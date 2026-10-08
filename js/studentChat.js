// ==========================================================================
// studentChat.js - ממשק התלמיד: app shell עם מסילת משימה (זהות, כרטיס
// המחקר האישי, צעדי השבוע) לצד שיחה רציפה אחת עם ה-AI Mentor -
// 3 שאלות מוערכות משולבות + עזרה חופשית בלתי מוגבלת סביבן (FR-B/FR-F).
// ==========================================================================
import { escapeHtml, toast, logoMark } from './ui.js';
import { getStudentContext, sendMentorMessage, setCurrentExperiment,
         getMyModel, saveMyModel, downloadMyModel } from './api.js';

// הקטנת תמונות לפני השליחה. צילומי טלפון/מסך מגיעים לעיתים במגה-בייטים,
// ו-Gemini מחייב על תמונות לפי רזולוציה - ההקטנה חוסכת עלות טוקנים, זמן
// המתנה ונפח ב-Drive. 1024px נשמר בכוונה גבוה מספיק כדי שמספרים בתרשים,
// תוויות בטבלה ופרטים עדינים במפת קשב יישארו קריאים.
const RAIL_PREF_KEY = 'ai-mentor-rail-hidden';

const MAX_IMAGE_DIM = 1024;
const IMAGE_QUALITY = 0.85;
const SKIP_RESIZE_UNDER_BYTES = 300 * 1024;

function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא הצלחתי לקרוא את הקובץ'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('הקובץ אינו תמונה תקינה'));
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
        // תמונה שכבר קטנה ממילא - משאירים כפי שהיא, בלי מעבר מיותר דרך JPEG
        if (scale === 1 && file.size <= SKIP_RESIZE_UNDER_BYTES) {
          resolve(reader.result);
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// אותו אוצר מילים כמו בשרת וב-tools/notebook. שם אחד לכל מושג, בכל המערכת.
const EXPERIMENT_BLURB = {
  curve:        'כמה תמונות באמת צריך? איפה העקומה מתיישרת',
  balance:      'מה קורה כשמחלקה אחת נדירה, ומה הדיוק הכולל מסתיר',
  source:       'האם המודל למד את הממצא — או את המקור שממנו הגיעה התמונה',
  intervention: 'מצאת חולשה. האם התיקון שלך עובד, ומה מחירו',
};

export async function mountStudentChat(app, session, onLogout) {
  app.innerHTML = `<div class="center-msg"><div class="spinner"></div>טוען את סביבת המחקר שלך...</div>`;

  let ctx;
  try {
    ctx = await getStudentContext(session.studentId);
  } catch (err) {
    app.innerHTML = `<div class="center-msg">שגיאה בטעינת הפרופיל: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const state = {
    history: [],
    images: null,          // נשלח פעם אחת, עם ההודעה שפותחת את החלק המוערך
    slots: [null, null],   // תצוגה מקדימה (dataURL) לפני השליחה
    submittedTask: ctx.gradedThisWeek,
    sending: false,
    sessionStart: Date.now(),
    // העדפת תצוגה נשמרת בין כניסות, כדי שלא צריך לקפל מחדש בכל פעם
    railHidden: localStorage.getItem(RAIL_PREF_KEY) === '1',
    taskModalOpen: false,
    summaryDraft: '', // נשמר כדי שסגירת החלון לא תמחק מה שנכתב
    model: null,      // { files:[{name,saved,...}], complete } - נטען אחרי הציור הראשון
    modelBusy: '',    // טקסט שמוצג בכרטיס בזמן העלאה/הורדה
  };

  // שבוע ללא צ׳ק-אין מוערך: אין משימת תמונות, אין שאלות מוערכות ואין ציון.
  // שרת ישן אינו שולח את השדה, ולכן חוסר ערך נחשב שבוע מוערך - ההתנהגות
  // שהייתה עד כה.
  const gradedWeek = ctx.checkInEnabled !== false;
  const trainerUrl = ctx.trainerUrl || 'https://teachablemachine.withgoogle.com/train/image';

  render();
  refreshModel();

  /** הלוקר נטען ברקע: המסך לא צריך להמתין לו, והוא מתעדכן כשהתשובה חוזרת. */
  async function refreshModel() {
    try {
      state.model = await getMyModel(session.studentId);
    } catch (err) {
      state.model = { files: [], complete: false, error: err.message,
                      unsupported: /פעולה לא מוכרת/.test(err.message) };
    }
    render();
  }

  // ---------------------------------------------------------------- מסילת הצד
  function railHtml() {
    const initial = (ctx.firstName || '?').trim().charAt(0);
    const imagesDone = state.submittedTask;
    const answering = state.submittedTask && !ctx.gradedThisWeek;
    const scored = ctx.gradedThisWeek;

    const step = (done, active, label) =>
      `<div class="step${done ? ' done' : ''}${active ? ' active' : ''}">
         <span class="dot">${done ? '✓' : ''}</span><span class="txt">${label}</span>
       </div>`;

    // rel="opener" במכוון: sessionStorage הוא פר-לשונית, ולשונית שנפתחת מכאן
    // יורשת עותק שלו. זה מה שמאפשר לכלי לזהות את התלמיד/ה ולתייק בשמו/ה -
    // כלי שנפתח מסימנייה או מהקלדת כתובת לא יראה שום חיבור.
    const toolLink = (href, name, sub) =>
      `<a class="tool-link" href="${href}" target="_blank" rel="opener">
         <b>${name}</b><span>${sub}</span></a>`;

    return `
    <aside class="rail">
      <div class="rail-top">
        <div class="rail-brand">${logoMark(26)} <span>AI Mentor</span></div>
        <button class="ghost" id="logout-btn" style="padding:6px 10px;font-size:12px;">יציאה</button>
      </div>

      <div class="id-card">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="who">
          <b>${escapeHtml(ctx.firstName || session.displayName)}</b>
          <span>${escapeHtml(ctx.group || 'ללא קבוצה')}</span>
        </div>
      </div>

      <div class="mission">
        <h4>המחקר שלי</h4>
        <div class="mission-row"><span>המאגר הפעיל</span><b>${escapeHtml(ctx.moduleName || '—')}</b></div>
        ${!ctx.datasets && ctx.datasetUrl
          ? /* שרת ישן: קישור יחיד לתיקיית-העל */ `
              <a class="tool-link" style="margin-top:8px" href="${escapeHtml(ctx.datasetUrl)}"
                 target="_blank" rel="noopener noreferrer">
                <b>ערכות האימון ↗</b><span>מחולקות מראש לפי גודל ויחס</span></a>`
          : (ctx.datasets || []).length
          ? (ctx.datasets || []).map(d => `
              <a class="tool-link" style="margin-top:8px" href="${escapeHtml(d.url)}"
                 target="_blank" rel="noopener noreferrer">
                <b>${escapeHtml(d.name)} ↗</b><span>נפתח בשלב ${d.stage}</span></a>`).join('')
            + `<p class="form-note" style="margin-top:6px;">אל תורידו את המאגר הגולמי ממקור
                 אחר — הערכות כאן בנויות כך שכל גודל מכיל את הקטן ממנו, ואותה שקופית לא
                 מופיעה גם באימון וגם במבחן.</p>`
          : `<p class="form-note" style="margin-top:6px;">המאגר נקבע על ידי המורה.
               ערכות האימון של השלב הנוכחי טרם זמינות.</p>`}
      </div>

      <div class="ladder">
        <h4>סולם הניסויים</h4>
        ${(ctx.experiments || []).map((e, i) => {
          const cur = e.key === ctx.currentExperiment;
          const done = (ctx.experiments || []).findIndex(x => x.key === ctx.currentExperiment) > i;
          const open = e.open !== false;
          return `<button class="exp${cur ? ' cur' : ''}${done ? ' done' : ''}${open ? '' : ' locked'}"
                    data-exp="${e.key}" ${open ? '' : 'disabled'}
                    ${cur ? 'aria-current="step"' : ''}>
                    <span class="n">${done ? '✓' : open ? i + 1 : '🔒'}</span>
                    <span class="t"><b>${escapeHtml(e.name)}</b>
                      <span>${open ? escapeHtml(EXPERIMENT_BLURB[e.key] || '') : 'טרם נפתח'}</span></span>
                  </button>`;
        }).join('')}
        <p class="form-note" style="margin-top:8px;">לחיצה מסמנת איפה את/ה עכשיו.
          המנטור ישאל על הניסוי המסומן. ניסוי נפתח על ידי המורה.</p>
      </div>

      ${gradedWeek ? `
      <div class="steps">
        <h4>המשימה השבועית</h4>
        ${step(imagesDone, !imagesDone, '2 תמונות התקדמות + סיכום')}
        ${step(scored, answering, 'מענה על שאלות המנטור')}
        ${step(scored, false, 'קבלת ציון ומשוב')}
      </div>` : `
      <div class="steps">
        <h4>המשימה של שבוע ${ctx.weekNumber}</h4>
        <p class="form-note" style="margin:0;">${ctx.topicText
          ? escapeHtml(ctx.topicText)
          : 'טרם הוזנה משימה לשבוע הזה.'}</p>
        <p class="form-note" style="margin-top:8px;">בשבוע הזה אין חלק מוערך —
          אין תמונות להעלות ואין ציון. המנטור כאן לעזרה מעשית.</p>
      </div>`}

      ${modelCardHtml()}

      <div class="tools">
        <h4>כלי המחקר</h4>
        <a class="tool-link" href="${trainerUrl}" target="_blank" rel="noopener noreferrer">
          <b>Teachable Machine ↗</b><span>כלי האימון — כאן מאמנים את המודל</span></a>
        ${ctx.tools
          ? ctx.tools.map(t => t.open
              ? toolLink(t.path, t.name, t.sub)
              : `<div class="tool-link locked"><b>${escapeHtml(t.name)} 🔒</b>
                   <span>נפתח ב${escapeHtml(t.opensAtName || '')}</span></div>`).join('')
          : /* שרת ישן: כל הכלים פתוחים */
            toolLink('tools/notebook/', 'מחברת ניסוי', 'השערה, מדידה, מסקנה')
            + toolLink('tools/evaluate/', 'הערכת מודל', 'דיוק, רגישות, מפת קשב')
            + toolLink('tools/perturb/', 'כלי הפרעות', 'מה באמת מניע את ההחלטה')}
        <p class="form-note" style="margin-top:8px">
          את כלי המערכת פתחו מכאן — כך כל ייצוא מתויק אוטומטית בתיקייה שלכם.
          כלי שנפתח מסימנייה לא יזהה אתכם, והקובץ יישאר על המחשב בלבד.
          Teachable Machine הוא כלי חיצוני ואינו מתייק אצלנו — את המודל ממנו
          שמרו בכרטיס "המודל שלי".
        </p>
      </div>

      <div class="rail-tip">
        ${gradedWeek
          ? `<b>שימו לב:</b> רק החלק המוערך נכנס לציון. בכל שאר השיחה אפשר לשאול
             בחופשיות על הניסוי, על הפעלת Teachable Machine, על קריאת המדדים
             והגרפים או על הרקע הרפואי — בלי שזה נמדד.`
          : `<b>שימו לב:</b> בשבוע הזה אין ציון. אפשר לשאול בחופשיות על הפעלת
             Teachable Machine, על האימון ועל כל מה שנתקעתם בו.`}
      </div>
    </aside>`;
  }

  // ------------------------------------------------------------- המודל שלי
  /**
   * לוקר המודל. התלמידים מחליפים מחשב בין שיעורים, ולכן מודל שיושב רק
   * בתיקיית ההורדות של מחשב בכיתה אבוד בפועל - גם אם האימון הצליח.
   */
  function modelCardHtml() {
    const m = state.model;
    // שרת שעוד לא עודכן אינו מכיר את הפעולה. כרטיס שמודיע על תקלה בכל
    // טעינה גרוע מכרטיס שלא קיים - מסתירים אותו עד שהשרת תומך.
    if (m && m.unsupported) return '';
    const busy = state.modelBusy;
    const done = m && m.complete;
    const partial = m && !m.complete && m.files.some(f => f.saved);
    const savedAt = done
      ? (m.files.map(f => f.savedAt).filter(Boolean).sort().slice(-1)[0] || '')
      : '';

    const statusLine = !m
      ? 'בודק מה שמור...'
      : m.error ? 'לא הצלחתי לבדוק: ' + escapeHtml(m.error)
      : done ? 'מודל שמור ✓' + (savedAt ? ' · ' + formatDate(savedAt) : '')
      : partial ? 'שמור חלקית (' + m.files.filter(f => f.saved).length + '/3 קבצים)'
      : 'אין מודל שמור';

    return `
      <div class="tools model-card">
        <h4>המודל שלי</h4>
        <p class="form-note" style="margin:0 0 8px;">${statusLine}</p>

        <label class="tool-link">
          <b>${done ? 'שמירת מודל חדש' : 'שמירת המודל במערכת'}</b>
          <span>בחרו את קובץ ה-zip שהורדתם מ-Teachable Machine</span>
          <input type="file" id="model-upload" accept=".zip,.json,.bin" multiple
                 style="display:none;">
        </label>

        ${done
          ? `<button class="tool-link" id="model-download" type="button">
               <b>הורדת המודל שלי ↓</b><span>zip עם שלושת הקבצים, לכל מחשב</span>
             </button>`
          : ''}

        ${busy ? `<p class="form-note" style="margin-top:8px;">${escapeHtml(busy)}</p>` : ''}
        <p class="form-note" style="margin-top:8px;">
          מה שנשמר כאן נשאר שלכם גם אם תחליפו מחשב. אל תסמכו על תיקיית
          ההורדות של מחשב בכיתה.
        </p>
      </div>`;
  }

  function formatDate(v) {
    const d = new Date(v);
    return isNaN(d) ? '' : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });
  }

  // ---------------------------------------------------------------- שיחה
  function turnHtml(turn) {
    if (turn.role === 'user') {
      return `<div class="turn me">
          <div class="who-mark">${escapeHtml((ctx.firstName || '?').charAt(0))}</div>
          <div class="bubble">${escapeHtml(turn.text)}</div>
        </div>`;
    }
    const scored = /ציון ההערכה לשבוע זה/.test(turn.text);
    return `<div class="turn ai${scored ? ' scored' : ''}">
        <div class="who-mark">${logoMark(18)}</div>
        <div>
          <span class="turn-tag">${scored ? 'הערכה וציון' : 'AI Mentor'}</span>
          <div class="bubble">${escapeHtml(turn.text)}</div>
        </div>
      </div>`;
  }

  function emptyStateHtml() {
    return `<div class="stream-empty">
        ${logoMark(52)}
        <div class="big">שלום ${escapeHtml(ctx.firstName || '')}, נתחיל?</div>
        ${gradedWeek
          ? `<p>אפשר לפתוח בשאלה חופשית על הניסוי שאת/ה מריץ/ה, או להעלות למטה
               שתי תמונות מהשבוע כדי להתחיל את החלק המוערך.</p>`
          : `<p>בשבוע הזה אין חלק מוערך. ${ctx.topicText
               ? 'המשימה: ' + escapeHtml(ctx.topicText) + '.'
               : ''} אם נתקעת — שאל/י כאן.</p>`}
      </div>`;
  }

  /** כפתור צף בפינת הצ'אט - מחליף את הרצועה שגזלה גובה מהשיחה */
  function taskFabHtml() {
    if (!gradedWeek) return '';   // אין משימת תמונות בשבוע לא-מוערך
    if (state.submittedTask) {
      return `<button class="task-fab done" id="task-fab" title="משימת השבוע הוגשה">
          <span class="fab-icon">✓</span><span>משימת השבוע הוגשה</span>
        </button>`;
    }
    return `<button class="task-fab pending" id="task-fab" title="פתיחת משימת השבוע">
        <span class="fab-icon">📸</span><span>משימת שבוע ${ctx.weekNumber}</span>
      </button>`;
  }

  function taskModalHtml() {
    if (!state.taskModalOpen || !gradedWeek) return '';
    if (state.submittedTask) {
      return `
      <div class="modal-veil" id="modal-veil">
        <div class="modal">
          <div class="modal-head">
            <h3>משימת שבוע ${ctx.weekNumber}</h3>
            <button class="modal-close" id="modal-close" title="סגירה">✕</button>
          </div>
          <p class="form-note">התמונות והסיכום לשבוע זה כבר נשלחו. אפשר להמשיך בשיחה.</p>
        </div>
      </div>`;
    }
    return `
    <div class="modal-veil" id="modal-veil">
      <div class="modal">
        <div class="modal-head">
          <h3>משימת שבוע ${ctx.weekNumber}</h3>
          <button class="modal-close" id="modal-close" title="סגירה">✕</button>
        </div>
        <p class="form-note">שתי תמונות מהניסוי + סיכום קצר. מומלץ: תרשים אחד
          מכלי ההערכה ומפת קשב אחת שמדגימה את הממצא. השליחה פותחת את החלק המוערך.</p>
        <div class="tiles">
          ${[0, 1].map(i => `
            <label class="tile${state.slots[i] ? ' filled' : ''}">
              ${state.slots[i]
                ? `<img src="${state.slots[i]}" alt="תמונה ${i + 1}">`
                : `<span class="ph">תמונה ${i + 1}<br>לחצו לבחירה</span>`}
              <input type="file" class="slot-input" data-idx="${i}" accept="image/*">
            </label>`).join('')}
        </div>
        <div class="field" style="margin:12px 0 10px;">
          <textarea id="week-summary" rows="3" placeholder="מה הרצת השבוע, מה יצא, ומה הפתיע אותך?">${escapeHtml(state.summaryDraft || '')}</textarea>
        </div>
        <button type="button" id="start-graded-btn" style="width:100%;">שליחה והתחלת החלק המוערך</button>
      </div>
    </div>`;
  }

  function render() {
    const statusPill = !gradedWeek
      ? '<span class="pill neutral">שבוע ללא ציון</span>'
      : ctx.gradedThisWeek
      ? '<span class="pill ok">החלק המוערך הושלם ✓</span>'
      : (state.submittedTask ? '<span class="pill warn">בתהליך הערכה</span>' : '<span class="pill bad">טרם בוצע</span>');

    app.innerHTML = `
    <div class="shell${state.railHidden ? ' rail-hidden' : ''}">
      ${railHtml()}
      <main class="main">
        <header class="stream-head">
          <button class="rail-toggle" id="rail-toggle"
            title="${state.railHidden ? 'הצגת פרטי המחקר' : 'הסתרת פרטי המחקר להרחבת השיחה'}">☰</button>
          <span class="week-pill">שבוע ${ctx.weekNumber}</span>
          <span class="topic-line">${ctx.topicText
            ? `נושא השבוע: <b>${escapeHtml(ctx.topicText)}</b>`
            : 'טרם הוזן נושא שבועי'}</span>
          <span class="head-status">${statusPill}</span>
        </header>

        <div class="stream" id="stream">
          <div class="stream-inner">
            ${state.history.length ? state.history.map(turnHtml).join('') : emptyStateHtml()}
            ${state.sending ? `<div class="turn ai"><div class="who-mark">${logoMark(18)}</div>
              <div class="bubble thinking"><i></i><i></i><i></i></div></div>` : ''}
          </div>
        </div>

        ${taskFabHtml()}

        <div class="dock">
          <div class="dock-inner">
            <form class="composer" id="chat-form">
              <textarea id="chat-input" rows="1" placeholder="כתבו הודעה למנטור..." required></textarea>
              <button type="submit" id="send-btn">שליחה</button>
            </form>
            <div class="dock-note">${!gradedWeek
              ? 'בשבוע הזה אין חלק מוערך — כל השיחה חופשית ואינה נמדדת.'
              : ctx.gradedThisWeek
              ? 'החלק המוערך של השבוע הסתיים — מכאן השיחה חופשית ואינה נמדדת.'
              : 'שאלות חופשיות אינן נמדדות. רק שאלות המנטור המסומנות מזכות בציון.'}</div>
          </div>
        </div>
      </main>
    </div>
    ${taskModalHtml()}
    <div id="toast" class="toast"></div>`;

    wire();
    const stream = document.getElementById('stream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  }

  // ---------------------------------------------------------------- אירועים
  function wire() {
    document.getElementById('logout-btn').addEventListener('click', onLogout);

    // סימון הניסוי הנוכחי. נשמר בשרת כדי שהמנטור ישאל על הדבר הנכון.
    document.querySelectorAll('.ladder .exp').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.exp;
        if (key === ctx.currentExperiment) return;
        const prev = ctx.currentExperiment;
        ctx.currentExperiment = key;            // תגובה מיידית
        const e = (ctx.experiments || []).find(x => x.key === key);
        ctx.experimentName = e ? e.name : '';
        render();
        try {
          await setCurrentExperiment(session.studentId, key);
        } catch (err) {
          ctx.currentExperiment = prev;         // החזרה למצב הקודם אם השמירה נכשלה
          render();
          toast('לא הצלחתי לשמור את הניסוי: ' + err.message);
        }
      });
    });

    document.getElementById('rail-toggle').addEventListener('click', () => {
      state.railHidden = !state.railHidden;
      localStorage.setItem(RAIL_PREF_KEY, state.railHidden ? '1' : '0');
      render();
    });

    // הכפתור אינו מצויר בשבוע לא-מוערך
    const fab = document.getElementById('task-fab');
    if (fab) fab.addEventListener('click', () => {
      state.taskModalOpen = true;
      render();
    });

    wireModelCard();

    const veil = document.getElementById('modal-veil');
    if (veil) {
      const close = () => {
        const ta = document.getElementById('week-summary');
        if (ta) state.summaryDraft = ta.value; // לא לאבד טיוטה בסגירה
        state.taskModalOpen = false;
        render();
      };
      document.getElementById('modal-close').addEventListener('click', close);
      veil.addEventListener('click', (e) => { if (e.target === veil) close(); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', esc); close(); }
      });
    }

    document.querySelectorAll('.slot-input').forEach(input => {
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const idx = Number(input.dataset.idx);
        try {
          state.slots[idx] = await downscaleImage(file);
        } catch (err) {
          toast('שגיאה בטעינת התמונה: ' + err.message, true);
          return;
        }
        render();
      });
    });

    const startBtn = document.getElementById('start-graded-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const summary = document.getElementById('week-summary').value.trim();
        if (!state.slots.some(Boolean) || !summary) {
          toast('נא להעלות לפחות תמונה אחת ולכתוב סיכום קצר', true);
          return;
        }
        state.images = state.slots.filter(Boolean).map(dataUrl => {
          const [meta, base64] = dataUrl.split(',');
          return { base64, mimeType: meta.match(/data:(.*);base64/)[1] };
        });
        state.submittedTask = true;
        state.taskModalOpen = false;
        state.summaryDraft = '';
        send(summary);
      });
    }

    const form = document.getElementById('chat-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      const text = input.value.trim();
      if (!text || state.sending) return;
      input.value = '';
      send(text);
    });

    // Enter שולח, Shift+Enter יורד שורה
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
  }

  // ------------------------------------------------- אירועי כרטיס המודל
  /** base64 בלבד, בלי התחילית data:...;base64, שהשרת לא מצפה לה. */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('לא הצלחתי לקרוא את הקובץ'));
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.readAsDataURL(file);
    });
  }

  function wireModelCard() {
    const up = document.getElementById('model-upload');
    if (up) {
      up.addEventListener('change', async () => {
        const files = Array.from(up.files || []);
        if (!files.length) return;
        state.modelBusy = 'שומר...';
        render();
        try {
          // הקבצים נשלחים אחד-אחד: שלוש בקשות קטנות עוברות גם כשרשת
          // הכיתה חונקת בקשה אחת גדולה.
          for (const f of files) {
            state.modelBusy = 'שומר את ' + f.name + '...';
            render();
            await saveMyModel(session.studentId, f.name, await fileToBase64(f));
          }
          state.modelBusy = '';
          await refreshModel();
          toast(state.model && state.model.complete
            ? 'המודל נשמר במערכת ✓'
            : 'נשמר. עדיין חסרים קבצים — העלו את כל ה-zip של הייצוא.');
        } catch (err) {
          state.modelBusy = '';
          render();
          toast('השמירה נכשלה: ' + err.message, true);
        }
      });
    }

    const down = document.getElementById('model-download');
    if (down) {
      down.addEventListener('click', async () => {
        state.modelBusy = 'מכין את ההורדה...';
        render();
        try {
          const res = await downloadMyModel(session.studentId);
          const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: res.mimeType }));
          const a = document.createElement('a');
          a.href = url;
          a.download = res.filename || 'my-model.zip';
          a.click();
          URL.revokeObjectURL(url);
          state.modelBusy = '';
          render();
          toast('ההורדה החלה. חלצו את ה-zip לתיקייה לפני הטעינה בכלי.');
        } catch (err) {
          state.modelBusy = '';
          render();
          toast('ההורדה נכשלה: ' + err.message, true);
        }
      });
    }
  }

  async function send(text) {
    state.history.push({ role: 'user', text });
    state.sending = true;
    render();
    try {
      const elapsedSeconds = Math.round((Date.now() - state.sessionStart) / 1000);
      const result = await sendMentorMessage(session.studentId, state.history, state.images, elapsedSeconds);
      state.history.push({ role: 'model', text: result.reply });
      if (result.graded) {
        ctx.gradedThisWeek = true;
        toast('הציון לשבוע זה נשמר: ' + result.score + '/10');
      }
    } catch (err) {
      state.history.push({ role: 'model', text: '⚠️ שגיאה: ' + err.message });
    } finally {
      state.sending = false;
      render();
    }
  }
}
