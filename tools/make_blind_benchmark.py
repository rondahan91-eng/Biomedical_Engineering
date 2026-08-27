"""
בונה ערכת מבחן עיוורת מתוך ערכת מבחן מתויגת.

למה זה נחוץ:
ערכת המבחן בנויה כתיקייה לכל מחלקה - כלי ההערכה קורא ממנה את התווית האמיתית.
זה נכון עבור הכלי, אבל הופך כל תרגיל "סווג בעצמך לפני שהמודל מסווג" לחסר
משמעות: התשובה כתובה בשם התיקייה. בחלק מהמאגרים היא כתובה גם בשם הקובץ -
במאגר הריאות 156 מתוך 200 קבצים מכילים "bacteria" או "virus", וכל אחד מהם
הוא PNEUMONIA.

הפתרון: עותק שטוח עם שמות ממוספרים מחדש, בסדר מעורבב. התלמיד/ה רואה
img_001 ... img_200 ותו לא.

הפלט מתפצל לשניים בכוונה:
  <out>/                                 לשיתוף - התמונות בלבד
  דף עבודה - ערכת מבחן עיוורת.csv        לשיתוף - דף עבודה ריק
  <key-dir>/מפתח - ערכת מבחן עיוורת.csv  לא לשיתוף - התווית והשם המקורי

הרצה:
    py tools/make_blind_benchmark.py \
        --benchmark "C:\\Users\\ronda\\Desktop\\malaria_work\\benchmark" \
        --out       "C:\\Users\\ronda\\Desktop\\malaria_work\\benchmark_blind" \
        --key-dir   "C:\\Users\\ronda\\Desktop\\מפתחות_תשובות\\malaria"
"""
import argparse
import csv
import io
import os
import random
import re
import shutil
import sys
from pathlib import Path

EXTS = ('.png', '.jpg', '.jpeg')
SEED = 20260826

# מילים ששם קובץ עיוור לעולם לא אמור להכיל
TELLS = ('parasit', 'uninfect', 'infect', 'normal', 'pneumonia',
         'bacteria', 'virus', 'abnormal', 'positive', 'negative')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--benchmark', required=True, help='תיקיית מבחן עם תת-תיקייה לכל מחלקה')
    ap.add_argument('--out', required=True, help='תיקיית הפלט העיוורת (שטוחה)')
    ap.add_argument('--key-dir', required=True, help='לאן יישמר מפתח התשובות')
    ap.add_argument('--prefix', default='img', help='קידומת לשמות החדשים')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    bench, out, keydir = Path(args.benchmark), Path(args.out), Path(args.key_dir)
    if not bench.is_dir():
        sys.exit(f'לא נמצא: {bench}')

    classes = sorted((d for d in bench.iterdir() if d.is_dir()), key=lambda p: p.name.lower())
    items = []
    for d in classes:
        for f in sorted(d.iterdir()):
            if f.suffix.lower() in EXTS:
                items.append((f, d.name))
    if not items:
        sys.exit(f'לא נמצאו תמונות תחת {bench}')

    # ערבוב דטרמיניסטי: אותה ערכה תיתן תמיד את אותו מיפוי, כדי שאפשר יהיה
    # לשחזר בדיקה של תלמיד/ה גם אחרי חודש.
    rng = random.Random(SEED)
    rng.shuffle(items)

    width = max(3, len(str(len(items))))
    rows = []
    for i, (src, cls) in enumerate(items, 1):
        blind = f'{args.prefix}_{i:0{width}d}{src.suffix.lower()}'
        rows.append({'blind': blind, 'true_label': cls,
                     'original': src.name, 'source_path': str(src)})

    # --- אימות לפני כתיבה ---
    problems = []
    for r in rows:
        low = r['blind'].lower()
        hit = [t for t in TELLS if t in low]
        if hit:
            problems.append(f"{r['blind']} מכיל {hit}")
    if len(set(r['blind'] for r in rows)) != len(rows):
        problems.append('שמות עיוורים כפולים')
    if problems:
        sys.exit('אימות נכשל:\n  ' + '\n  '.join(problems))

    print(f'Benchmark: {bench}')
    print(f'Out:       {out}')
    print(f'Key:       {keydir}')
    print(f'Mode:      {"DRY RUN" if args.dry_run else "COPY"}\n')

    counts = {}
    for r in rows:
        counts[r['true_label']] = counts.get(r['true_label'], 0) + 1
    for c, n in sorted(counts.items()):
        print(f'  {c:<16} {n}')
    print(f'  {"סה״כ":<16} {len(rows)}')

    # האם הסדר החדש מתואם עם המחלקה? חצי ראשון מול חצי שני.
    half = len(rows) // 2
    first = sum(1 for r in rows[:half] if r['true_label'] == classes[0].name)
    print(f'\n  בדיקת ערבוב: {classes[0].name} בחצי הראשון {first}/{half} '
          f'(מצופה סביב {counts.get(classes[0].name, 0) // 2})')

    if args.dry_run:
        print('\nDry run only.')
        return

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    keydir.mkdir(parents=True, exist_ok=True)

    for r in rows:
        shutil.copy2(r['source_path'], out / r['blind'])

    # דף עבודה - ליד התמונות, לשיתוף
    ws = out.parent / 'דף עבודה - ערכת מבחן עיוורת.csv'
    with io.open(ws, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['image', 'my_label', 'confidence_1_5', 'notes'])
        for r in rows:
            w.writerow([r['blind'], '', '', ''])

    # מפתח - הרחק משם
    key = keydir / 'מפתח - ערכת מבחן עיוורת.csv'
    with io.open(key, 'w', encoding='utf-8-sig', newline='') as fh:
        w = csv.writer(fh)
        w.writerow(['blind_name', 'true_label', 'original_name'])
        for r in rows:
            w.writerow([r['blind'], r['true_label'], r['original']])

    # --- אימות אחרי כתיבה: נספר מהדיסק, לא מהתוכנית ---
    on_disk = sorted(f.name for f in out.iterdir() if f.suffix.lower() in EXTS)
    print(f'\nOn disk: {len(on_disk)} תמונות ב-{out.name}')
    bad = [n for n in on_disk if any(t in n.lower() for t in TELLS)]
    print(f'  שמות שמסגירים תווית: {len(bad)}')
    print(f'  דף עבודה: {ws.name}')
    print(f'  מפתח:     {key}')
    if len(on_disk) != len(rows):
        sys.exit(f'[!] נכתבו {len(on_disk)} מתוך {len(rows)} - הפלט אינו שלם')
    print('\n[OK] Done.')


if __name__ == '__main__':
    main()
