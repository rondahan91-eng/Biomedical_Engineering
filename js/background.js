/* רקע דינמי למעבדה: שדה מדידות שקט בפיזור אחיד, בלי רשת. העקומה רמז נדיר ודק.
     const bg = mountBackground(document.body, { intensity: CONTENT, seed: 7 });
   z-index:-1 כדי שלא תידרש שורת CSS: מעל רקע העמוד, מתחת לכל התוכן. אם אב
   יוצר stacking context — z-index:0 לקנבס, position:relative;z-index:1 לתוכן. */

export const TITLE = 0.9, CONTENT = 0.45, DENSE = 0.18;

const { round, max, min, sqrt, sin, exp, floor, imul, PI } = Math;
const LINE = '#e0e9f0', MUTED = '#8aa2b3', ACCENT = '#14b8a6';
const FRAME = 1000 / 30, TAU = PI * 2, AREA_PER_PT = 21000, S = 8;
/* העקומה נראית 36 שניות מתוך 48. המחזור המקורי היה 84 שניות, כלומר 54 שניות
   בלי עקומה בכלל - האלמנט הנראה ביותר נעדר רוב הזמן, והרקע נקרא כריק. */
const DRAW = 18000, HOLD = 12000, FADE = 6000, CYCLE = 48000, STATIC_AT = DRAW * 0.92;

/* תקרות אטימות לצבעים הכהים, נגזרות מ-T1: שום סימן ברקע לא יעבור את גבול
   הכרטיס, שהוא dL=0.196 (#e0e9f0 על לבן). מעל התקרות האלה הרקע מתחיל להתחרות
   בתוכן. הקווים והעקומה אינם זקוקים לתקרה - #e0e9f0 באלפא מלאה הוא dL=0.139. */
const A_DOT = 0.21, A_ACCENT = 0.20;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = (a, b) => imul(a * 2654435761 ^ b * 2246822519, 1597334677) >>> 0;
/* mulberry32 — אחרי האתחול אין Math.random. */
function prng(s) {
  let a = s >>> 0;
  return () => { a = a + 0x6d2b79f5 | 0; let t = imul(a ^ a >>> 15, 1 | a); t = t + imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export function mountBackground(target, opts) {
  const o = opts || {}, accent = o.accent !== false, seed = (o.seed == null ? 7 : o.seed) | 0;
  let intensity = clamp(o.intensity == null ? CONTENT : o.intensity, 0, 1);

  const cv = document.createElement('canvas');
  cv.className = 'lab-bg';
  cv.ariaHidden = 'true';
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;display:block';
  const sheet = document.createElement('style');
  sheet.textContent = '@media print{.lab-bg{display:none!important}}';
  const ctx = cv.getContext('2d');
  (target || document.body).appendChild(cv);
  document.head.appendChild(sheet);

  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, dpr = 1, pts = new Float32Array(0), lv = [0, 0];
  let cyc = -1, curve = null, elapsed = 0, last = 0, raf = 0, tid = 0;
  let onscreen = true, dead = false, reduce = mq.matches, frames = 0;

  /* קו 1px מיושר לפיקסל המכשיר, שלא יימרח לאפור. */
  const snap = v => (round(v * dpr - dpr / 2) + dpr / 2) / dpr;

  /* סריג מופרע: תא לכל נקודה, ג'יטר בתוך התא, היסט חצי-תא בשורות האי-זוגיות.
     הצפיפות נגזרת משטח, ולכן גודל התא זהה ב-1024x600 וב-1920x1080. */
  function field() {
    const n0 = clamp(round(W * H / AREA_PER_PT), 24, 140);
    let cols = max(2, round(sqrt(n0 * W / H))), rows = max(2, round(n0 / cols));
    while (cols * rows > 140) { if (cols > rows) cols--; else rows--; }
    const cw = W / cols, ch = H / rows, r = prng(hash(seed, cols * 977 + rows)), a = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const dir = r() < 0.5 ? -1 : 1; // חצי לכל כיוון: לשדה אין צד מועדף
      // x, y, vx px/s, amp, phase, omega/ms, radius, alpha level
      a.push((i + 0.5 + (j & 1 ? 0.5 : 0)) * cw + (r() - 0.5) * 0.9 * cw,
        (j + 0.5) * ch + (r() - 0.5) * 0.9 * ch, dir * (1.2 + r() * 2.6),
        2 + r() * 6, r() * TAU, TAU / (70000 + r() * 80000), 1.5 + r(), (r() * 5) | 0);
    }
    pts = new Float32Array(a);
    /* רמת הרוויה, והסף שמתחתיו ההפרש שקוע ברעש. אופקי הוא גם הכיוון היחיד שניטרלי ב-RTL. */
    const rl = prng(hash(seed, 7331));
    lv = [H * (0.30 + rl() * 0.08), H * (0.56 + rl() * 0.09)];
  }

  /* תלויה במספר המחזור בלבד: אותו זמן תמיד אותה עקומה. */
  function makeCurve(ci) {
    const r = prng(hash(seed ^ 0x9e37, ci)), n = clamp(round(W / 16), 24, 90);
    const yb = H * (0.70 + r() * 0.07), yt = H * (0.23 + r() * 0.08), k = 0.14 + r() * 0.07;
    const xs = new Float32Array(n), ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      xs[i] = t * W; ys[i] = yb - (yb - yt) * (1 - exp(-t / k)) + (r() - 0.5) * 2.2;
    }
    curve = { n, xs, ys };
  }

  function render() {
    frames++;
    const ts = elapsed / 1000, span = W + 6;
    ctx.clearRect(0, 0, W, H);
    /* #e0e9f0 באלפא מלאה נותן dL=0.139 מול #f6f9fb, ועדיין מתחת ל-0.196 של גבול
       הכרטיס. הקווים והעקומה יכולים להגיע כמעט לאלפא מלאה בלי להפר את T1 -
       מה שהנקודות, שצבען כהה, אינן יכולות. */
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.globalAlpha = 0.95 * intensity;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) { const y = snap(lv[i]); ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    /* חמש דרגות אטימות => חמישה מילויים לפריים. */
    ctx.fillStyle = MUTED;
    for (let L = 0; L < 5; L++) {
      ctx.globalAlpha = min(A_DOT, (0.18 + L * 0.0425) * intensity);
      ctx.beginPath();
      for (let p = 0; p < pts.length; p += S) {
        if (pts[p + 7] !== L) continue;
        const xw = (pts[p] + pts[p + 2] * ts) % span, rad = pts[p + 6];
        const px = (xw < 0 ? xw + span : xw) - 3;
        const py = pts[p + 1] + pts[p + 3] * sin(pts[p + 4] + pts[p + 5] * elapsed);
        ctx.moveTo(px + rad, py); ctx.arc(px, py, rad, 0, TAU);
      }
      ctx.fill();
    }

    const ph = elapsed % CYCLE;
    if (ph < DRAW + HOLD + FADE) {
      const ci = floor(elapsed / CYCLE);
      if (ci !== cyc) { cyc = ci; makeCurve(ci); }
      const { xs, ys, n } = curve;
      let vis = 1, prog = 1;
      if (ph < DRAW) { prog = ph / DRAW; vis = min(1, ph / 1500); }
      else if (ph > DRAW + HOLD) vis = 1 - (ph - DRAW - HOLD) / FADE;
      const f = prog * (n - 1), m = floor(f), fr = f - m;
      let hx = xs[m], hy = ys[m];
      ctx.beginPath(); ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i <= m; i++) ctx.lineTo(xs[i], ys[i]);
      if (fr > 0 && m < n - 1) {
        hx += (xs[m + 1] - xs[m]) * fr; hy += (ys[m + 1] - ys[m]) * fr;
        ctx.lineTo(hx, hy);
      }
      ctx.globalAlpha = 0.9 * intensity * vis; ctx.stroke();
      /* הטורקיז היחיד, ורק בזמן השרטוט. התקרה היא A_ACCENT ולא 0.4 שבמפרט:
         המפרט חסם לפי אלפא בלי להתחשב בכך ש-#14b8a6 כהה בהרבה מ-#e0e9f0,
         ובאלפא 0.4 הנקודה נותנת dL=0.26 - חזקה יותר מגבול הכרטיס. */
      if (accent && ph < DRAW) {
        /* A_ACCENT היא האטימות בעוצמה מלאה, לא תקרה שחוסמת מעליה: אחרת הטורקיז
           היה נתקע על התקרה בכל עוצמה מעל 0.44, והידית לא הייתה שולטת בו. */
        ctx.globalAlpha = A_ACCENT * intensity * vis;
        ctx.fillStyle = ACCENT;
        ctx.beginPath(); ctx.moveTo(hx + 1.8, hy); ctx.arc(hx, hy, 1.8, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function sizeTo() {
    const r = cv.getBoundingClientRect();
    W = max(1, round(r.width)); H = max(1, round(r.height));
    dpr = min(devicePixelRatio || 1, 2);   // תקרה 2 — מחשבי המעבדה
    cv.width = round(W * dpr); cv.height = round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cyc = -1; field();
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const d = now - last;
    if (d < FRAME - 1) return;        // שער 30fps
    last = now;
    elapsed += d < 200 ? d : FRAME;   // זמן אמיתי; קפיצה חריגה לא מזניקה תנועה
    render();
  }
  function run() {
    if (raf || dead || reduce || !onscreen || document.hidden) return;
    last = performance.now() - FRAME; raf = requestAnimationFrame(tick);
  }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  /* reduce => פריים אחד ועוצר. לא איטי — עוצר. */
  function apply() { if (reduce) { stop(); elapsed = STATIC_AT; render(); } else run(); }

  /* בלי שינוי מידה אין ציור, כך שהקריאה הראשונה של ResizeObserver לא מוסיפה פריים. */
  function resized() {
    tid = 0; if (dead) return;
    const r = cv.getBoundingClientRect(), d2 = min(devicePixelRatio || 1, 2);
    if (round(r.width) === W && round(r.height) === H && d2 === dpr) return;
    sizeTo(); if (!raf) render();
  }
  const ro = new ResizeObserver(() => { if (!tid) tid = setTimeout(resized, 160); });
  const io = new IntersectionObserver(e => {
    onscreen = e[e.length - 1].isIntersecting;
    if (onscreen) run(); else stop();
  });
  const onVis = () => { if (document.hidden) stop(); else run(); };
  const onMq = () => { reduce = mq.matches; apply(); };

  ro.observe(document.documentElement);
  io.observe(cv);
  document.addEventListener('visibilitychange', onVis);
  if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
  sizeTo(); apply();

  return {
    destroy() {
      dead = true; stop(); clearTimeout(tid); ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      if (mq.removeEventListener) mq.removeEventListener('change', onMq); else mq.removeListener(onMq);
      cv.remove(); sheet.remove();
    },
    setIntensity(v) { intensity = clamp(+v || 0, 0, 1); if (!raf) render(); },
    get frames() { return frames; }
  };
}

if (typeof window !== 'undefined') window.LabBackground = { mountBackground, TITLE, CONTENT, DENSE };
