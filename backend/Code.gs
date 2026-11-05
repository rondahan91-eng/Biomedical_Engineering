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
const SHEET_PLANS = 'WeeklyPlans';
const SHEET_PROGRESS = 'TaskProgress';
const SHEET_RUNS = 'Runs';

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

/**
 * המשימה הכתובה הפעילה. המנטור צריך לדעת שלושה דברים עליה: שהיא קיימת,
 * מה מבקשים בכל חלק, והאם התלמיד/ה כבר הגיש/ה.
 *
 * ה"הגשה" מזוהה מתוך התיוק עצמו - דף המטלה מתייק קובץ ששמו מתחיל ב-prefix
 * הזה. אין מנגנון הגשה נפרד, ולכן אין גם מה שיצא מסנכרון: אם הקובץ בתיקייה,
 * ההגשה קרתה.
 */
const ASSIGNMENT = {
  title: 'תיק ההערכה של המודל שלי',
  filePrefix: 'מטלת_כלי_האבחון_',
};

// ---- צ׳קליסט המשימה השבועית ---------------------------------------------
// התבניות נמצאות בקוד ולא בגיליון, בכוונה: הטקסט ארוך, מכויל מול נוסח הכלים
// ושמות התיקיות ב-Drive, ותא בגיליון שאפשר לערוך בטעות הוא דרך להפיל את
// המסילה לכיתה שלמה באמצע שיעור. מה שהמורה בוחר/ת הוא *מפתח* תבנית בלבד,
// והוא נבדק מול הרשימה כאן.
const CHECKLIST_MIN_NOTE = 12;   // תווים. סימון עצמי עולה משפט, לא קליק.

/**
 * דגל ההפעלה של החסימה. Script Property ולא קבוע בקוד, בדיוק כמו GEMINI_MODEL:
 * אפשר לכבות את החסימה לכל הכיתה בעשר שניות בלי פריסה מחדש, וגם אם הפאנל
 * עצמו תקול. ברירת המחדל - כשהמאפיין אינו קיים - היא *לא חוסם*.
 */
function checklistGateOn() {
  return PropertiesService.getScriptProperties().getProperty('CHECKLIST_GATE') === 'on';
}

/**
 * הדלקה וכיבוי של החסימה מתוך הפאנל. המאפיין נשאר מקור האמת, כך שאפשר
 * לכבות גם ידנית מעורך Apps Script אם הפאנל עצמו תקול.
 */
function setChecklistGate(on) {
  PropertiesService.getScriptProperties().setProperty('CHECKLIST_GATE', on ? 'on' : 'off');
  return { ok: true, gateOn: checklistGateOn() };
}

/** מחלץ את מספר ה-n מתווית הרצה. 'n=100 א' ו-'n=100' מחזירים שניהם 100. */
function runN(label) {
  const m = String(label == null ? '' : label).match(/n\s*=\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/**
 * substring ולא תחילית: fname() שם את שם התלמיד/ה *ראשון* בכל ייצוא מהכלים,
 * ולכן indexOf(...) === 0 נכשל לכל תרשים ו-CSV. היוצא היחיד הוא המטלה הכתובה,
 * ששמה מתחיל ב-ASSIGNMENT.filePrefix ולה יש בודק משלה.
 */
function nameHas(name, needle) {
  return String(name == null ? '' : name).indexOf(String(needle)) >= 0;
}

/**
 * הבודקים האוטומטיים. כל אחד מקבל את הסעיף ואת אוסף הראיות שנבנה פעם אחת
 * ב-checklistEvidence, ומחזיר בוליאני. אין כאן קריאה לגיליון: הקריאות כולן
 * כבר נעשו, אחת לכל גיליון, לפני הלולאה.
 */
const STEP_DETECTORS = {
  // 1. מודל שמור במערכת. החזק ביותר: עובר דרך js/api.js ולא דרך נתיב התיוק
  //    של הכלים, ושמות הקבצים קבועים ב-MODEL_FILES ולא נחתכים.
  model:         function (it, ev) { return ev.modelComplete; },
  // 2. המטלה הכתובה הוגשה. התוצר היחיד שמוגן בתור חוזר (tools/evaluate/מטלה.html).
  assignment:    function (it, ev) { return !!(ev.assignment && ev.assignment.submitted); },
  // 3. הייתה הרצת הערכה אחת לפחות בשבוע הזה.
  run1:          function (it, ev) { return ev.runs.length >= 1; },
  // 4. חמש נקודות שונות על ציר אחד. *distinct* n=, לא חמש שמירות.
  runsDistinct5: function (it, ev) { return ev.nDistinct >= (Number(it.min) || 5); },
  // 5. סרגל הרעש: אותו n= שמור פעמיים.
  runsNoisePair: function (it, ev) { return ev.nRepeated >= 1; },
  // 6. תרשים/CSV מכלי ההערכה תויק (kind='charts').
  chartHas:      function (it, ev) { return ev.charts.some(function (f) { return nameHas(f, it.match); }); },
  // 7. רשומת מחברת ניסוי תויקה (kind='notebook', למעט המטלה הכתובה).
  notebookHas:   function (it, ev) { return ev.notebooks.some(function (f) { return nameHas(f, it.match); }); },
};

/**
 * ארבעה סוגי סעיפים:
 *   auto    - המערכת מזהה לבד. אם לא זיהתה, התלמיד/ה יכול/ה לטעון שביצע/ה.
 *   soft    - אותו דבר, אבל הראיה רוכבת על נתיב תיוק שעדיין לא מוקשח.
 *             לכן לכל סעיף soft יש gate:false - שום חסימה לא נשענת עליו.
 *   declare - המערכת אינה יכולה לראות זאת גם בעיקרון (הורדה מ-Drive, אימון
 *             ב-Teachable Machine, קריאת מפת קשב). הסימון דורש משפט.
 *   advice  - המלצה. gate:false תמיד.
 *
 * link הוא *מפתח* ולא נתיב: הדף מתרגם אותו מול ctx.tools, ולכן שורה כאן
 * לא יכולה לחלק כתובת לכלי שנעול ב-TOOL_STAGE.
 */
const CHECKLIST_TEMPLATES = {

  // =======================================================================
  dossier: {
    title: 'תיק ההערכה של המודל שלי',
    note: 'השבוע ממלאים את תיק ההערכה. עבדו מתוך כלי ההערכה, לא מתוך המדריך.',
    items: [

    { id: 'model', kind: 'auto', verify: 'model', gate: true, scope: 'ever', needsStage: 1,
      link: 'locker',
      title: 'ייצוא המודל מ-Teachable Machine ושמירתו במערכת',
      why: 'כלי ההערכה מריץ את המודל בדפדפן. בלי שלושת הקבצים אין מה למדוד, וכל שאר הסעיפים חסומים. ומודל שיושב רק בתיקיית ההורדות של מחשב בכיתה אבוד בשיעור הבא.',
      how: 'ב-Teachable Machine: Export Model ← לשונית Tensorflow.js ← Download my model. בכרטיס "המודל שלי" במסילה העלו את אותו קובץ zip — השרת פורק אותו לבד, אין צורך לחלץ.',
      refs: 'הקישור ל-Teachable Machine נמצא במסילה תחת "כלי המחקר" · כרטיס "המודל שלי" במסילה',
      proof: 'בכרטיס "המודל שלי" כתוב "מודל שמור ✓" (שלושה קבצים מתוך שלושה). הסעיף נדלק לבד.',
      pitfall: 'שמות קלאסים שנשארו Class 1 / Class 2 — אז הכלי נופל לברירת מחדל ולוקח את הקלאס השני כחריג, ובחצי מהמקרים זה בדיוק הפוך. ולהוריד מהלשונית הנכונה: Tensorflow.js, לא Keras ולא tflite.' },

    { id: 'run', kind: 'auto', verify: 'run1', gate: true, needsStage: 1,
      link: 'evaluate',
      title: 'הרצת ההערכה על ערכת המבחן',
      why: 'ציון על תמונות שאימנתם עליהן אינו מדידה. התוויות נלקחות משמות תתי-התיקיות, ולכן תיקייה שגויה נותנת טבלה שגויה — והכלי אינו יכול לדעת זאת.',
      how: 'שלב 1 — תיקיית המודל. שלב 2 — תיקיית "ערכת מבחן" (בתוכה נגוע ותקין). שלב 3 — "הרצת ההערכה". אחרי ההרצה לחצו "שמירה" עם תווית. אל תסגרו את הלשונית: ההרצה חיה בזיכרון הדף בלבד.',
      refs: 'כלי "הערכת מודל" · תיקיית "ערכת המבחן" ברשימת הערכות במסילה · המדריך, סעיף 1',
      proof: 'הסעיף נדלק אחרי שלחצתם "שמירה" על ההרצה. השמירה היא מה שמגיע למערכת — הרצה שלא נשמרה אינה קיימת מחוץ ללשונית הזו.',
      pitfall: 'בחירת תיקייה של מחלקה אחת בלבד — אז הדיוק הכולל והדיוק החיובי מוצגים כ-"—". ואם הופיעה קופסה אדומה "N תמונות לא נכללו", התיקייה אינה מה שחשבתם.' },

    { id: 'cells', kind: 'declare', gate: true, needsStage: 1,
      link: 'assignment',
      title: 'חלק א׳ ו-ב׳ — ארבעת התאים בסף 0.50, וארבעת המדדים מתוכם',
      ask: 'כתבו בשורה אחת: TP / FN / FP / TN בסף 0.50, ומה יצא לרגישות ולספציפיות.',
      why: 'ארבעת האחוזים אינם ארבע מדידות אלא ארבע דרכים לקרוא את אותה טבלה. הטבלה היא המקור; האחוזים הם התוצאה.',
      how: 'ודאו שהסף מציג 0.50, קראו TP/FN/FP/TN ממטריצת הבלבול (או לחצו "העתקה לחלק א׳"), ואז חשבו ביד: דיוק כולל=(TP+TN)/הכל · רגישות=TP/(TP+FN) · ספציפיות=TN/(TN+FP) · דיוק חיובי=TP/(TP+FP). עגלו לאחוז שלם.',
      refs: 'מטלת כלי האבחון, חלקים א׳ ו-ב׳ · המדריך, סעיף 1 (מטריצת הבלבול) וסעיף 2 (ארבעת המדדים)',
      proof: 'בדף המטלה: שורת הסכומים מראה את סך התמונות, וליד כל אחד מארבעת המדדים מופיע "✓ נכון" (סובלנות של נקודת אחוז).',
      pitfall: 'המכנה — זה ההבדל היחיד בין שלושת המדדים האחרונים, וזו הטעות הנפוצה ביותר כאן. ושני התאים הירוקים נושאים את אותה תווית "זוהה נכון": רק השורה מבדילה ביניהם.' },

    { id: 'threshold', kind: 'declare', gate: true, needsStage: 1,
      link: 'evaluate',
      title: 'חלק ג׳ — שלוש שורות סף, ומה שילמתם כדי להרוויח רגישות',
      ask: 'כתבו בשורה אחת: בסף הנמוך כמה החמצות נחסכו, וכמה אזעקות שווא זה עלה.',
      why: 'אותו מודל, אותם ציונים, הכרעה אחרת. זה מראה שאפשר לייפות מדד בגרירה אחת בלי שהמודל למד דבר — וששיפור במדד אחד נגבה מהשני.',
      how: 'מלאו שלוש שורות: ברירת המחדל, סף נמוך יותר, סף גבוה יותר. בכל שורה רגישות, ספציפיות, וגם FN ו-FP — צריך אותם לשאלה 4. הדף RTL ולכן הסרגל הפוך: המינימום 0.05 בצד ימין. סמכו על המספר שליד "סף החלטה", לא על מקום הידית.',
      refs: 'מטלת כלי האבחון, חלק ג׳ ושאלות 4 ו-5 · המדריך, סעיף 3 (סף ההחלטה)',
      proof: 'בדף המטלה מופיעה הקופסה הירוקה "✓ שלוש השורות עקביות זו עם זו".',
      pitfall: 'רישום הסף ההפוך בגלל כיווניות הסרגל, והחלפה בין עמודות FN ו-FP. וצעד של 0.01 לא חייב לשנות כלום — ייתכן שאין אף ציון בתחום שנחצה.' },

    { id: 'heatmap', kind: 'declare', gate: true, needsStage: 1,
      link: 'evaluate',
      title: 'חלק ד׳ — מפת קשב על הטעות שהמודל היה בטוח בה ביותר',
      ask: 'כתבו בשורה אחת: סוג הטעות, הביטחון שהכלי הציג, איפה האזור המשפיע, ומה היה "שינוי מרבי בתחזית".',
      why: 'טעות שהמודל היה בטוח בה היא המקום שבו הכלל שהוא למד נכשל בגלוי. זו הבדיקה היחידה בכלי שמנסה להבדיל בין "המודל צדק" ל"המודל צדק מהסיבה הנכונה".',
      how: 'בטבלה "טעויות — מהבטוחה ביותר לפחותה" לחצו על השורה הראשונה. התחילו ב-48px · מהיר (25 אזורים), וירדו ל-16px רק אם מצאתם השפעה. רשמו את סוג הטעות, את הביטחון, את האזור, ואת "שינוי מרבי בתחזית".',
      refs: 'כלי "הערכת מודל" — טבלת הטעויות ומפת הקשב · המדריך, סעיף 4 וסעיף 6',
      proof: 'השדות "סוג הטעות" / "ביטחון" / "איפה" ושאלה 6 במטלה מלאים ומסתדרים זה עם זה (בהחמצה, הביטחון הוא 1 פחות הציון).',
      pitfall: 'צבע חזק אינו "השפעה גדולה": המפה מנורמלת לכל תמונה בנפרד, ולכן בכל מפה לא-ריקה יש אדום מלא. רק "שינוי מרבי בתחזית" ניתן להשוואה. מפה ריקה היא תוצאה ולא תקלה. ואל תעשו ניתוח טעויות אחרי הזזת הסרגל — המיון עוגן ל-0.5.' },

    { id: 'claim2', kind: 'declare', gate: true, needsStage: 1,
      link: 'assignment',
      title: 'חלק ה׳ — טענה אחת, שתי ראיות משני רכיבים, והבדיקה שתפריך אותה',
      ask: 'כתבו בשורה אחת את הטענה שלכם, ואת הבדיקה שאם תיכשל — הטענה הופרכה.',
      why: 'זה החלק היחיד במטלה שבו אתם קובעים משהו ולא רק מדווחים. טענה שאין בדיקה שיכולה לומר עליה "לא" אינה טענה מדעית.',
      how: 'טענה אחת שניתנת לבדיקה; ראיה 1 מספרית מרכיב אחד; ראיה 2 מרכיב *אחר* (הדף מזהיר אם בחרתם פעמיים אותו רכיב). בשאלה 7 — בדיקה אחת קונקרטית עם תנאי כשלון מספרי, למשל "אם הרגישות תרד ביותר מ-10 נקודות".',
      refs: 'מטלת כלי האבחון, חלק ה׳ ושאלה 7 · המדריך, סעיפים 4 עד 6 (מאיפה לוקחים ראיות)',
      proof: 'בדף המטלה: "✓ שתי ראיות משני רכיבים שונים", ושני השדות מכילים מספר או תצפית קונקרטית.',
      pitfall: '"אבדוק עם עוד תמונות" אינה בדיקה — זו בקשה לעוד נתונים. ושתי ראיות שהן אותו מספר בשני שמות הן ראיה אחת, גם אם הדף אינו חוסם.' },

    { id: 'submit', kind: 'auto', verify: 'assignment', gate: true, scope: 'ever', needsStage: 1,
      link: 'assignment',
      title: 'הגשת תיק ההערכה — והקובץ נקלט אצל המורה',
      why: 'אין מנגנון הגשה נפרד: ההגשה מזוהה מתוך הקובץ שהגיע. קובץ שירד למחשב בלבד אינו הגשה.',
      how: 'בדף המטלה מלאו את השם (רק הוא נועל את הכפתור) ולחצו "שמירה והגשה". הקובץ יורד למחשב וגם נכנס לתור ונשלח.',
      refs: 'מטלת כלי האבחון, כפתור "שמירה והגשה" · תיקיית היעד: AI Mentor · הנדסה ביו-רפואית / השם שלכם / 04_מחברת ניסוי',
      proof: 'הפס הירוק בראש דף המטלה: "✓ ההגשה נקלטה אצל המורה", עם שעה ושם תיקייה. אם הוא לא הופיע — ההגשה ממתינה בתור: התחברו למערכת באותו דפדפן, פתחו שוב את דף המטלה, והיא תישלח לבד.',
      pitfall: 'פתיחת הדף מסימנייה ולא מתוך המערכת — אז אין התחברות וההגשה ממתינה. ושורת "שלמות" בראש הדוח מונה "X מתוך 31 שדות חובה": הגשה חלקית נראית בדיוק כמו מלאה עד שקוראים אותה.' },

    { id: 'charts', kind: 'soft', verify: 'chartHas', match: 'evaluation_results.csv',
      gate: false, needsStage: 1, link: 'evaluate',
      title: 'מומלץ — תיוק ארבעת התרשימים וטבלת התוצאות',
      why: 'זו הראיה היחידה שנשארת אחרי שהלשונית נסגרת. ההרצה עצמה אינה ניתנת לשחזור.',
      how: '"הורדת התרשים" בכל אחד מארבעת הגרפים, ואז "ייצוא כל התוצאות ל-CSV".',
      refs: 'כלי "הערכת מודל", הכפתורים מתחת לכל גרף',
      proof: 'שורות בתיקייה "01_גרפים" שלכם. הסעיף נדלק לבד כשה-CSV מגיע.',
      pitfall: 'שם הקובץ אינו מכיל את הסף, ולכן שני קבצי PNG באותו שם יכולים להיות שתי מציאויות שונות.' },
    ],
  },

  // =======================================================================
  curve: {
    title: 'שבוע עקומת הלמידה',
    note: 'כמה תמונות באמת צריך, ואיפה העקומה מתיישרת. חמש נקודות, ערכת מבחן אחת, סף אחד.',
    items: [

    { id: 'exp_marked', kind: 'declare', gate: true, needsStage: 1, link: 'notebook',
      title: 'סימון הניסוי "עקומת למידה" ופתיחת רשומה במחברת',
      ask: 'כתבו בשורה אחת: איזה מאגר, ובאיזה תאריך פתחתם את הרשומה.',
      why: 'הניסוי המסומן הוא מה שהמנטור שואל עליו, והמחברת היא המקום שבו ההשערה ננעלת לפני המדידה.',
      how: 'במסילה, תחת "סולם הניסויים", לחצו על "עקומת למידה". בכלי "מחברת ניסוי", שלב 1: מאגר, שם מלא, תאריך.',
      refs: 'כלי "מחברת ניסוי", שלב 1 · "סולם הניסויים" במסילה',
      proof: 'הרשומה מופיעה ב"רשומות שמורות" בכלי המחברת, בשם הניסוי.',
      pitfall: 'ניסוי שמעבר לשלב הפתוח יידחה על ידי השרת — כפתור מושבת הוא בקשה, לא מניעה.' },

    { id: 'sizes', kind: 'declare', gate: true, needsStage: 2, link: 'notebook',
      title: 'ספירת הגדלים שנבנו בפועל — וכתיבת הרשימה',
      ask: 'כתבו בשורה אחת את הגדלים שחזרו לכם בפועל, למשל 25, 50, 100, 200.',
      why: 'עקומה שנעצרה כי הנתונים נגמרו אינה עקומה שהתיישרה. אלה שני דברים שונים לגמרי, וחייבים להיכתב בנפרד.',
      how: 'במסילה, תחת "המחקר שלי", ספרו אילו קישורי "ערכת אימון" חזרו: 25 / 50 / 100 / 200 / 400 לכל מחלקה. רשמו את הרשימה בשדה "הערות על התנאים" במחברת.',
      refs: 'רשימת הערכות במסילה · תיקיות Drive: ניסויים/עקומת למידה/גודל 0025 עד גודל 0400',
      proof: 'השדה "הערות על התנאים" במחברת מכיל את רשימת הגדלים שבאמת קיימים אצלכם.',
      pitfall: 'להניח חמש נקודות. בשלב 1 פתוחות רק "גודל 0025" ו"ערכת מבחן"; השאר נפתחות בשלב 2.' },

    { id: 'hypothesis', kind: 'declare', gate: true, needsStage: 1, link: 'notebook',
      title: 'נעילת השערה שנוקבת במספר — לפני המדידה',
      ask: 'כתבו בשורה אחת את ההשערה שנעלתם, עם מספר.',
      why: 'השערה שנכתבת אחרי שרואים את התוצאה תמיד מתאמתת, וכך הניסוי מפסיק ללמד משהו.',
      how: 'במחברת, שלב 2 ← "נעילת ההשערה ומעבר למדידה". הניסוח חייב להיות מופרך: ✅ "מ-200 ל-400 יתווספו פחות מ-3 נקודות דיוק" ❌ "הדיוק ימשיך להשתפר". ענו גם בכתב: אם העקומה מתיישרת בין 100 ל-200 — מה נגמר שם, התמונות, המודל או המדד, ואיזו בדיקה אחת תבדיל בין שלוש התשובות.',
      refs: 'כלי "מחברת ניסוי", שלב 2 · מערך שיעור 2, שקף 17',
      proof: 'חותמת הנעילה מופיעה בסיכום הרשומה. פתיחה חוזרת לעריכה מצוינת שם במפורש.',
      pitfall: 'השערה שאינה ניתנת להפרכה. ואין טעם "לנעול" אחרי שההרצה הראשונה כבר רצה — הנעילה חותמת שעה.' },

    { id: 'noise', kind: 'auto', verify: 'runsNoisePair', gate: true, needsStage: 1,
      link: 'evaluate',
      title: 'סרגל הרעש — שתי הרצות על אותה ערכה בדיוק',
      why: 'שתי הרצות על אותה ערכה נותנות תוצאות שונות, כי משקולות ההתחלה וסדר התמונות מוגרלים. בלי הסרגל הזה כל הפרש קטן הוא טענה בלי בסיס.',
      how: 'אמנו פעמיים על אותה ערכה בדיוק ובאותן הגדרות, העריכו את שני המודלים על אותה ערכת מבחן, ושמרו שתי הרצות בתוויות "n=100 א" ו-"n=100 ב". רשמו את הפער במחברת.',
      refs: 'מערך שיעור 2, שקף 17 (סרגל הרעש) · כלי "הערכת מודל", שורת שמירת ההרצה',
      proof: 'הסעיף נדלק לבד כששתי הרצות שמורות באותו שבוע נושאות אותו מספר n= בתווית.',
      pitfall: 'לדלג על זה ואז לקרוא ל-1.5 נקודות "שיפור". ולהניח שהרעש שנמדד בגודל הקטן תקף גם לגדול.' },

    { id: 'models', kind: 'declare', gate: true, needsStage: 2, link: 'trainer',
      title: 'אימון מודל נפרד לכל גודל — כל אחד מאפס, באותן הגדרות',
      ask: 'כתבו בשורה אחת: כמה מודלים אימנתם, ומה השארתם זהה בכולם.',
      why: 'כל נקודה על הגרף היא אימון נפרד. המודל של 100 אינו המודל של 50 שהשתפר — אימנתם מודלים שונים, לא מודל אחד שלמד כמה פעמים.',
      how: 'לכל תיקיית "גודל NNNN": פרויקט Teachable Machine חדש, אותם שמות קלאסים, בלי לגעת ב-Epochs, ב-Learning rate או ב-Batch size, וייצוא Tensorflow.js לתיקייה שנקראת בשם הגודל. סמנו במחברת את ארבעת התנאים הקבועים.',
      refs: 'מערך שיעור 2, שקף 15 · כלי "מחברת ניסוי", שלב 3 (תנאים)',
      proof: 'תיקיית מודל לכל גודל, כל אחת עם שלושת הקבצים, והגודל בשם התיקייה.',
      pitfall: 'לשנות גם את מספר הסבבים "כי זה יותר תמונות". ולהתאכזב מ-97% כבר ב-25 תמונות — Teachable Machine בונה על רשת שאומנה מראש, ולכן ההתמתנות מתחילה מוקדם. זה ממצא, לא כישלון.' },

    { id: 'runs5', kind: 'auto', verify: 'runsDistinct5', min: 5, gate: true, needsStage: 2,
      link: 'evaluate',
      title: 'חמש הרצות שמורות, כל אחת עם תווית n=, כולן באותו סף',
      why: 'ההרצה השמורה היא הדבר היחיד שמצמיד יחד תווית, סף, ארבעה תאים ושלושה מדדים. הכלי אינו יודע על כמה תמונות אימנתם — התווית היא ציר ה-X שלכם.',
      how: 'לכל מודל: שלב 1 תיקיית המודל ← שלב 2 אותה "ערכת מבחן" בכל הנקודות ← "הרצת ההערכה". ודאו שהסף 0.50 לפני כל שמירה, הקלידו n=25 / n=50 / n=100 / n=200 / n=400, ושמרו בסדר עולה.',
      refs: 'כלי "הערכת מודל", שדה "תווית — למשל n=50" · המדריך, סעיף 7',
      proof: 'הסעיף נדלק לבד כשיש חמש הרצות שמורות באותו שבוע עם חמישה מספרי n= שונים.',
      pitfall: 'תווית ריקה הופכת ל"הרצה 1", ועקומת הלמידה מאבדת את ציר ה-X שלה לנצח. ושמירה בשני ספים שונים — הסף נצרב בתוך ההרצה בלי אזהרה, ושתי נקודות ייראו כהפרש כמות.' },

    { id: 'read3', kind: 'declare', gate: true, needsStage: 1, link: 'evaluate',
      title: 'קריאת שלושת הקווים — וחישוב הדיוק החיובי מה-CSV',
      ask: 'כתבו בשורה אחת: בין איזה שתי נקודות העקומה התיישרה, ובכמה נקודות.',
      why: 'הדיוק יכול להישאר קפוא בזמן שהרגישות עולה והספציפיות יורדת. זה לא "אין שינוי" — זה שינוי שמתבטל בחישוב. ובעין, 3% הם כקוטר נקודה אחת.',
      how: '"ייצוא טבלת ההרצות ל-CSV", וקראו מספרים ולא צורת קו. בערכת מבחן של 200 תמונות כל תמונה שווה חצי נקודת דיוק, ולכן הפרש של נקודה אחת הוא שתי תמונות — רעש. השוו כל הפרש לסרגל הרעש. הדיוק החיובי אינו מצויר ואינו נשמר: חשבו TP/(TP+FP) לכל הרצה בעצמכם.',
      refs: 'המדריך, סעיף 5 (גרף 4 — השוואת ההרצות) · כלי "הערכת מודל", "ייצוא טבלת ההרצות ל-CSV"',
      proof: 'טבלה במחברת, שלב 4, שבה לכל תנאי נבחרה ההרצה המתאימה והמספרים נשלפו מההרצות ולא הוקלדו ביד.',
      pitfall: 'ציר ה-X הוא סדר השמירה ולא n: המרחק בין 25 ל-50 זהה למרחק בין 200 ל-400, והכתובית קוראת לזה "עקומת הלמידה" בכל זאת.' },

    { id: 'maps', kind: 'declare', gate: true, needsStage: 1, link: 'evaluate',
      title: 'מפת קשב בנקודה הראשונה ובאחרונה — האם האזור זז',
      ask: 'כתבו בשורה אחת: על מה הסתכל המודל הקטן, על מה הגדול, ומה היה "שינוי מרבי בתחזית" בכל אחד.',
      why: 'מודל שלמד קיצור דרך משפר את עצמו עם עוד נתונים בדיוק כמו מודל שלמד את הטפיל, והעקומה תיראה כמעט אותו דבר. אם הדיוק עלה והקשב נשאר על המסגרת — מה ששיפרתם אינו האבחון.',
      how: 'בשתי הנקודות: פתחו את שתיים-שלוש הטעויות הבטוחות ביותר, הריצו 48px, ורשמו את האזור ואת "שינוי מרבי בתחזית". כדי לפתוח מפה על תשובה נכונה, העלו את סף ההחלטה עד שאותה תמונה נספרת כהחמצה ונכנסת לטבלה.',
      refs: 'מערך שיעור 2, שקף 18 · המדריך, סעיף 6 ("מה אפשר לפתוח, ומה לא") · כלי "מחברת ניסוי", שלב 5',
      proof: 'שני השדות בשלב 5 במחברת מלאים: האזור, מספר האזורים, ואחוז השינוי המרבי.',
      pitfall: '"מפת הקשב מראה שהמודל מבין" — היא רמז שמחייב בדיקה, לא הוכחה. ואין בשום כלי דרך לתייק את המפה עצמה: מה שנשאר הוא מה שכתבתם, או צילום מסך שתשלחו בצ׳אט המנטור.' },

    { id: 'conclusion', kind: 'declare', gate: true, needsStage: 1, link: 'notebook',
      title: 'מסקנה — ואם המדידה לא הכריעה, לכתוב זאת',
      ask: 'כתבו בשורה אחת: האם ההשערה התאמתה, ומה הניסוי הזה לא יכול להוכיח.',
      why: 'שתי המסקנות "הכמות שיפרה את הלמידה" ו"הכמות שיפרה את ניצול קיצור הדרך" מתאימות לאותם נתונים בדיוק. "המדידה לא הכריעה" היא תשובה לגיטימית ומזכה.',
      how: 'במחברת, שלב 6: האם ההשערה התאמתה (התאמתה / חלקית / הופרכה / המדידה לא הכריעה), מה אני יודע/ת עכשיו שלא ידעתי קודם, מה הניסוי לא יכול להוכיח, והשאלה הבאה שנפתחה.',
      refs: 'כלי "מחברת ניסוי", שלב 6 · מערך שיעור 2, שקף 18',
      proof: 'השדה "מה הניסוי לא יכול להוכיח" מזכיר במפורש לפחות אחת מהמגבלות: גודל ערכת המבחן, מאגר יחיד, אותו מקור, רעש התיוג.',
      pitfall: '"העקומה התיישרה אז הגעתי לתקרה" — הטעות המרכזית של השיעור. ו"הדיוק לא עלה, הניסוי נכשל": טווח קטן מ-2% הוא ממצא בפני עצמו.' },

    { id: 'record', kind: 'soft', verify: 'notebookHas', match: 'ניסוי_',
      gate: false, needsStage: 1, link: 'notebook',
      title: 'מומלץ — ייצוא רשומת המחברת ותרשים השוואת ההרצות',
      why: 'ההרצות יושבות ב-localStorage של המחשב הזה. "איפוס הרצות", או מחשב אחר, והן איננו.',
      how: 'במחברת — "הורדה כקובץ". בכלי ההערכה — "הורדת התרשים" של השוואת ההרצות, ו"ייצוא טבלת ההרצות ל-CSV".',
      refs: 'כלי "מחברת ניסוי" · כלי "הערכת מודל"',
      proof: 'שורות בתיקיות "04_מחברת ניסוי" ו-"01_גרפים" שלכם, באותו תאריך.',
      pitfall: 'ההודעה הקטנה בפינה היא הדבר היחיד שאומר אם התיוק הצליח או רק ההורדה — ובכלי המחברת היא נעלמת אחרי 6 שניות ואין תור חוזר.' },
    ],
  },
};

/**
 * בדיקה עצמית של התבניות. מריצים אותה פעם אחת מתפריט הפונקציות בעורך אחרי
 * הדבקה. היא מה שהופך "סעיף חוסם בלי הסבר" לבלתי אפשרי מבחינה מבנית.
 */
function assertChecklistTemplates() {
  const seen = {};
  Object.keys(CHECKLIST_TEMPLATES).forEach(function (k) {
    CHECKLIST_TEMPLATES[k].items.forEach(function (it) {
      const key = k + '/' + it.id;
      if (seen[key]) throw new Error('מזהה כפול בתבנית ' + k + ': ' + it.id);
      seen[key] = true;
      if (['auto', 'soft', 'declare', 'advice'].indexOf(it.kind) < 0) {
        throw new Error('סוג סעיף לא מוכר ב-' + key + ': ' + it.kind);
      }
      if ((it.kind === 'auto' || it.kind === 'soft') && !STEP_DETECTORS[it.verify]) {
        throw new Error('אין בודק אוטומטי בשם ' + it.verify + ' (' + key + ')');
      }
      if (it.kind === 'declare' && !it.ask) throw new Error('סעיף הצהרה בלי שאלה: ' + key);
      if (it.gate && (!it.why || !it.how || !it.proof)) {
        throw new Error('סעיף חוסם בלי הסבר מלא: ' + key);
      }
      if (it.kind === 'soft' && it.gate) {
        throw new Error('סעיף soft אינו יכול לחסום (' + key + '): נתיב התיוק שלו עדיין לא מוקשח.');
      }
    });
  });
  return { ok: true, templates: Object.keys(CHECKLIST_TEMPLATES).length };
}

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

// ---- המנוע של המנטור -----------------------------------------------------
// המערכת עובדת מול Claude כשיש מפתח, ונופלת ל-Gemini כשאין. זה לא היסוס:
// זה מה שמאפשר להדביק את הקוד הזה *לפני* שהמפתח מוגדר, ולחזור אחורה
// במחיקת מאפיין אחד - בלי פריסה מחדש ובלי שיעור בלי מנטור.
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_API_VERSION = '2026-10-21';
// החלפת מודל בלי לגעת בקוד: Project Settings ← Script Properties ← CLAUDE_MODEL.
// claude-sonnet-5-5 עולה חצי, claude-haiku-5-5 עולה כעשירית.
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
// תקרת הפלט לתשובה אחת. בניגוד ל-Gemini, ב-Claude *חובה* לציין אותה,
// והיא כוללת גם את טוקני החשיבה - ולכן היא גבוהה מ-1024 ששימשו קודם.
const CLAUDE_MAX_TOKENS = 4000;
// תשובת מנטור היא פסקה קצרה ושאלה אחת, לא הוכחה מתמטית. effort נמוך
// מקצר את החשיבה ואת החשבון, ושומר על זמן תגובה סביר בשיעור.
const CLAUDE_EFFORT = 'low';

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

function claudeModel() {
  return PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL') || DEFAULT_CLAUDE_MODEL;
}

function geminiModel() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
}

/** מפתח Claude אם הוגדר. מחזיר '' ולא זורק - היעדר מפתח הוא מצב תקין. */
function claudeApiKey() {
  return String(PropertiesService.getScriptProperties()
    .getProperty('CLAUDE_API_KEY') || '').trim();
}

/**
 * מזהה סביבת העבודה, אם הוגדר.
 *
 * מפתח שנוצר ברמת הארגון אינו משויך לסביבת עבודה, ואז Claude אינו יודע
 * על איזו לחייב ומחזיר 400. אפשר לפתור זאת בשתי דרכים: מפתח שנוצר *בתוך*
 * סביבת עבודה, או הכותרת הזו. התמיכה כאן קיימת כדי שלא יהיה צורך להנפיק
 * מפתח מחדש.
 */
function claudeWorkspaceId() {
  return String(PropertiesService.getScriptProperties()
    .getProperty('CLAUDE_WORKSPACE_ID') || '').trim();
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
    // סימון תת-משימה. הזהות מהטוקן: אחרת תלמיד/ה יכול/ה לסמן עבור אחר/ת.
    case 'setChecklistItem':
      return setChecklistItem(requireAuth(payload).studentId,
        payload.itemId, payload.done, payload.note);
    // רישום הרצת הערכה. גם כאן הזהות מהטוקן ולא מהבקשה.
    case 'saveRun':
      return saveRun(requireAuth(payload).studentId, payload.run);

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
    case 'deleteCheckIn':
      requireAdmin(payload);
      return deleteCheckIn(payload.checkInId);
    case 'setWeekChecklist':
      return setWeekChecklist(payload.group, payload.templateKey,
        requireAdmin(payload).studentId);
    // פתח המילוט של המורה. כל סעיף מותר כאן, כולל auto, וזו כל הנקודה.
    case 'overrideChecklistItem':
      return overrideChecklistItem(payload.studentId, payload.itemId, payload.done,
        requireAdmin(payload).studentId);
    case 'resetWeeklyUsage':
      requireAdmin(payload);
      return resetWeeklyUsage(payload.studentId);
    case 'setChecklistGate':
      requireAdmin(payload);
      return setChecklistGate(payload.on);
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

// איזה צ׳קליסט מוגדר לאיזה שבוע של איזו קבוצה. append-only: השורה בעלת ה-rev
// הגבוה ביותר עבור (group, weekNumber) היא הקובעת, והקודמות הן ההיסטוריה.
// בכוונה גיליון נפרד ולא עמודה ב-WeeklyTopics: עמודה שם דורשת הגירה שלישית
// *וגם* שורה חדשה בתוך getSheet, ושכחה של החלק השני מפילה את השרת לשתי
// הקבוצות בבת אחת - מסך התלמיד, המנטור, פאנל המורה וחיפוש השבוע של saveArtifact.
SHEET_SCHEMAS[SHEET_PLANS] = ['planId', 'group', 'weekNumber', 'rev', 'templateKey', 'setAt', 'setBy'];

// תת-משימה אחת, אירוע אחד, שורה אחת. append-only ובלי נעילה: אין כאן מונה
// ואין עותק יחיד, ולכן אין read-then-write. השורה האחרונה (לפי __row) עבור
// (studentId, weekNumber, itemId) היא המצב הנוכחי. ביטול סימון מוסיף שורה
// ולא מוחק, ולכן ההיסטוריה נשארת ניתנת לביקורת.
SHEET_SCHEMAS[SHEET_PROGRESS] = ['eventId', 'studentId', 'weekNumber', 'itemId',
  'state', 'source', 'note', 'setAt', 'setBy'];

// הרשומה הראשונה בשרת לכך שהייתה הרצת הערכה בכלל. גיליון ולא Artifacts:
// שורה כאן אינה נוגעת ב-ARTIFACT_WEEKLY_CAP, אינה כותבת ל-Drive, ואינה
// נכנסת לנעילה של 20 השניות ש-saveArtifact מחזיקה.
SHEET_SCHEMAS[SHEET_RUNS] = ['runId', 'studentId', 'weekNumber', 'label', 'threshold',
  'images', 'tp', 'fn', 'fp', 'tn', 'acc', 'sens', 'spec', 'createdAt'];

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
 * שכחת את סיסמת המורה? זו דרך החזרה.
 *
 * להרצה מעורך ה-Apps Script בלבד - היא אינה חשופה כפעולת API, ולכן אי אפשר
 * להגיע אליה מהרשת. רק מי שיש לו גישה לעורך, כלומר בעל הפרויקט, יכול להריץ.
 *
 * שלבים: כתוב/כתבי סיסמה חדשה בשורה למטה, שמור/שמרי, בחר/י את הפונקציה
 * בתפריט העליון והרץ/הריצי. אחר כך **מחק/י את הסיסמה מהשורה ושמור/שמרי שוב** -
 * קוד המקור אינו מקום לשמור בו סיסמה.
 *
 * אין צורך לפרוס מחדש בשביל זה: פריסה משנה את מה שהרשת רואה, והרצה מהעורך
 * עובדת על הגיליון ישירות.
 */
function resetAdminPassword() {
  const NEW_PASSWORD = '';          // ← כאן. ולמחוק מיד אחרי ההרצה.

  if (!NEW_PASSWORD || NEW_PASSWORD.length < 6) {
    throw new Error('כתוב/כתבי סיסמה חדשה (6 תווים לפחות) במשתנה NEW_PASSWORD ואז הרץ/הריצי שוב.');
  }
  const sheet = getSheet(SHEET_USERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('studentId');
  const roleCol = headers.indexOf('role');
  const hashCol = headers.indexOf('passHash') + 1;
  const mustCol = headers.indexOf('mustChangePassword') + 1;

  for (let r = 1; r < values.length; r++) {
    if (values[r][roleCol] !== 'admin') continue;
    sheet.getRange(r + 1, hashCol).setValue(sha256(NEW_PASSWORD));
    sheet.getRange(r + 1, mustCol).setValue(false);
    // גם החיבורים הפעילים מתבטלים: אחרת טוקן ישן ממשיך לעבוד 24 שעות.
    const ses = getSheet(SHEET_SESSIONS);
    const sv = ses.getDataRange().getValues();
    const sIdCol = sv[0].indexOf('studentId');
    for (let k = sv.length - 1; k >= 1; k--) {
      if (sv[k][sIdCol] === values[r][idCol]) ses.deleteRow(k + 1);
    }
    Logger.log('✅ הסיסמה של "' + values[r][idCol] + '" הוחלפה. ' +
               'כעת מחק/י את הסיסמה מהקוד ושמור/שמרי.');
    return { ok: true, username: values[r][headers.indexOf('username')] };
  }
  throw new Error('לא נמצאה שורת מורה (role=admin) בגיליון Users.');
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
/**
 * כל ערך הוא תיקייה *שמכילה תמונות* - אף פעם לא תיקיית-אב.
 *
 * ניסיתי לקצר ולפתוח את 'ניסויים/עקומת למידה' כולה בשלב 1, וזו הייתה טעות:
 * שיתוף ב-Drive אינו עובר בירושה כלפי מטה, ולכן הקישור הוביל את התלמידים
 * לתיקייה פרטית. תיקייה שמקושרת חייבת להיות תיקייה שנפתחת בפועל.
 *
 * השמות כאן הם מה שהתלמיד רואה, ולכן הם אומרים גם כמה תמונות יש בפנים:
 * "גודל 0025" הוא 25 לכל מחלקה, כלומר 50 תמונות.
 */
const STAGE_FOLDERS = {
  1: [['ניסויים/עקומת למידה/גודל 0025', 'ערכת אימון · 25 לכל מחלקה (50 תמונות)'],
      ['ערכת מבחן',                      'ערכת המבחן']],
  2: [['ניסויים/עקומת למידה/גודל 0050', 'ערכת אימון · 50 לכל מחלקה (100 תמונות)'],
      ['ניסויים/עקומת למידה/גודל 0100', 'ערכת אימון · 100 לכל מחלקה (200 תמונות)'],
      ['ניסויים/עקומת למידה/גודל 0200', 'ערכת אימון · 200 לכל מחלקה (400 תמונות)'],
      ['ניסויים/עקומת למידה/גודל 0400', 'ערכת אימון · 400 לכל מחלקה (800 תמונות)'],
      ['ניסויים/יחסי איזון',             'ערכות יחסי האיזון']],
  3: [['ניסויים/הכללה בין מקורות',       'ערכות ההכללה']],
  4: [['בריכת תמונות',                   'בריכת התמונות המלאה']],
};

/**
 * תיקיות שאסור שייפתחו אוטומטית בשום שלב.
 * תיקיית-העל - כדי שתלמיד לא יוכל לדפדף בכל המאגר; הערכה העיוורת - כי כל
 * ערכה שמטרתה בדיקה ללא תוויות מאבדת את ערכה ברגע שאפשר לשוטט בה.
 */
// 'ניסויים/עקומת למידה' נסגרת במפורש: היא תיקיית אינדקס שמכילה את כל
// הגדלים, ופתיחתה הייתה נותנת לתלמיד של שלב 1 לדפדף גם ל-400.
const NEVER_SHARED = ['', 'ערכת מבחן עיוורת', 'ניסויים', 'ניסויים/עקומת למידה'];

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
  // מצב החסימה הוא תכונה של הפריסה, לא של הקבוצה. נקרא פעם אחת ונרכב על כל
  // שורה, כדי שהפאנל יידע להבדיל בין "צ׳קליסט מוצג" לבין "צ׳קליסט חוסם".
  const gateOn = checklistGateOn();
  return listGroups().map(g => {
    const week = getCurrentWeekInfo(g.group);
    week.studentCount = g.studentCount;
    week.unlockedStage = getGroupStage(g.group);
    week.stageName = EXPERIMENTS[EXPERIMENT_ORDER[week.unlockedStage - 1]];
    week.templateKey = currentPlanKey(g.group, week.weekNumber);
    week.checklistGateOn = gateOn;
    // הקטלוג רוכב על השורות הקיימות בכוונה: refresh() בפאנל מצפה למערך,
    // ובקשה שלישית לרשימה שלא משתנה היא בזבוז של עוד נסיעה לשרת.
    week.checklistCatalog = Object.keys(CHECKLIST_TEMPLATES).map(function (k) {
      const t = CHECKLIST_TEMPLATES[k];
      return { key: k, title: t.title, itemCount: t.items.length,
               gateCount: t.items.filter(function (i) { return i.gate; }).length,
               maxStage: Math.max.apply(null, t.items.map(function (i) { return Number(i.needsStage) || 1; })) };
    });
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

/**
 * האם המטלה הכתובה הוגשה, ומתי. נקרא בכל הודעה למנטור, ולכן הוא יודע על
 * הגשה בשנייה שהיא קורית - בלי דגל נפרד שאפשר לשכוח לעדכן.
 */
// artifactRows אופציונלי: מי שכבר קרא את הגיליון מעביר אותו, כדי שהקשר
// התלמיד/ה לא יקרא את Artifacts פעמיים. קריאה בלי הפרמטר נשארת כשהייתה.
function assignmentStatus(studentId, artifactRows) {
  const all = artifactRows || sheetToObjects(getSheet(SHEET_ARTIFACTS));
  const rows = all.filter(function (a) {
    return a.studentId === studentId &&
           String(a.filename || '').indexOf(ASSIGNMENT.filePrefix) === 0;
  });
  if (!rows.length) return { title: ASSIGNMENT.title, submitted: false };
  // הגשה חוזרת מותרת ומתויקת כקובץ נוסף; האחרונה היא הקובעת.
  const latest = rows.reduce(function (a, b) {
    return Number(b.__row) >= Number(a.__row) ? b : a;
  });
  return { title: ASSIGNMENT.title, submitted: true,
           submittedAt: latest.createdAt, times: rows.length };
}

// -------------------------------------------------------- צ׳קליסט שבועי
/**
 * מפתח התבנית שהוגדר ל-(קבוצה, שבוע). '' = אין צ׳קליסט, וזו ברירת המחדל
 * של כל שבוע עד שהמורה בוחר/ת. מפתח שאינו מוכר נחשב כאין - כך שגם אם
 * מישהו ערך את הגיליון ביד, התוצאה היא "בלי צ׳קליסט" ולא שגיאה.
 */
function currentPlanKey(group, weekNumber) {
  const g = normGroup(group);
  const rows = sheetToObjects(getSheet(SHEET_PLANS)).filter(function (p) {
    return normGroup(p.group) === g && Number(p.weekNumber) === Number(weekNumber);
  });
  if (!rows.length) return '';
  const latest = rows.reduce(function (a, b) { return Number(b.rev) >= Number(a.rev) ? b : a; });
  const key = String(latest.templateKey || '').trim();
  return CHECKLIST_TEMPLATES[key] ? key : '';
}

/**
 * אוסף הראיות, נבנה פעם אחת מתוך שורות שכבר נקראו. אין כאן קריאת גיליון -
 * אחרת כל סעיף היה קורא מחדש, ו-55 תלמידים כפול עשרה סעיפים הם 550 קריאות.
 */
function checklistEvidence(studentId, weekNumber, artifactRows, runRows) {
  const mine = artifactRows.filter(function (a) { return a.studentId === studentId; });
  const wk = function (a) { return Number(a.weekNumber) === Number(weekNumber); };

  // המודל אינו פר-שבוע: מודל שנשמר בשבוע 2 הוא עדיין המודל שלך.
  const modelComplete = MODEL_FILES.every(function (f) {
    return mine.some(function (a) { return a.kind === 'model' && a.filename === f; });
  });

  const runs = runRows.filter(function (r) {
    return r.studentId === studentId && Number(r.weekNumber) === Number(weekNumber);
  });
  const counts = {};
  runs.forEach(function (r) {
    const n = runN(r.label);
    if (n !== null) counts[n] = (counts[n] || 0) + 1;
  });
  const ns = Object.keys(counts);

  return {
    modelComplete: modelComplete,
    assignment: assignmentStatus(studentId, artifactRows),
    runs: runs,
    nDistinct: ns.length,
    nRepeated: ns.filter(function (n) { return counts[n] >= 2; }).length,
    charts: mine.filter(function (a) { return a.kind === 'charts' && wk(a); })
                .map(function (a) { return a.filename; }),
    // המטלה הכתובה מתויקת גם היא כ-notebook, ואסור שהיא תדליק סעיף מחברת.
    notebooks: mine.filter(function (a) {
                 return a.kind === 'notebook' && wk(a) &&
                        String(a.filename || '').indexOf(ASSIGNMENT.filePrefix) !== 0;
               }).map(function (a) { return a.filename; }),
  };
}

/** המצב האנושי האחרון לכל סעיף: latest-__row-wins, ובנפרד לשבוע ולתמיד. */
function progressMap(progressRows, studentId, weekNumber) {
  const mine = progressRows.filter(function (p) { return p.studentId === studentId; });
  const byWeek = {}, byEver = {};
  let waived = false;
  mine.forEach(function (p) {
    const rec = { state: p.state, source: p.source, note: p.note,
                  setAt: p.setAt, setBy: p.setBy, __row: Number(p.__row) };
    const thisWeek = Number(p.weekNumber) === Number(weekNumber);
    if (!byEver[p.itemId] || rec.__row >= byEver[p.itemId].__row) byEver[p.itemId] = rec;
    if (thisWeek && (!byWeek[p.itemId] || rec.__row >= byWeek[p.itemId].__row)) {
      byWeek[p.itemId] = rec;
    }
    if (thisWeek && p.itemId === '*' && p.state === 'done' && p.source === 'waive') waived = true;
  });
  return { byWeek: byWeek, byEver: byEver, waived: waived };
}

/**
 * הצ׳קליסט המלא של תלמיד/ה לשבוע הנוכחי.
 *
 * *לעולם לא זורק.* הפונקציה הזו נקראת מתוך getStudentContext, כלומר מתוך
 * כל טעינת מסך ומתוך כל הודעה למנטור. שגיאה כאן הייתה משביתה את המערכת
 * לכיתה שלמה - ולכן כל תקלה מחזירה צ׳קליסט *פתוח*. ברירת המחדל הבטוחה
 * היא תמיד "לא חוסם".
 */
function weeklyChecklist(studentId, user, week, stage, gradedThisWeek,
                         artifactRows, runRows, progressRows) {
  try {
    const key = currentPlanKey(user.group, week.weekNumber);
    if (!key) return null;
    const tpl = CHECKLIST_TEMPLATES[key];
    const ev = checklistEvidence(studentId, week.weekNumber, artifactRows, runRows);
    const pm = progressMap(progressRows, studentId, week.weekNumber);

    const items = tpl.items.map(function (it) {
      const available = (Number(it.needsStage) || 1) <= Number(stage || 1);
      const human = (it.scope === 'ever' ? pm.byEver : pm.byWeek)[it.id] || null;

      // סדר הכרעה: ויתור כללי ← המורה ← זיהוי אוטומטי ← סימון עצמי ← לא בוצע.
      let done = false, source = '';
      if (pm.waived) { done = true; source = 'waived'; }
      else if (human && human.source === 'teacher') { done = human.state === 'done'; source = 'teacher'; }
      else {
        const det = STEP_DETECTORS[it.verify];
        if ((it.kind === 'auto' || it.kind === 'soft') && det && det(it, ev)) {
          done = true; source = 'auto';
        } else if (human && human.state === 'done') {
          done = true; source = human.source || 'self';
        }
      }

      return {
        id: it.id, title: it.title, why: it.why || '', how: it.how || '',
        refs: it.refs || '', proof: it.proof || '', pitfall: it.pitfall || '',
        ask: it.ask || '', link: it.link || '', kind: it.kind,
        gate: !!it.gate, needsStage: Number(it.needsStage) || 1,
        available: available, done: done, source: source,
        note: human ? String(human.note || '') : '',
      };
    });

    const gateItems = items.filter(function (i) { return i.gate && i.available; });
    const gateDone = gateItems.filter(function (i) { return i.done; }).length;
    const gateOn = checklistGateOn();

    return {
      key: key, title: tpl.title, note: tpl.note || '', weekNumber: week.weekNumber,
      items: items,
      total: items.filter(function (i) { return i.available; }).length,
      doneCount: items.filter(function (i) { return i.available && i.done; }).length,
      gateTotal: gateItems.length, gateDone: gateDone,
      missing: gateItems.filter(function (i) { return !i.done; })
                        .map(function (i) { return i.title; }),
      complete: gateDone >= gateItems.length,
      gateOn: gateOn,
      blocked: gateOn && week.checkIn !== false && !gradedThisWeek &&
               !pm.waived && gateDone < gateItems.length,
    };
  } catch (e) {
    return { key: '', title: '', note: '', items: [], total: 0, doneCount: 0,
             gateTotal: 0, gateDone: 0, missing: [], complete: true,
             blocked: false, gateOn: false, error: String((e && e.message) || e) };
  }
}

/**
 * ------------------------------------------------------- עקומת הלמידה
 * מה שאפשר לבדוק אוטומטית בשבוע עקומת הלמידה, מתוך שורות ההרצות בלבד.
 *
 * הדבר היחיד כאן שאינו ספירה הוא סרגל הרעש: שתי הרצות שנשמרו עם אותו n=
 * הן אותו ניסוי פעמיים, וההפרש ביניהן הוא הרעש של המדידה. בלעדיו "העקומה
 * התיישרה" היא אמירה חסרת משמעות - אי אפשר לדעת אם הפרש של נקודה וחצי
 * הוא ממצא או רעש. *זה* מה שהופך את המטלה מטבלה לניסוי, וזה מה שהשרת
 * יכול לבדוק במקום המורה.
 *
 * הפונקציה אינה קובעת ציון ואינה מנסחת מסקנה. היא מחזירה מספרים, והמנטור
 * שואל עליהם.
 */
function curveReport(studentId, weekNumber, runRows) {
  const mine = runRows.filter(function (r) {
    return r.studentId === studentId && Number(r.weekNumber) === Number(weekNumber);
  });
  const byN = {};
  mine.forEach(function (r) {
    const n = runN(r.label);
    if (n === null) return;
    const acc = Number(r.acc);
    if (isNaN(acc)) return;
    (byN[n] = byN[n] || []).push({
      acc: acc, sens: Number(r.sens), spec: Number(r.spec),
      images: Number(r.images), threshold: Number(r.threshold), label: String(r.label || ''),
    });
  });

  const ns = Object.keys(byN).map(Number).sort(function (a, b) { return a - b; });
  if (!ns.length) {
    return { points: [], unlabeled: mine.length, noiseBand: null, noiseAtN: null,
             gaps: [], plateauFrom: null, mixedThreshold: false, mixedTestSet: false,
             nDistinct: 0, nRepeated: 0 };
  }

  // סרגל הרעש: הפער הגדול ביותר בין שתי הרצות שנשמרו על אותו n.
  // הגדול ולא הממוצע - סרגל צריך להיות שמרני, אחרת הוא מכשיר טענות.
  let noiseBand = null, noiseAtN = null;
  ns.forEach(function (n) {
    const accs = byN[n].map(function (x) { return x.acc; });
    if (accs.length < 2) return;
    const spread = (Math.max.apply(null, accs) - Math.min.apply(null, accs)) * 100;
    if (noiseBand === null || spread > noiseBand) { noiseBand = spread; noiseAtN = n; }
  });

  // נקודה אחת לכל n: הראשונה שנשמרה. שתי הרצות באותו n הן סרגל הרעש,
  // לא שתי נקודות על הציר.
  const points = ns.map(function (n) {
    const p = byN[n][0];
    return { n: n, acc: p.acc, sens: p.sens, spec: p.spec,
             images: p.images, threshold: p.threshold, runs: byN[n].length };
  });

  const gaps = [];
  for (let i = 1; i < points.length; i++) {
    gaps.push({ from: points[i - 1].n, to: points[i].n,
                delta: (points[i].acc - points[i - 1].acc) * 100 });
  }

  // "מאיפה העקומה שטוחה": ה-n הראשון שממנו והלאה *כל* הפערים קטנים
  // מהרעש. פער בודד קטן אינו התיישרות - הוא יכול להיות גומה.
  let plateauFrom = null;
  if (noiseBand !== null && gaps.length) {
    for (let i = 0; i < gaps.length; i++) {
      let flat = true;
      for (let j = i; j < gaps.length; j++) {
        if (Math.abs(gaps[j].delta) > noiseBand) { flat = false; break; }
      }
      if (flat) { plateauFrom = gaps[i].from; break; }
    }
  }

  const uniq = function (arr) {
    const seen = {};
    arr.forEach(function (v) { if (!isNaN(v)) seen[v] = true; });
    return Object.keys(seen);
  };
  return {
    points: points,
    unlabeled: mine.length - ns.reduce(function (s, n) { return s + byN[n].length; }, 0),
    noiseBand: noiseBand, noiseAtN: noiseAtN,
    gaps: gaps, plateauFrom: plateauFrom,
    // שני הדברים שהופכים את העקומה למדידה של שני דברים שונים בלי להודיע:
    // סף שונה בין נקודות, וערכת מבחן בגודל שונה.
    mixedThreshold: uniq(points.map(function (p) { return p.threshold; })).length > 1,
    mixedTestSet: uniq(points.map(function (p) { return p.images; })).length > 1,
    nDistinct: ns.length,
    nRepeated: ns.filter(function (n) { return byN[n].length >= 2; }).length,
  };
}

/** אותו דוח כטקסט קצר לפרומפט. מספרים בלבד - בלי מסקנה ובלי ציון. */
function curveReportLines(cr) {
  if (!cr || !cr.points.length) {
    return 'טרם נשמרו הרצות עם תווית n= בשבוע הזה.' +
      (cr && cr.unlabeled ? ' (' + cr.unlabeled + ' הרצות נשמרו בלי תווית n=.)' : '');
  }
  const pct = function (v) { return isNaN(v) ? '—' : (v * 100).toFixed(1) + '%'; };
  const lines = ['נקודות שנמדדו (n = תמונות לכל מחלקה):'];
  cr.points.forEach(function (p) {
    lines.push('  n=' + p.n + ' · דיוק ' + pct(p.acc) + ' · רגישות ' + pct(p.sens) +
      ' · ספציפיות ' + pct(p.spec) + ' · ערכת מבחן ' + p.images + ' · סף ' + p.threshold);
  });
  lines.push(cr.noiseBand === null
    ? 'סרגל רעש: טרם נמדד. אין שתי הרצות שמורות על אותו n=, ולכן אי אפשר לדעת ' +
      'אם הפרש כלשהו בין נקודות הוא ממצא או רעש.'
    : 'סרגל רעש: ' + cr.noiseBand.toFixed(1) + ' נקודות דיוק (נמדד על n=' + cr.noiseAtN + ').');
  if (cr.gaps.length) {
    lines.push('פערים בין נקודות סמוכות: ' + cr.gaps.map(function (g) {
      return g.from + '→' + g.to + ': ' + (g.delta >= 0 ? '+' : '') + g.delta.toFixed(1);
    }).join(' · '));
  }
  if (cr.noiseBand !== null) {
    lines.push(cr.plateauFrom === null
      ? 'לפי המספרים: אין עדיין טווח שבו כל הפערים קטנים מהרעש — כלומר העקומה ' +
        'טרם התיישרה בתוך מה שנמדד.'
      : 'לפי המספרים: מ-n=' + cr.plateauFrom + ' והלאה כל הפערים קטנים מסרגל הרעש.');
  }
  if (cr.mixedThreshold) {
    lines.push('⚠ ההרצות נשמרו בספים שונים. הסף נצרב בתוך כל הרצה, ולכן חלק ' +
      'מההפרש בין הנקודות אינו נובע מכמות התמונות.');
  }
  if (cr.mixedTestSet) {
    lines.push('⚠ ההרצות נשמרו על ערכות מבחן בגדלים שונים. הנקודות אינן על אותו ציר.');
  }
  if (cr.unlabeled) {
    lines.push('⚠ ' + cr.unlabeled + ' הרצות נשמרו בלי תווית n= ואינן נספרות.');
  }
  return lines.join('\n');
}

/** כל הקריאות שצריך כדי לבנות צ׳קליסט אחד, במקום אחד. */
function checklistBundle(studentId) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!user) throw new Error('תלמיד לא נמצא');
  const week = getCurrentWeekInfo(user.group);
  const graded = sheetToObjects(getSheet(SHEET_CHECKINS)).some(function (c) {
    return c.studentId === studentId && Number(c.weekNumber) === Number(week.weekNumber) &&
           c.status === 'graded';
  });
  const cl = weeklyChecklist(studentId, user, week, getGroupStage(user.group), graded,
    sheetToObjects(getSheet(SHEET_ARTIFACTS)),
    sheetToObjects(getSheet(SHEET_RUNS)),
    sheetToObjects(getSheet(SHEET_PROGRESS)));
  return { user: user, week: week, checklist: cl };
}

/**
 * סימון או ביטול סימון של תת-משימה, על ידי התלמיד/ה.
 *
 * אף הודעת שגיאה כאן אינה מכילה את המחרוזת 'פג תוקף ההתחברות': js/api.js
 * מזהה אותה ומרענן את הדף, וזה היה מנתק תלמיד/ה באמצע סימון.
 */
function setChecklistItem(studentId, itemId, done, note) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!user) throw new Error('תלמיד לא נמצא');
  const week = getCurrentWeekInfo(user.group);
  const key = currentPlanKey(user.group, week.weekNumber);
  if (!key) throw new Error('אין צ׳קליסט לשבוע הזה.');

  const it = CHECKLIST_TEMPLATES[key].items.filter(function (x) { return x.id === itemId; })[0];
  if (!it) throw new Error('תת-משימה לא מוכרת במשימה של השבוע.');

  const stage = getGroupStage(user.group);
  if ((Number(it.needsStage) || 1) > stage) {
    throw new Error('תת-המשימה הזו נפתחת בשלב ' + (Number(it.needsStage) || 1) +
      '. אין צורך לסמן אותה עכשיו.');
  }

  const text = String(note == null ? '' : note).trim();
  const want = !!done;
  if (want && text.length < CHECKLIST_MIN_NOTE) {
    throw new Error(it.kind === 'declare'
      ? 'כדי לסמן את הסעיף הזה צריך לכתוב בשורה אחת מה יצא לך — לפחות ' +
        CHECKLIST_MIN_NOTE + ' תווים.'
      : 'כדי לסמן סעיף שהמערכת לא זיהתה צריך לכתוב בשורה אחת מה עשית — לפחות ' +
        CHECKLIST_MIN_NOTE + ' תווים. המורה רואה את המשפט.');
  }

  // declare = הצהרה; auto/soft = טענה שהמערכת לא ראתה, והיא נצבעת אחרת אצל המורה.
  const src = want ? (it.kind === 'declare' ? 'self' : 'claim') : 'self';
  getSheet(SHEET_PROGRESS).appendRow([
    'TPE' + new Date().getTime() + Utilities.getUuid().slice(0, 3),
    studentId, week.weekNumber, itemId, want ? 'done' : 'open', src,
    text.slice(0, 400), new Date(), studentId]);

  return { ok: true, checklist: checklistBundle(studentId).checklist };
}

/**
 * פתח המילוט של המורה. כל סעיף מותר, כולל auto - וזו כל הנקודה.
 * itemId === '*' עם done=true משחרר את כל השבוע של התלמיד/ה הזה/זו.
 */
function overrideChecklistItem(studentId, itemId, done, teacherId) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!user) throw new Error('תלמיד לא נמצא');
  const week = getCurrentWeekInfo(user.group);
  const id = String(itemId || '').trim();
  if (!id) throw new Error('לא צוינה תת-משימה');
  const want = !!done;
  getSheet(SHEET_PROGRESS).appendRow([
    'TPE' + new Date().getTime() + Utilities.getUuid().slice(0, 3),
    studentId, week.weekNumber, id, want ? 'done' : 'open',
    want && id === '*' ? 'waive' : 'teacher',
    want && id === '*' ? 'שוחרר על ידי המורה' : '', new Date(), teacherId || '']);
  return { ok: true, checklist: checklistBundle(studentId).checklist };
}

/** בחירת הצ׳קליסט לשבוע הנוכחי של קבוצה. '' מסיר אותו. */
function setWeekChecklist(group, templateKey, teacherId) {
  const g = requireGroup(group);
  const key = String(templateKey || '').trim();
  if (key && !CHECKLIST_TEMPLATES[key]) throw new Error('צ׳קליסט לא מוכר: ' + key);
  const week = getCurrentWeekInfo(g);
  if (!week.weekNumber) throw new Error('טרם נפתח שבוע לקבוצה הזו.');

  const sheet = getSheet(SHEET_PLANS);
  const prev = sheetToObjects(sheet).filter(function (p) {
    return normGroup(p.group) === g && Number(p.weekNumber) === Number(week.weekNumber);
  });
  const rev = prev.length ? Math.max.apply(null, prev.map(function (p) { return Number(p.rev) || 0; })) + 1 : 1;
  sheet.appendRow(['PLAN' + new Date().getTime(), g, week.weekNumber, rev, key,
                   new Date(), teacherId || '']);

  const tpl = key ? CHECKLIST_TEMPLATES[key] : null;
  return { ok: true, group: g, weekNumber: week.weekNumber, templateKey: key, rev: rev,
           title: tpl ? tpl.title : '',
           itemCount: tpl ? tpl.items.length : 0,
           gateCount: tpl ? tpl.items.filter(function (i) { return i.gate; }).length : 0 };
}

/**
 * רישום הרצת הערכה. גיליון ולא Artifacts: בלי Drive, בלי נעילה, ובלי
 * להיספר בתקרת הקבצים השבועית.
 */
function saveRun(studentId, run) {
  if (!run) throw new Error('לא התקבלו נתוני הרצה');
  // הכלי מחזיק את המספרים באותיות גדולות (currentMetrics), ומפרסם אותם
  // באותיות קטנות ל-localStorage. מקבלים את שתי הצורות.
  const pick = function (o, a, b) {
    const v = o && (o[a] !== undefined ? o[a] : o[b]);
    return Number(v);
  };
  const tp = pick(run, 'TP', 'tp'), fn = pick(run, 'FN', 'fn');
  const fp = pick(run, 'FP', 'fp'), tn = pick(run, 'TN', 'tn');
  if ([tp, fn, fp, tn].some(isNaN)) {
    throw new Error('הרצה חסרת מספרים — יש לנסות לשמור שוב מתוך הכלי.');
  }
  const images = Number(run.images);
  if (!isNaN(images) && images > 0 && tp + fn + fp + tn !== images) {
    throw new Error('מספרי ההרצה אינם מסתכמים למספר התמונות — יש לנסות לשמור שוב.');
  }

  const label = String(run.label == null ? '' : run.label)
    .replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || 'הרצה';
  const owner = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  const week = Number(getCurrentWeekInfo(owner && owner.group).weekNumber) || 0;
  const threshold = Number(run.threshold);
  const now = new Date();

  // לחיצה כפולה על "שמירה" אינה נקודה שנייה על העקומה.
  const sheet = getSheet(SHEET_RUNS);
  const dup = sheetToObjects(sheet).filter(function (r) {
    return r.studentId === studentId && Number(r.weekNumber) === week &&
           String(r.label) === label && Number(r.tp) === tp && Number(r.fn) === fn &&
           Number(r.fp) === fp && Number(r.tn) === tn &&
           Math.abs(now.getTime() - new Date(r.createdAt).getTime()) < 90000;
  })[0];
  if (dup) return { ok: true, runId: dup.runId, weekNumber: week, duplicate: true };

  const runId = 'RUN' + now.getTime() + Utilities.getUuid().slice(0, 3);
  sheet.appendRow([runId, studentId, week, label, isNaN(threshold) ? '' : threshold,
                   isNaN(images) ? '' : images, tp, fn, fp, tn,
                   Number(run.acc), Number(run.sens), Number(run.spec), now]);
  return { ok: true, runId: runId, weekNumber: week };
}

/**
 * איפוס מונה ההודעות של תלמיד/ה לשבוע הנוכחי.
 * קיים כי תלמיד/ה שהגיע/ה לתקרה אינו/ה יכול/ה להשלים משימה חסומה, והמוצא
 * היחיד עד היום היה לפתוח שבוע חדש לכל הקבוצה.
 */
function resetWeeklyUsage(studentId) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!user) throw new Error('תלמיד לא נמצא');
  const week = Number(getCurrentWeekInfo(user.group).weekNumber) || 0;
  const sheet = getSheet(SHEET_USAGE);
  const row = sheetToObjects(sheet).find(function (r) {
    return r.studentId === studentId && Number(r.weekNumber) === week;
  });
  if (!row) return { ok: true, studentId: studentId, weekNumber: week, deleted: 0 };
  sheet.deleteRow(row.__row);
  return { ok: true, studentId: studentId, weekNumber: week, deleted: 1 };
}

// -------------------------------------------------------------- הקשר תלמיד
function getStudentContext(studentId) {
  const user = sheetToObjects(getSheet(SHEET_USERS)).find(u => u.studentId === studentId);
  if (!user) throw new Error('תלמיד לא נמצא');
  // השבוע נקבע לפי הקבוצה של התלמיד/ה, ולכן קבוצה שמתקדמת מהר לא גוררת
  // איתה את האחרות ולהפך.
  const week = getCurrentWeekInfo(user.group);
  // קריאה אחת של Artifacts, משותפת ל-assignmentStatus ולאוסף הראיות.
  const artifactRows = sheetToObjects(getSheet(SHEET_ARTIFACTS));
  // שתי הקריאות הנוספות נעשות *רק* כשיש תבנית לשבוע הזה. בלי תבנית התוספת
  // לעלות הקריאה היא אפס, וזה המצב של כל שבוע עד שהמורה בוחר/ת צ׳קליסט.
  const planKey = currentPlanKey(user.group, week.weekNumber);
  const runRows = planKey ? sheetToObjects(getSheet(SHEET_RUNS)) : [];
  const progRows = planKey ? sheetToObjects(getSheet(SHEET_PROGRESS)) : [];
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
    assignment: assignmentStatus(studentId, artifactRows),
    // כמו assignment: מצב נגזר, שמחושב מהראיות בכל קריאה ולא נשמר כדגל שאפשר
    // לשכוח לעדכן. null = אין צ׳קליסט לשבוע הזה, וזו ברירת המחדל.
    checklist: planKey
      ? weeklyChecklist(studentId, user, week, stage,
          !!(thisWeekCheckIn && thisWeekCheckIn.status === 'graded'),
          artifactRows, runRows, progRows)
      : null,
    // רק בשבוע עקומת הלמידה, ומתוך שורות שכבר נקראו - אפס קריאות נוספות.
    curve: planKey === 'curve' ? curveReport(studentId, week.weekNumber, runRows) : null,
    trainerUrl: TRAINER_URL,
    priorSummary: lastGraded ? lastGraded.aiMemorySummary : '',
    gradedThisWeek: !!(thisWeekCheckIn && thisWeekCheckIn.status === 'graded'),
  };
}

/**
 * " (14/10 18:25)" או מחרוזת ריקה. לעולם לא זורק.
 *
 * זה נכנס לתוך ה-prompt, ושגיאה כאן הייתה מפילה את בניית ה-prompt - כלומר
 * משביתה את המנטור לכל הכיתה בגלל תא תאריך אחד שנערך ביד בגיליון.
 */
function shortDate(v) {
  try {
    const d = (Object.prototype.toString.call(v) === '[object Date]') ? v : new Date(v);
    if (!d || isNaN(d.getTime())) return '';
    return ' (' + Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM HH:mm') + ')';
  } catch (e) { return ''; }
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
    '[צ׳קליסט המשימה השבועית - נשלף מהמערכת, לא מהתלמיד]',
    (ctx.checklist && ctx.checklist.items && ctx.checklist.items.length)
      ? [
        'שם המשימה: ' + (ctx.checklist.title || '(חסר)'),
        'התקדמות: ' + ctx.checklist.gateDone + ' מתוך ' + ctx.checklist.gateTotal +
          ' תת-משימות חוסמות.',
        ctx.checklist.items.map(function (it) {
          return '  ' + (!it.available ? '[נעול] ' : it.done ? '[בוצע] ' : '[חסר]  ') +
                 it.title + (it.gate ? '' : ' (לא חוסם)');
        }).join('\n'),
        'מה שמסומן [בוצע] כבר נעשה: **אסור לבקש לעשות אותו שוב ואסור לשאול אם עשו אותו.**',
        'מה שמסומן [נעול] עוד לא נפתח לקבוצה הזו - אל תבקש/י אותו ואל תזכיר/י אותו.',
        'אם נשאלת "מה עוד נשאר" - ענה/י מהרשימה הזו ואל תשאל/י מה בוצע.',
        'חלק מהסימונים הם הצהרה של התלמיד/ה ולא אימות של המערכת. מותר לשאול "איך יצא',
        'לך X" ולבדוק מול המספרים שלו/ה; אסור להאשים אותו/ה שלא עשה/תה.',
        'אסור לך לסמן תת-משימה, אסור להבטיח שתת-משימה תסומן, ואסור לומר שתת-משימה',
        'בוצעה אם היא [חסר]. הסימון נעשה בכרטיס "המשימה השבועית" במסך, בצד המסילה.',
        'אסור לך לחסום את התלמיד/ה בעצמך - החסימה היא של המערכת, לא שלך.',
      ].join('\n')
      : 'אין צ׳קליסט לשבוע הזה. המשימה היא בדיוק "נושא השיעור השבועי" למעלה.',
    '',
    // רק בשבוע עקומת הלמידה. אלה המספרים של התלמיד/ה עצמו/ה, ישירות
    // מההרצות ששמר/ה - ולכן אפשר לשאול עליהם בלי לבקש שידווח/תדווח אותם.
    ...(ctx.curve ? [
      '[עקומת הלמידה - המספרים ששמר/ה התלמיד/ה, נשלפים מהמערכת]',
      curveReportLines(ctx.curve),
      '',
      'איך להשתמש בזה: שאל/י על המספרים האלה, אל תדווח/י אותם. **אסור לומר',
      'לתלמיד/ה מה המסקנה** - לא "העקומה התיישרה", לא "הגעת לתקרה" ולא "זה רעש".',
      'השורה "לפי המספרים" היא *לידיעתך בלבד*: היא קיימת כדי שתדע/י אם מה',
      'שהוא/היא טוען/ת מתיישב עם המדידה שלו/ה, ולא כדי לצטט אותה.',
      'אם הוא/היא טוען/ת שהעקומה התיישרה - בקש/י להשוות את הפער לסרגל הרעש.',
      'אם אין עדיין סרגל רעש - זו השאלה החשובה ביותר שיש לשאול השבוע: בלי',
      'שתי הרצות על אותו n אין דרך לדעת אם הפרש כלשהו הוא ממצא.',
      'אם הפערים קטנים מהרעש - שאל/י מה *עוד* יכול להסביר את זה חוץ מ"הגעתי',
      'לתקרה": אולי התמונות נגמרו, אולי המדד אינו רגיש, אולי המודל הוא הגבול.',
      'אם סומן ⚠ - הפנה/י לזה כשאלה ("על איזה סף נשמרו הנקודות?"), לא כהאשמה.',
      '',
    ] : []),
    '[ידע מקצועי - קריאת התוצאות של כלי ההערכה]',
    'זה הידע שממנו את/ה מסביר/ה כששואלים אותך על המושגים האלה. הסבר/י בפשטות,',
    'עם דוגמה מספרית *משלך* - ולעולם אל תחשב/י עבור התלמיד/ה את המספרים שלו/ה.',
    '',
    'ארבעת התאים. האות הראשונה אומרת אם המודל צדק (T/F); השנייה אומרת מה הוא',
    'אמר (P = "חריג", N = "תקין"). שם התא מתאר את *המודל*, לא את האמת:',
    '  TP - אמר "חריג" וצדק.        FP - אמר "חריג" וטעה (אזעקת שווא).',
    '  TN - אמר "תקין" וצדק.        FN - אמר "תקין" וטעה (ממצא שהוחמץ).',
    'הטעות הנפוצה ביותר: לחשוב ש-FN הוא "תקין באמת". הוא נגוע באמת, שהמודל שחרר.',
    '',
    'ארבעת המדדים. ההבדל ביניהם הוא המכנה - "מתוך מי סופרים":',
    '  דיוק כולל  = (TP+TN) / כל התמונות   - מתוך כולן',
    '  רגישות     = TP / (TP+FN)           - מתוך החריגים בלבד',
    '  ספציפיות   = TN / (TN+FP)           - מתוך התקינים בלבד',
    '  דיוק חיובי = TP / (TP+FP)           - מתוך מי שהוכרז חריג',
    'אם נשאלת "למה לא לחלק בסך כל התמונות" - המדד שואל שאלה על קבוצה אחת בלבד,',
    'ושאר התמונות פשוט אינן חלק מהשאלה. לכן הרוב הגדול אינו יכול לנפח אותו.',
    '',
    'מה הדיוק הכולל מסתיר. הוא ממוצע על שתי אוכלוסיות. בערכה לא מאוזנת הקבוצה',
    'הגדולה קובעת אותו כמעט לבדה: מודל שעונה "תקין" על כל תמונה, בערכה של 95',
    'תקינים ו-5 נגועים, מקבל 95% דיוק ומזהה אפס חולים (רגישות 0/5). ערכת המבחן',
    'של הקורס מאוזנת - 100 מכל סוג - ולכן אצלם המלכודת הזו אינה פעילה, וזה בדיוק',
    'מה שניסוי "יחסי איזון" שובר בכוונה בהמשך.',
    '',
    'השם "מטריצת בלבול". ה"בלבול" הוא של המודל ולא של הקורא: כל תא שאינו על',
    'האלכסון הוא מקרה שבו המודל בלבל מחלקה אחת באחרת. האלכסון = צדק.',
    '',
    'סף ההחלטה. המודל מחזיר הסתברות, לא הכרעה; הסף הוא הקו שמעליו מכריזים "חריג".',
    'הזזתו אינה מאמנת מחדש - אלה אותם ציונים בדיוק, חיתוך אחר. העלאת הסף: הרגישות',
    'יורדת או נשארת, הספציפיות עולה או נשארת. הורדתו - להפך. שימו לב שהדף מוצג',
    'מימין לשמאל, ולכן הסרגל מוצג הפוך: המינימום בצד ימין והמקסימום בצד שמאל.',
    '',
    'מפת הקשב. הכלי מכסה אזור בריבוע אפור ושואל את המודל מחדש; אזור שכיסויו שינה',
    'את התשובה הוא שהשפיע. היא מראה מה השפיע על ההחלטה - לא היכן הממצא נמצא.',
    '',
    '[המשימה הכתובה הפעילה: "' + ASSIGNMENT.title + '"]',
    'זו המשימה שהתלמידים עובדים עליה עכשיו. היא נפתחת מתוך כלי ההערכה, ומוגשת',
    'ממנה. **מצב ההגשה של התלמיד/ה שמולך כרגע: ' +
      (ctx.assignment && ctx.assignment.submitted
        ? 'הוגשה' + shortDate(ctx.assignment.submittedAt) + '.**'
        : 'טרם הוגשה.**'),
    '',
    'מבנה המשימה, ומה כל חלק בודק:',
    '  א׳ - העתקת ארבעת התאים מהמסך בסף 0.50. בודק קריאה מדויקת של המטריצה.',
    '  ב׳ - חישוב ארבעת המדדים *ביד* מהתאים (הדף בודק את החשבון), ועוד שלוש שאלות:',
    '      1. חבר אמר "95% דיוק" - איזה מספר אחד תבקש ממנו? ההישג: להבין שדיוק',
    '         כולל הוא ממוצע על שתי אוכלוסיות, ושרגישות (או הרכב הערכה, או FN)',
    '         חושפת את מה שהוא מסתיר. כל אחת מהשלוש תקפה אם הנימוק נכון.',
    '      2. אצלו/ה - מי גבוה, רגישות או ספציפיות? ההישג: לקשר את הפער לסוג',
    '         הטעות שהמודל שלו/ה מעדיף לעשות, במספרים שלו/ה.',
    '      3. איזו טעות חמורה יותר במלריה? ההישג: החמצה חמורה יותר, עם המשמעות',
    '         למטופל - לא רק "כי היא יותר גרועה".',
    '  ג׳ - שלוש שורות סף (ברירת מחדל, נמוך, גבוה) ועוד שתי שאלות:',
    '      4. מה שילמת כדי להרוויח רגישות? ההישג: לכמת את הפשרה במספרים שלו/ה.',
    '      5. איזה סף למעבדה אמיתית? ההישג: אין תשובה אחת נכונה - יש נימוק נכון,',
    '         שאומר למי מיטיבים ועל חשבון מי.',
    '  ד׳ - הטעות שהמודל היה בטוח בה ביותר, ומפת הקשב שלה:',
    '      6. תמונה קשה באמת או קיצור דרך? ההישג: להכריע *על סמך המפה*. "המפה',
    '         אינה מכריעה" היא תשובה מצוינת אם נאמר גם איזו בדיקה כן תכריע.',
    '  ה׳ - טענה אחת + שתי ראיות משני רכיבים שונים של הכלי (הדף דוחה שתיים',
    '      מאותו רכיב), ועוד שאלה:',
    '      7. מה תבדוק כדי לנסות להפריך את עצמך? ההישג: בדיקה קונקרטית אחת.',
    '',
    'איך להתייחס אליה:',
    '  לא הוגשה - אם הוא/היא שואל/ת לאן להתקדם, הזכר/י אותה בקצרה והצע/י עזרה',
    '  במושג שנתקע/ה בו. אל תעבור/תעברי איתו/ה על השאלות אחת-אחת מיוזמתך.',
    '  הוגשה - אפשר להתייחס אליה כעובדה ולהמשיך לחלק המוערך או לשאלות חופשיות.',
    '  **אל תאשר/י ואל תפסול/י תשובות שלו/ה במטלה, ואל תיתן/י לה ציון.** הציון',
    '  השבועי ניתן רק בחלק המוערך של השיחה, ולפי הפורמט שמוגדר לו.',
    '',
    '[הגבול בין הסבר לבין מתן תשובה]',
    'לתלמידים יש מטלה כתובה על כלי האבחון, עם שאלות פתוחות. סביר שידביקו לך שאלה',
    'משם ויבקשו תשובה. הגבול חד:',
    '  מותר - להסביר את המושג; לתת דוגמה מספרית שהמצאת בעצמך; לשאול שאלה מנחה',
    '  שמקרבת אותו/ה לתשובה; להפנות למקום בכלי שבו המספר נמצא.',
    '  אסור - לנסח עבורו/ה תשובה; לומר "תכתוב ש..."; לבחור עבורו/ה איזה מדד לבקש;',
    '  להסיק מהמספרים *שלו/ה* מה המסקנה; למלא לו/ה שדה במטלה.',
    'אם הוא/היא מתעקש/ת "רק תגיד לי מה לכתוב" - אמור/י זאת פעם אחת בנעימות: זה',
    'בדיוק החלק שנועד להיעשות לבד. ואז הצע/י שאלה מכוונת במקום, והמשך/י הלאה.',
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
      : (ctx.checklist && ctx.checklist.blocked)
      ? [
        '--- החלק המוערך של השבוע נעול עד להשלמת הצ׳קליסט ---',
        '',
        'בשלב הזה **אסור לבקש תמונות התקדמות, אסור לבקש סיכום שבועי, אסור להודיע על',
        'שאלות שמזכות בציון ואסור לתת ציון.** אל תבטיח/י שהחלק המוערך "ייפתח בהמשך".',
        'תת-המשימות שעוד לא בוצעו: ' + ctx.checklist.missing.join(' · ') + '.',
        'פתח/י בפנייה בשם הפרטי, אמור/י באיזו תת-משימה הוא/היא עומד/ת עכשיו - הראשונה',
        'ברשימה שלמעלה - ועזור/י בה מעשית, שלב אחרי שלב, בלי תשאול ובלי לפתור במקומו/ה.',
        'אם הוא/היא טוען/ת שביצע/ה תת-משימה שאינה מסומנת: תת-משימה שמסמנים ביד -',
        'הפנה/י לכרטיס "המשימה השבועית" במסך. תת-משימה שהמערכת מסמנת לבד - אמור/י',
        'שיש שם כפתור "עשיתי, והמערכת לא רואה את זה", ושאחריו אפשר להמשיך. אל',
        'תתנצל/י יותר מפעם אחת ואל תתווכח/י על מה בוצע.',
        'המשך/י לפי "מצב ב׳" למטה.',
        '',
        '--- מצב ב׳ ---',
      ].join('\n')
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
        'אם הגעת לכאן, כל תת-המשימות החוסמות של השבוע כבר סומנו. אל תחזור/תחזרי על',
        'הצ׳קליסט ואל תתנה/י את תחילת החלק המוערך בשום תת-משימה נוספת.',
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

  // "המערכת לא מתקדמת": הדבר היחיד שנחסם הוא *פתיחת* החלק המוערך, והחסימה
  // כאן ולא בפרומפט - הנחיה לדגם היא בקשה, ובדיקה בשרת היא מה שקובע (אותו
  // תקדים כמו שמירת הציון למטה). הבדיקה לפני enforceUsageLimits, ולכן ניסיון
  // שנדחה אינו עולה הודעה מהמכסה. ההודעה נוקבת בשמות הסעיפים כי היא נכתבת
  // לתוך התמליל אצל התלמיד/ה, וזה ההסבר היחיד ששורד גרסה ישנה של הדף
  // ששמורה במטמון של מחשב בכיתה.
  if (images && images.length && ctx.checklist && ctx.checklist.blocked) {
    throw new Error('כדי לפתוח את החלק המוערך יש להשלים את תת-המשימות: ' +
      ctx.checklist.missing.join(' · ') +
      '. אם רשימת תת-המשימות אינה מופיעה במסך — לחצו Ctrl+F5 ואז נסו שוב.');
  }

  const lastTurn = (history || [])[history.length - 1];
  if (lastTurn && String(lastTurn.text || '').length > MAX_MESSAGE_CHARS) {
    throw new Error('ההודעה ארוכה מדי (עד ' + MAX_MESSAGE_CHARS + ' תווים). נסו לקצר או לפצל אותה.');
  }
  // בשבוע ללא צ׳ק-אין אין שיחה מוערכת לשמור לה מכסה, ולכן הרזרבה משוחררת
  // לשימוש חופשי במקום להישאר נעולה עד סוף השבוע. כשהצ׳קליסט חוסם הרזרבה
  // נשארת נעולה דווקא: תלמיד/ה חסום/ה מדבר/ת עם המנטור כדי להשתחרר, ובלי
  // התנאי הזה הוא/היא שורף/ת בדיוק את עשר ההודעות שנועדו לחלק המוערך.
  enforceUsageLimits(studentId, ctx.weekNumber,
    ctx.gradedThisWeek || ctx.checkInEnabled === false ||
    !!(ctx.checklist && ctx.checklist.blocked));

  const systemPrompt = buildSystemPrompt(ctx);

  // שולחים למודל רק חלון מההיסטוריה. התור הראשון נשמר תמיד כי אליו מצורפות
  // התמונות והסיכום השבועי - בלעדיו החלק המוערך מאבד את ההקשר שלו.
  const messages = claudeMessagesFrom(trimHistory(history || []),
    (images && images.length && !ctx.gradedThisWeek) ? images : null);

  const raw = callMentorModel(systemPrompt, messages);
  const summaryMatch = raw.match(/###SUMMARY###\s*([\s\S]*)$/);
  const visibleText = raw.replace(/###SUMMARY###[\s\S]*$/, '').trim();
  const scoreMatch = visibleText.match(/ציון ההערכה לשבוע זה:\s*\[?(\d{1,2})\]?/);

  const result = { reply: visibleText, graded: false };

  // גם אם המודל בחר בכל זאת לכתוב ציון בשבוע לא-מוערך, הוא לא נשמר:
  // ההנחיה היא בקשה, והבדיקה כאן היא מה שבאמת קובע.
  if (scoreMatch && !ctx.gradedThisWeek && ctx.checkInEnabled !== false &&
      !(ctx.checklist && ctx.checklist.blocked)) {
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

/**
 * בוחר מנוע. Claude כשיש מפתח, אחרת Gemini.
 *
 * messages הוא תמיד בפורמט של Claude; המרה ל-Gemini נעשית כאן ולא בקריאה,
 * כך שיש *צורה אחת* שמישהו צריך להכיר כדי לקרוא את sendMentorMessage.
 */
function callMentorModel(systemPrompt, messages) {
  return claudeApiKey()
    ? callClaude(systemPrompt, messages)
    : callGemini(systemPrompt, geminiContentsFrom(messages));
}

/**
 * Claude דורש החלפה קפדנית: user, assistant, user... וההודעה הראשונה חייבת
 * להיות של המשתמש. trimHistory שומר את התור הראשון ואז חלון מהסוף, ולכן
 * הוא יכול לייצר שתי הודעות רצופות של אותו צד. כאן מאחדים אותן.
 */
function claudeMessagesFrom(turns, images) {
  const out = [];
  turns.forEach(function (turn, idx) {
    const role = turn.role === 'model' ? 'assistant' : 'user';
    const content = [];
    // התמונות לפני הטקסט: זה הסדר שממנו Claude קורא טוב יותר.
    if (idx === 0 && images && images.length) {
      images.forEach(function (img) {
        content.push({ type: 'image', source: { type: 'base64',
          media_type: img.mimeType, data: img.base64 } });
      });
    }
    content.push({ type: 'text', text: String(turn.text == null ? '' : turn.text) });

    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content = prev.content.concat(content);
    else out.push({ role: role, content: content });
  });
  // הודעת assistant בפתיחה נדחית; מוחקים עד להודעת משתמש ראשונה.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** אותן הודעות בצורת Gemini, לנפילה אחורה. */
function geminiContentsFrom(messages) {
  return messages.map(function (m) {
    const parts = [];
    m.content.forEach(function (b) {
      if (b.type === 'text') parts.push({ text: b.text });
      else if (b.type === 'image') {
        parts.push({ inline_data: { mime_type: b.source.media_type, data: b.source.data } });
      }
    });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts };
  });
}

/**
 * קריאה ל-Claude.
 *
 * שלושה דברים שונים מ-Gemini ושווה לדעת עליהם:
 *  - temperature הוסר מה-API. שליחתו מחזירה 400 בכל מודל.
 *  - max_tokens חובה, והוא כולל את טוקני החשיבה.
 *  - הפרומפט המערכתי נשלח עם cache_control: הוא כ-10,000 תווים ונשלח
 *    מחדש בכל הודעה, וקריאה מהמטמון עולה כחמישית ממחיר קלט רגיל.
 *    הוא משתנה רק כשמצב התלמיד/ה משתנה, ולכן ברצף הודעות בשיעור הוא נפגע.
 */
function callClaude(systemPrompt, messages) {
  const key = claudeApiKey();
  if (!key) throw new Error('לא הוגדר CLAUDE_API_KEY ב-Script Properties.');
  if (/\s/.test(key)) {
    throw new Error('המפתח שב-CLAUDE_API_KEY מכיל רווח או ירידת שורה (' + key.length +
      ' תווים). כנראה נדבק טקסט נוסף. הדביקו מחדש את המפתח בלבד, והריצו ' +
      'testClaudeKey בעורך כדי לאמת.');
  }
  const payload = {
    model: claudeModel(),
    max_tokens: CLAUDE_MAX_TOKENS,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: messages,
    output_config: { effort: CLAUDE_EFFORT },
    // סירוב של מסנני הבטיחות עוצר את התשובה. בכיתה זה שיעור בלי מנטור,
    // ולכן השרת מנותב אוטומטית למודל גיבוי באותה קריאה.
    fallbacks: 'default',
  };
  const headers = {
    'x-api-key': key,
    'anthropic-version': CLAUDE_API_VERSION,
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  };
  const ws = claudeWorkspaceId();
  if (ws) headers['anthropic-workspace-id'] = ws;

  const res = UrlFetchApp.fetch(CLAUDE_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const raw = res.getContentText();
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { throw new Error('תשובה לא קריאה מ-Claude (HTTP ' + code + '): ' + raw.slice(0, 300)); }

  if (code !== 200 || data.type === 'error') {
    const msg = (data.error && data.error.message) || raw.slice(0, 300);
    // התקלה הראשונה שפוגשים עם מפתח ברמת ארגון, ושמה של הכותרת החסרה
    // אינו רומז מאיפה משיגים את הערך שלה.
    if (/workspace/i.test(msg) && !ws) {
      throw new Error('המפתח שייך לארגון ולא לסביבת עבודה, ולכן Claude אינו יודע ' +
        'על איזו סביבה לחייב.\nפתרון א: הוסיפו Script Property בשם CLAUDE_WORKSPACE_ID ' +
        'עם מזהה סביבת העבודה (Console ← Settings ← Workspaces, מזהה שמתחיל ב-wrkspc_).\n' +
        'פתרון ב: צרו מפתח חדש מתוך סביבת העבודה עצמה והחליפו את CLAUDE_API_KEY.\n' +
        'המקור: ' + msg);
    }
    throw new Error('שגיאת Claude (HTTP ' + code + ', מודל: ' + claudeModel() + '): ' + msg +
      '\nהריצו testClaudeKey בעורך ה-Apps Script כדי לבדוק את המפתח ואת המודל.');
  }
  if (data.stop_reason === 'refusal') {
    throw new Error('המודל סירב לענות על ההודעה הזו. נסחו אותה אחרת, ואם זה חוזר — פנו למורה.');
  }
  const text = (data.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text || ''; }).join('');
  if (!text) throw new Error('Claude החזיר תשובה ריקה (stop_reason: ' + data.stop_reason + ').');
  // תשובה שנקטעה מאבדת את ###SUMMARY### ואת שורת הציון, ואז צ׳ק-אין מוערך
  // נשמר בלי ציון בלי שאיש ידע. עדיף להגיד את זה במפורש.
  if (data.stop_reason === 'max_tokens') {
    return text + '\n\n(התשובה נקטעה באמצע. בקשו מהמנטור לקצר, או פנו למורה.)';
  }
  return text;
}

/**
 * בודק את מפתח Claude מול ה-API בפועל ומדפיס את מה שחזר.
 * להרצה מתוך עורך ה-Apps Script; התוצאה ב"יומן ביצוע".
 */
function testClaudeKey() {
  const key = claudeApiKey();
  if (!key) { Logger.log('לא הוגדר CLAUDE_API_KEY — המנטור עובד מול Gemini.'); return; }
  Logger.log('אורך המפתח: ' + key.length + ' תווים, מתחיל ב-"' + key.slice(0, 7) + '"');
  Logger.log('מודל: ' + claudeModel());
  Logger.log('סביבת עבודה: ' + (claudeWorkspaceId() || '(לא הוגדרה — תקין אם המפתח עצמו משויך לסביבה)'));
  try {
    const reply = callClaude('ענה במילה אחת בעברית.',
      [{ role: 'user', content: [{ type: 'text', text: 'אמור רק: תקין' }] }]);
    Logger.log('✅ המפתח עובד. התשובה: ' + reply);
  } catch (e) {
    Logger.log('❌ ' + e.message);
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
  const weekByGroup = {}, stageByGroup = {}, planByGroup = {};
  users.forEach(u => {
    const g = normGroup(u.group);
    if (!(g in weekByGroup)) {
      weekByGroup[g] = getCurrentWeekInfo(g);
      stageByGroup[g] = getGroupStage(g);
      planByGroup[g] = currentPlanKey(g, weekByGroup[g].weekNumber);
    }
  });
  // שלוש קריאות לכל הכיתה, לא קריאה לכל תלמיד/ה. הן נעשות רק אם לקבוצה
  // כלשהי יש בכלל צ׳קליסט השבוע.
  const anyPlan = Object.keys(planByGroup).some(function (g) { return !!planByGroup[g]; });
  const artifactRows = anyPlan ? sheetToObjects(getSheet(SHEET_ARTIFACTS)) : [];
  const runRows = anyPlan ? sheetToObjects(getSheet(SHEET_RUNS)) : [];
  const progRows = anyPlan ? sheetToObjects(getSheet(SHEET_PROGRESS)) : [];

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
      // מי תקוע/ה על מה. selfCount מול claims הוא ההבדל בין "הצהיר" לבין
      // "טען שהמערכת לא ראתה" - ושניהם אינם "המערכת ראתה".
      checklist: (function () {
        if (!planByGroup[normGroup(u.group)]) return null;
        const cl = weeklyChecklist(u.studentId, u, week, stageByGroup[normGroup(u.group)],
          doneThisWeek, artifactRows, runRows, progRows);
        if (!cl) return null;
        return {
          title: cl.title, gateDone: cl.gateDone, gateTotal: cl.gateTotal,
          stuckOn: cl.missing[0] || '', blocked: cl.blocked,
          claims: cl.items.filter(function (i) { return i.source === 'claim'; }).length,
          selfCount: cl.items.filter(function (i) { return i.source === 'self'; }).length,
          cells: cl.items.map(function (i) {
            return { id: i.id, title: i.title, gate: i.gate, available: i.available,
                     done: i.done, source: i.source, note: i.note };
          }),
        };
      })(),
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

/**
 * מוחק צ׳ק-אין מוערך אחד.
 *
 * למה זה נחוץ: `gradedThisWeek` חוסם צ׳ק-אין שני באותו שבוע. תלמיד/ה
 * שהגיש/ה בטעות, או ששבוע הוגדר מוערך לפני שהייתה משימה, נשאר/ת נעול/ה עד
 * שהשורה יורדת. דריסת ציון אינה פותרת את זה - היא משנה מספר, לא מצב.
 *
 * מה נמחק: השורה בגיליון (כולל התמלול והציון) ושתי תמונות ההתקדמות ב-Drive.
 * מה נשאר: היומן ב-Docs. הוא מסמך מצטבר שנכתב אליו בכל צ׳ק-אין, ומחיקה
 * סלקטיבית ממנו הייתה שבירה. עדיף רשומה עודפת ביומן מאשר יומן הרוס.
 */
function deleteCheckIn(checkInId) {
  if (!checkInId) throw new Error('לא צוין צ׳ק-אין למחיקה');
  const sheet = getSheet(SHEET_CHECKINS);
  const row = sheetToObjects(sheet).find(r => r.checkInId === checkInId);
  if (!row) throw new Error('הצ׳ק-אין לא נמצא (ייתכן שכבר נמחק)');

  // התמונות קודם: אם המחיקה שלהן תיכשל, השורה עדיין כאן ואפשר לנסות שוב.
  let imagesTrashed = 0;
  [row.image1Url, row.image2Url].forEach(function (url) {
    const m = String(url || '').match(/[-\w]{25,}/);
    if (!m) return;
    try { DriveApp.getFileById(m[0]).setTrashed(true); imagesTrashed++; }
    catch (e) { /* כבר נמחקה, או אין הרשאה - לא עוצרים בגלל זה */ }
  });

  sheet.deleteRow(row.__row);
  return {
    ok: true, checkInId: checkInId,
    weekNumber: row.weekNumber, score: row.score,
    imagesTrashed: imagesTrashed,
    note: 'היומן ב-Docs לא שונה.',
  };
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
