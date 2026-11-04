/* ==========================================================================
   _filing.js - תיוק אוטומטי של תוצרי הכלים, עם תור חוזר.
   מועתק כלשונו לתוך הכלים. הקובץ הזה אינו נטען בזמן ריצה - הוא המקור.

   למה תור ולא fetch אחד: הכלים נפתחים בלשונית חדשה, sessionStorage הוא
   פר-לשונית, ולשונית בת מקבלת ממנו *עותק מנותק* ברגע הפתיחה. תלמיד/ה
   שנכנס/ה למערכת אחרי שהכלי כבר היה פתוח, או שפתח/ה את הכלי מסימנייה,
   לא מזוהה - וכל ייצוא ירד למחשב ונעלם. בגרסה הקודמת זה נבלע בהודעה
   קטנה שנעלמה אחרי 6 שניות, והתלמידים קראו אותה כהצלחה.

   ארבעה מנגנונים, כל אחד סוגר כשל אחר:
     1. כתובת השרת מיובאת מ-js/config.js - מקור אמת אחד.
     2. ההתחברות נלקחת מהלשונית הזו, אחרת משרשרת ה-opener, אחרת מהמראה
        ב-localStorage שהדף הראשי כותב בכניסה.
     3. כל תוצר נכנס לתור ב-localStorage, ויוצא ממנו רק כשהשרת אישר.
     4. פס מצב קבוע על המסך, לא הודעה חולפת.

   דורש בדף: SESSION_KEY, ואלמנט בשם filingChk.
   ========================================================================== */

const API_KEY_LS = 'ai-mentor-api-url';
const QUEUE_KEY  = 'ai-mentor-submit-queue';
const RE_AUTH    = /פג תוקף ההתחברות|נדרשת התחברות|אין הרשאה/;

const sessionUser = () => {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
};

/* ---- כתובת השרת ----
   מיובאת מ-js/config.js, שהוא מקור האמת היחיד שלה. אותו origin, ולכן
   הייבוא תמיד מצליח. localStorage ושרשרת ה-opener נשארים כגיבוי לרגעים
   שלפני שהייבוא חוזר. */
let CONFIG_API = '';

function apiUrl() {
  if (CONFIG_API) return CONFIG_API;
  const own = localStorage.getItem(API_KEY_LS) || '';
  if (own) return own;
  let w = window, hops = 0;
  try {
    while (w.opener && w.opener !== w && hops < 5) {
      w = w.opener; hops++;
      const u = w.localStorage.getItem(API_KEY_LS);
      if (u) return u;
    }
  } catch (e) {}
  return '';
}

async function loadApiUrl() {
  try {
    const m = await import('../../js/config.js');
    CONFIG_API = (m.CONFIG && m.CONFIG.API_URL) || '';
    if (CONFIG_API) { try { localStorage.setItem(API_KEY_LS, CONFIG_API); } catch (e) {} }
  } catch (e) { /* נשארים עם הגיבויים */ }
  renderFilingStatus();
  flushQueue();
}

/* ---- התחברות ----
   sessionStorage הוא פר-לשונית ולשונית בת מקבלת עותק מנותק. אם ההתחברות
   כאן ישנה או חסרה, הלשונית שפתחה אותנו מחזיקה את העדכנית. */
function tokenFromOpenerChain(current) {
  let w = window, hops = 0;
  try {
    while (w.opener && w.opener !== w && hops < 5) {
      w = w.opener; hops++;
      const raw = w.sessionStorage.getItem(SESSION_KEY);
      if (!raw) continue;
      const u = JSON.parse(raw);
      if (u && u.token && u.token !== current) return u;
    }
  } catch (e) {}
  return null;
}

/* העותק המשותף שהדף הראשי כותב בכניסה. זה מה שמאפשר להתחבר בלשונית אחת
   ולהגיש מלשונית אחרת, גם אם זו נפתחה לפני ההתחברות או ישירות מסימנייה. */
const SESSION_MIRROR = 'ai-mentor-session-mirror';
const MIRROR_TTL = 24 * 60 * 60 * 1000;      // תוקף הטוקן בשרת

function sessionFromMirror() {
  try {
    const u = JSON.parse(localStorage.getItem(SESSION_MIRROR) || 'null');
    if (!u || !u.token) return null;
    if (u.mirroredAt && Date.now() - u.mirroredAt > MIRROR_TTL) return null;
    return u;
  } catch { return null; }
}

function currentUser() {
  const mine = sessionUser();
  if (mine && mine.token) return mine;
  // הלשונית שפתחה אותנו מחזיקה את ההתחברות הטרייה ביותר
  const borrowed = tokenFromOpenerChain(null) || sessionFromMirror();
  if (borrowed) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(borrowed)); } catch (e) {}
    return borrowed;
  }
  return null;
}

/* ---- התור ---- */
const loadQueue = () => {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
};
const saveQueue = q => {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch (e) {}
};

function enqueue(item) {
  const q = loadQueue();
  q.push(item);
  saveQueue(q);
}

let flushing = false;

/**
 * מנסה לשלוח את כל מה שממתין. בטוח להרצה חוזרת: פריט נמחק מהתור רק
 * אחרי שהשרת אישר אותו.
 */
async function flushQueue() {
  if (flushing) return;
  const q = loadQueue();
  if (!q.length) { renderFilingStatus(); return; }

  const api = apiUrl();
  const u = currentUser();
  if (!api || !u) { renderFilingStatus(); return; }   // אין למי לשלוח - נשאר בתור

  flushing = true;
  try {
    for (const item of q.slice()) {
      let d;
      try {
        d = await postQueued(u.token, item);
      } catch (netErr) {
        break;                       // רשת נפלה - שאר התור ימתין לניסיון הבא
      }
      if (!d.ok && RE_AUTH.test(d.error || '')) {
        const fresh = tokenFromOpenerChain(u.token);
        if (!fresh) break;           // אין טוקן טרי - ממתינים להתחברות
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(fresh)); } catch (e) {}
        try { d = await postQueued(fresh.token, item); } catch (e2) { break; }
      }
      // סירוב של השרת נשמר *על השורה שבתור*, לא על העותק שבזיכרון. בלי
      // זה הסיבה נעלמת, והתלמיד/ה רואה פריט שתקוע בלי לדעת למה - וזו
      // בדיוק צורת הכישלון שהתור הזה נבנה כדי לבטל.
      if (!d.ok) {
        const q2 = loadQueue();
        const row = q2.filter(x => x.id === item.id)[0];
        if (row) { row.lastError = d.error || 'שגיאה לא ידועה'; saveQueue(q2); }
        break;
      }

      // נקלט. מסירים מהתור ורושמים אישור שנשאר על המסך.
      const rest = loadQueue().filter(x => x.id !== item.id);
      saveQueue(rest);
      lastConfirmed = { filename: item.filename, kind: d.result && d.result.kind, at: Date.now() };
      try { localStorage.setItem('ai-mentor-last-confirmed', JSON.stringify(lastConfirmed)); } catch (e) {}
    }
  } finally {
    flushing = false;
    renderFilingStatus();
  }
}

/**
 * פריט בתור הוא או קובץ לתיוק או רישום הרצה. אותו תור, אותם ניסיונות
 * חוזרים, אותו פס מצב - רק גוף הבקשה שונה.
 */
async function postQueued(token, item) {
  const body = (item.action === 'saveRun')
    ? { action: 'saveRun', token: token, run: item.run }
    : { action: 'saveArtifact', token: token, kind: item.kind,
        filename: item.filename, mimeType: item.mimeType, base64: item.base64 };
  const resp = await fetch(apiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // מונע preflight מול Apps Script
    body: JSON.stringify(body),
  });
  return resp.json();
}

let lastConfirmed = null;
try { lastConfirmed = JSON.parse(localStorage.getItem('ai-mentor-last-confirmed') || 'null'); }
catch { lastConfirmed = null; }

/* ---- הפס שמספר את האמת ---- */
function renderFilingStatus() {
  const box = document.getElementById('filingChk');
  if (!box) return;
  const u = currentUser(), api = apiUrl(), q = loadQueue();

  if (q.length) {
    const needsLogin = !u;
    const refused = q.filter(x => x.lastError)[0];
    box.className = 'verdict warn';
    box.innerHTML = '<b>⏳ ' + q.length + ' קבצים ותוצאות ממתינים לשליחה.</b><br>' +
      (refused
        // סירוב מנומק של השרת הוא דבר שאפשר לתקן. אומרים אותו במילים שלו.
        ? 'השרת החזיר: <b>' + String(refused.lastError).replace(/[<>&]/g, '') + '</b><br>' +
          'תקנו ונסו שוב; מה שבתור יישלח אחר כך לבד.'
        : needsLogin
        ? 'כדי לשלוח אותם צריך להיות מחוברים. היכנסו למערכת באותו דפדפן — ' +
          'הם יישלחו לבד ברגע שתחזרו לכאן.<br>' +
          '<a href="../../" target="_blank" rel="opener" style="color:inherit;font-weight:700">' +
          'פתיחת מסך הכניסה ↗</a>'
        : !api
        ? 'מחפש את כתובת השרת. אם זה לא נפתר תוך כמה שניות — רעננו את הדף.'
        : 'מנסה לשלוח שוב. אפשר להשאיר את הדף פתוח.') +
      '<br><span style="font-weight:400">מה שהורד כבר נמצא על המחשב שלכם, ושום דבר לא אבד.</span>';
    return;
  }

  if (lastConfirmed) {
    box.className = 'verdict good';
    box.innerHTML = '<b>✓ נקלט אצל המורה.</b> ' +
      new Date(lastConfirmed.at).toLocaleString('he-IL',
        { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) +
      (lastConfirmed.kind ? ' · תיקייה "' + lastConfirmed.kind + '"' : '');
    return;
  }

  if (u && api) {
    box.className = 'verdict good';
    box.textContent = '✓ מחובר/ת כ' + (u.displayName ? '-' + u.displayName : 'תלמיד/ה') +
      '. כל ייצוא ושמירת הרצה יתויקו אצל המורה.';
  } else {
    box.className = 'verdict warn';
    box.innerHTML = '<b>עדיין לא מזוהה התחברות.</b> אפשר לעבוד בשקט — ' +
      'מה שתייצאו יישמר ויישלח בתור ברגע שתתחברו. ' +
      'עדיף להיכנס עכשיו: <a href="../../" target="_blank" rel="opener" ' +
      'style="color:inherit;font-weight:700">מסך הכניסה ↗</a>';
  }
}

/* ---- טריגרים לניסיון חוזר ---- */
window.addEventListener('focus', flushQueue);
document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
window.addEventListener('online', flushQueue);
setInterval(() => { if (loadQueue().length) flushQueue(); }, 20000);
