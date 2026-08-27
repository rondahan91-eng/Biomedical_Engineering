"""
משנה את שמות תיקיות הערכות לעברית.

למה זה עדין: שם התיקייה אינו קישוט. הוא נכנס ל-Teachable Machine כשם
המחלקה, משם ל-metadata.json של המודל, ומשם לכלי ההערכה - שגוזר ממנו את
התווית. שינוי שם שלא מלווה בעדכון LABEL_RULES הופך דיוק של 92% ל-8%,
בשקט, בלי הודעת שגיאה. זה קרה כאן פעם.

לכן הסקריפט:
  1. מריץ יבש כברירת מחדל
  2. מסרב לשנות שם שאינו במיפוי, במקום לנחש
  3. מוודא שכל שם עברי חדש מזוהה על ידי אותם כללים שבכלים
  4. כותב יומן שינויים, כדי שאפשר יהיה לחזור אחורה

הרצה:
    py tools/rename_to_hebrew.py --root "C:\\Users\\ronda\\Desktop\\malaria_work"
    py tools/rename_to_hebrew.py --root "..." --apply
"""
import argparse
import csv
import io
import os
import re
import sys
from pathlib import Path

# --- שמות המחלקות. אלה שנכנסים ל-Teachable Machine ולמודל. ---
CLASS_MAP = {
    'Parasitized': 'נגוע',
    'Uninfected':  'תקין',
    'PNEUMONIA':   'דלקת ריאות',
    'NORMAL':      'תקין',
}

# --- תיקיות מכילות. אלה שהתלמיד/ה מנווט/ת בהן. ---
DIR_MAP = {
    'benchmark':       'ערכת מבחן',
    'benchmark_blind': 'ערכת מבחן עיוורת',
    'pool':            'בריכת תמונות',
    'train':           'אימון',
    'experiments':     'ניסויים',
    'curve':           'עקומת למידה',
    'balance':         'יחסי איזון',
    'source':          'הכללה בין מקורות',
    'train_a':         'אימון מקור א',
    'train_b':         'אימון מקור ב',
    'bench_a':         'מבחן מקור א',
    'bench_b':         'מבחן מקור ב',
}

# --- תבניות עם מספר. הריפוד נשמר כדי שהמיון יישאר נכון. ---
PATTERNS = [
    (re.compile(r'^n(\d{4})$'),          lambda m: f'גודל {m.group(1)}'),
    (re.compile(r'^r(\d+)_(\d+)$'),      lambda m: f'יחס {m.group(1)}-{m.group(2)}'),
]

# אותם כללים שבכלים (tools/evaluate, tools/perturb). כל שם מחלקה חדש חייב
# ליפול לאחד מהם, אחרת הכלי ידלג על התיקייה או - גרוע יותר - יהפוך תוויות.
LABEL_RULES = [
    (re.compile(r'uninfected|unaffected', re.I), 'normal'),
    (re.compile(r'abnormal', re.I),              'abnormal'),
    (re.compile(r'^normal|[^b]normal', re.I),    'normal'),
    (re.compile(r'pneumonia|parasitized|positive|tumou?r|malignant|diseased|'
                r'sick|fracture|חריג|חיובי|נגוע|דלקת', re.I), 'abnormal'),
    (re.compile(r'negative|healthy|benign|תקין|שלילי', re.I), 'normal'),
]
EXPECTED = {'נגוע': 'abnormal', 'תקין': 'normal', 'דלקת ריאות': 'abnormal'}


def label_of(name):
    for rx, lab in LABEL_RULES:
        if rx.search(name):
            return lab
    return None


def new_name(old):
    if old in CLASS_MAP:
        return CLASS_MAP[old], 'מחלקה'
    if old in DIR_MAP:
        return DIR_MAP[old], 'מכילה'
    for rx, fn in PATTERNS:
        m = rx.match(old)
        if m:
            return fn(m), 'תבנית'
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--apply', action='store_true', help='ללא זה - הרצה יבשה')
    args = ap.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        sys.exit(f'לא נמצא: {root}')

    # אימות מקדים: כל שם מחלקה חדש חייב להיות מזוהה נכון
    problems = []
    for heb, want in EXPECTED.items():
        got = label_of(heb)
        if got != want:
            problems.append(f'"{heb}" מזוהה כ-{got}, ציפינו ל-{want}')
    if problems:
        sys.exit('כללי התוויות אינם מכסים את השמות החדשים:\n  ' + '\n  '.join(problems))
    print('כללי התוויות מכסים את כל השמות החדשים ✓\n')

    # מהעמוק לרדוד, אחרת הנתיב של הילד משתנה תחת הרגליים
    dirs = sorted((p for p in root.rglob('*') if p.is_dir()),
                  key=lambda p: len(p.parts), reverse=True)

    plan, skipped = [], []
    for d in dirs:
        nn, kind = new_name(d.name)
        if nn is None:
            skipped.append(d)
            continue
        if nn == d.name:
            continue
        plan.append((d, d.with_name(nn), kind))

    print(f'{"מ":<24}{"אל":<24}{"סוג"}')
    print('-' * 60)
    for old, new, kind in plan:
        print(f'{old.name:<24}{new.name:<24}{kind}')
    print(f'\nסה"כ: {len(plan)} תיקיות')

    if skipped:
        print(f'\nלא במיפוי ולכן לא ישונו ({len(skipped)}):')
        for d in sorted({s.name for s in skipped}):
            print(f'  {d}')

    # התנגשות: שתי תיקיות שונות שיקבלו אותו שם באותו הורה
    seen = {}
    for old, new, _ in plan:
        key = str(new)
        if key in seen:
            sys.exit(f'התנגשות: {old} ו-{seen[key]} שניהם ל-{new}')
        seen[key] = old
    for old, new, _ in plan:
        if new.exists() and new != old:
            sys.exit(f'היעד כבר קיים: {new}')

    if not args.apply:
        print('\nהרצה יבשה. הוסיפו --apply כדי לבצע.')
        return

    log = []
    for old, new, kind in plan:
        os.rename(old, new)
        log.append([str(old.relative_to(root)), str(new.relative_to(root)), kind])

    logf = root / 'שינוי_שמות.csv'
    with io.open(logf, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(['old', 'new', 'kind'])
        w.writerows(log)

    # אימות מהדיסק
    print(f'\n[OK] שונו {len(log)} תיקיות. יומן: {logf.name}')
    print('\nמצב אחרי:')
    for d in sorted(root.rglob('*')):
        if not d.is_dir():
            continue
        n = len([f for f in d.iterdir() if f.suffix.lower() in ('.png', '.jpg', '.jpeg')])
        if n:
            print(f'  {d.relative_to(root)}: {n}')


if __name__ == '__main__':
    main()
