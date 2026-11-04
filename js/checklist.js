/**
 * ==========================================================================
 * checklist.js - הצ׳קליסט של המשימה השבועית
 *
 * שלוש יצואות בלבד, ואף אחת מהן אינה רצה בזמן הייבוא: js/main.js מייבא את
 * כל המודולים לנקודת כניסה אחת, ומודול שנשבר בטעינה הפיל כאן פעם את כל
 * האתר. אין כאן שום קוד ברמת המודול מלבד הגדרות.
 *
 * המקור לכל מה שמצויר כאן הוא ctx.checklist מהשרת. אם הוא חסר - למשל מול
 * שרת שעוד לא עודכן - הפונקציות מחזירות מחרוזת ריקה, והמסך נופל לכרטיס
 * הקודם. ברירת המחדל הבטוחה היא תמיד *לא חסום*.
 * ==========================================================================
 */
import { escapeHtml } from './ui.js';

/** האם יש בכלל צ׳קליסט לצייר. */
function has(state) {
  return !!(state && state.checklist && state.checklist.items && state.checklist.items.length);
}

/**
 * המקום היחיד שבו שורה בתבנית הופכת לכתובת.
 *
 * הקישור נגזר מ-ctx.tools, שהשרת כבר סינן לפי TOOL_STAGE - ולכן סעיף אינו
 * יכול לחלק נתיב לכלי שעוד לא נפתח לקבוצה. כלי נעול חוזר בלי path, ואז
 * פשוט אין קישור.
 */
function resolveLink(ctx, it) {
  const tool = k => ((ctx.tools || []).find(t => t.key === k) || {});
  if (it.link === 'evaluate') {
    const t = tool('evaluate');
    return t.path ? { href: t.path, text: 'פתיחת כלי ההערכה ←',
                      sub: 'כל ייצוא מכאן מתויק בתיקייה שלך', opener: true } : null;
  }
  if (it.link === 'assignment') {
    const t = tool('evaluate');
    return t.path ? { href: t.path + 'מטלה.html', text: 'פתיחת המטלה ←',
                      sub: 'המספרים מלשונית הכלי מופיעים בה לבד', opener: true } : null;
  }
  if (it.link === 'notebook') {
    const t = tool('notebook');
    return t.path ? { href: t.path, text: 'פתיחת מחברת הניסוי ←',
                      sub: 'השערה, מדידה, מסקנה', opener: true } : null;
  }
  if (it.link === 'trainer') {
    return { href: ctx.trainerUrl || 'https://teachablemachine.withgoogle.com/train/image',
             text: 'פתיחת Teachable Machine ↗',
             sub: 'כלי חיצוני — את המודל ממנו שומרים בכרטיס "המודל שלי"', opener: false };
  }
  return null;   // 'locker' ומה שאין לו יעד: הטקסט מפנה לכרטיס במסילה
}

/**
 * rel="opener" במכוון, בדיוק כמו toolLink במסילה: sessionStorage הוא
 * פר-לשונית, ולשונית שנפתחת מכאן יורשת עותק שלו. זה מה שמאפשר לכלי לזהות
 * את התלמיד/ה ולתייק בשמו/ה. rel="noopener" היה שובר את התיוג בשקט.
 * אתר חיצוני מקבל noopener noreferrer - אין לו מה לדעת עלינו.
 */
function linkHtml(link, margin) {
  if (!link || !link.href) return '';
  const rel = link.opener ? 'opener' : 'noopener noreferrer';
  return `<a class="tool-link"${margin ? ' style="margin-top:6px"' : ''}
     href="${escapeHtml(link.href)}" target="_blank" rel="${rel}">
     <b>${escapeHtml(link.text)}</b><span>${escapeHtml(link.sub)}</span></a>`;
}

/** מה כתוב מתחת לשורה שכבר בוצעה - ומאיזה מקור. */
function stateLabel(it) {
  if (it.source === 'auto') return 'נרשם אוטומטית ✓';
  if (it.source === 'teacher') return 'אושר על ידי המורה ✓';
  if (it.source === 'waived') return 'שוחרר על ידי המורה';
  if (it.source === 'claim') return 'טענה — ממתין לבדיקת המורה';
  if (it.source === 'self') return 'סומן על ידך';
  return '';
}

function dotOf(it) {
  if (it.done) return '✓';
  if (!it.available) return '🔒';
  if (!it.gate) return '•';
  return '';
}

// ---------------------------------------------------------- כרטיס המסילה
/**
 * הכרטיס במסילה הוא *מפה*, לא טופס: שורה לכל סעיף, והסבר מלא רק לסעיף
 * שעומדים בו עכשיו. כל השאר נמצא בחלון המשימה. מסילה באורך עשר פסקאות
 * היא בדיוק הבעיה שהשינוי הזה בא לפתור.
 */
export function checklistCardHtml(ctx, state) {
  if (!has(state)) return '';
  const cl = state.checklist;
  const gradedWeek = ctx.checkInEnabled !== false;

  // רק הסעיף הראשון שטרם בוצע וזמין מקבל הסבר מוטבע.
  const activeId = (cl.items.find(i => i.available && !i.done && i.gate) ||
                    cl.items.find(i => i.available && !i.done) || {}).id || '';

  const rows = cl.items.map(it => {
    const cls = 'step' + (it.done ? ' done' : '') + (it.id === activeId ? ' active' : '');
    const label = it.done ? stateLabel(it)
      : !it.available ? 'נפתח בשלב ' + it.needsStage + ' — אין צורך לסמן עכשיו'
      : !it.gate ? 'לא חוסם' : '';
    const row = `<div class="${cls}"><span class="dot">${dotOf(it)}</span>
        <span class="txt">${escapeHtml(it.title)}${
          label ? `<span class="cl-state">${escapeHtml(label)}</span>` : ''}</span></div>`;
    if (it.id !== activeId) return row;
    return row +
      (it.how ? `<p class="form-note cl-why">${escapeHtml(it.how)}</p>` : '') +
      linkHtml(resolveLink(ctx, it), true);
  }).join('');

  // השורה האחרונה היא היעד של השער - והיחידה שמצוירת כנעולה.
  const tail = !gradedWeek
    ? `<p class="form-note" style="margin-top:8px;">בשבוע הזה אין חלק מוערך —
         אין תמונות להעלות ואין ציון.</p>`
    : cl.blocked
    ? `<div class="step blocked"><span class="dot">🔒</span>
         <span class="txt">הצ׳ק-אין המוערך — נפתח כשכל תת-המשימות החוסמות מסומנות</span></div>`
    : `<div class="step active"><span class="dot">▶</span>
         <span class="txt">אפשר לפתוח את החלק המוערך</span></div>`;

  return `
      <div class="steps">
        <h4>המשימה של שבוע ${escapeHtml(String(cl.weekNumber))} ·
            ${cl.gateDone} מתוך ${cl.gateTotal}</h4>
        <p class="form-note" style="margin:0 0 10px;">${
          escapeHtml(cl.note || ctx.topicText || 'טרם הוזנה משימה לשבוע הזה.')}</p>
        ${rows}
        ${tail}
        <p class="form-note" style="margin-top:8px;"><b>לחצו "משימת שבוע
          ${escapeHtml(String(cl.weekNumber))}"</b> לכל ההסברים, ההפניות והסימון.</p>
      </div>`;
}

// ------------------------------------------------------- חלון המשימה
/** הפקד שמתאים למצב של הסעיף - אחד בדיוק, ולעולם לא prompt(). */
function controlHtml(it, state) {
  const busy = state.tickBusy === it.id;
  const draft = (state.noteDraft && state.noteDraft[it.id]) || '';

  if (!it.available) {
    return `<p class="form-note">נפתח בשלב ${it.needsStage} — אין צורך לסמן עכשיו.</p>`;
  }
  if (it.done && (it.source === 'auto' || it.source === 'teacher' || it.source === 'waived')) {
    // ראיה אינה דעה, ולכן אין כאן כפתור ביטול.
    return `<p class="form-note">${escapeHtml(stateLabel(it))}${
      it.source === 'auto' && it.proof ? ' — ' + escapeHtml(it.proof) : ''}</p>`;
  }
  if (it.done) {
    return `<p class="form-note">${escapeHtml(stateLabel(it))}${
        it.note ? ': “' + escapeHtml(it.note) + '”' : ''}</p>
      <button class="tool-link cl-undo" data-item="${escapeHtml(it.id)}" type="button"
        ${busy ? 'disabled' : ''}>
        <b>${busy ? 'מבטל...' : 'ביטול הסימון'}</b>
        <span>אם סימנתם את השורה הלא נכונה</span></button>`;
  }

  const isDeclare = it.kind === 'declare';
  const label = isDeclare ? it.ask
    : 'כתבו בשורה אחת מה עשיתם — המורה רואה את המשפט.';
  const btn = isDeclare
    ? { cls: 'cl-tick', t: 'סימון כבוצע', s: 'המשפט שכתבתם נשמר ומוצג למורה' }
    : { cls: 'cl-claim', t: 'עשיתי, והמערכת לא רואה את זה',
        s: 'יסומן מיד, ויופיע אצל המורה כטענה' };

  return `
    <label class="form-note" for="cl-note-${escapeHtml(it.id)}">${escapeHtml(label)}</label>
    <textarea id="cl-note-${escapeHtml(it.id)}" class="cl-note"
      data-item="${escapeHtml(it.id)}" rows="2"
      placeholder="שורה אחת">${escapeHtml(draft)}</textarea>
    <button class="tool-link ${btn.cls}" data-item="${escapeHtml(it.id)}" type="button"
      ${busy ? 'disabled' : ''}>
      <b>${busy ? 'שומר...' : escapeHtml(btn.t)}</b><span>${escapeHtml(btn.s)}</span></button>`;
}

/** החלק של הצ׳קליסט בתוך חלון המשימה: כל ההסברים, ההפניות והסימון. */
export function checklistModalHtml(ctx, state) {
  if (!has(state)) return '';
  const cl = state.checklist;
  const open = state.openItem ||
    (cl.items.find(i => i.available && !i.done && i.gate) ||
     cl.items.find(i => i.available && !i.done) || {}).id || '';

  const blocks = cl.items.map(it => {
    const cls = 'step' + (it.done ? ' done' : '') + (it.id === open ? ' active' : '');
    const label = it.done ? stateLabel(it) : '';
    return `
    <details class="chk" data-item="${escapeHtml(it.id)}"${it.id === open ? ' open' : ''}>
      <summary>
        <div class="${cls}"><span class="dot">${dotOf(it)}</span>
          <span class="txt">${escapeHtml(it.title)}${
            label ? `<span class="cl-state">${escapeHtml(label)}</span>` : ''}</span></div>
      </summary>
      <div class="step-why">
        ${it.why ? `<p class="form-note"><b>למה:</b> ${escapeHtml(it.why)}</p>` : ''}
        ${it.how ? `<p class="form-note"><b>איך:</b> ${escapeHtml(it.how)}</p>` : ''}
        ${it.refs ? `<p class="form-note"><b>הפניות:</b> ${escapeHtml(it.refs)}</p>` : ''}
        ${linkHtml(resolveLink(ctx, it), false)}
        ${it.proof ? `<p class="form-note"><b>איך יודעים שזה בוצע:</b> ${escapeHtml(it.proof)}</p>` : ''}
        ${it.pitfall ? `<p class="form-note"><b>מלכודת:</b> ${escapeHtml(it.pitfall)}</p>` : ''}
        ${controlHtml(it, state)}
      </div>
    </details>`;
  }).join('');

  return `
    <div class="chk-list">
      <div class="mono-lbl">תת-המשימות · ${cl.gateDone} מתוך ${cl.gateTotal}</div>
      ${blocks}
    </div>`;
}

// ------------------------------------------------------------ אירועים
/**
 * קושר את הפקדים של הצ׳קליסט. כל הקישורים דרך querySelectorAll, שהוא
 * no-op על רשימה ריקה - ולכן אפשר לקרוא לזה גם כשאין צ׳קליסט בכלל.
 *
 * onTick(itemId, done, note) הוא מה שמדבר עם השרת; המודול הזה לא מכיר את
 * ה-API ולא קורא ל-render.
 */
export function wireChecklist(root, ctx, state, onTick) {
  const scope = root || document;

  // הטיוטה נשמרת ב-state בכל הקלדה ובלי ציור מחדש: ציור היה גוזל את
  // הפוקוס באמצע משפט.
  scope.querySelectorAll('textarea.cl-note').forEach(ta => {
    ta.addEventListener('input', () => {
      if (!state.noteDraft) state.noteDraft = {};
      state.noteDraft[ta.dataset.item] = ta.value;
    });
  });

  // איזה סעיף פתוח - כדי שציור מחדש לא יסגור אותו.
  scope.querySelectorAll('details.chk').forEach(d => {
    d.addEventListener('toggle', () => {
      if (d.open) state.openItem = d.dataset.item;
      else if (state.openItem === d.dataset.item) state.openItem = '';
    });
  });

  scope.querySelectorAll('.cl-tick, .cl-claim').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.item;
      const ta = scope.querySelector('textarea.cl-note[data-item="' + id + '"]');
      const note = ta ? ta.value : ((state.noteDraft || {})[id] || '');
      if (!state.noteDraft) state.noteDraft = {};
      state.noteDraft[id] = note;          // נשמר גם אם השרת יסרב
      state.openItem = id;
      onTick(id, true, note);
    });
  });

  scope.querySelectorAll('.cl-undo').forEach(btn => {
    btn.addEventListener('click', () => {
      state.openItem = btn.dataset.item;
      onTick(btn.dataset.item, false, '');
    });
  });
}
