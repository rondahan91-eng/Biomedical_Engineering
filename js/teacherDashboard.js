// ==========================================================================
// teacherDashboard.js - פאנל ניהול: ייבוא תלמידים, נושא שבועי, מעקב ציונים,
// צפייה בתמלולים, דריסת ציון, ייצוא (FR-C).
// ==========================================================================
import { escapeHtml, toast, topbarHtml, wireLogout, passwordField, wirePasswordEyes } from './ui.js';
import {
  getDashboard, getCurrentWeek, startNewWeek, updateCurrentWeekTopic,
  getStudentTranscripts, setManualGrade, exportWeeklyReport, importRoster, resetStudentPassword,
  changePassword, deleteStudent,
} from './api.js';
import { parseStudentsExcel } from './excelImport.js';

export async function mountTeacherDashboard(app, session, onLogout) {
  const state = { students: [], week: { weekNumber: 0, topicText: '' }, selectedStudentId: null,
                  transcripts: null, importPreview: null, checked: new Set() };
  await refresh();

  async function refresh() {
    const [students, week] = await Promise.all([getDashboard(), getCurrentWeek()]);
    state.students = students;
    state.week = week;
    render();
  }

  function render() {
    app.innerHTML = `
      ${topbarHtml(session, 'פאנל ניהול')}
      <div class="dash-wrap">
        <div class="dash-grid">
          <div>
            <div class="panel glass">
              <h3>👥 תלמידים (${state.students.length})</h3>
              ${state.checked.size ? `<div class="bulk-bar">
                  <span>${state.checked.size} מסומנים</span>
                  <button type="button" id="bulk-clear" class="ghost">ניקוי הבחירה</button>
                  <button type="button" id="bulk-delete" class="danger">מחיקת המסומנים</button>
                </div>` : ''}
              <div class="table-scroll">
                <table class="data-table">
                  <thead><tr>
                    <th class="check-cell" style="width:38px"><input type="checkbox" id="check-all"
                        title="סימון הכול" style="margin:0"></th>
                    <th>שם</th><th>קבוצה</th><th>ניסוי נוכחי</th><th>הערה</th>
                    <th>שבועות</th><th>ציון Mentor</th><th>השבוע</th><th></th>
                  </tr></thead>
                  <tbody>
                    ${state.students.map(s => `
                      <tr>
                        <td class="check-cell"><input type="checkbox" class="row-check" data-id="${s.studentId}"
                            ${state.checked.has(s.studentId) ? 'checked' : ''}
                            style="margin:0"></td>
                        <td>${escapeHtml(`${s.firstName || ''} ${s.lastName || ''}`.trim()
                          || `⚠️ רשומה חסרת שם (${s.username || s.studentId})`)}</td>
                        <td>${escapeHtml(s.group || '—')}</td>
                        <td>${escapeHtml(s.experimentName || '—')}</td>
                        <td>${escapeHtml(s.note || '—')}</td>
                        <td>${s.weeksCompleted}</td>
                        <td>${s.mentorGrade}${s.surplusPoints > 0 ? ` <span class="pill ok">+${s.surplusPoints.toFixed(1)} בונוס</span>` : ''}</td>
                        <td>${s.doneThisWeek ? '<span class="pill ok">בוצע</span>' : '<span class="pill bad">חסר</span>'}</td>
                        <td style="white-space:nowrap;">
                          <button class="secondary view-student-btn" data-id="${s.studentId}" style="padding:5px 10px;font-size:12px;">תמלולים</button>
                          <button class="secondary reset-pw-btn" data-id="${s.studentId}" data-name="${escapeHtml(s.firstName || s.username || '')}" style="padding:5px 10px;font-size:12px;">🔑</button>
                          <button class="secondary del-student-btn" data-id="${s.studentId}" data-name="${escapeHtml(`${s.firstName || ''} ${s.lastName || ''}`.trim() || s.username || '')}" data-weeks="${s.weeksCompleted}" style="padding:5px 10px;font-size:12px;">🗑</button>
                        </td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
            ${state.selectedStudentId ? renderStudentDetail() : ''}
          </div>

          <div>
            <div class="panel glass">
              <h3>🗓️ נושא שבועי נוכחי</h3>
              <p class="form-note" style="margin-top:0;">שבוע ${state.week.weekNumber}${state.week.topicText ? ' · ' + escapeHtml(state.week.topicText) : ' · טרם הוזן נושא'}</p>
              <div class="field"><textarea id="topic-input" rows="2" placeholder="נושא השיעור השבועי...">${escapeHtml(state.week.topicText || '')}</textarea></div>
              <div class="field">
                <label for="dataset-url">קישור לערכות האימון (Drive)</label>
                <input type="text" id="dataset-url" placeholder="https://drive.google.com/..."
                  value="${escapeHtml(state.week.datasetUrl || '')}">
                <p class="form-note" style="margin-top:4px;">מוצג לתלמידים במסילה. נשמר בשני
                  הכפתורים, ונגרר משבוע לשבוע כל עוד המאגר לא השתנה.</p>
              </div>
              <div style="display:flex;gap:8px;">
                <button type="button" id="update-topic-btn" class="secondary" style="flex:1;">שמירה לשבוע הנוכחי</button>
                <button type="button" id="new-week-btn" style="flex:1;">שבוע חדש ▶</button>
              </div>
            </div>

            <div class="panel glass">
              <h3>📥 ייבוא תלמידים מקובץ Excel</h3>
              <p class="form-note" style="margin-top:0;">עמודות נדרשות: שם פרטי, שם משפחה, תעודת זהות מלאה, תאריך לידה, קבוצה. עמודת "הערה" אופציונלית.
                שם משתמש ייגזר משם פרטי + 4 ספרות אחרונות של ת"ז, וסיסמה ראשונית מתאריך הלידה. ת"ז המלאה לא עוזבת את הדפדפן.</p>
              <div class="field"><input type="file" id="excel-file-input" accept=".xlsx,.xls"></div>
              <button type="button" id="parse-excel-btn" class="secondary" style="width:100%;">ניתוח קובץ</button>
              ${renderImportPreview()}
            </div>

            <div class="panel glass" id="pw-panel">
              <h3>🔒 סיסמת המורה</h3>
              <p class="form-note" style="margin-top:0;">
                סיסמת ברירת המחדל <code>admin123</code> מתועדת ב-README שבמאגר הציבורי.
                כל עוד היא בתוקף, מי שמוצא את כתובת האתר יכול להיכנס כמורה.
              </p>
              ${passwordField({ id: 'pw-new', placeholder: 'סיסמה חדשה', autocomplete: 'new-password' })}
              ${passwordField({ id: 'pw-again', placeholder: 'שוב, לאימות', autocomplete: 'new-password' })}
              <button type="button" id="pw-save-btn" style="width:100%;">שינוי סיסמה</button>
            </div>

            <div class="panel glass">
              <h3>📤 ייצוא נתונים</h3>
              <p class="form-note" style="margin-top:0;">דוח Excel (גיליון לכל תלמיד) נשמר אוטומטית מדי שבוע ל-Drive. אפשר גם להריץ ידנית עכשיו.</p>
              <button type="button" id="export-btn" class="secondary" style="width:100%;">ייצוא עכשיו</button>
            </div>
          </div>
        </div>
      </div>
      <div id="toast" class="toast"></div>`;
    wireLogout(onLogout);
    wirePasswordEyes();
    wireActions();
  }

  function renderImportPreview() {
    if (!state.importPreview) return '';
    const { valid, invalid, duplicates = [] } = state.importPreview;
    // הפרסר כבר הבחין בין אדם חדש לאדם שכבר במערכת, לפי שם פרטי + שם משפחה
    // + 4 ספרות. כאן רק מציגים את ההבחנה *לפני* האישור, כדי שהמורה יראה מה
    // ייווצר ומה ידולג ולא יגלה זאת רק אחרי הייבוא.
    const fresh = valid, dupes = duplicates;

    const rows = list => list.map(v =>
      `<div class="import-row"><span>${escapeHtml(v.displayName)}</span>
         <span>${escapeHtml(v.username)}</span></div>`).join('');

    return `
      <div style="margin-top:12px;">
        ${fresh.length ? `<p class="form-note"><b>${fresh.length} ייווצרו:</b></p>${rows(fresh)}` : ''}
        ${dupes.length ? `<p class="form-note" style="color:var(--warn);">
             <b>${dupes.length} כבר במערכת</b> ולא ייווצרו שוב:</p>${rows(dupes)}` : ''}
        ${invalid.length ? `<p class="form-note" style="color:var(--err);">
             <b>${invalid.length} שורות נכשלו:</b></p>
          ${invalid.map(v => `<div class="import-row"><span>שורה ${v.row}</span>
             <span>${escapeHtml(v.reason)}</span></div>`).join('')}` : ''}
        ${fresh.length
          ? `<button type="button" id="confirm-import-btn" style="width:100%;margin-top:10px;">ייבוא ${fresh.length} תלמידים</button>`
          : `<p class="form-note" style="margin-top:10px;">אין מה לייבא — כל השורות התקינות כבר קיימות במערכת.</p>`}
      </div>`;
  }

  function renderStudentDetail() {
    const s = state.students.find(s => s.studentId === state.selectedStudentId);
    if (!s || !state.transcripts) return `<div class="panel glass"><div class="spinner"></div></div>`;
    const { checkIns, helpChats } = state.transcripts;
    return `
    <div class="panel glass">
      <h3>📄 תמלולים - ${escapeHtml(s.firstName)} ${escapeHtml(s.lastName || '')}</h3>
      ${checkIns.length === 0 ? '<p class="form-note">אין עדיין צ\'ק-אין מוערך.</p>' : checkIns.map(c => `
        <div style="border-bottom:1px solid var(--line);padding:10px 0;">
          <b>שבוע ${c.weekNumber}</b> · ציון: ${c.teacherOverrideScore || c.score}/10
          ${c.docLink ? ` · <a href="${escapeHtml(c.docLink)}" target="_blank">קובץ Docs</a>` : ''}
          <div class="form-note">${escapeHtml(c.mentorFeedback || '')}</div>
          <form class="override-form" data-checkin="${c.checkInId}" style="display:flex;gap:8px;margin-top:6px;">
            <input type="number" min="1" max="10" placeholder="דריסת ציון" style="width:110px;">
            <input type="text" placeholder="הערה" style="flex:1;">
            <button type="submit" class="secondary" style="padding:6px 12px;font-size:12.5px;">שמירה</button>
          </form>
        </div>`).join('')}
      ${helpChats.length ? `<p class="form-note" style="margin-top:10px;">${helpChats.length} שיחות עזרה חופשיות נוספות נשמרו (לא מוערכות).</p>` : ''}
      <button type="button" id="close-detail-btn" class="secondary" style="margin-top:10px;">סגירה</button>
    </div>`;
  }

  function wireActions() {
    document.querySelectorAll('.view-student-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        state.selectedStudentId = btn.dataset.id;
        state.transcripts = null;
        render();
        state.transcripts = await getStudentTranscripts(state.selectedStudentId);
        render();
      });
    });

    document.querySelectorAll('.reset-pw-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newPw = prompt('סיסמה חדשה עבור ' + btn.dataset.name + ' (תקפה מיד):');
        if (!newPw) return;
        try {
          await resetStudentPassword(btn.dataset.id, newPw);
          toast('הסיסמה אופסה');
        } catch (err) { toast('שגיאה: ' + err.message, true); }
      });
    });

    document.getElementById('pw-save-btn').addEventListener('click', async () => {
      const a = document.getElementById('pw-new').value;
      const b = document.getElementById('pw-again').value;
      if (a.length < 8) { toast('סיסמה של פחות מ-8 תווים — בחרו ארוכה יותר', true); return; }
      if (a !== b) { toast('שתי הסיסמאות אינן זהות', true); return; }
      if (a === 'admin123') { toast('זו בדיוק הסיסמה שצריך להחליף', true); return; }
      try {
        await changePassword(session.studentId, a);
        document.getElementById('pw-new').value = '';
        document.getElementById('pw-again').value = '';
        toast('הסיסמה הוחלפה. בכניסה הבאה השתמשו בחדשה.');
      } catch (err) { toast('שגיאה: ' + err.message, true); }
    });

    // --- בחירה מרובה ---
    const allBox = document.getElementById('check-all');
    if (allBox) {
      const ids = state.students.map(x => x.studentId);
      allBox.checked = ids.length > 0 && ids.every(i => state.checked.has(i));
      allBox.indeterminate = !allBox.checked && ids.some(i => state.checked.has(i));
      allBox.addEventListener('change', () => {
        if (allBox.checked) ids.forEach(i => state.checked.add(i));
        else state.checked.clear();
        render();
      });
    }
    // לחיצה בכל מקום בתא מסמנת, לא רק על הריבוע עצמו
    document.querySelectorAll('td.check-cell').forEach(td => {
      td.addEventListener('click', e => {
        if (e.target.tagName !== 'INPUT') td.querySelector('input')?.click();
      });
    });
    document.querySelectorAll('.row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.checked.add(cb.dataset.id);
        else state.checked.delete(cb.dataset.id);
        render();
      });
    });
    const clearBtn = document.getElementById('bulk-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => { state.checked.clear(); render(); });

    const bulkBtn = document.getElementById('bulk-delete');
    if (bulkBtn) bulkBtn.addEventListener('click', async () => {
      const picked = state.students.filter(x => state.checked.has(x.studentId));
      if (!picked.length) return;
      const withWork = picked.filter(x => x.weeksCompleted > 0);
      const names = picked.map(x => `${x.firstName || ''} ${x.lastName || ''}`.trim()).join(', ');
      let msg = `למחוק ${picked.length} תלמידים?

${names}`;
      if (withWork.length) {
        const weeks = withWork.reduce((n, x) => n + x.weeksCompleted, 0);
        msg += `

ל-${withWork.length} מהם יש יחד ${weeks} שבועות מוערכים. `
             + 'הצ׳ק-אינים והציונים יישארו בגיליון, אבל החשבונות יימחקו.';
      }
      if (!confirm(msg)) return;

      bulkBtn.disabled = true;
      // אחד-אחד ולא במקביל: Apps Script נועל את הגיליון, ובקשות מקבילות
      // נכשלות על נעילה במקום למחוק.
      const done = [], failed = [];
      for (const st of picked) {
        try { await deleteStudent(st.studentId); done.push(st.studentId); }
        catch (err) { failed.push(`${st.firstName}: ${err.message}`); }
      }
      done.forEach(i => state.checked.delete(i));
      toast(failed.length
        ? `נמחקו ${done.length} · נכשלו ${failed.length} — ${failed[0]}`
        : `${done.length} תלמידים נמחקו`, failed.length > 0);
      await refresh();
    });

    document.querySelectorAll('.del-student-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const weeks = Number(btn.dataset.weeks) || 0;
        // מזהירים לפי מה שכבר נצבר: מחיקה של תלמיד/ה עם היסטוריה היא
        // החלטה אחרת לגמרי ממחיקה של רשומת בדיקה ריקה.
        const warn = weeks
          ? `ל${btn.dataset.name} יש ${weeks} שבועות מוערכים. הצ׳ק-אינים והציונים `
            + `יישארו בגיליון, אבל החשבון יימחק והכניסה תיחסם.

למחוק?`
          : `למחוק את ${btn.dataset.name}? אין לו/ה עדיין צ׳ק-אין מוערך.`;
        if (!confirm(warn)) return;
        try {
          const r = await deleteStudent(btn.dataset.id);
          const kept = r.checkInsKept + r.helpChatsKept + r.artifactsKept;
          toast(`${r.username} נמחק/ה` + (kept ? ` · ${kept} רשומות נשארו בגיליון` : ''));
          await refresh();
        } catch (err) { toast('שגיאה: ' + err.message, true); }
      });
    });

    const closeBtn = document.getElementById('close-detail-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => { state.selectedStudentId = null; render(); });

    document.querySelectorAll('.override-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const [scoreInput, noteInput] = form.querySelectorAll('input');
        if (!scoreInput.value) return;
        try {
          await setManualGrade(form.dataset.checkin, Number(scoreInput.value), noteInput.value);
          toast('הציון עודכן');
          state.transcripts = await getStudentTranscripts(state.selectedStudentId);
          await refresh();
        } catch (err) {
          toast('שגיאה: ' + err.message, true);
        }
      });
    });

    document.getElementById('update-topic-btn').addEventListener('click', async () => {
      const text = document.getElementById('topic-input').value.trim();
      const dsUrl = (document.getElementById('dataset-url').value || '').trim();
      try {
        state.week = await updateCurrentWeekTopic(text, dsUrl);
        toast('הנושא עודכן');
        render();
      } catch (err) { toast('שגיאה: ' + err.message, true); }
    });

    document.getElementById('new-week-btn').addEventListener('click', async () => {
      const text = document.getElementById('topic-input').value.trim();
      if (!confirm('להתחיל שבוע חדש (' + (state.week.weekNumber + 1) + ')? זה יאפשר לכל התלמידים לבצע צ\'ק-אין מוערך חדש.')) return;
      try {
        const dsUrl = (document.getElementById('dataset-url').value || '').trim();
        state.week = await startNewWeek(text, undefined, dsUrl);
        toast('שבוע ' + state.week.weekNumber + ' התחיל');
        await refresh();
      } catch (err) { toast('שגיאה: ' + err.message, true); }
    });

    document.getElementById('parse-excel-btn').addEventListener('click', async () => {
      const input = document.getElementById('excel-file-input');
      const file = input.files && input.files[0];
      if (!file) { toast('נא לבחור קובץ Excel קודם', true); return; }
      try {
        state.importPreview = await parseStudentsExcel(file, state.students);
        render();
      } catch (err) {
        toast('שגיאה בקריאת הקובץ: ' + err.message, true);
      }
    });

    const confirmBtn = document.getElementById('confirm-import-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        try {
          const { imported } = await importRoster(state.importPreview.valid);
          const created = imported.filter(r => r.status === 'נוצר').length;
          toast(`יובאו ${created} תלמידים חדשים`);
          state.importPreview = null;
          await refresh();
        } catch (err) {
          toast('שגיאה בייבוא: ' + err.message, true);
          confirmBtn.disabled = false;
        }
      });
    }

    document.getElementById('export-btn').addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const { url } = await exportWeeklyReport();
        toast('הדוח מוכן');
        if (url && url.startsWith('http')) window.open(url, '_blank');
      } catch (err) {
        toast('שגיאה בייצוא: ' + err.message, true);
      } finally {
        e.target.disabled = false;
      }
    });
  }
}
