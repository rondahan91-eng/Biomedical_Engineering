// ==========================================================================
// main.js - נקודת הכניסה: ניהול session וניתוב בין מסך התחברות / צ'אט / דשבורד.
// ==========================================================================
import { CONFIG } from './config.js';
import { renderLogin } from './auth.js';
import { logout as apiLogout } from './api.js';
import { mountTeacherDashboard } from './teacherDashboard.js';
/* studentChat.js אינו מיובא יותר: המעבדה היא מסך התלמיד. הקובץ נשאר
   בריפו כמקור לחלק המוערך שעובר אליה, ולא נטען בכניסה. */

const app = document.getElementById('app');

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(CONFIG.SESSION_KEY) || 'null'); }
  catch { return null; }
}
/**
 * ההתחברות נשמרת ב-sessionStorage, שהוא פר-לשונית: לשונית שנפתחת מכאן
 * מקבלת *עותק* ומאותו רגע הוא מנותק. לכן התחברות מחדש כאן לא הגיעה לדף
 * המטלה, והוא נכשל בתיוק גם כשהמשתמש/ת בדיוק התחבר/ה.
 *
 * העותק ב-localStorage משותף לכל הלשוניות ופותר את זה. הוא נמחק ביציאה,
 * ונושא חותמת זמן כדי שהכלים יתעלמו ממנו אחרי שפג תוקפו בשרת (24 שעות).
 */
const SESSION_MIRROR = 'ai-mentor-session-mirror';

function saveSession(user) {
  sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(user));
  try {
    localStorage.setItem(SESSION_MIRROR, JSON.stringify(
      Object.assign({}, user, { mirroredAt: Date.now() })));
  } catch {}
}

function clearSession() {
  sessionStorage.removeItem(CONFIG.SESSION_KEY);
  try { localStorage.removeItem(SESSION_MIRROR); } catch {}
}

function route() {
  const session = loadSession();
  if (!session) {
    renderLogin(app, (user) => { saveSession(user); route(); });
    return;
  }
  // מבטלים את הטוקן בשרת לפני שמוחקים אותו מקומית, כדי שלא יישאר תקף
  const onLogout = async () => { await apiLogout(); clearSession(); route(); };
  if (session.role === 'admin') { mountTeacherDashboard(app, session, onLogout); return; }
  /* מסך התלמיד הוא המעבדה, והיא המסך היחיד. ההתחברות כבר נשמרה — גם
     במראה שב-localStorage — ולכן המעבדה מזהה את התלמיד/ה מיד.
     mountStudentChat נשאר בקוד כמקור לחלק המוערך שעובר לתוך המעבדה;
     הוא אינו מנותב אליו יותר. */
  location.replace('tools/_design/lab/');
}

route();
