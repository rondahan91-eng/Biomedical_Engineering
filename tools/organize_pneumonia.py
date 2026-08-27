"""
מארגן את מאגר צילומי החזה (Kermany) לתיקיות אימון ומבחן.

שלוש בעיות מתועדות במאגר, ואיך הן מטופלות כאן:

1. personNNNN אינו מזהה מטופל ייחודי - 979 מזהים מופיעים גם כ-bacteria וגם
   כ-virus, כלומר שתי תת-הקבוצות מוספרו בנפרד. מפתח הקיבוץ הוא person+סוג.
2. 84% ממזהי ה-test מופיעים גם ב-train (דליפה מתועדת). לכן מאחדים את שלוש
   החלוקות המקוריות ומחלקים מחדש בעצמנו.
3. תמונות NORMAL חסרות מזהה מטופל. משתמשים במזהה IM-#### כמפתח חלקי -
   הוא מקבץ לפחות את הצילומים החוזרים של אותה בדיקה.

הפרדה: כל קבוצת תמונות (אותו מטופל/בדיקה) הולכת בשלמותה לאימון או למבחן,
לעולם לא מתפצלת - אחרת המודל נבחן על מה שכמעט ראה.

מבנה הפלט:
  chest_work/
    train/NORMAL|PNEUMONIA/     400 בכל אחת (מאוזן)
    benchmark/NORMAL|PNEUMONIA/ 100 בכל אחת (מאוזן, נעול)
    benchmark_answers.csv
    benchmark_blank.csv
    manifest.csv                מקור כל תמונה, לשחזור

הרצה:
    py tools/organize_pneumonia.py --dry-run
    py tools/organize_pneumonia.py
"""
import csv
import os
import random
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

SRC = Path(r'C:\Users\ronda\Downloads\archive\chest_xray')
OUT = Path(r'C:\Users\ronda\Desktop\chest_work')

BENCH_PER_CLASS = 100
POOL_PER_CLASS = 800
SEED = 20260813

# שם התיקייה הוא שם המחלקה ב-Teachable Machine ובמודל. ראו ההערה
# ב-tools/rename_to_hebrew.py - חייב להיות מזוהה על ידי LABEL_RULES שבכלים.
CLASS_HE = {'NORMAL': 'תקין', 'PNEUMONIA': 'דלקת ריאות'}
SET_HE   = {'benchmark': 'ערכת מבחן', 'pool': 'בריכת תמונות'}

PNEU_RE = re.compile(r'(person\d+)_(\w+?)_', re.I)
NORM_RE = re.compile(r'(?:NORMAL2-)?IM-(\d+)-(\d+)', re.I)


def collect():
    """אוסף את כל התמונות משלוש החלוקות המקוריות ומקבץ אותן לפי מטופל/בדיקה."""
    groups = defaultdict(list)          # key -> [(path, cls, subtype)]
    for split in ('train', 'test', 'val'):
        for cls in ('NORMAL', 'PNEUMONIA'):
            d = SRC / split / cls
            if not d.is_dir():
                continue
            for fn in sorted(os.listdir(d)):
                if not fn.lower().endswith(('.jpeg', '.jpg', '.png')):
                    continue
                p = d / fn
                if cls == 'PNEUMONIA':
                    m = PNEU_RE.match(fn)
                    sub = m.group(2).lower() if m else 'unknown'
                    # ה-split אינו במפתח. קודם הוא כן נכלל, בנימוק שאי אפשר
                    # לדעת אם person1 ב-train ו-person1 ב-test הם אותו אדם -
                    # אבל "אי אפשר לדעת" מחייב את ההנחה הזהירה, לא ההפוכה.
                    # נמדדו 4 מטופלים שנפלו כך גם במבחן וגם בבריכה.
                    key = ('PNEUMONIA', m.group(1).lower() if m else fn, sub)
                else:
                    m = NORM_RE.match(fn)
                    sub = 'normal'
                    # ל-NORMAL אין split במפתח, בשונה מ-PNEUMONIA. IM-#### הוא
                    # מספר בדיקה שנראה גלובלי, ו-"NORMAL2-IM-0201" הוא אצווה
                    # שנייה של אותו מספר: נמדדו 12 מקרים שבהם אותו מספר נפל
                    # גם בערכת המבחן וגם בבריכה, כי ה-split הפריד ביניהם.
                    # אי אפשר לשלול שזה אותו מטופל, ולכן מניחים שכן - המחיר
                    # של זהירות הוא כמה תמונות, המחיר של טעות הוא ציון מנופח.
                    key = ('NORMAL', m.group(1) if m else fn, sub)
                groups[key].append((p, cls, sub))
    return groups


def main():
    dry = '--dry-run' in sys.argv
    if not SRC.is_dir():
        sys.exit(f'Source not found: {SRC}')

    groups = collect()
    by_cls = defaultdict(list)
    for key, items in groups.items():
        by_cls[key[0]].append((key, items))

    rng = random.Random(SEED)
    plan, summary = [], []

    for cls in ('NORMAL', 'PNEUMONIA'):
        gs = sorted(by_cls[cls], key=lambda x: str(x[0]))
        rng.shuffle(gs)

        # קודם ה-benchmark, ורק ממה שנשאר בונים את האימון - כך שאף קבוצה
        # לא יכולה להופיע בשניהם
        def take(pool, target):
            picked, imgs = [], []
            for key, items in pool:
                if len(imgs) >= target:
                    break
                picked.append(key)
                imgs.extend(items)
            return picked, imgs[:target]

        # ערכת המבחן נבחרת ראשונה ובאותו seed, ולכן היא זהה בכל הרצה -
        # תנאי הכרחי, כי הערכה העיוורת והמפתח שלה נגזרו ממנה.
        bench_keys, bench = take(gs, BENCH_PER_CLASS)
        used = set(bench_keys)
        rest = [(k, i) for k, i in gs if k not in used]
        _, pool = take(rest, POOL_PER_CLASS)

        plan.append((cls, 'benchmark', bench))
        plan.append((cls, 'pool', pool))

        subs = defaultdict(int)
        for p, c, s in pool:
            subs[s] += 1
        summary.append((cls, len(bench), len(pool), dict(subs)))

    # ביצוע
    # מנקים את תיקיות היעד. בלי זה הרצה חוזרת *מוסיפה* לקיים, וכשהבחירה
    # משתנה בין הרצות התיקייה מתמלאת בתערובת של שתיהן - נמדדו 190 תמונות
    # בערכת מבחן שאמורה להכיל 100, וחלקן הופיעו גם בבריכה.
    # מוחקים קובצי תמונה בלבד ולא את התיקיות עצמן: ב-Windows נשאר בהן
    # desktop.ini עם תכונת מערכת, ו-rmtree נכשל עליו בשגיאת הרשאה.
    if not dry:
        removed = 0
        for name in SET_HE.values():
            d = OUT / name
            if not d.exists():
                continue
            for f in d.rglob('*'):
                if f.is_file() and f.suffix.lower() in ('.jpeg', '.jpg', '.png'):
                    f.unlink(); removed += 1
        if removed:
            print(f'נוקו {removed} תמונות מהרצה קודמת\n')

    manifest = []
    for cls, dest, imgs in plan:
        out_dir = OUT / SET_HE.get(dest, dest) / CLASS_HE.get(cls, cls)
        if not dry:
            out_dir.mkdir(parents=True, exist_ok=True)
        for src_path, c, sub in imgs:
            name = f'{sub}__{src_path.name}' if cls == 'PNEUMONIA' else src_path.name
            if not dry:
                shutil.copy2(src_path, out_dir / name)
            manifest.append([dest, cls, sub, name, str(src_path)])

    if not dry:
        OUT.mkdir(parents=True, exist_ok=True)
        with open(OUT / 'manifest.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f)
            w.writerow(['set', 'class', 'subtype', 'filename', 'source_path'])
            w.writerows(manifest)

        bench_rows = [(r[3], CLASS_HE.get(r[1], r[1])) for r in manifest if r[0] == 'benchmark']
        with open(OUT / 'benchmark_answers.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f); w.writerow(['image', 'true_label'])
            w.writerows(bench_rows)
        shuffled = [r[0] for r in bench_rows]
        rng.shuffle(shuffled)
        with open(OUT / 'benchmark_blank.csv', 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.writer(f); w.writerow(['image', 'my_label', 'confidence_1_5', 'notes'])
            for n in shuffled:
                w.writerow([n, '', '', ''])

    # דיווח - נספר מהדיסק ולא מהתוכנית
    print(f'Source: {SRC}')
    print(f'Output: {OUT}')
    print(f'Mode:   {"DRY RUN" if dry else "COPY"}\n')
    print(f'{"class":<12}{"benchmark":>10}{"pool":>8}   pool breakdown')
    print('-' * 58)
    for cls, nb, nt, subs in summary:
        bd = ', '.join(f'{k}={v}' for k, v in sorted(subs.items()))
        print(f'{cls:<12}{nb:>10}{nt:>8}   {bd}')
    print('-' * 58)

    if not dry:
        print('\nActual files on disk:')
        for dest in ('pool', 'benchmark'):
            for cls in ('NORMAL', 'PNEUMONIA'):
                d = OUT / SET_HE[dest] / CLASS_HE[cls]
                n = len(list(d.glob('*'))) if d.is_dir() else 0
                print(f'  {SET_HE[dest]}/{CLASS_HE[cls]}: {n}')
        print('\n[OK] Done.')
    else:
        print('\nDry run only. Re-run without --dry-run to copy.')


if __name__ == '__main__':
    main()
