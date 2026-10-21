// ==========================================================================
// main.js - נקודת הכניסה: ניהול session וניתוב בין מסך התחברות / צ'אט / דשבורד.
// ==========================================================================
import { CONFIG } from './config.js';
import { renderLogin } from './auth.js';
import { logout as apiLogout } from './api.js';
import { mountStudentChat } from './studentChat.js';
import { mountTeacherDashboard } from './teacherDashboard.js';

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
  if (session.role === 'admin') mountTeacherDashboard(app, session, onLogout);
  else mountStudentChat(app, session, onLogout);
}

route();
