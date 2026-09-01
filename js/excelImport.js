// ==========================================================================
// excelImport.js - פרשור קובץ Excel של תלמידים + חישוב פרטי התחברות.
// משתמש בספריית SheetJS הגלובלית (XLSX) שנטענת ב-index.html.
//
// הערת פרטיות: תעודת הזהות המלאה נקראת מהקובץ *רק בדפדפן*, משמשת לחישוב
// 4 הספרות האחרונות (לשם המשתמש) ואז נזרקת - היא לעולם לא מוחזרת מהפונקציה
// הזו ולא נשלחת לשרת (ראו FR-A3/NFR-2 באפיון).
// ==========================================================================

const HEADER_ALIASES = {
  firstName: ['שם פרטי'],
  lastName: ['שם משפחה'],
  idNumber: ['תעודת זהות מלאה', 'ת.ז', 'ת"ז', 'ת״ז', 'תעודת זהות', 'תז'],
  dob: ['תאריך לידה'],
  group: ['קבוצה'],
  note: ['הערה', 'הערות', 'הערה על התלמיד'],
};
// שדות שאינם חובה: שורה בלי ערך בהם עדיין מיובאת.
const OPTIONAL_FIELDS = ['note'];
const FIELD_LABELS = {
  firstName: 'שם פרטי', lastName: 'שם משפחה', idNumber: 'תעודת זהות מלאה',
  dob: 'תאריך לידה', group: 'קבוצה', note: 'הערה',
};

function normalizeHeader(h) {
  return String(h || '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim();
}

function buildFieldMap(sampleRow) {
  const rawHeaders = Object.keys(sampleRow);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeHeader);
    const found = rawHeaders.find(h => normalizedAliases.includes(normalizeHeader(h)));
    if (found) map[field] = found;
  }
  return map;
}

/** מפרש ערך תאריך לידה (Date אמיתי מ-SheetJS, או מחרוזת DD/MM/YYYY וכדומה). */
export function parseDob(value) {
  if (value instanceof Date && !isNaN(value)) {
    return {
      dd: String(value.getDate()).padStart(2, '0'),
      mm: String(value.getMonth() + 1).padStart(2, '0'),
      yy: String(value.getFullYear() % 100).padStart(2, '0'),
    };
  }
  const s = String(value || '').trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10), month = parseInt(m[2], 10);
  let year = m[3];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  year = year.length === 4 ? year.slice(2) : year.padStart(2, '0');
  return { dd: String(day).padStart(2, '0'), mm: String(month).padStart(2, '0'), yy: year };
}

/**
 * מפתח זהות של תלמיד/ה.
 *
 * שם המשתמש אינו זהות אלא נגזרת שלה, ולכן אי אפשר להסתמך עליו: שתי דנה
 * שונות ש-4 ספרות ת״ז שלהן זהות יקבלו את אותו שם משתמש, ואותה דנה בייבוא
 * חוזר תיראה כמו התנגשות. שם פרטי + שם משפחה + 4 ספרות מבדיל בין השניים -
 * אותו אדם מתאים בדיוק, אדם אחר נופל למפתח אחר.
 */
export function identityKey(firstName, lastName, last4) {
  const name = [firstName, lastName].map(x => String(x || '').trim().toLowerCase());
  return name.concat(normalizeLast4(last4)).join('|');
}

/**
 * 4 הספרות כמחרוזת בת 4 תווים - או מחרוזת ריקה אם אין ספרות כלל.
 *
 * Google Sheets שומר "0330" כמספר 330 ובולע את האפס המוביל, ולכן הערך שחוזר
 * מהשרת אינו זהה לזה שנגזר מהקובץ. בלי ההשוואה המנורמלת, כל תלמיד שת״ז שלו
 * מסתיימת באפס מוביל היה נראה כאדם חדש בכל ייבוא חוזר ומקבל חשבון כפול.
 *
 * ריק נשאר ריק ולא הופך ל-"0000": אחרת כל מי שאין לו 4 ספרות (למשל שורת
 * המורה) היה מתמזג לאותה זהות.
 */
function normalizeLast4(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-4).padStart(4, '0') : '';
}

/** שם משתמש = שם פרטי + 4 הספרות האחרונות של ת.ז, עם דה-דופ (_2, _3...). */
export function deriveUsername(firstName, idNumber, takenSet) {
  const digits = String(idNumber || '').replace(/\D/g, '');
  const last4 = digits.slice(-4).padStart(4, '0');
  const base = firstName.trim() + last4;
  let candidate = base;
  let i = 2;
  while (takenSet.has(candidate)) {
    candidate = `${base}_${i}`;
    i += 1;
  }
  takenSet.add(candidate);
  return { username: candidate, last4 };
}

function isBlankRow(row, fieldMap) {
  return Object.values(fieldMap).every(key => String(row[key] ?? '').trim() === '');
}

/**
 * מפרש קובץ Excel של תלמידים ומחזיר { valid, invalid, duplicates }.
 *
 * existing: רשימת התלמידים שכבר במערכת - אובייקטים עם firstName, lastName,
 * last4Id ו-username. מקבל גם מערך מחרוזות (שמות משתמש בלבד) לתאימות לאחור.
 */
export async function parseStudentsExcel(file, existing = []) {
  if (typeof XLSX === 'undefined') {
    throw new Error('ספריית קריאת ה-Excel לא נטענה. ודאו חיבור אינטרנט ורעננו את הדף.');
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (!rows.length) {
    return { valid: [], invalid: [{ row: 0, reason: 'הקובץ ריק, או שלא נמצאו כותרות עמודות בשורה הראשונה.' }] };
  }

  const fieldMap = buildFieldMap(rows[0]);
  const missingFields = Object.keys(HEADER_ALIASES)
    .filter(f => !OPTIONAL_FIELDS.includes(f) && !fieldMap[f]);
  if (missingFields.length) {
    return {
      valid: [],
      invalid: [{ row: 0, reason: `עמודות חסרות בקובץ: ${missingFields.map(f => FIELD_LABELS[f]).join(', ')}` }],
    };
  }

  const asObjects = existing.map(e => typeof e === 'string' ? { username: e } : e);
  const takenUsernames = new Set(asObjects.map(e => e.username).filter(Boolean));
  const knownPeople = new Map(asObjects
    .filter(e => e.firstName || e.lastName || e.last4Id)
    .map(e => [identityKey(e.firstName, e.lastName, e.last4Id), e]));
  const valid = [], duplicates = [];
  const invalid = [];

  rows.forEach((row, i) => {
    const excelRow = i + 2; // שורה 1 = כותרות
    if (isBlankRow(row, fieldMap)) return; // דילוג שקט על שורות ריקות

    const firstName = String(row[fieldMap.firstName] ?? '').trim();
    const lastName = String(row[fieldMap.lastName] ?? '').trim();
    const idNumber = String(row[fieldMap.idNumber] ?? '').trim(); // נקרא כאן בלבד, לא מוחזר
    const dobRaw = row[fieldMap.dob];
    const group = String(row[fieldMap.group] ?? '').trim();
    const note = String(row[fieldMap.note] ?? '').trim();

    if (!firstName || !lastName || !idNumber || !dobRaw || !group) {
      invalid.push({ row: excelRow, reason: 'חסרים שדות חובה בשורה.' });
      return;
    }
    const dob = parseDob(dobRaw);
    if (!dob) {
      invalid.push({ row: excelRow, reason: `תאריך לידה לא תקין ("${dobRaw}"). פורמט צפוי: DD/MM/YYYY.` });
      return;
    }
    const digits = String(idNumber).replace(/\D/g, '');
    const rowLast4 = digits.slice(-4).padStart(4, '0');
    const known = knownPeople.get(identityKey(firstName, lastName, rowLast4));
    if (known) {
      // אותו אדם בדיוק - לא יוצרים חשבון שני. ייבוא חוזר של אותו קובץ
      // אינו משנה דבר, וזו ההתנהגות הנכונה.
      duplicates.push({ excelRow, firstName, lastName,
        displayName: `${firstName} ${lastName}`, username: known.username || '' });
      return;
    }
    const { username, last4 } = deriveUsername(firstName, idNumber, takenUsernames);
    const password = dob.dd + dob.mm + dob.yy;
    valid.push({
      excelRow, firstName, lastName, displayName: `${firstName} ${lastName}`,
      last4Id: last4, birthDateLabel: `${dob.dd}/${dob.mm}/${dob.yy}`, group, note,
      username, password,
    });
    // idNumber המלא לא נשמר באובייקט המוחזר - נזרק כאן.
  });

  return { valid, invalid, duplicates };
}
