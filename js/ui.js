// רכיבי ממשק משותפים: פס עליון, טוסט הודעות, עזרי DOM קטנים.
import { CONFIG } from './config.js';

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
export function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/**
 * סמל המערכת: מסגרת סורק דימות (viewfinder) עם קו דופק - רפואי-טכנולוגי.
 * uid מבדיל בין מופעים כדי שמזהי ה-gradient לא יתנגשו כששניים מוצגים יחד.
 */
let logoCounter = 0;
export function logoMark(size = 64) {
  const uid = 'lg' + (++logoCounter);
  const s = Number(size);
  return `
  <svg width="${s}" height="${s}" viewBox="0 0 64 64" fill="none"
       xmlns="http://www.w3.org/2000/svg" role="img" aria-label="AI Mentor">
    <defs>
      <linearGradient id="${uid}" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
        <stop stop-color="#22d3ee"/><stop offset="1" stop-color="#0d9488"/>
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="58" height="58" rx="17" fill="url(#${uid})" opacity=".10"/>
    <rect x="3.9" y="3.9" width="56.2" height="56.2" rx="16.1" stroke="url(#${uid})" stroke-width="1.8"/>
    <g stroke="url(#${uid})" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M15 24v-5a4 4 0 0 1 4-4h5"/>
      <path d="M49 24v-5a4 4 0 0 0-4-4h-5"/>
      <path d="M15 40v5a4 4 0 0 0 4 4h5"/>
      <path d="M49 40v5a4 4 0 0 1-4 4h-5"/>
    </g>
    <path d="M16 32.5h6.5l3.2-7.4 5.6 14.6 4-8.2 2.4 3.4H48"
          stroke="url(#${uid})" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`;
}

export function topbarHtml(session, subtitle) {
  const roleLabel = session.role === 'admin' ? 'מורה / ניהול' : 'תלמיד/ה';
  return `
  <div class="topbar">
    <div class="brand">${logoMark(28)} <span>${CONFIG.APP_NAME}</span>
      ${subtitle ? `<span style="color:var(--text-1);font-size:13px;font-weight:400;">— ${subtitle}</span>` : ''}
    </div>
    <div class="user-pill">
      <span><b>${escapeHtml(session.displayName || session.username)}</b> · ${roleLabel}</span>
      <button class="secondary" id="logout-btn" style="padding:6px 12px;font-size:12.5px;">התנתקות</button>
    </div>
  </div>`;
}

export function wireLogout(onLogout) {
  const btn = document.getElementById('logout-btn');
  if (btn) btn.addEventListener('click', onLogout);
}

// ---------------------------------------------------------------- שדה סיסמה
/**
 * שדה סיסמה עם כפתור הצגה.
 *
 * הסיסמאות כאן נגזרות מתאריך לידה (DDMMYY), ותלמיד שמקליד ספרה שגויה
 * בטלפון אינו יכול לראות מה כתב - הוא רק מקבל "שם משתמש או סיסמה שגויים"
 * ואין לו דרך להבחין בין טעות הקלדה לסיסמה שגויה.
 */
export function passwordField({ id, label, placeholder = '', autocomplete = 'current-password', required = false }) {
  return `
    <div class="field">
      ${label ? `<label for="${id}">${escapeHtml(label)}</label>` : ''}
      <div class="pw-wrap">
        <input type="password" id="${id}" autocomplete="${autocomplete}"
               ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ''}
               ${required ? 'required' : ''}>
        <button type="button" class="pw-eye" data-for="${id}"
                aria-label="הצגת הסיסמה" aria-pressed="false" title="הצגת הסיסמה">${EYE}</button>
      </div>
    </div>`;
}

const EYE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/>' +
  '<circle cx="12" cy="12" r="2.6"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/>' +
  '<circle cx="12" cy="12" r="2.6"/><path d="M3 3l18 18"/></svg>';

/** מחבר את כל כפתורי ההצגה שבמסך. יש לקרוא אחרי כל render. */
export function wirePasswordEyes(root = document) {
  root.querySelectorAll('.pw-eye').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = root.getElementById
        ? root.getElementById(btn.dataset.for)
        : root.querySelector('#' + btn.dataset.for);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה');
      btn.title = show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה';
      // הסמן חוזר לסוף, אחרת החלפת סוג השדה מקפיצה אותו להתחלה
      const v = input.value;
      input.focus();
      input.setSelectionRange?.(v.length, v.length);
    });
  });
}
