/**
 * ==========================================================================
 * AI Mentor - הנדסה ביו-רפואית - Code.gs
 * שרת ה-Backend (Google Apps Script) עבור מערכת ליווי התלמידים.
 * משתמש בגיליון Google Sheets מחובר כמסד נתונים.
 *
 * הוראות פריסה מלאות נמצאות בקובץ README.md שבשורש הפרויקט.
 * ==========================================================================
 */

const SHEET_USERS = 'Users';
const SHEET_TOPICS = 'WeeklyTopics';
const SHEET_CHECKINS = 'WeeklyCheckIns';
const SHEET_HELPCHATS = 'HelpChatLog';
const SHEET_SESSIONS = 'Sessions';
const SHEET_USAGE = 'Usage';
const SHEET_ARTIFACTS = 'Artifacts';
const SHEET_STAGES = 'GroupStages';

/**
 * מבנה הקורס: שדרה אחת של שיטה, שרצה על מודולים מתחלפים של מאגרים.
 *
 * כל תלמיד/ה מריץ/ה את *כל* ארבעת הניסויים - זו הסיבה שאין כאן "אסטרטגיה
 * אישית". מה שמשתנה בין תלמידים הוא הקצב וההסבר, לא המשימה. המורה קובע/ת
 * את המאגר הפעיל (חלוקת ערכות האימון היא פיזית ממילא), והתלמיד/ה מתקדם/ת
 * בסולם הניסויים בקצב שלו/ה.
 *
 * אותו אוצר מילים בדיוק מופיע גם ב-tools/notebook. שתי רשימות נפרדות כבר
 * גרמו כאן פעם להיפוך מלא של תוצאות - שם אחד לכל מושג, בכל המערכת.
 */
const MODULES = {
  malaria: 'מלריה — תאי דם',
  chest:   'צילומי חזה',
  mura:    'MURA — צילומי גפיים',
};
const DEFAULT_MODULE = 'malaria';

const EXPERIMENTS = {
  curve:        'עקומת למידה',
  balance:      'יחסי איזון',
  source:       'הכללה בין מקורות',
  intervention: 'התערבות — תיקון הבעיה',
};
const EXPERIMENT_ORDER = ['curve', 'balance', 'source', 'intervention'];

/** מה כל ניסוי בודק - נכנס לפרומפט כדי שהמנטור ישאל על הדבר הנכון. */
const EXPERIMENT_QUESTION = {
  curve:        'כמה תמונות באמת צריך, ואיפה העקומה מתיישרת',
  balance:      'מה קורה כשמחלקה אחת נדירה, וכיצד דיוק כולל מסתיר זאת',
  source:       'האם המודל למד את הממצא הרפואי או את המקור שממנו הגיעה התמונה',
  intervention: 'האם תיקון שהתלמיד/ה הציע/ה באמת עובד, ומה מחירו',
};

const moduleName = k => MODULES[k] || MODULES[DEFAULT_MODULE];
const experimentName = k => EXPERIMENTS[k] || EXPERIMENTS.curve;

/**
 * תיקיית-על אחת, ובתוכה תיקייה לכל תלמיד/ה עם תת-תיקיות לפי סוג התוצר.
 * ה-kind מגיע מהדפדפן ולכן הוא נבדק מול הרשימה הזו בלבד - נתיב שנבנה
 * ממחרוזת חופשית של הלקוח מאפשר כתיבה לכל מקום ב-Drive.
 */
const ARTIFACT_KINDS = {
  charts:   '01_גרפים',
  heatmaps: '02_מפות קשב',
  perturb:  '03_הפרעות',
  notebook: '04_מחברת ניסוי',
  checkin:  '05_צ׳ק-אין שבועי',
  model:    '06_מודלים שמורים',
};
// שלושת הקבצים שמרכיבים מודל של Teachable Machine. השמות קבועים כי
// tmImage.loadFromFiles מזהה אותם לפי שם, והלוקר שומר עותק אחד מכל אחד.
const MODEL_FILES = ['model.json', 'weights.bin', 'metadata.json'];
// כלי האימון עצמו. התלמידים מאמנים ב-Teachable Machine ומייצאים משם את
// המודל; הקישור יושב בהקשר ולא בקוד הדף כדי שיהיה מקור אחד לשינוי.
const TRAINER_URL = 'https://teachablemachine.withgoogle.com/train/image';

const ARTIFACT_MAX_BYTES = 6 * 1024 * 1024;   // תרשים או מפת קשב הם עשרות KB
const ARTIFACT_WEEKLY_CAP = 300;              // תקרה שמונעת העלאה בלולאה

// תוקף טוקן התחברות. אחרי הזמן הזה נדרשת התחברות מחדש.
const TOKEN_TTL_HOURS = 24;

// ---- מגבלות שימוש (הגנה תקציבית) ----------------------------------------
// אלה מגבלות *שרת* בכוונה. הנחיה בפרומפט לא מגנה על התקציב: אפשר לשכנע את
// המודל לחרוג ממנה, וגם סירוב עולה כסף. רק המגבלות כאן חוסמות בפועל.
const WEEKLY_MESSAGE_QUOTA = 80;          // הודעות לתלמיד/ה בשבוע
const GRADED_RESERVE = 10;                // רזרבה כדי שתמיד אפשר יהיה להשלים את החלק המוערך
const MIN_SECONDS_BETWEEN_MESSAGES = 3;   // בלימת סקריפטים אוטומטיים
const MAX_HISTORY_TURNS = 16;             // כמה תורות נשלחות ל-Gemini (בולם תפיחת עלות)
const MAX_MESSAGE_CHARS = 4000;           // בולם הדבקת קבצי קוד ענקיים

// מודל ברירת המחדל. אפשר לעקוף אותו בלי לגעת בקוד: Project Settings →
// Script Properties → מאפיין בשם GEMINI_MODEL. שימושי כשגוגל מוציאה משימוש
// מודל ישן (הרצת listAvailableModels תראה מה זמין למפתח שלכם).
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

function geminiModel() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
}

// -------------------------------------------------------------- כניסה ל-Web App
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'בקשה לא תקינה (JSON שגוי)' });
  }
  const { action, payload } = body;
  try {
    const result = routeAction(action, payload || {});
    return jsonResponse({ ok: true, result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function doGet() {
  return ContentService.createTextOutput(
    'AI Mentor - הנדסה ביו-רפואית - API פעיל. יש לשלוח בקשות POST בלבד.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * כל פעולה - חוץ מההתחברות עצמה - דורשת טוקן תקף. בלי זה, מי שמשיג את
 * כתובת ה-/exec יכול היה למשוך את כל נתוני הכיתה ללא סיסמה.
 */
function routeAction(action, payload) {
  switch (action) {
    case 'authenticateUser': return authenticateUser(payload.username, payload.password);
    case 'logout': return logout(payload.token);

    // --- התלמיד/ה עצמו/ה, או המורה ---
    case 'changePassword':
      requireSelfOrAdmin(payload, payload.studentId);
      return changePassword(payload.studentId, payload.newPassword);
    case 'getStudentContext':
      requireSelfOrAdmin(payload, payload.studentId);
      return getStudentContext(payload.studentId);
    case 'sendMentorMessage':
      requireSelfOrAdmin(payload, payload.studentId);
      return sendMentorMessage(payload.studentId, payload.history, payload.images, payload.elapsedSeconds);
    case 'getCurrentWeek':
      requireAuth(payload);
      return getCurrentWeekInfo(payload.group);
    case 'getGroupWeeks':
      requireAdmin(payload);
      return getGroupWeeks();
    case 'setGroupStage':
      requireAdmin(payload);
      return setGroupStage(payload.group, payload.stage);
    case 'setCurrentExperiment':
      requireSelfOrAdmin(payload, payload.studentId);
      return setCurrentExperiment(payload.studentId, payload.experiment);
    // התיוק נעשה תמיד לפי הזהות שבטוקן, ולעולם לא לפי studentId שנשלח
    // בבקשה - אחרת תלמיד/ה יכול/ה היה לתייק קבצים בתיקייה של אחר/ת.
    case 'saveArtifact':
      return saveArtifact(requireAuth(payload).studentId, payload.kind,
        payload.filename, payload.mimeType, payload.base64);
    case 'listArtifacts':
      requireSelfOrAdmin(payload, payload.studentId);
      return listArtifacts(payload.studentId);
    // הורדה חזרה למחשב אחר. גם כאן הזהות מהטוקן: אחרת artifactId של מישהו
    // אחר היה מחזיר את הקובץ שלו.
    case 'getArtifact':
      return getArtifact(requireAuth(payload).studentId, payload.artifactId);
    case 'getMyModel':
      return getMyModel(requireAuth(payload).studentId);
    case 'saveMyModel':
      return saveMyModel(requireAuth(payload).studentId, payload.filename, payload.base64);
    case 'downloadMyModel':
      return downloadMyModel(requireAuth(payload).studentId);

    // --- מורה בלבד ---
    case 'resetStudentPassword':
      requireAdmin(payload);
      return resetStudentPassword(payload.studentId, payload.newPassword);
    case 'deleteStudent':
      requireAdmin(payload);
      return deleteStudent(payload.studentId);
    case 'importRoster':
      requireAdmin(payload);
      return importRoster(payload.students);
    case 'startNewWeek':
      requireAdmin(payload);
      return startNewWeek(payload.group, payload.topicText, payload.module,
        payload.datasetUrl, payload.checkIn);
    case 'updateCurrentWeekTopic':
      requireAdmin(payload);
      return updateCurrentWeekTopic(payload.group, payload.topicText,
        payload.datasetUrl, payload.checkIn);
    case 'getDashboard':
      requireAdmin(payload);
      return getDashboard();
    case 'getStudentTranscripts':
      requireSelfOrAdmin(payload, payload.studentId);
      return getStudentTranscripts(payload.studentId);
    case 'setManualGrade':
      requireAdmin(payload);
      return setManualGrade(payload.checkInId, payload.score, payload.note);
    case 'exportWeeklyReport':
      requireAdmin(payload);
      return exportWeeklyReport();

    default: throw new Error('פעולה לא מוכרת: ' + action);
  }
}

// -------------------------------------------------------------- טוקנים והרשאות
const ERR_REAUTH = 'פג תוקף ההתחברות - יש להתחבר מחדש';

function createSession(user) {
  const sheet = getSheet(SHEET_SESSIONS);
  pruneExpiredSessions(sheet);
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([token, user.studentId, user.role, now,
    new Date(now.getTime() + TOKEN_TTL_HOURS * 3600 * 1000)]);
  return token;
}

function pruneExpiredSessions(sheet) {
  const values = sheet.getDataRange().getValues();
  const now = new Date();
  for (let r = values.length - 1; r >= 1; r--) {
    const exp = values[r][4];
    if (exp && new Date(exp) < now) sheet.deleteRow(r + 1);
  }
}

function resolveSession(token) {
  if (!token) throw new Error(ERR_REAUTH);
  const row = sheetToObjects(getSheet(SHEET_SESSIONS)).find(r => r.token === token);
  if (!row) throw new Error(ERR_REAUTH);
  if (new Date(row.expiresAt) < new Date()) throw new Error(ERR_REAUTH);
  return { studentId: row.studentId, role: row.role };
}

function requireAuth(payload) {
  return resolveSession(payload.token);
}

function requireAdmin(payload) {
  const s = resolveSession(payload.token);
  if (s.role !== 'admin') throw new Error('הפעולה מותרת למורה בלבד');
  return s;
}

/** תלמיד/ה רשאי/ת לגשת רק לנתונים של עצמו/ה; מורה - לכולם. */
function requireSelfOrAdmin(payload, studentId) {
  const s = resolveSession(payload.token);
  if (s.role !== 'admin' && s.studentId !== studentId) {
    throw new Error('אין הרשאה לגשת לנתונים של תלמיד/ה אחר/ת');
  }
  return s;
}

function logout(token) {
  if (!token) return { ok: true };
  const sheet = getSheet(SHEET_SESSIONS);
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (values[r][0] === token) { sheet.deleteRow(r + 1); break; }
  }
  return { ok: true };
}

// -------------------------------------------------------------- גישה לגיליונות
// מבנה העמודות של כל גיליון, במקום אחד. משמש גם ליצירה וגם לאימות - כדי
// שהמערכת לא תכתוב בשקט לגיליון של מערכת אחרת עם עמודות בשמות דומים.
const SHEET_SCHEMAS = {};
SHEET_SCHEMAS[SHEET_USERS] = ['studentId', 'username', 'passHash', 'mustChangePassword', 'role',
  'firstName', 'lastName', 'last4Id', 'birthDate', 'group', 'note', 'currentExperiment', 'createdAt'];
SHEET_SCHEMAS[SHEET_TOPICS] = ['group', 'weekNumber', 'topicText', 'module', 'datasetUrl', 'setAt', 'checkIn'];
SHEET_SCHEMAS[SHEET_CHECKINS] = ['checkInId', 'studentId', 'weekNumber', 'date', 'image1Url', 'image2Url',
  'studentSummary', 'transcriptJson', 'aiMemorySummary', 'mentorFeedback', 'score',
  'teacherOverrideScore', 'teacherNote', 'docLink', 'sessionSeconds', 'status'];
SHEET_SCHEMAS[SHEET_HELPCHATS] = ['logId', 'studentId', 'weekNumber', 'date', 'transcriptJson'];
SHEET_SCHEMAS[SHEET_SESSIONS] = ['token', 'studentId', 'role', 'createdAt', 'expiresAt'];
SHEET_SCHEMAS[SHEET_USAGE] = ['studentId', 'weekNumber', 'messageCount', 'lastMessageAt'];
SHEET_SCHEMAS[SHEET_ARTIFACTS] = ['artifactId', 'studentId', 'weekNumber', 'kind', 'filename',
  'fileId', 'url', 'sizeBytes', 'createdAt'];
SHEET_SCHEMAS[SHEET_STAGES] = ['group', 'unlockedStage', 'setAt'];

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) return createSheet(ss, name);
  // סדר חשוב: הגירה שנייה מניחה שהראשונה כבר רצה
  if (SHEET_MIGRATIONS[name]) SHEET_MIGRATIONS[name](sheet);
  if (SHEET_MIGRATIONS[name + '_checkIn']) SHEET_MIGRATIONS[name + '_checkIn'](sheet);
  assertSchema(sheet, name);
  return sheet;
}

/**
 * שדרוגי מבנה שרצים לבד בקריאה הראשונה אחרי פריסה.
 *
 * assertSchema מפילה כל גיליון שהעמודות שלו אינן מה שהקוד מצפה לו - וזו
 * ההתנהגות הנכונה - אבל היא הופכת כל הוספת עמודה לתקלה חיה עד שמישהו יתקן
 * את הגיליון ביד. הפונקציות כאן סוגרות את הפער: הן חייבות להיות אידמפוטנטיות
 * (רצות בכל קריאה), ולזהות במפורש את המבנה הישן שהן יודעות לשדרג - מבנה לא
 * מוכר נשאר לטיפול של assertSchema ולא נוגעים בו.
 */
const SHEET_MIGRATIONS = {};

// הוספת עמודת group ל-WeeklyTopics: מכאן ואילך לכל קבוצה שבוע ונושא משלה.
// השורות שהיו קיימות לפני ההפרדה מסומנות ב-'*' = "חל על כל קבוצה שאין לה
// עדיין שורה משלה", כך שהנושא שכבר הוזן ממשיך לשרת את כל הכיתות עד שנקבע
// להן נושא נפרד, ואין רגע שבו לתלמיד אין נושא.
//
// '*' ולא תא ריק, כי sheetToObjects מדלגת על שורה שהעמודה הראשונה שלה ריקה -
// שורה בלי סימון פשוט הייתה נעלמת בשקט.
const GROUP_ALL = '*';

SHEET_MIGRATIONS[SHEET_TOPICS] = function (sheet) {
  const width = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(h => String(h || '').trim());
  if (header[0] === 'group') return false;      // כבר שודרג
  if (header[0] !== 'weekNumber') return false; // מבנה לא מוכר - assertSchema תטפל
  sheet.insertColumnBefore(1);
  sheet.getRange(1, 1).setValue('group');
  const dataRows = sheet.getLastRow() - 1;
  if (dataRows > 0) {
    sheet.getRange(2, 1, dataRows, 1)
      .setValues(Array.from({ length: dataRows }, () => [GROUP_ALL]));
  }
  return true;
};

// הוספת עמודת checkIn: האם השבוע כולל צ'ק-אין מוערך. שבועות קיימים מקבלים
// TRUE - זו הייתה ההתנהגות עד כה, ושינוי שקט שלה היה מבטל ציונים בדיעבד.
SHEET_MIGRATIONS[SHEET_TOPICS + '_checkIn'] = function (sheet) {
  const width = Math.max(1, sheet.getLastColumn());
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(h => String(h || '').trim());
  if (header.indexOf('checkIn') >= 0) return false;
  if (header[0] !== 'group') return false;           // ההגירה הקודמת עוד לא רצה
  const col = width + 1;
  sheet.getRange(1, col).setValue('checkIn');
  const dataRows = sheet.getLastRow() - 1;
  if (dataRows > 0) {
    sheet.getRange(2, col, dataRows, 1)
      .setValues(Array.from({ length: dataRows }, () => [true]));
  }
  return true;
};

/**
 * נכשל ברעש אם הגיליון קיים אבל העמודות שלו אינן מה שהמערכת מצפה לו.
 * בלי הבדיקה הזו, חיבור הסקריפט לגיליון של מערכת אחרת (שיש בה במקרה
 * גיליון בשם Users) גורם לכתיבה בהזזת עמודות - נתונים שנראים תקינים
 * בגיליון אבל נקראים שגוי, בלי שום הודעת שגיאה.
 */
function assertSchema(sheet, name) {
  const expected = SHEET_SCHEMAS[name];
  if (!expected) return;
  const width = Math.max(expected.length, sheet.getLastColumn() || expected.length);
  const actual = sheet.getRange(1, 1, 1, width).getValues()[0];
  for (let i = 0; i < expected.length; i++) {
    if (String(actual[i] || '').trim() !== expected[i]) {
      throw new Error(
        'הגיליון "' + name + '" קיים אך מבנה העמודות שלו שגוי (עמודה ' + (i + 1) +
        ': נמצא "' + actual[i] + '", ציפינו ל-"' + expected[i] + '").\n' +
        'זה קורה כשהסקריפט מחובר לגיליון של מערכת אחרת. יש לחבר את הסקריפט ' +
        'לגיליון ריק וייעודי למערכת הזו בלבד - ראו README.');
    }
  }
}

function createSheet(ss, name) {
  const sheet = ss.insertSheet(name);
  sheet.appendRow(SHEET_SCHEMAS[name]);
  if (name === SHEET_USERS) {
    forceTextColumns(sheet, name, USERS_TEXT_COLUMNS);
    sheet.appendRow(['admin', 'admin', sha256('admin123'), false, 'admin', 'מורה', 'ראשי', '', '', '', '', '', new Date()]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function sheetToObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(row => row[0] !== '').map((row, idx) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    obj.__row = idx + 2; // מספר שורה בפועל בגיליון (1-based + header)
    return obj;
  });
}

function sha256(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}

// -------------------------------------------------------------- אימות והרשאות
function authenticateUser(username, password) {
  if (!username || !password) throw new Error('שם משתמש וסיסמה הם שדות חובה');
  const users = sheetToObjects(getSheet(SHEET_USERS));
  const user = users.find(u => String(u.username).toLowerCase() === String(username).trim().toLowerCase());
  if (!user) throw new Error('שם משתמש או סיסמה שגויים');
  if (sha256(password) !== user.passHash) throw new Error('שם משתמש או סיסמה שגויים');
  return {
    studentId: user.studentId, username: user.username, role: user.role,
    displayName: (user.firstName || '') + ' ' + (user.lastName || ''),
    mustChangePassword: !!user.mustChangePassword,
    token: createSession(user),
  };
}

function changePassword(studentId, newPassword) {
  if (!studentId || !newPassword) throw new Error('חסרים פרטים לעדכון הסיסמה');
  const sheet = getSheet(SHEET_USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const col = (name) => headers.indexOf(name) + 1;
  for (let r = 1; r < values.length; r++) {
    if (values[r][0] === studentId) {
      sheet.getRange(r + 1, col('passHash')).setValue(sha256(newPassword));
      sheet.getRange(r + 1, col('mustChangePassword')).setValue(false);
      return { ok: true };
    }
  }
  throw new Error('תלמיד לא נמצא');
}

/**
 * מסיר תלמיד/ה מהמערכת.
 *
 * שתי החלטות מכוונות:
 * 1. חשבון מורה אינו נמחק. לחיצה שגויה על השורה הלא נכונה הייתה נועלת את
 *    המערכת בפני מי שמנהל אותה, בלי דרך חזרה מלבד עריכת הגיליון.
 * 2. הצ׳ק-אינים, שיחות העזרה והתוצרים *נשארים*. הם רשומת ההערכה, ומחיקת
 *    חשבון אינה סיבה להשמיד אותה. הפונקציה מחזירה כמה נשארו, כדי שהמורה
 *    יראה מה נותר בגיליון ולא יופתע.
 */
function deleteStudent(studentId) {
  if (!studentId) throw new Error('לא צוין תלמיד');
  const sheet = getSheet(SHEET_USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('studentId');
  const roleCol = headers.indexOf('role');
  const userCol = headers.indexOf('username');

  let row = -1, username = '';
  for (let r = 1; r < values.length; r++) {
    if (values[r][idCol] === studentId) {
      if (values[r][roleCol] === 'admin') {
        throw new Error('אי אפשר למחוק חשבון מורה מהפאנל. ' +
          'אם זו הכוונה, ערכו ישירות את גיליון Users.');
      }
      row = r + 1;
      username = values[r][userCol];
      break;
    }
  }
  if (row === -1) throw new Error('תלמיד לא נמצא');
  sheet.deleteRow(row);

  // מוחקים גם את החיבורים הפעילים, אחרת טוקן קיים ימשיך לעבוד עד לפקיעתו
  const ses = getSheet(SHEET_SESSIONS);
  const sv = ses.getDataRange().getValues();
  const sIdCol = sv[0].indexOf('studentId');
  let killed = 0;
  for (let r = sv.length - 1; r >= 1; r--) {
    if (sv[r][sIdCol] === studentId) { ses.deleteRow(r + 1); killed++; }
  }

  const count = (name, field) =>
    sheetToObjects(getSheet(name)).filter(x => x[field] === studentId).length;
  return {
    ok: true, username: username,
    sessionsRemoved: killed,
    checkInsKept: count(SHEET_CHECKINS, 'studentId'),
    helpChatsKept: count(SHEET_HELPCHATS, 'studentId'),
    artifactsKept: count(SHEET_ARTIFACTS, 'studentId'),
  };
}

function resetStudentPassword(studentId, newPassword) {
  // איפוס ע"י המורה (למשל אם תלמיד שכח סיסמה). הסיסמה החדשה תקפה מיד -
  // אין חיוב להחליף אותה בכניסה הבאה.
  const sheet = getSheet(SHEET_USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const col = (name) => headers.indexOf(name) + 1;
  for (let r = 1; r < values.length; r++) {
    if (values[r][0] === studentId) {
      sheet.getRange(r + 1, col('passHash')).setValue(sha256(newPassword));
      sheet.getRange(r + 1, col('mustChangePassword')).setValue(false);
      return { ok: true };
    }
  }
  throw new Error('תלמיד לא נמצא');
}

/**
 * שם משתמש = שם פרטי + 3 הספרות האחרונות של ת״ז. חייב להישאר זהה לנוסחה
 * ב-js/excelImport.js (deriveUsername) - שתי נוסחאות שונות פירושן שתלמיד
 * שייובא בעתיד יקבל שם בפורמט אחר מכולם.
 *
 * 3 הספרות נלקחות מ-last4Id ולא מהת״ז המלאה, שאינה נשמרת כלל. last4Id עצמו
 * נשאר בן 4 ספרות - הוא שדה הזהות, לא שם המשתמש.
 */
function usernameFor(firstName, last4Id) {
  return String(firstName || '').trim() + pad4(last4Id).slice(-3);
}

/**
 * הסיסמה הראשונית היא תאריך הלידה, DDMMYY.
 *
 * התא עשוי להיות טקסט ("05/10/11") או תאריך אמיתי, תלוי אם Sheets המיר אותו
 * בייבוא. שני המקרים מטופלים, ושניהם חייבים לתת את אותן שש הספרות שמופיעות
 * בתצוגה - הן אלה שמהן נגזר ה-hash.
 */
function initialPasswordFromBirthDate(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'ddMMyy');
  }
  return String(v == null ? '' : v).replace(/\D/g, '');
}

/**
 * הרצה חד-פעמית מעורך Apps Script: מקצרת את שמות המשתמש ל-3 ספרות.
 *
 * **הסיסמאות אינן משתנות.** עמודת passHash לא נגעת בה, ולכן כל תלמיד ממשיך
 * עם תאריך הלידה שלו. זה גם מה שהופך את הפעולה הזו לבטוחה יחסית: גם אם משהו
 * ישתבש, אף אחד לא נעול בחוץ בגלל סיסמה.
 *
 * שלושה דברים שהפונקציה עושה לפני שהיא כותבת משהו:
 *   1. מחשבת את כל השמות החדשים ובודקת שאין התנגשות - גם מול שורת המורה.
 *      התנגשות עוצרת הכול לפני הכתיבה הראשונה.
 *   2. מאמתת כל סיסמה מול ה-hash השמור. שורה שלא מתאימה מסומנת ברשימה
 *      במקום להיות מוגשת למורה כאילו היא נכונה.
 *   3. כותבת גיליון "פרטי התחברות" לחלוקה. **למחוק אותו אחרי ההדפסה.**
 *
 * אידמפוטנטית: השם נגזר מ-last4Id ולא מהשם הנוכחי, ולכן הרצה שנייה לא משנה
 * דבר. אינה חשופה כפעולת רשת בכוונה.
 */
function shortenUsernamesToThreeDigits() {
  const sheet = getSheet(SHEET_USERS);
  const rows = sheetToObjects(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const unCol = headers.indexOf('username') + 1;

  const taken = {}, plan = [];
  rows.filter(u => u.role !== 'student').forEach(u => { taken[String(u.username)] = 'שורה שאינה תלמיד'; });
  rows.forEach(u => {
    if (u.role !== 'student') return;
    const to = usernameFor(u.firstName, u.last4Id);
    if (taken[to]) {
      throw new Error('התנגשות בשם משתמש "' + to + '" (' + u.firstName + ' ' + u.lastName +
                      ' מול ' + taken[to] + '). לא בוצע שום שינוי.');
    }
    taken[to] = u.firstName + ' ' + u.lastName;
    plan.push({ row: u.__row, to: to, u: u });
  });

  plan.forEach(p => sheet.getRange(p.row, unCol).setValue(p.to));

  const out = [['שם מלא', 'קבוצה', 'שם משתמש', 'סיסמה', 'אומת']];
  let bad = 0;
  plan.forEach(p => {
    const pw = initialPasswordFromBirthDate(p.u.birthDate);
    const ok = sha256(pw) === String(p.u.passHash);
    if (!ok) bad++;
    out.push([(p.u.firstName + ' ' + p.u.lastName).trim(), p.u.group, p.to, pw,
              ok ? '✓' : '✗ לא תואם — לאפס מהפאנל']);
  });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const old = ss.getSheetByName('פרטי התחברות');
  if (old) ss.deleteSheet(old);
  const list = ss.insertSheet('פרטי התחברות');
  list.getRange(1, 1, out.length, 5).setValues(out);
  list.setFrozenRows(1);
  list.autoResizeColumns(1, 5);

  Logger.log('שונו ' + plan.length + ' שמות משתמש. סיסמאות לא שונו. ' +
             (bad ? bad + ' סיסמאות לא אומתו — ראו עמודת "אומת".' : 'כל הסיסמאות אומתו.'));
  return { renamed: plan.length, unverified: bad };
}

// -------------------------------------------------------------- ייבוא תלמידים מאקסל
/**
 * הקובץ עצמו נקרא ומפוענח בדפדפן (js/excelImport.js, SheetJS) - כולל גזירת
 * username/password ותחתוך ת"ז ל-4 ספרות אחרונות. תעודת הזהות המלאה **לא
 * מגיעה לשרת בכלל** - זו הגנת הפרטיות הראשונה (השנייה: גם אם הייתה מגיעה,
 * לא הייתה נכתבת לגיליון).
 * students: [{firstName, lastName, username, password, last4Id, birthDateLabel, group, note}]
 */
/**
 * עמודות שחייבות להישאר טקסט. "0330" ו-"05/10/11" הם מחרוזות, אבל Sheets
 * ממיר אותן לבד למספר ולתאריך ובולע את האפס המוביל - וכך 4 הספרות שחוזרות
 * מהשרת אינן זהות לאלה שנגזרות מקובץ הייבוא, ואותו תלמיד נראה כאדם חדש.
 */
const USERS_TEXT_COLUMNS = ['last4Id', 'birthDate'];

/**
 * 4 הספרות תמיד כמחרוזת בת 4 תווים, גם אם בגיליון הן שמורות כמספר.
 *
 * הפורמט של העמודה אמור למנוע את זה מלכתחילה, אבל שורות שנוצרו לפניו קיימות
 * ולא נוגעים בהן. הנרמול כאן הופך את זה לחסין: מי שקורא מה-API מקבל תמיד
 * ארבעה תווים, ולא צריך לדעת איך Sheets במקרה שמר את התא. ריק נשאר ריק ולא
 * הופך ל-0000, אחרת כל מי שאין לו ת״ז היה מתמזג לאותה זהות.
 */
function pad4(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  return digits ? ('0000' + digits).slice(-4) : '';
}

function forceTextColumns(sheet, name, fieldNames) {
  const schema = SHEET_SCHEMAS[name];
  fieldNames.forEach(field => {
    const col = schema.indexOf(field) + 1;
    if (col > 0) sheet.getRange(1, col, sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  // בלי flush, שינוי הפורמט נשאר בתור הכתיבות של Apps Script ועלול להיות
  // מוחל *אחרי* ה-appendRow שאמור היה ליהנות ממנו - וכך "0528" עדיין נכנס
  // כמספר 528. זה בדיוק מה שקרה בייבוא הראשון אחרי התיקון.
  SpreadsheetApp.flush();
}

function importRoster(students) {
  if (!students || !students.length) throw new Error('לא התקבלו תלמידים לייבוא');
  const usersSheet = getSheet(SHEET_USERS);
  forceTextColumns(usersSheet, SHEET_USERS, USERS_TEXT_COLUMNS);
  const existing = sheetToObjects(usersSheet);
  const results = [];
  students.forEach(s => {
    if (!s.firstName || !s.username || !s.password) {
      results.push({ firstName: s.firstName, ok: false, error: 'שורה חסרה שדות חובה' });
      return;
    }
    if (existing.some(u => u.username === s.username)) {
      results.push({ firstName: s.firstName, username: s.username, ok: true, status: 'כבר קיים - לא נוצר מחדש' });
      return;
    }
    const studentId = 's_' + Utilities.getUuid().slice(0, 8);
    usersSheet.appendRow([studentId, s.username, sha256(s.password), false, 'student', s.firstName, s.lastName || '',
      s.last4Id || '', s.birthDateLabel || '', s.group || '', s.note || '',
      EXPERIMENT_ORDER[0], new Date()]);
    existing.push({ username: s.username }); // מונע כפילויות בתוך אותו קובץ
    results.push({ firstName: s.firstName, username: s.username, ok: true, status: 'נוצר' });
  });
  return { imported: results };
}

// -------------------------------------------------------------- נושא שבועי (FR-C6)
function normGroup(g) { return String(g == null ? '' : g).trim(); }

/**
 * השבוע הנוכחי של קבוצה מסוימת.
 *
 * לכל קבוצה מסלול משלה: אחת יכולה להיות בשבוע 5 בזמן שהשנייה בשבוע 2, וזו
 * בדיוק מטרת ההפרדה. כל עוד לא נקבע לקבוצה נושא משלה היא נופלת לשורות
 * הגלובליות (קבוצה ריקה) - כך שמה שהוזן לפני ההפרדה ממשיך לעבוד לכולן, ולא
 * נוצר רגע שבו לתלמידים אין נושא.
 */
function getCurrentWeekInfo(group) {
  const g = normGroup(group);
  const rows = sheetToObjects(getSheet(SHEET_TOPICS));
  const own = g ? rows.filter(r => normGroup(r.group) === g) : [];
  const shared = rows.filter(r => normGroup(r.group) === GROUP_ALL);
  const pool = own.length ? own : shared;
  if (!pool.length) {
    return { group: g, weekNumber: 0, topicText: '', module: DEFAULT_MODULE,
             moduleName: moduleName(DEFAULT_MODULE), datasetUrl: '', checkIn: true, isOwn: false };
  }
  const latest = pool.reduce((a, b) => (Number(b.weekNumber) >= Number(a.weekNumber) ? b : a));
  return {
    group: g, weekNumber: Number(latest.weekNumber) || 0, topicText: latest.topicText || '',
    module: latest.module || DEFAULT_MODULE, moduleName: moduleName(latest.module),
    datasetUrl: latest.datasetUrl || '', setAt: latest.setAt,
    // ברירת מחדל TRUE: שורה שנוצרה לפני העמודה, או ערך ריק, היא שבוע רגיל
    checkIn: latest.checkIn === false || latest.checkIn === 'FALSE' ? false : true,
    isOwn: own.length > 0,
  };
}

/** רשימת הקבוצות בפועל - נגזרת מהתלמידים, ואין מה לתחזק בנפרד. */
function listGroups() {
  const seen = {};
  sheetToObjects(getSheet(SHEET_USERS))
    .filter(u => u.role === 'student')
    .forEach(u => { const g = normGroup(u.group); seen[g] = (seen[g] || 0) + 1; });
  return Object.keys(seen).sort().map(g => ({ group: g, studentCount: seen[g] }));
}

/**
 * ===========================================================================
 * פתיחה הדרגתית
 * ===========================================================================
 * לכל קבוצה "שלב פתוח" (1..4) שהמורה מקדם מהפאנל. השלב קובע שני דברים:
 * אילו ערכות אימון מוצגות, ואילו כלים זמינים.
 *
 * זו נעילת תצוגה, לא נעילת הרשאות: התיקיות ב-Drive נשארות משותפות, ומי
 * שכבר מחזיק קישור יכול לפתוח אותו. המטרה היא שתלמיד לא *יגיע* לחומר של
 * שלב שעוד לא נפתח, לא למנוע ממנו בכוח. החלטה מודעת - נעילה אמיתית דורשת
 * לשנות שיתופים ב-Drive בכל פתיחת שלב.
 */

/** איזה כלי נפתח באיזה שלב. שינוי כאן מזיז כלי בין שלבים - אין מקום נוסף. */
// כלי ההערכה נפתח כבר בניסוי הראשון: עקומת למידה *היא* סדרת מדידות
// דיוק, ובלי הכלי אין במה למדוד אותה.
const TOOL_STAGE = { notebook: 1, evaluate: 1, perturb: 3 };

const TOOLS = {
  notebook: { path: 'tools/notebook/', name: 'מחברת ניסוי', sub: 'השערה, מדידה, מסקנה' },
  evaluate: { path: 'tools/evaluate/', name: 'הערכת מודל',  sub: 'דיוק, רגישות, מפת קשב' },
  perturb:  { path: 'tools/perturb/',  name: 'כלי הפרעות',  sub: 'מה באמת מניע את ההחלטה' },
};

/**
 * אילו תיקיות נפתחות בכל שלב, לפי שמן ב-Drive.
 * 'ניסויים/X' = תת-תיקייה בתוך תיקיית הניסויים.
 */
const STAGE_FOLDERS = {
  1: [['ניסויים/עקומת למידה/גודל 0025', 'ערכת אימון ראשונה — 25 תמונות'],
      ['ערכת מבחן',                      'ערכת המבחן']],
  2: [['ניסויים/עקומת למידה',            'כל ערכות עקומת הלמידה'],
      ['ניסויים/יחסי איזון',              'ערכות יחסי האיזון']],
  3: [['ניסויים/הכללה בין מקורות',        'ערכות ההכללה']],
  4: [['בריכת תמונות',                    'בריכת התמונות המלאה']],
};

/**
 * תיקיות שאסור שייפתחו אוטומטית בשום שלב.
 * תיקיית-העל - כדי שתלמיד לא יוכל לדפדף בכל המאגר; הערכה העיוורת - כי כל
 * ערכה שמטרתה בדיקה ללא תוויות מאבדת את ערכה ברגע שאפשר לשוטט בה.
 */
const NEVER_SHARED = ['', 'ערכת מבחן עיוורת', 'ניסויים'];

function stageOf(experimentKey) {
  const i = EXPERIMENT_ORDER.indexOf(experimentKey);
  return i < 0 ? 1 : i + 1;
}

/** השלב הפתוח של קבוצה. ברירת המחדל היא 1 - לא פותחים מה שלא נפתח במפורש. */
function getGroupStage(group) {
  const g = normGroup(group);
  const row = sheetToObjects(getSheet(SHEET_STAGES)).find(r => normGroup(r.group) === g);
  const n = row ? Number(row.unlockedStage) : 1;
  return Math.min(EXPERIMENT_ORDER.length, Math.max(1, n || 1));
}

function setGroupStage(group, stage) {
  const g = requireGroup(group);
  const n = Math.min(EXPERIMENT_ORDER.length, Math.max(1, Number(stage) || 1));
  const sheet = getSheet(SHEET_STAGES);
  const rows = sheetToObjects(sheet);
  const row = rows.find(r => normGroup(r.group) === g);
  if (row) {
    sheet.getRange(row.__row, 2).setValue(n);
    sheet.getRange(row.__row, 3).setValue(new Date());
  } else {
    sheet.appendRow([g, n, new Date()]);
  }
  // הסנכרון אחרי הכתיבה: הוא נשען על השלב המעודכן של כל הקבוצות
  const week = getCurrentWeekInfo(g);
  const sync = syncDriveSharing(week.datasetUrl);
  return { group: g, unlockedStage: n, stageName: EXPERIMENTS[EXPERIMENT_ORDER[n - 1]], sync: sync };
}

/**
 * הקישורים לתיקיות שנפתחו, נגזרים מתוך תיקיית המאגר שהמורה הזין.
 *
 * אין טופס נפרד לכל ערכה: שמות התיקיות קבועים במאגרי הקורס, ולכן השרת מוצא
 * אותן לבד. מאגר חדש שייבנה באותו מבנה יעבוד בלי שינוי קוד; מאגר בשמות
 * אחרים פשוט לא יחזיר קישור, והתלמיד יראה הערה במקום קישור שבור.
 *
 * התוצאה נשמרת ב-cache לחצי שעה - חיפוש ב-Drive בכל טעינת מסך הוא בזבוז.
 */
function unlockedDatasetLinks(datasetUrl, stage) {
  if (!datasetUrl) return [];
  const key = 'ds_' + stage + '_' + datasetUrl;
  const cache = CacheService.getScriptCache();
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const m = String(datasetUrl).match(/[-\w]{25,}/);
  if (!m) return [];
  let root;
  try { root = DriveApp.getFolderById(m[0]); } catch (e) { return []; }

  const byName = (folder, name) => {
    const it = folder.getFoldersByName(name);
    return it.hasNext() ? it.next() : null;
  };
  const out = [];
  for (let s = 1; s <= stage; s++) {
    (STAGE_FOLDERS[s] || []).forEach(pair => {
      let f = root;
      pair[0].split('/').forEach(part => { f = f ? byName(f, part) : null; });
      if (f) out.push({ name: pair[1], url: f.getUrl(), stage: s });
    });
  }
  cache.put(key, JSON.stringify(out), 1800);
  return out;
}

/**
 * מסנכרן את השיתוף ב-Drive למצב השלבים בפועל.
 *
 * תיקייה של שלב שנפתח מקבלת "כל מי שיש לו הקישור - צפייה"; תיקייה של שלב
 * שעוד לא נפתח הופכת לפרטית. כך "מה שהתלמיד רואה" ו"מה שהתלמיד יכול לפתוח"
 * הם אותו דבר, ולא צריך לזכור לשנות שיתופים ביד בכל פתיחת שלב.
 *
 * **השיתוף גלובלי והשלב הוא פר-קבוצה.** התיקיות ב-Drive משותפות לכולם, ולכן
 * הסנכרון עובד לפי השלב *הגבוה ביותר* מבין הקבוצות. אם י1 בשלב 3 ו-י2 בשלב 1,
 * תלמיד מ-י2 לא *יראה* את הקישורים של שלב 3 - אבל אם חבר מ-י1 ישלח לו קישור,
 * הוא ייפתח. הפרדה מלאה דורשת עותק נפרד של המאגר לכל קבוצה.
 */
function syncDriveSharing(datasetUrl) {
  if (!datasetUrl) return { shared: 0, closed: 0, note: 'אין קישור למאגר' };
  const m = String(datasetUrl).match(/[-\w]{25,}/);
  if (!m) return { shared: 0, closed: 0, note: 'קישור לא תקין' };
  let root;
  try { root = DriveApp.getFolderById(m[0]); }
  catch (e) { return { shared: 0, closed: 0, note: 'אין גישה לתיקייה' }; }

  const maxStage = listGroups().reduce(function (acc, g) {
    return Math.max(acc, getGroupStage(g.group));
  }, 1);

  const byPath = function (path) {
    let f = root;
    path.split('/').forEach(function (part) {
      if (!f) return;
      const it = f.getFoldersByName(part);
      f = it.hasNext() ? it.next() : null;
    });
    return f;
  };
  const setAccess = function (folder, open) {
    try {
      if (open) folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      else folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
      return true;
    } catch (e) { return false; }
  };

  let shared = 0, closed = 0;

  // **שתי פניות, וסדר שאי אפשר להחליף: קודם סוגרים הכול, ורק אחר כך פותחים.**
  //
  // סגירת תיקייה ב-Drive מסירה את שיתוף-הקישור גם מצאצאיה. 'גודל 0025' נפתח
  // בשלב 1 אבל יושב בתוך 'עקומת למידה' שנסגרת בשלב 2 - וכשהסגירה רצה אחרי
  // הפתיחה היא מוחקת אותה בשקט. בדיוק זה קרה: אחרי ההרצה הראשונה 'ערכת מבחן'
  // נותרה פתוחה (ההורה שלה נסגר *לפניה*) ו'גודל 0025' נסגרה.
  const closeF = function (f) { if (f && setAccess(f, false)) closed++; };
  const openF  = function (f) { if (f && setAccess(f, true))  shared++; };

  // פנייה 1 - סגירה: תיקיית-העל, מה שלעולם אינו משותף, וכל שלב שטרם נפתח
  closeF(root);
  NEVER_SHARED.filter(function (p) { return p; }).forEach(function (p) {
    closeF(byPath(p));
  });
  Object.keys(STAGE_FOLDERS).forEach(function (k) {
    if (Number(k) <= maxStage) return;
    STAGE_FOLDERS[k].forEach(function (pair) { closeF(byPath(pair[0])); });
  });

  // פנייה 2 - פתיחה: רק עכשיו, כשאף סגירה לא תרוץ אחריה
  Object.keys(STAGE_FOLDERS).forEach(function (k) {
    if (Number(k) > maxStage) return;
    STAGE_FOLDERS[k].forEach(function (pair) { openF(byPath(pair[0])); });
  });
  // הקישורים לכל שלב נשמרים ב-cache לחצי שעה. אחרי שינוי שלב צריך לפנות
  // אותם, אחרת תלמיד שייכנס מיד יקבל את הרשימה של לפני השינוי.
  const keys = [];
  for (let st = 1; st <= EXPERIMENT_ORDER.length; st++) keys.push('ds_' + st + '_' + datasetUrl);
  CacheService.getScriptCache().removeAll(keys);

  return { shared: shared, closed: closed, maxStage: maxStage };
}

/**
 * נעילה ראשונית - להרצה חד-פעמית מהעורך.
 * מביאה את כל התיקיות למצב שתואם את השלבים הפתוחים כרגע. אחרי זה הסנכרון
 * קורה לבד בכל פתיחת שלב.
 */
function lockDriveToCurrentStages() {
  const res = {};
  listGroups().forEach(function (g) {
    const w = getCurrentWeekInfo(g.group);
    if (w.datasetUrl && !res[w.datasetUrl]) res[w.datasetUrl] = syncDriveSharing(w.datasetUrl);
  });
  Logger.log(JSON.stringify(res));
  return res;
}

/** מצב כל הקבוצות במכה אחת - זה מה שהפאנל מצייר. */
function getGroupWeeks() {
  return listGroups().map(g => {
    const week = getCurrentWeekInfo(g.group);
    week.studentCount = g.studentCount;
    week.unlockedStage = getGroupStage(g.group);
    week.stageName = EXPERIMENTS[EXPERIMENT_ORDER[week.unlockedStage - 1]];
    return week;
  });
}

function startNewWeek(group, topicText, module, datasetUrl, checkIn) {
  const g = requireGroup(group);
  const sheet = getSheet(SHEET_TOPICS);
  const current = getCurrentWeekInfo(g);
  const nextWeek = (Number(current.weekNumber) || 0) + 1;
  // ברירת המחדל היא המאגר של השבוע הקודם: מעבר מודול הוא אירוע נדיר ומכוון,
  // ולא משהו שצריך לבחור מחדש בכל שבוע. אותו היגיון לקישור ערכות האימון.
  const mod = MODULES[module] ? module : (current.module || DEFAULT_MODULE);
  const url = safeHttpUrl(datasetUrl) || (mod === current.module ? current.datasetUrl || '' : '');
  // undefined = הלקוח לא שלח את השדה. שבוע חדש הוא שבוע מוערך כברירת מחדל.
  const ci = checkIn === undefined || checkIn === null ? true : !!checkIn;
  sheet.appendRow([g, nextWeek, topicText || '', mod, url, new Date(), ci]);
  return { group: g, weekNumber: nextWeek, topicText: topicText || '',
           module: mod, moduleName: moduleName(mod), datasetUrl: url,
           checkIn: ci, isOwn: true };
}

/**
 * קבוצה היא שדה חובה בכל פעולה על נושא שבועי. בלי זה קל מדי לכתוב בטעות
 * שורה גלובלית שמשנה את הנושא לכל הכיתות בבת אחת - וזה בדיוק מה שההפרדה
 * באה למנוע.
 */
function requireGroup(group) {
  const g = normGroup(group);
  if (!g) throw new Error('לא נבחרה קבוצה. נושא שבועי נקבע לקבוצה מסוימת.');
  return g;
}

/**
 * מקבל רק http/https. הקישור מוצג לתלמידים כקישור לחיץ, ולכן ערך חופשי
 * כאן היה מאפשר להזריק javascript: או data: לדף שלהם.
 */
function safeHttpUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) throw new Error('קישור חייב להתחיל ב-http:// או https://');
  if (/[\s<>"']/.test(s)) throw new Error('הקישור מכיל תווים לא חוקיים');
  return s;
}

/** התלמיד/ה מסמן/ת באיזה ניסוי הוא/היא נמצא/ת. הקצב אישי, המשימות זהות. */
function setCurrentExperiment(studentId, experiment) {
  if (!EXPERIMENTS[experiment]) throw new Error('ניסוי לא מוכר: ' + experiment);
  // הגבלה גם בשרת ולא רק בתצוגה: כפתור מושבת הוא בקשה, לא מניעה.
  const me = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!me) throw new Error('תלמיד לא נמצא');
  const stage = getGroupStage(me.group);
  if (stageOf(experiment) > stage) {
    throw new Error('הניסוי הזה עוד לא נפתח. השלב הפתוח כרגע: ' +
                    EXPERIMENTS[EXPERIMENT_ORDER[stage - 1]] + '.');
  }
  const sheet = getSheet(SHEET_USERS);
  const headers = sheet.getDataRange().getValues()[0];
  const col = headers.indexOf('currentExperiment') + 1;
  const idCol = headers.indexOf('studentId');
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r++) {
    if (values[r][idCol] === studentId) {
      sheet.getRange(r + 1, col).setValue(experiment);
      return { ok: true, experiment: experiment, experimentName: EXPERIMENTS[experiment] };
    }
  }
  throw new Error('תלמיד לא נמצא');
}

/**
 * מעדכן את השבוע הנוכחי במקום לפתוח חדש.
 *
 * מעדכן גם את קישור ערכות האימון: קודם הוא נשמר רק בפתיחת שבוע, והשדה
 * בפאנל יושב ליד שני הכפתורים - כך שלחיצה על "עדכון נושא" בלעה את הקישור
 * בשקט. שדה שמוצג ואינו נשמר הוא באג, לא אי-הבנה של המשתמש.
 */
function updateCurrentWeekTopic(group, topicText, datasetUrl, checkIn) {
  const g = requireGroup(group);
  const sheet = getSheet(SHEET_TOPICS);
  const current = getCurrentWeekInfo(g);

  // undefined/null = הלקוח לא שלח את השדה ולא נוגעים בקיים.
  // מחרוזת ריקה = בקשה מפורשת לנקות.
  const url = (datasetUrl === undefined || datasetUrl === null)
    ? (current.datasetUrl || '') : safeHttpUrl(datasetUrl);
  const ci = (checkIn === undefined || checkIn === null)
    ? (current.checkIn !== false) : !!checkIn;

  // הקבוצה עדיין רוכבת על השורה המשותפת: יוצרים לה שורה משלה במקום לערוך
  // את המשותפת, שמשרתת גם את הקבוצות האחרות. עריכה שם הייתה משנה נושא
  // לכיתה שלא נגעו בה.
  if (!current.isOwn) {
    const week = current.weekNumber || 1;
    sheet.appendRow([g, week, topicText || '', current.module, url, new Date(), ci]);
    return { group: g, weekNumber: week, topicText: topicText || '',
             module: current.module, moduleName: moduleName(current.module),
             datasetUrl: url, checkIn: ci, isOwn: true };
  }

  const rows = sheetToObjects(sheet).filter(r => normGroup(r.group) === g);
  const latest = rows.reduce((a, b) => (Number(b.weekNumber) >= Number(a.weekNumber) ? b : a));
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(latest.__row, headers.indexOf('topicText') + 1).setValue(topicText || '');
  if (datasetUrl !== undefined && datasetUrl !== null) {
    sheet.getRange(latest.__row, headers.indexOf('datasetUrl') + 1).setValue(url);
  }
  if (checkIn !== undefined && checkIn !== null) {
    sheet.getRange(latest.__row, headers.indexOf('checkIn') + 1).setValue(ci);
  }
  const mod = latest.module || DEFAULT_MODULE;
  return { group: g, weekNumber: Number(latest.weekNumber) || 0, topicText: topicText || '',
           module: mod, moduleName: moduleName(mod), datasetUrl: url,
           checkIn: ci, isOwn: true };
}

// -------------------------------------------------------------- הקשר תלמיד
function getStudentContext(studentId) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!user) throw new Error('תלמיד לא נמצא');
  // השבוע נקבע לפי הקבוצה של התלמיד/ה, ולכן קבוצה שמתקדמת מהר לא גוררת
  // איתה את האחרות ולהפך.
  const week = getCurrentWeekInfo(user.group);
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS)).filter(c => c.studentId === studentId);
  const thisWeekCheckIn = checkIns.find(c => Number(c.weekNumber) === Number(week.weekNumber));
  const lastGraded = checkIns.filter(c => c.status === 'graded').sort((a, b) => b.weekNumber - a.weekNumber)[0];
  const stage = getGroupStage(user.group);
  // הניסוי המסומן לא יכול לחרוג מהשלב שנפתח: אם המורה הוריד שלב, או
  // שהתלמיד סומן קדימה בעבר, מציגים אותו בגבול העליון שנפתח.
  const cur = user.currentExperiment || EXPERIMENT_ORDER[0];
  const curCapped = stageOf(cur) > stage ? EXPERIMENT_ORDER[stage - 1] : cur;

  return {
    firstName: user.firstName,
    group: user.group,
    note: user.note,
    module: week.module || DEFAULT_MODULE,
    moduleName: moduleName(week.module),
    unlockedStage: stage,
    // הקישור לתיקיית-העל לא נשלח לתלמיד בכוונה - רק הערכות שנפתחו
    datasets: unlockedDatasetLinks(week.datasetUrl, stage),
    // כלי נעול נשלח בלי path - אין כתובת לשלוח אליה, ולא רק כפתור מושבת
    tools: Object.keys(TOOLS).map(k => ({
      key: k, name: TOOLS[k].name, sub: TOOLS[k].sub,
      path: TOOL_STAGE[k] <= stage ? TOOLS[k].path : '',
      open: TOOL_STAGE[k] <= stage,
      opensAtName: EXPERIMENTS[EXPERIMENT_ORDER[TOOL_STAGE[k] - 1]],
    })),
    currentExperiment: curCapped,
    experimentName: experimentName(curCapped),
    experiments: EXPERIMENT_ORDER.map((k, i) => ({ key: k, name: EXPERIMENTS[k], open: i + 1 <= stage })),
    weekNumber: week.weekNumber,
    topicText: week.topicText,
    // שבוע ללא צ׳ק-אין מוערך: אין משימת תמונות, אין שאלות מוערכות ואין ציון.
    // השדה נשלח תמיד כך שגם התצוגה וגם ה-prompt נגזרים מאותו מקור אחד.
    checkInEnabled: week.checkIn !== false,
    trainerUrl: TRAINER_URL,
    priorSummary: lastGraded ? lastGraded.aiMemorySummary : '',
    gradedThisWeek: !!(thisWeekCheckIn && thisWeekCheckIn.status === 'graded'),
  };
}

// -------------------------------------------------------------- System Prompt מאוחד
function buildSystemPrompt(ctx) {
  return [
    '[זהות ותפקיד]',
    'אתה מנטור רפואי-טכנולוגי, מומחה למדעי הנתונים ובוחן פדגוגי. מטרתך היא לאתגר ולהעריך',
    'תלמידי כיתה י׳ החוקרים מודלי AI לאבחון תמונה רפואית, באמצעות תשאול סוקרטי -',
    'וגם לשמש עוזר טכני/מקצועי חופשי מחוץ לחלק המוערך.',
    '',
    '[מבנה הקורס]',
    'התלמידים אינם "בונים מודל" - הם מריצים ניסויים מבוקרים על מודל שאימנו, ובודקים',
    'מה באמת משפיע על התוצאה. ארבעת הניסויים, שכל תלמיד/ה מריץ/ה את כולם:',
    EXPERIMENT_ORDER.map(function (k, i) {
      return '  ' + (i + 1) + '. ' + EXPERIMENTS[k] + ' - ' + EXPERIMENT_QUESTION[k];
    }).join('\n'),
    'לצד כל ניסוי יש כלי בדיקה: מפת קשב (איפה המודל הסתכל) וכלי הפרעות (האם זה באמת',
    'מה שקובע). כל ניסוי מתועד במחברת ניסוי: השערה שננעלת *לפני* המדידה, תנאים',
    'מבוקרים, מדידה, ומסקנה.',
    '',
    '[הקשר התלמיד - נשלף מהמערכת, לא מהתלמיד]',
    'שם התלמיד: ' + (ctx.firstName || '(חסר)'),
    'המאגר הפעיל: ' + (ctx.moduleName || '(חסר)'),
    'הניסוי הנוכחי: ' + (ctx.experimentName || '(חסר)') +
      ' - בודק ' + (EXPERIMENT_QUESTION[ctx.currentExperiment] || ''),
    'נושא השיעור השבועי: ' + (ctx.topicText || '(לא הוזן)'),
    'סיכום הצ׳ק-אין המוערך האחרון: ' + (ctx.priorSummary || '(אין - זה הצ׳ק-אין הראשון)'),
    '',
    'חשוב: הפרטים למעלה כבר ידועים לך. **אסור לשאול את התלמיד/ה על איזה מאגר הוא/היא',
    'עובד/ת או באיזה ניסוי הוא/היא נמצא/ת** - זה משדר שהמערכת לא מכירה אותו/ה. פנה/י',
    'בשם הפרטי והתייחס/י למאגר ולניסוי כעובדה ידועה כבר מההודעה הראשונה.',
    '',
    'ערכות האימון: הן מחולקות מראש ומקושרות מהמסילה בצד המסך, תחת "המאגר',
    'הפעיל". אם נשאלת היכן להשיג תמונות - הפנה/י לשם. **אסור להציע להוריד',
    'את המאגר הגולמי מ-Kaggle, מ-NIH או מכל מקור אחר**, ואסור להמציא כתובת.',
    'הערכות המחולקות בנויות כך שכל גודל מכיל את הקטן ממנו, וכל שקופית/מטופל',
    'נמצא בצד אחד בלבד. הורדה עצמאית הורסת את שתי התכונות האלה בשקט, והניסוי',
    'מפסיק למדוד את מה שהוא אמור למדוד.',
    'אם ערך כלשהו מופיע כ-"(חסר)" - אל תמציא אותו ואל תבקש מהתלמיד/ה להשלים אותו;',
    'ציין/י בקצרה שיש תקלה בנתונים ושכדאי לפנות למורה.',
    '',
    ctx.checkInEnabled === false
      ? [
        '--- השבוע הזה אינו שבוע מוערך ---',
        '',
        'בשבוע הזה אין צ׳ק-אין מוערך: **אסור לבקש תמונות התקדמות, אסור לבקש סיכום שבועי,',
        'אסור להודיע על שאלות שמזכות בציון ואסור לתת ציון.** אל תזכיר כלל שקיים חלק מוערך.',
        'המשימה של השבוע היא בדיוק מה שמופיע ב"נושא השיעור השבועי" למעלה - עבוד/י ממנה',
        'ולא ממשימה אחרת, גם אם בשבועות אחרים הקורס עובד אחרת.',
        'פתח/י בפנייה בשם הפרטי ובשאלה קצרה אחת: איפה הוא/היא עומד/ת במשימה של השבוע.',
        'אם הוא/היא נתקע/ת - עזרה טכנית מעשית, שלב אחרי שלב, בלי להפוך את זה לתשאול.',
        'המשך/י לפי "מצב ב׳" למטה.',
        '',
        '--- מצב ב׳ ---',
      ].join('\n')
      : ctx.gradedThisWeek
      ? '--- החלק המוערך של השבוע הזה כבר בוצע. פעל אך ורק לפי "מצב ב׳" למטה. ---'
      : [
        '--- מצב א׳: החלק המוערך של השבוע (אם עוד לא בוצע) ---',
        '',
        'אם עוד לא הועלו 2 תמונות התקדמות + סיכום מילולי של השבוע - בקש זאת. הודע לתלמיד',
        'במפורש שאתה עומד לשאול אותו שאלות שיזכו אותו בציון.',
        '',
        'בניית השאלה הפותחת (חובה): שאלה אחת בלבד, המשלבת שלושה אלמנטים - (1) המאגר',
        'הפעיל, (2) השאלה שהניסוי הנוכחי בודק, (3) נושא השיעור השבועי. אסור שאלות "גוגל"',
        '(שינון עובדתי, כמו "מה ההגדרה של רגישות?"). חובה שאלות מבוססות-תרחיש שמציגות',
        'בעיה/קונפליקט קונקרטי מתוך המדידות שלו/ה.',
        'דוגמה גרועה: "מה זה פיקסל?"',
        'דוגמה טובה (עקומת למידה, מלריה): "אימנת על 50 תמונות וקיבלת 88%, ועל 400',
        'וקיבלת 94%. במקביל, מפת הקשב הראתה שהמודל מסתכל גם על שולי התמונה ולא רק על',
        'התא. איך שתי העובדות מתיישבות - האם ששת האחוזים הנוספים הם זיהוי טוב יותר של',
        'הטפיל, או ניצול טוב יותר של הרקע? ואיזו בדיקה תכריע בין השתיים?"',
        '',
        'העדף/י שאלות שדורשות להתייחס למספרים שהתלמיד/ה עצמו/ה מדד/ה, ולסתירות בין',
        'המספר לבין מה שכלי הבדיקה הראו. ההבחנה בין "המודל צדק" ל"המודל צדק מהסיבה',
        'הנכונה" היא לב הקורס.',
        '',
        'ניהול השיחה: שאל שאלה אחת בלבד והמתן לתשובה. בלי פסקאות ארוכות. סולם סוקרטי לפי',
        'איכות התשובה:',
        '  - נכונה אך שטחית -> "תוכל לתת לי דוגמה מתוך התמונות שאספת השבוע?"',
        '  - מתחמקת ("כן, זה ישפיע") -> "באילו מובנים? תאר לי את התהליך הלוגי."',
        '  - שגויה לגמרי -> אל תיתן את התשובה! הצג סתירה לוגית ("אבל אם זה נכון, איך תסביר',
        '    ש...?") כדי שהתלמיד יבין בעצמו שטעה.',
        'מקסימום 3 חילופי דברים (תורות).',
        '',
        'מתן ציון (בסוף השיחה המוערכת בלבד): 40% דיוק מדעי/מושגי (מונחים כמו רגישות',
        'וספציפיות, דליפת נתונים, קיצור דרך, מפת קשב, False Positives/Negatives) - 40%',
        'חיבור לניסוי שהוא/היא מריץ/ה ולמספרים שמדד/ה - 20% ביסוס ונימוק, כולל נכונות',
        'לומר "המדידה לא מכריעה". רמות: 9-10 מצוין, 7-8 טוב, 5-6 חלקי, 1-4',
        'דורש שיפור ניכר. אזהרה: אל תהיה רך מדי - תשובות של מילה אחת/חוסר הבנה מוחלט',
        'מקבלות ציון נמוך (4-6) עם הסבר.',
        '',
        'פורמט סיום חובה, מדויק:',
        '"תודה על התשובות, ' + ctx.firstName + '. ציון ההערכה לשבוע זה: [ציון מ-1 עד 10].',
        'משוב מנטור: [משפט חיזוק חיובי ספציפי, ומשפט אחד המציג נקודה לשיפור או שאלה',
        'פתוחה למחשבה לקראת השבוע הבא]."',
        '',
        'מיד אחרי הודעת הסיום הזו, כתוב שורה נוספת בפורמט המדויק הבא (לשימוש פנימי של',
        'המערכת, לא לתלמיד):',
        '###SUMMARY### <סיכום קצר של השיחה לזיכרון השבוע הבא>',
        '',
        '--- מצב ב׳: בכל שאר ההודעות (לפני/אחרי החלק המוערך, או אם כבר בוצע השבוע) ---',
      ].join('\n'),
    '',
    'אתה עוזר חופשי, לא מוערך. תפקידך:',
    '1. הכוונה כללית על הפרויקט בגישה סוקרטית - הנחה בשאלות מנחות ורמזים, לעולם אל תמסור',
    '   תשובה סופית, מסקנה מוכנה, או פתרון מוכן (אל תסווג תמונה עבורו, אל תכתוב עבורו',
    '   מסקנת מחקר). אם הוא מבקש ישירות "תן לי את התשובה" - הכוון אותו לחשוב בשלבים.',
    '2. סיוע טכני בהפעלת כלי אימון חיצוניים (כגון Teachable Machine) - הסבר שלבים, עזרה',
    '   בפתרון תקלות נפוצות.',
    '3. מענה מקצועי ומדויק על שאלות בתחום הרפואה והדימות (אנטומיה, מיקרוסקופיה,',
    '   פיזיקת קרינת רנטגן, מינוח), ברמה המתאימה לתלמיד תיכון.',
    '4. עזרה בקריאת תוצאות הכלים: מטריצת בלבול, בחירת סף, מפת קשב, טבלת ההפרעות.',
    '   מותר להסביר מה *מודד* כל מדד; אסור לומר מה המסקנה מהמספרים שלו/ה.',
    'במצב ב׳ אל תזכיר ציונים ואל תיתן ציון.',
    '',
    'לגבי היקף העזרה: היה נדיב ופרשני לטובת התלמיד. שאלות על הצגת התוצאות, על ניתוח',
    'נתונים, על כלים שהוא משתמש בהם או על רקע רפואי - כולן בתחום, גם אם אינן נוגעות',
    'ישירות למאגר הפעיל. רק אם הבקשה ברור שאין לה קשר לפרויקט (למשל: לכתוב עבורו אתר שלם,',
    'שיעורי בית במקצוע אחר, או משימת תכנות שאינה חלק מהמחקר) - אמור זאת **פעם אחת**,',
    'במשפט קצר ונעים, והצע במה כן תוכל לעזור. אל תחזור על הסירוב בהודעות הבאות ואל',
    'תפתח בכל תשובה בתזכורת על גבולות - זה מעיק ופוגע בשיחה.',
  ].join('\n');
}

// -------------------------------------------------------------- שיחת ה-AI Mentor
/**
 * history: מערך {role: 'user'|'model', text: string} - כל היסטוריית השיחה הנוכחית
 * (הלקוח שומר ושולח אותה בכל פעם - השרת חסר מצב בין קריאות).
 * images: מערך עד 2 {base64, mimeType} - רק בהודעה הראשונה של צ׳ק-אין חדש.
 */
function sendMentorMessage(studentId, history, images, elapsedSeconds) {
  const ctx = getStudentContext(studentId);

  const lastTurn = (history || [])[history.length - 1];
  if (lastTurn && String(lastTurn.text || '').length > MAX_MESSAGE_CHARS) {
    throw new Error('ההודעה ארוכה מדי (עד ' + MAX_MESSAGE_CHARS + ' תווים). נסו לקצר או לפצל אותה.');
  }
  // בשבוע ללא צ׳ק-אין אין שיחה מוערכת לשמור לה מכסה, ולכן הרזרבה משוחררת
  // לשימוש חופשי במקום להישאר נעולה עד סוף השבוע.
  enforceUsageLimits(studentId, ctx.weekNumber,
    ctx.gradedThisWeek || ctx.checkInEnabled === false);

  const systemPrompt = buildSystemPrompt(ctx);

  // שולחים ל-Gemini רק חלון מההיסטוריה. התור הראשון נשמר תמיד כי אליו מצורפות
  // התמונות והסיכום השבועי - בלעדיו החלק המוערך מאבד את ההקשר שלו.
  const contents = trimHistory(history || []).map((turn, idx) => {
    const parts = [{ text: turn.text }];
    if (idx === 0 && images && images.length && !ctx.gradedThisWeek) {
      images.forEach(img => {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
      });
    }
    return { role: turn.role === 'model' ? 'model' : 'user', parts };
  });

  const raw = callGemini(systemPrompt, contents);
  const summaryMatch = raw.match(/###SUMMARY###\s*([\s\S]*)$/);
  const visibleText = raw.replace(/###SUMMARY###[\s\S]*$/, '').trim();
  const scoreMatch = visibleText.match(/ציון ההערכה לשבוע זה:\s*\[?(\d{1,2})\]?/);

  const result = { reply: visibleText, graded: false };

  // גם אם המודל בחר בכל זאת לכתוב ציון בשבוע לא-מוערך, הוא לא נשמר:
  // ההנחיה היא בקשה, והבדיקה כאן היא מה שבאמת קובע.
  if (scoreMatch && !ctx.gradedThisWeek && ctx.checkInEnabled !== false) {
    const score = Math.max(1, Math.min(10, Number(scoreMatch[1])));
    const aiMemorySummary = summaryMatch ? summaryMatch[1].trim() : '';
    saveGradedCheckIn(studentId, ctx.weekNumber, images, history.concat([{ role: 'model', text: visibleText }]),
      aiMemorySummary, visibleText, score, elapsedSeconds);
    result.graded = true;
    result.score = score;
  } else {
    appendHelpChatTurn(studentId, ctx.weekNumber, history.concat([{ role: 'model', text: visibleText }]));
  }
  return result;
}

/** משאיר את התור הראשון (תמונות + סיכום שבועי) ואת חלון התורות האחרון. */
function trimHistory(history) {
  if (history.length <= MAX_HISTORY_TURNS) return history;
  return [history[0]].concat(history.slice(history.length - (MAX_HISTORY_TURNS - 1)));
}

/**
 * מכסה שבועית + הגבלת קצב, לכל תלמיד/ה. עטוף ב-LockService כי בלי נעילה
 * אפשר לעקוף את המונה פשוט ע"י שליחת בקשות במקביל - וזה בדיוק התרחיש
 * שההגנה הזו נועדה לחסום.
 */
function enforceUsageLimits(studentId, weekNumber, gradedThisWeek) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getSheet(SHEET_USAGE);
    const row = sheetToObjects(sheet)
      .find(r => r.studentId === studentId && Number(r.weekNumber) === Number(weekNumber));
    const now = new Date();

    if (!row) {
      sheet.appendRow([studentId, weekNumber, 1, now]);
      return;
    }

    const last = row.lastMessageAt ? new Date(row.lastMessageAt) : null;
    if (last && (now.getTime() - last.getTime()) / 1000 < MIN_SECONDS_BETWEEN_MESSAGES) {
      throw new Error('רגע אחד - נא להמתין כמה שניות בין הודעות.');
    }

    // כל עוד החלק המוערך של השבוע לא הושלם, שומרים רזרבה כדי שתלמיד/ה
    // שמיצה/תה את המכסה בשיחה חופשית עדיין יוכל/תוכל לקבל ציון.
    const count = Number(row.messageCount) || 0;
    const ceiling = gradedThisWeek ? WEEKLY_MESSAGE_QUOTA : WEEKLY_MESSAGE_QUOTA + GRADED_RESERVE;
    if (count >= ceiling) {
      throw new Error('הגעת למכסת ההודעות השבועית (' + WEEKLY_MESSAGE_QUOTA +
        '). המכסה מתאפסת בשבוע הבא. אם צריך יותר - דברו עם המורה.');
    }

    sheet.getRange(row.__row, 3).setValue(count + 1);
    sheet.getRange(row.__row, 4).setValue(now);
  } finally {
    lock.releaseLock();
  }
}

/**
 * שולף את המפתח ובודק שהוא נראה כמו מפתח Gemini תקין. בלי הבדיקה הזו,
 * מפתח שהודבק עם רווח או טוקן מסוג אחר מגיע לגוגל ומקבל "API key not valid",
 * שלא מרמז מה בעצם לא בסדר.
 */
function getGeminiApiKey() {
  const raw = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!raw) throw new Error('לא הוגדר GEMINI_API_KEY ב-Script Properties (ראו README)');
  const key = String(raw).trim();
  if (key !== raw) {
    // תיקון שקט של רווחים/שורה חדשה שנדבקו בהעתקה
    PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', key);
  }
  // כאן עמדה בדיקה שדרשה שהמפתח יתחיל ב-"AIza". גוגל מנפיקה גם מפתחות
  // בפורמטים אחרים, ולכן הבדיקה חסמה מפתחות תקינים לחלוטין. בדיקה שמנחשת
  // פורמט אינה יכולה להבדיל בין מפתח פסול לפורמט שלא הכרתי - הדרך היחידה
  // לדעת אם מפתח עובד היא לקרוא איתו ל-API. לשם כך יש testGeminiKey().
  // כאן נשארת רק בדיקה למה שבוודאות שגוי: ערך ריק או עם רווחים בתוכו.
  if (!key) throw new Error('GEMINI_API_KEY ריק. ראו README.');
  if (/\s/.test(key)) {
    throw new Error('המפתח שב-GEMINI_API_KEY מכיל רווח או ירידת שורה בתוכו (' +
      key.length + ' תווים). כנראה נדבק טקסט נוסף בהעתקה. ' +
      'הדביקו מחדש את המפתח בלבד, והריצו testGeminiKey בעורך כדי לאמת.');
  }
  return key;
}

/**
 * בודק את המפתח מול ה-API בפועל, ומחזיר את מה שגוגל אמרה.
 * להרצה מתוך עורך ה-Apps Script; התוצאה נראית ב"יומן ביצוע".
 * זו הבדיקה היחידה שיכולה באמת להיכשל - ולכן היחידה ששווה משהו.
 */
function testGeminiKey() {
  const key = String(PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY') || '').trim();
  if (!key) { Logger.log('לא הוגדר GEMINI_API_KEY.'); return; }
  Logger.log('אורך המפתח: ' + key.length + ' תווים, מתחיל ב-"' + key.slice(0, 4) + '"');
  Logger.log('מודל: ' + geminiModel());

  const resp = UrlFetchApp.fetch(
    GEMINI_API_BASE + geminiModel() + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ parts: [{ text: 'אמור רק: תקין' }] }] }),
    });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code === 200) {
    Logger.log('✅ המפתח עובד. תשובת המודל: ' +
      (JSON.parse(text).candidates || [{}])[0].content.parts[0].text);
  } else {
    Logger.log('❌ נדחה (HTTP ' + code + '):\n' + text.slice(0, 600));
  }
}

function callGemini(systemPrompt, contents) {
  const apiKey = getGeminiApiKey();
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: contents,
    generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
  };
  const url = GEMINI_API_BASE + geminiModel() + ':generateContent?key=' + apiKey;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (data.error) {
    throw new Error('שגיאת Gemini (מודל: ' + geminiModel() + '): ' + data.error.message +
      '\nהריצו את listAvailableModels בעורך ה-Apps Script כדי לראות אילו מודלים זמינים לכם.');
  }
  const candidate = data.candidates && data.candidates[0];
  if (!candidate) throw new Error('Gemini לא החזיר תשובה (ייתכן שנחסם ע"י מסנני בטיחות)');
  return candidate.content.parts.map(p => p.text || '').join('');
}

/**
 * כלי אבחון - להרצה ידנית מעורך ה-Apps Script בלבד (לא חשוף כ-API).
 * בוחרים את הפונקציה בתפריט העליון, לוחצים ▶ Run, ואז פותחים את
 * "יומן ביצוע / Execution log" כדי לראות אילו מודלים המפתח שלכם יכול להריץ.
 * שימושי כשגוגל מוציאה משימוש מודל וההודעה "no longer available" מופיעה.
 */
function listAvailableModels() {
  const apiKey = getGeminiApiKey();
  const res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + apiKey,
    { muteHttpExceptions: true });
  const data = JSON.parse(res.getContentText());
  if (data.error) throw new Error('שגיאה בשליפת רשימת המודלים: ' + data.error.message);

  const usable = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1)
    .map(m => m.name.replace('models/', ''));

  Logger.log('המודל שמוגדר כרגע: ' + geminiModel());
  Logger.log('נמצאו ' + usable.length + ' מודלים זמינים ליצירת תוכן:');
  usable.forEach(name => Logger.log('  ' + name));
  Logger.log('\nלהחלפה: Project Settings ← Script Properties ← מאפיין GEMINI_MODEL עם השם המבוקש.');
  return usable;
}

// -------------------------------------------------------------- שמירת אירועי הערכה/עזרה
function saveGradedCheckIn(studentId, weekNumber, images, fullHistory, aiMemorySummary, mentorFeedback, score, elapsedSeconds) {
  const studentSummary = (fullHistory[0] && fullHistory[0].text) || '';
  const image1Url = images && images[0] ? saveImageToDrive(studentId, weekNumber, 1, images[0]) : '';
  const image2Url = images && images[1] ? saveImageToDrive(studentId, weekNumber, 2, images[1]) : '';
  const docLink = createWeeklyDoc(studentId, weekNumber, fullHistory, image1Url, image2Url);
  const checkInId = 'ci_' + Utilities.getUuid().slice(0, 8);
  getSheet(SHEET_CHECKINS).appendRow([
    checkInId, studentId, weekNumber, new Date(), image1Url, image2Url, studentSummary,
    JSON.stringify(fullHistory), aiMemorySummary, mentorFeedback, score, '', '', docLink, elapsedSeconds || '', 'graded',
  ]);
}

function appendHelpChatTurn(studentId, weekNumber, fullHistory) {
  const sheet = getSheet(SHEET_HELPCHATS);
  const rows = sheetToObjects(sheet);
  const existing = rows.find(r => r.studentId === studentId && Number(r.weekNumber) === Number(weekNumber));
  if (existing) {
    sheet.getRange(existing.__row, 5).setValue(JSON.stringify(fullHistory));
  } else {
    const logId = 'hc_' + Utilities.getUuid().slice(0, 8);
    sheet.appendRow([logId, studentId, weekNumber, new Date(), JSON.stringify(fullHistory)]);
  }
}

function saveImageToDrive(studentId, weekNumber, idx, image) {
  const folder = artifactFolder(studentId, 'checkin');
  const blob = Utilities.newBlob(Utilities.base64Decode(image.base64), image.mimeType,
    'week' + weekNumber + '_img' + idx);
  const file = folder.createFile(blob);
  return file.getUrl();
}

// ------------------------------------------------------------ תיוק תוצרי הכלים
/** שם תיקייה יציב וקריא. ה-username ייחודי ולכן הוא מונע התנגשות בשמות זהים. */
function studentFolderName(studentId) {
  const u = sheetToObjects(getSheet(SHEET_USERS)).find(x => x.studentId === studentId);
  if (!u) return studentId;
  const name = ((u.firstName || '') + ' ' + (u.lastName || '')).trim();
  return (name ? name + ' - ' : '') + (u.username || studentId);
}

function driveRootName() {
  return PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT')
    || 'AI Mentor · הנדסה ביו-רפואית';
}

function artifactFolder(studentId, kind) {
  const sub = ARTIFACT_KINDS[kind];
  if (!sub) throw new Error('סוג תוצר לא מוכר: ' + kind);
  return getOrCreateFolderPath([driveRootName(), studentFolderName(studentId), sub]);
}

/** מנקה כל דבר שיכול להפוך שם קובץ לנתיב. */
function safeFileName(name) {
  return String(name || 'file')
    .replace(/[\u0000-\u001f]/g, '')        // תווי בקרה
    .replace(/[\\/:*?"<>|]/g, '-')          // מפרידי נתיב ותווים אסורים
    .replace(/^\.+/, '')
    .slice(0, 120) || 'file';
}

function countArtifactsThisWeek(studentId, weekNumber) {
  return sheetToObjects(getSheet(SHEET_ARTIFACTS))
    .filter(a => a.studentId === studentId && Number(a.weekNumber) === Number(weekNumber)).length;
}

/**
 * מקבל תוצר שהתלמיד/ה ייצא/ה מאחד הכלים ומתייק אותו תחת התיקייה שלו/ה.
 * הזהות נלקחת מהטוקן ולא משדה בבקשה - אחרת אפשר היה לתייק בשם מישהו אחר.
 */
function saveArtifact(studentId, kind, filename, mimeType, base64) {
  if (!ARTIFACT_KINDS[kind]) throw new Error('סוג תוצר לא מוכר: ' + kind);
  if (!base64) throw new Error('לא התקבל תוכן הקובץ');

  const bytes = Math.floor(String(base64).length * 3 / 4);
  if (bytes > ARTIFACT_MAX_BYTES) {
    throw new Error('הקובץ גדול מדי (' + Math.round(bytes / 1024 / 1024) + 'MB). ' +
      'המותר עד ' + (ARTIFACT_MAX_BYTES / 1024 / 1024) + 'MB.');
  }

  // השבוע של הקבוצה של התלמיד/ה, ולא שבוע כללי: גם התיוג של הקובץ וגם
  // התקרה השבועית נמדדים מול השבוע שהוא/היא באמת נמצא/ת בו.
  const owner = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  const week = Number(getCurrentWeekInfo(owner && owner.group).weekNumber) || 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (countArtifactsThisWeek(studentId, week) >= ARTIFACT_WEEKLY_CAP) {
      throw new Error('הגעת לתקרת הקבצים השבועית (' + ARTIFACT_WEEKLY_CAP + '). ' +
        'פנה/י למורה אם נדרש יותר.');
    }
    // הלוקר של המודל מקבל רק את שלושת הקבצים של Teachable Machine, בשמותיהם
    // המקוריים - loadFromFiles מזהה אותם לפי שם, וקובץ בשם אחר לא ייטען.
    if (kind === 'model') {
      if (MODEL_FILES.indexOf(String(filename)) < 0) {
        throw new Error('קובץ מודל חייב להיות אחד מ: ' + MODEL_FILES.join(', ') +
          '. התקבל: ' + filename);
      }
      replaceModelFile(studentId, String(filename));
    }
    const name = safeFileName(filename);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64),
      mimeType || 'application/octet-stream', name);
    const file = artifactFolder(studentId, kind).createFile(blob);

    const id = 'ART' + new Date().getTime();
    getSheet(SHEET_ARTIFACTS).appendRow([id, studentId, week, kind, name,
      file.getId(), file.getUrl(), bytes, new Date()]);
    return { ok: true, url: file.getUrl(), filename: name, kind: ARTIFACT_KINDS[kind], week: week };
  } finally {
    lock.releaseLock();
  }
}

function listArtifacts(studentId) {
  return sheetToObjects(getSheet(SHEET_ARTIFACTS))
    .filter(a => a.studentId === studentId)
    .map(a => ({ id: a.artifactId, kind: a.kind, folder: ARTIFACT_KINDS[a.kind] || a.kind,
                 filename: a.filename, url: a.url, weekNumber: a.weekNumber,
                 createdAt: a.createdAt }))
    .reverse();
}

/**
 * מחזיר את תוכן הקובץ עצמו, ולא קישור Drive: תיקיות התוצרים אינן משותפות,
 * ולכן קישור לא היה נפתח לתלמיד/ה. הזהות מגיעה מהטוקן והשורה נבדקת מולה -
 * artifactId לבדו אינו הרשאה.
 */
function getArtifact(studentId, artifactId) {
  const row = sheetToObjects(getSheet(SHEET_ARTIFACTS))
    .find(a => a.artifactId === artifactId && a.studentId === studentId);
  if (!row) throw new Error('הקובץ לא נמצא');
  const blob = DriveApp.getFileById(row.fileId).getBlob();
  return {
    filename: row.filename,
    mimeType: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes()),
  };
}

/**
 * הלוקר של המודל: שלושת קבצי Teachable Machine, העותק האחרון בלבד.
 * התלמידים מחליפים מחשב בין שיעורים, ולכן מודל שיושב רק בתיקיית ההורדות
 * של מחשב בכיתה אבוד בפועל.
 */
function getMyModel(studentId) {
  const rows = sheetToObjects(getSheet(SHEET_ARTIFACTS))
    .filter(a => a.studentId === studentId && a.kind === 'model');
  const files = MODEL_FILES.map(function (name) {
    // האחרון שנשמר בשם הזה הוא הקובץ הנוכחי, גם אם נשארו ישנים בגיליון
    const mine = rows.filter(r => r.filename === name);
    if (!mine.length) return { name: name, saved: false };
    const latest = mine.reduce((a, b) => (Number(b.__row) >= Number(a.__row) ? b : a));
    return { name: name, saved: true, id: latest.artifactId,
             weekNumber: latest.weekNumber, savedAt: latest.createdAt,
             bytes: Number(latest.sizeBytes) || 0 };
  });
  return { files: files, complete: files.every(f => f.saved) };
}

/**
 * מקבל בדיוק את מה ש-Teachable Machine נותן: את קובץ ה-zip של הייצוא, או
 * את שלושת הקבצים בנפרד. פריקת ה-zip נעשית בשרת ולא בדפדפן - כך אין צורך
 * בספריית zip בדף, והתלמיד/ה לא צריך/ה לפרוק כלום לפני ההעלאה.
 */
function saveMyModel(studentId, filename, base64) {
  if (!base64) throw new Error('לא התקבל תוכן הקובץ');
  // בדיקה לפני הפריקה: zip קטן יכול להתנפח לגיגה, ו-Utilities.unzip פורק
  // לזיכרון. מודל של Teachable Machine הוא בערך 2MB.
  const bytes = Math.floor(String(base64).length * 3 / 4);
  if (bytes > ARTIFACT_MAX_BYTES) {
    throw new Error('הקובץ גדול מדי (' + Math.round(bytes / 1024 / 1024) + 'MB). ' +
      'המותר עד ' + (ARTIFACT_MAX_BYTES / 1024 / 1024) + 'MB.');
  }
  const name = String(filename || '');
  const isZip = /\.zip$/i.test(name);

  if (!isZip) {
    const base = name.split(/[\\/]/).pop();
    return { saved: [saveArtifact(studentId, 'model', base,
      /\.json$/i.test(base) ? 'application/json' : 'application/octet-stream',
      base64).filename] };
  }

  const zip = Utilities.newBlob(Utilities.base64Decode(base64), 'application/zip', 'model.zip');
  const entries = Utilities.unzip(zip);
  const saved = [];
  entries.forEach(function (entry) {
    // שם הערך ב-zip יכול לכלול תיקייה ("my_model/model.json") - רק הקובץ חשוב
    const base = entry.getName().split(/[\\/]/).pop();
    if (MODEL_FILES.indexOf(base) < 0) return;
    saveArtifact(studentId, 'model', base,
      /\.json$/i.test(base) ? 'application/json' : 'application/octet-stream',
      Utilities.base64Encode(entry.getBytes()));
    saved.push(base);
  });
  if (!saved.length) {
    throw new Error('ה-zip לא מכיל את קבצי המודל (' + MODEL_FILES.join(', ') + '). ' +
      'ודאו שייצאתם מ-Teachable Machine בפורמט Tensorflow.js.');
  }
  return { saved: saved };
}

/**
 * מחזיר zip אחד ולא שלוש הורדות נפרדות: כלי ההערכה מבקש *תיקייה* עם
 * שלושת הקבצים, ושלושה קבצים שנוחתים בתיקיית ההורדות בין קבצים אחרים
 * אינם תיקייה כזו.
 */
function downloadMyModel(studentId) {
  const rows = sheetToObjects(getSheet(SHEET_ARTIFACTS))
    .filter(a => a.studentId === studentId && a.kind === 'model');
  const blobs = [];
  MODEL_FILES.forEach(function (name) {
    const mine = rows.filter(r => r.filename === name);
    if (!mine.length) return;
    const latest = mine.reduce((a, b) => (Number(b.__row) >= Number(a.__row) ? b : a));
    blobs.push(DriveApp.getFileById(latest.fileId).getBlob().setName(name));
  });
  if (blobs.length < MODEL_FILES.length) {
    throw new Error('המודל השמור חסר קבצים. שמרו אותו מחדש מהייצוא של Teachable Machine.');
  }
  const zip = Utilities.zip(blobs, 'my-model.zip');
  return { filename: 'my-model.zip', mimeType: 'application/zip',
           base64: Utilities.base64Encode(zip.getBytes()) };
}

/**
 * מודל שמור הוא עותק אחד ולא היסטוריה: שמירה חדשה של אותו שם מוציאה את
 * הקודם לפח ומוחקת את שורתו. בלי זה הלוקר מתמלא בעשרות model.json
 * והתלמיד/ה לא יודע/ת איזה מהם המודל שלו/ה.
 */
function replaceModelFile(studentId, filename) {
  const sheet = getSheet(SHEET_ARTIFACTS);
  const rows = sheetToObjects(sheet)
    .filter(a => a.studentId === studentId && a.kind === 'model' && a.filename === filename)
    .sort((a, b) => b.__row - a.__row);        // מלמטה למעלה: מחיקה לא מזיזה שורות שטרם נמחקו
  rows.forEach(function (r) {
    try { DriveApp.getFileById(r.fileId).setTrashed(true); } catch (e) {}
    sheet.deleteRow(r.__row);
  });
  return rows.length;
}

function getOrCreateFolderPath(pathParts) {
  let folder = DriveApp.getRootFolder();
  pathParts.forEach(name => {
    const it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

/** יוצר/מעדכן קובץ Google Docs מצטבר לתלמיד, עם סעיף חדש לכל שבוע מוערך */
function createWeeklyDoc(studentId, weekNumber, fullHistory, image1Url, image2Url) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  // היומן יושב בתיקייה של התלמיד/ה, לצד התוצרים - ולא בערימה נפרדת לפי סוג
  const folder = getOrCreateFolderPath([driveRootName(), studentFolderName(studentId)]);
  const docName = 'יומן AI Mentor - ' + (user ? user.firstName + ' ' + user.lastName : studentId);
  const files = folder.getFilesByName(docName);
  let doc;
  if (files.hasNext()) {
    doc = DocumentApp.openById(files.next().getId());
  } else {
    doc = DocumentApp.create(docName);
    DriveApp.getFileById(doc.getId()).moveTo(folder);
  }
  const body = doc.getBody();
  body.appendParagraph('שבוע ' + weekNumber + ' - ' + new Date().toLocaleDateString('he-IL')).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  fullHistory.forEach(turn => {
    body.appendParagraph((turn.role === 'user' ? 'תלמיד: ' : 'AI: ') + turn.text);
  });
  if (image1Url) body.appendParagraph('תמונה 1: ' + image1Url);
  if (image2Url) body.appendParagraph('תמונה 2: ' + image2Url);
  body.appendHorizontalRule();
  doc.saveAndClose();
  return doc.getUrl();
}

// -------------------------------------------------------------- דשבורד למורה
/** ציון רכיב ה-AI Mentor לפי FR-B10: 80% מהנקודות האפשריות = ציון 100 */
function computeMentorGrade(scores, totalWeeksSoFar) {
  const accumulated = scores.reduce((s, v) => s + v, 0);
  const pointsFor100 = 0.8 * totalWeeksSoFar * 10;
  const grade = pointsFor100 > 0 ? Math.min(100, Math.round((accumulated / pointsFor100) * 100)) : 0;
  const surplusPoints = Math.max(0, accumulated - pointsFor100);
  return { grade, surplusPoints, accumulated };
}

function getDashboard() {
  const users = sheetToObjects(getSheet(SHEET_USERS)).filter(u => u.role === 'student');
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS));
  // שבוע לכל קבוצה, ולא שבוע אחד לכיתה: הציון נמדד מול מספר השבועות שהקבוצה
  // *שלה* עברה. אחרת קבוצה שנמצאת בשבוע 2 הייתה נענשת על שבועות שקבוצה
  // אחרת הספיקה לעבור.
  const weekByGroup = {};
  users.forEach(u => {
    const g = normGroup(u.group);
    if (!(g in weekByGroup)) weekByGroup[g] = getCurrentWeekInfo(g);
  });
  return users.map(u => {
    const week = weekByGroup[normGroup(u.group)];
    const mine = checkIns.filter(c => c.studentId === u.studentId);
    const scores = mine.map(c => Number(c.teacherOverrideScore || c.score) || 0);
    const totalWeeksSoFar = Number(week.weekNumber) || mine.length || 1;
    const { grade, surplusPoints } = computeMentorGrade(scores, totalWeeksSoFar);
    const doneThisWeek = mine.some(c => Number(c.weekNumber) === Number(week.weekNumber) && c.status === 'graded');
    return {
      // username ו-last4Id נדרשים בפאנל לזיהוי כפילויות בייבוא:
      // שם פרטי + שם משפחה + 4 ספרות הוא מפתח הזהות שמבדיל בין "אותו
      // אדם, ייבוא חוזר" (מדלגים) לבין "אדם אחר, אותן 4 ספרות" (יוצרים
      // עם סיומת). בלעדיהם המפתח חסר וכל שורה נראית חדשה.
      studentId: u.studentId, username: u.username, last4Id: pad4(u.last4Id),
      firstName: u.firstName, lastName: u.lastName,
      group: u.group, note: u.note,
      groupWeekNumber: week.weekNumber,
      currentExperiment: u.currentExperiment || EXPERIMENT_ORDER[0],
      experimentName: experimentName(u.currentExperiment),
      weeksCompleted: mine.length, mentorGrade: grade, surplusPoints,
      doneThisWeek, lastScore: mine.length ? scores[scores.length - 1] : null,
    };
  });
}

function getStudentTranscripts(studentId) {
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS)).filter(c => c.studentId === studentId)
    .map(c => Object.assign({}, c, { transcript: JSON.parse(c.transcriptJson || '[]') }));
  const helpChats = sheetToObjects(getSheet(SHEET_HELPCHATS)).filter(c => c.studentId === studentId)
    .map(c => Object.assign({}, c, { transcript: JSON.parse(c.transcriptJson || '[]') }));
  return { checkIns, helpChats };
}

function setManualGrade(checkInId, score, note) {
  const sheet = getSheet(SHEET_CHECKINS);
  const rows = sheetToObjects(sheet);
  const row = rows.find(r => r.checkInId === checkInId);
  if (!row) throw new Error('צ׳ק-אין לא נמצא');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(row.__row, headers.indexOf('teacherOverrideScore') + 1).setValue(score);
  sheet.getRange(row.__row, headers.indexOf('teacherNote') + 1).setValue(note || '');
  return { ok: true };
}

// -------------------------------------------------------------- ייצוא שבועי (FR-C5)
function exportWeeklyReport() {
  const users = sheetToObjects(getSheet(SHEET_USERS)).filter(u => u.role === 'student');
  const checkIns = sheetToObjects(getSheet(SHEET_CHECKINS));
  const grades = {}; // group -> קבוצה, לתיקיית שכבה אחת בסיסית (ניתן להרחיב לפי שכבה אמיתית אם יש שדה נפרד)
  const reportName = 'דוח AI Mentor - ' + new Date().toLocaleDateString('he-IL');
  const folder = getOrCreateFolderPath(['AI Mentor - דוחות שבועיים']);
  const existingFiles = folder.getFilesByName(reportName);
  let ss;
  if (existingFiles.hasNext()) {
    ss = SpreadsheetApp.openById(existingFiles.next().getId());
  } else {
    ss = SpreadsheetApp.create(reportName);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  }

  // ממוין לפי קבוצה ואז שם, והקבוצה בשם הלשונית: כשכל קבוצה בשבוע אחר,
  // "שבוע 3" של אחת אינו אותו שבוע של השנייה, ובלי הקבוצה הדוח מטעה.
  users.sort((a, b) => normGroup(a.group).localeCompare(normGroup(b.group), 'he')
    || (a.firstName + a.lastName).localeCompare(b.firstName + b.lastName, 'he'));

  users.forEach(u => {
    const who = (u.firstName + ' ' + u.lastName).trim() || u.studentId;
    const g = normGroup(u.group);
    const name = ((g ? g + ' · ' : '') + who).slice(0, 90);
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(['שבוע', 'ציון שבועי', 'קישור ליומן Docs', 'זמן פעילות (שניות)', 'הערכת AI לתפקוד']);
      sheet.setFrozenRows(1);
    } else {
      sheet.clearContents();
      sheet.appendRow(['שבוע', 'ציון שבועי', 'קישור ליומן Docs', 'זמן פעילות (שניות)', 'הערכת AI לתפקוד']);
    }
    const mine = checkIns.filter(c => c.studentId === u.studentId).sort((a, b) => a.weekNumber - b.weekNumber);
    mine.forEach(c => {
      sheet.appendRow([c.weekNumber, c.teacherOverrideScore || c.score || 0, c.docLink || '',
        c.sessionSeconds || '', c.mentorFeedback || '']);
    });
  });
  const defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);
  return { url: ss.getUrl() };
}

/** מתקין (פעם אחת, ידנית מהעורך) הרצה אוטומטית שבועית של הייצוא */
function installWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'exportWeeklyReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('exportWeeklyReport').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(20).create();
  return { ok: true };
}
