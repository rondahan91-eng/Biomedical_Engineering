"""
מחולל ערכות אימון לניסויים.

בונה תיקיות מוכנות לגרירה ל-Teachable Machine, אחת לכל תנאי ניסוי.
עובד על כל מאגר שבנוי כתיקיית-על עם תת-תיקייה לכל מחלקה.

שלושת הניסויים:
  curve    - עקומת למידה: אותו יחס, גדלים עולים
  balance  - יחסי איזון: אותו סך הכל, יחסים שונים
  source   - הכללה: אימון על תת-מקור אחד בלבד

עקרון קריטי - קינון:
ערכת ה-50 מכילה את כל ה-25, ערכת ה-100 את כל ה-50, וכן הלאה. בלי זה,
הפרש בין שתי נקודות בעקומה עלול לנבוע מ*אילו* תמונות נבחרו ולא מ*כמה* -
והניסוי מודד רעש במקום מגמה.

הרצה:
    py tools/make_experiment_sets.py --source <pool> --out <dir> --experiment curve
    py tools/make_experiment_sets.py --source <pool> --out <dir> --experiment balance
    py tools/make_experiment_sets.py --source <pool> --out <dir> --experiment source \
        --group-a "NThinF" --group-b "(?<!N)ThinF" --group-regex "(.+?)_cell_"

    הוסיפו --exclude <benchmark_dir> כדי לוודא שאף תמונת מבחן לא נכנסת.
"""
import argparse
import csv
import io
import random
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

# שמות התיקיות בעברית. שם התיקייה נכנס ל-Teachable Machine כשם המחלקה
# ומשם ל-metadata.json, ולכן הוא חייב להיות מזוהה על ידי LABEL_RULES שבכלים -
# ראו tools/rename_to_hebrew.py, שמאמת בדיוק את זה לפני שהוא נוגע בדיסק.
CLASS_HE = {'Parasitized': 'נגוע', 'Uninfected': 'תקין',
            'PNEUMONIA': 'דלקת ריאות', 'NORMAL': 'תקין'}
EXP_HE = {'curve': 'עקומת למידה', 'balance': 'יחסי איזון',
          'source': 'הכללה בין מקורות'}


def he(name):
    """שם עברי אם ידוע, אחרת השם כפי שהוא."""
    return CLASS_HE.get(name, name)


CURVE_SIZES = [25, 50, 100, 200, 400]
BALANCE_TOTAL = 400            # סך הכל קבוע, רק היחס משתנה
BALANCE_RATIOS = [(50, 50), (70, 30), (90, 10)]
SEED = 20260817
EXTS = ('.png', '.jpg', '.jpeg')


def class_dirs(root: Path):
    ds = sorted((d for d in root.iterdir() if d.is_dir()),
                key=lambda p: p.name.lower())
    return [d for d in ds if any(f.suffix.lower() in EXTS for f in d.iterdir())]


def excluded_names(paths):
    """שמות קבצים שאסור להם להיכנס לאימון (בדרך כלל ערכת המבחן)."""
    names = set()
    for p in paths:
        p = Path(p)
        if p.is_dir():
            for f in p.rglob('*'):
                if f.suffix.lower() in EXTS:
                    names.add(f.name)
    return names


def write(sets, out_root, manifest_rows, dry):
    # מנקים כל תיקיית יעד לפני הכתיבה. בלי זה הרצה חוזרת *מוסיפה* לקיים,
    # וכשהבחירה משתנה בין הרצות התיקייה מתמלאת בתערובת של שתיהן - נמדדו 323
    # תמונות בערכה שאמורה להכיל 200. מוחקים קבצים ולא תיקיות: ב-Windows
    # נשאר בהן desktop.ini עם תכונת מערכת, ו-rmtree נכשל עליו.
    if not dry:
        for rel, _ in sets:
            dest = out_root / rel
            if dest.is_dir():
                for f in dest.iterdir():
                    if f.is_file() and f.suffix.lower() in EXTS:
                        f.unlink()

    for rel, files in sets:
        dest = out_root / rel
        if not dry:
            dest.mkdir(parents=True, exist_ok=True)
            for f in files:
                shutil.copy2(f, dest / f.name)
        for f in files:
            manifest_rows.append([str(rel), dest.name, f.name, str(f)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True, help='בריכת תמונות: תיקייה עם תת-תיקיית מחלקה')
    ap.add_argument('--out', required=True)
    ap.add_argument('--experiment', required=True, choices=['curve', 'balance', 'source'])
    ap.add_argument('--exclude', nargs='*', default=[], help='תיקיות שתמונותיהן אסורות (benchmark)')
    ap.add_argument('--group-a', default=None, help='ביטוי רגולרי שמזהה מקור א׳')
    ap.add_argument('--group-b', default=None, help='ביטוי רגולרי שמזהה מקור ב׳')
    ap.add_argument('--group-regex', nargs='*', default=None,
                    help='ביטוי אחד או יותר לחילוץ מזהה מקור משם הקובץ. '
                         'נבדקים לפי הסדר, הראשון שתואם קובע.')
    ap.add_argument('--source-bench', type=int, default=50, help='גודל ערכת מבחן לכל מקור')
    ap.add_argument('--source-cap', type=int, default=200, help='תקרת אימון לכל מקור')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    src, out = Path(args.source), Path(args.out)
    if not src.is_dir():
        sys.exit(f'לא נמצא: {src}')
    classes = class_dirs(src)
    if len(classes) < 2:
        sys.exit(f'נדרשות לפחות שתי תת-תיקיות מחלקה תחת {src}')

    banned = excluded_names(args.exclude)
    rng = random.Random(SEED)
    pools = {}
    for d in classes:
        files = sorted(f for f in d.iterdir()
                       if f.suffix.lower() in EXTS and f.name not in banned)
        rng.shuffle(files)
        pools[d.name] = files

    print(f'Source: {src}')
    print(f'Output: {out}')
    print(f'Mode:   {"DRY RUN" if args.dry_run else "COPY"}')
    if banned:
        print(f'Excluded {len(banned)} benchmark filenames')
    for k, v in pools.items():
        print(f'  {k}: {len(v)} available')
    print()

    sets, rows = [], []
    exp = args.experiment

    if exp == 'curve':
        # קינון: כל גודל הוא רישא של אותה רשימה מעורבבת
        for n in CURVE_SIZES:
            short = min(n, min(len(v) for v in pools.values()))
            if short < n:
                print(f'  [!] רק {short} זמינות - מדלג על {n}')
                continue
            for cls, files in pools.items():
                sets.append((Path(EXP_HE['curve']) / f'גודל {n:04d}' / he(cls), files[:n]))

    elif exp == 'balance':
        names = list(pools)
        if len(names) != 2:
            sys.exit('ניסוי האיזון מוגדר לשתי מחלקות בלבד')
        for a_pct, b_pct in BALANCE_RATIOS:
            na = BALANCE_TOTAL * a_pct // 100
            nb = BALANCE_TOTAL * b_pct // 100
            if len(pools[names[0]]) < na or len(pools[names[1]]) < nb:
                print(f'  [!] אין מספיק תמונות ליחס {a_pct}/{b_pct} - מדלג')
                continue
            tag = Path(EXP_HE['balance']) / f'יחס {a_pct}-{b_pct}'
            sets.append((tag / he(names[0]), pools[names[0]][:na]))
            sets.append((tag / he(names[1]), pools[names[1]][:nb]))

    else:  # source
        if not (args.group_a and args.group_b):
            sys.exit('ניסוי ההכללה דורש --group-a ו---group-b')

        # ההתאמה היא ביטוי רגולרי ולא תת-מחרוזת. במלריה המקורות נבדלים
        # בווריאנט של שם הקובץ, ו-"ThinF" מוכל בתוך "NThinF" - התאמת
        # תת-מחרוזת הייתה משייכת את אותם קבצים לשני המקורות.
        try:
            rx_a = re.compile(args.group_a, re.I)
            rx_b = re.compile(args.group_b, re.I)
        except re.error as e:
            sys.exit(f'ביטוי רגולרי שגוי: {e}')

        # אפשר לתת כמה ביטויים: מאגר אחד יכול להכיל כמה משפחות שמות, ומחלקת
        # בקרה בדרך כלל נקראת אחרת מהמחלקה שמתפצלת. ביטוי יחיד שאינו תואם
        # אותה גורם לכל קובץ בה להיחשב מקור נפרד, וההפרדה ברמת מטופל נשברת
        # בלי שאיש ישים לב - נמדדו 34 מטופלים שנפלו כך לשני הצדדים.
        grps = [re.compile(g) for g in (args.group_regex or [])]

        def slide_of(f):
            for g in grps:
                m = g.search(f.name)
                if m:
                    return m.group(1)
            return f.name

        if grps:
            unmatched = {cls: sum(1 for f in fs if not any(g.search(f.name) for g in grps))
                         for cls, fs in pools.items()}
            miss = {c: n for c, n in unmatched.items() if n}
            if miss:
                print('  [!] קבצים שאף ביטוי קיבוץ לא תואם, ולכן כל אחד מהם '
                      'ייחשב מקור נפרד:')
                for c, n in miss.items():
                    print(f'      {c}: {n} מתוך {len(pools[c])}')
                print()

        # פיצול לפי מקור, ובתוך כל מקור - קיבוץ לפי שקופית/מטופל.
        #
        # מחלקה שאינה תואמת אף אחד מהדפוסים היא מחלקת *בקרה*: היא קיימת בשני
        # המקורות, ולכן היא מחולקת ביניהם לשני חצאים זרים. בלי זה, ניסוי שבו
        # רק המחלקה החריגה מתפצלת (bacteria מול virus, בעוד "תקין" משותף)
        # היה מייצר ערכות אימון בעלות מחלקה אחת בלבד.
        srcs = {'a': {}, 'b': {}}
        controls = []
        for cls, files in pools.items():
            hit_a = [f for f in files if rx_a.search(f.name)]
            hit_b = [f for f in files if rx_b.search(f.name)]
            if hit_a or hit_b:
                for tag, hits in (('a', hit_a), ('b', hit_b)):
                    by = defaultdict(list)
                    for f in hits:
                        by[slide_of(f)].append(f)
                    srcs[tag][cls] = by
            else:
                controls.append(cls)
                by = defaultdict(list)
                for f in files:
                    by[slide_of(f)].append(f)
                keys = sorted(by)
                rng.shuffle(keys)
                half = len(keys) // 2
                srcs['a'][cls] = {k: by[k] for k in keys[:half]}
                srcs['b'][cls] = {k: by[k] for k in keys[half:]}

        # מקור שנופל בשני הצדדים ישבור את הניסוי
        for cls in pools:
            both = set(srcs['a'][cls]) & set(srcs['b'][cls])
            if both:
                sys.exit(f'{len(both)} מקורות ב-{cls} תואמים את שני הביטויים. '
                         'המקורות חייבים להיות זרים - בדקו את --group-regex: '
                         'הוא צריך לחלץ מזהה ייחודי, כולל מה שמבדיל בין הדפוסים.')
        if controls:
            print(f'  מחלקות בקרה (מחולקות בין המקורות): {", ".join(controls)}')

        # ערכת מבחן נפרדת לכל מקור, נלקחת ראשונה וברמת שקופית. בלי זה אי אפשר
        # למדוד הכללה: הערכה המשותפת מכילה תערובת, וציון עליה מערבב מקור מוכר
        # עם מקור חדש.
        #
        # החלוקה חוצה מחלקות בתוך כל מקור. שקופית אחת יכולה לתרום תאים לשתי
        # המחלקות, ולכן חלוקה נפרדת לכל מחלקה הייתה מציבה אותה במבחן דרך אחת
        # ובאימון דרך השנייה - נמדד מקרה כזה במלריה.
        def carve_source(by_cls, n):
            """מחלק את מקורות המקור בין מבחן לאימון, פעם אחת לכל המחלקות."""
            owners = defaultdict(list)          # מקור -> [(מחלקה, קבצים)]
            for cls, by in by_cls.items():
                for k, fs in by.items():
                    owners[k].append((cls, fs))
            keys = sorted(owners)
            rng.shuffle(keys)

            need = {c: n for c in by_cls}
            bench_keys = set()
            for k in keys:
                if all(v <= 0 for v in need.values()):
                    break
                bench_keys.add(k)
                for cls, fs in owners[k]:
                    need[cls] -= len(fs)

            out = {}
            for cls, by in by_cls.items():
                b = [f for k in by if k in bench_keys for f in by[k]]
                r = [f for k in by if k not in bench_keys for f in by[k]]
                out[cls] = (b[:n], r)
            return out

        nb = args.source_bench
        carved_by_src = {t: carve_source(srcs[t], nb) for t in ('a', 'b')}
        carved = {t: {c: carved_by_src[t][c] for c in pools} for t in ('a', 'b')}

        # גודל אימון זהה לשני המקורות - אחרת ההפרש בין הרצות משקף גם כמות
        # וגם מקור, ולא נדע מי אחראי.
        avail = [len(carved[t][c][1]) for t in ('a', 'b') for c in pools]
        n_train = min(min(avail), args.source_cap)
        print(f'  מקור א׳: /{args.group_a}/   מקור ב׳: /{args.group_b}/')
        for t in ('a', 'b'):
            for c in pools:
                b, r = carved[t][c]
                print(f'    {t}·{c:<14} מבחן {len(b):>3}  זמין לאימון {len(r):>4}')
        print(f'  גודל אימון אחיד: {n_train} לכל מחלקה')
        if n_train < 25:
            print('  [!] ערכה קטנה מאוד - התוצאה תהיה רועשת')
        print()

        for t, label in (('a', args.group_a), ('b', args.group_b)):
            for cls in pools:
                bench, rest = carved[t][cls]
                side = 'א' if t == 'a' else 'ב'
                root = Path(EXP_HE['source'])
                sets.append((root / f'אימון מקור {side}' / he(cls), rest[:n_train]))
                sets.append((root / f'מבחן מקור {side}' / he(cls), bench))

    if not sets:
        sys.exit('לא נוצרה אף ערכה - בדקו את הפרמטרים.')

    write(sets, out, rows, args.dry_run)

    # דיווח נספר מהתוכנית, ואחריו אימות מהדיסק
    print(f'{"set":<22}{"class":<20}{"images":>8}')
    print('-' * 50)
    for rel, files in sets:
        print(f'{str(rel.parent):<22}{rel.name:<20}{len(files):>8}')

    if not args.dry_run:
        out.mkdir(parents=True, exist_ok=True)
        # המניפסט מצטבר ואינו נדרס. כל ניסוי נבנה בהרצה נפרדת, וכתיבה במצב 'w'
        # מחקה את התיעוד של הניסויים הקודמים - אחרי שלוש הרצות נשאר תיעוד של
        # האחרונה בלבד. שורה מזוהה לפי (set, filename), כך שהרצה חוזרת של אותו
        # ניסוי מעדכנת במקום לשכפל.
        man = out / 'manifest.csv'
        merged, seen = [], set()
        if man.exists():
            with io.open(man, encoding='utf-8-sig', newline='') as f:
                for r in csv.reader(f):
                    if len(r) == 4 and r[0] != 'set':
                        merged.append(r); seen.add((r[0], r[2]))
        kept = len(merged)
        replaced = 0
        new_keys = {(r[0], r[2]) for r in rows}
        if new_keys & seen:
            merged = [r for r in merged if (r[0], r[2]) not in new_keys]
            replaced = kept - len(merged)
        merged.extend(rows)
        with io.open(man, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['set', 'class', 'filename', 'source_path'])
            w.writerows(merged)
        print(f'\nManifest: {len(rows)} חדשות + {kept - replaced} קיימות'
              f'{f" ({replaced} הוחלפו)" if replaced else ""} = {len(merged)} שורות')
        print('\nOn disk:')
        for d in sorted(p for p in out.rglob('*') if p.is_dir()):
            n = len([f for f in d.iterdir() if f.suffix.lower() in EXTS])
            if n:
                print(f'  {d.relative_to(out)}: {n}')
        print('\n[OK] Done.')
    else:
        print('\nDry run only.')


if __name__ == '__main__':
    main()
