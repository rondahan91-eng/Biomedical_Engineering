# Prompt — dynamic background layer for the biomed learning system

Paste everything below the line into a fresh coding session. It is self-contained.

---

## Role

Build one small, self-contained module: an animated background layer for an existing
Hebrew-language (RTL) educational web app for 10th-grade biomedical engineering.
It must look like it was always part of the app. Change nothing else about the app.

Deliver exactly one file: `js/background.js`. No build step, no dependencies, no CSS file.

## The design language you must match

These values were measured by counting every colour occurrence in the course's own
lesson deck, not guessed. Use these exact values.

| token       | value     | occurrences | role                       |
| ----------- | --------- | ----------: | -------------------------- |
| `--ink`     | `#0d1f2b` |          38 | headlines                  |
| `--body`    | `#4a6478` |          26 | body text                  |
| `--muted`   | `#8aa2b3` |          32 | eyebrow, muted labels      |
| `--line`    | `#e0e9f0` |      **44** | hairlines, card borders    |
| `--bg`      | `#f6f9fb` |          12 | page background            |
| `--surface` | `#ffffff` |          12 | card fill                  |
| `--accent`  | `#14b8a6` |       **6** | accent — deliberately rare |
| `--accent2` | `#0891b2` |           1 | second accent — rarer      |

Typography of the system, for context only (do not draw text in the background):
`Heebo 900 72px #0d1f2b` headlines · `Heebo 500 32px #4a6478` body ·
`JetBrains Mono 500 11px letter-spacing .22em #8aa2b3 uppercase` eyebrow.
Cards: `#fff`, `border-radius:10px`, `border:1px solid #e0e9f0`, **no shadow**.

### The one rule that matters most

This system separates surfaces with **1px hairlines only**. The deck contains zero
shadows, zero gradients, zero blurs, zero soft blobs. `#e0e9f0` is the single most
used colour in the whole file precisely because every edge in the system is a hairline.

Therefore: build the background out of **thin strokes and small points**, never out of
fills, glows or gradients. The default "modern web background" — mesh gradient, blurred
colour orbs, animated noise, aurora — is wrong here and must not be produced. If a
reviewer can describe your output as "glowy", it has failed.

## What the background depicts

The course's current unit is **learning curves**: accuracy as a function of training-set
size, where the curve rises and then flattens, and run-to-run noise sets the limit on
what you can read from it. The background should carry that idea quietly — it is
subject matter, not decoration, and it must never become the thing you look at.

Three layers, back to front:

1. **Graph field (static).** A hairline grid in `--line`. Not a uniform graph paper:
   a few verticals and horizontals at irregular, graph-like spacing, max alpha `0.5`,
   `lineWidth: 1` snapped to device pixels so it stays crisp and never blurs to grey.

2. **Measurement points (slow drift).** A sparse field of small dots in `--muted`,
   radius `1.5–2.5px`, alpha `0.18–0.35`. Density scales with viewport **area**, about
   one point per 24,000 px² (≈ 86 points at 1920×1080), clamped to `[24, 140]`.
   Each point drifts along its own near-horizontal path, never faster than **10 px/s**,
   and wraps around the edges. A point's vertical drift is at most ±8px from its origin,
   so the field reads as a settled measurement, not as falling snow.

3. **The curve (long cycle).** One `1px` polyline in `--line` at alpha `0.55`, shaped
   like a saturating learning curve: a fast rise over the first fifth of the width,
   then an asymptotic flattening. Over a **45-second** cycle it is drawn left-to-right,
   rests, then fades out and a new one is drawn with slightly different parameters —
   a different random draft of the same shape, which is the actual lesson.
   At most one curve is visible at a time. Exactly one element on screen may use
   `--accent` at alpha `≤ 0.4`: the leading point of the curve being drawn. Nothing else
   is ever teal.

Nothing in the composition may be anchored to one side: the app is RTL, and a
left-weighted background reads as broken there. Keep it direction-agnostic.

## Hard constraints

Performance — the school lab PCs are old and run an old Chrome. This is a real limit,
not a nicety:

- Canvas 2D only. **No WebGL, no `filter: blur()`, no `ctx.shadowBlur`, no `ctx.filter`.**
  Those are the expensive operations in canvas 2D and are also off-language here.
- Cap the animation at **30 fps**, not 60 — it is a background. Drive it from
  `requestAnimationFrame` with an elapsed-time gate, and advance motion by real elapsed
  time so it looks identical on a slow machine.
- Budget: **under 2 ms of main-thread work per frame** at 1920×1080.
- Handle `devicePixelRatio`; re-scale on resize via `ResizeObserver`, debounced.
- Stop the loop entirely when `document.hidden` is true (`visibilitychange`) and when an
  `IntersectionObserver` reports the canvas is off-screen. Resume where it left off.

Accessibility and integration:

- `prefers-reduced-motion: reduce` → render **exactly one static frame and stop**.
  Not slower; stopped. Honour changes to the media query at runtime.
- The canvas must be `position:fixed; inset:0; width:100%; height:100%;
  pointer-events:none;` with a low `z-index`, and must set its own styles in JS so the
  app needs no CSS change. Document in a comment that app content needs
  `position:relative; z-index:1`.
- Hidden under `@media print` (inject the rule from JS).
- Must look right from `1024×600` to `2560×1440`. Density and curve geometry derive from
  measured size, never from hard-coded pixel counts.
- Unminified file size **≤ 8 KB**.

## API

```js
// ES module, plus a window.LabBackground fallback for non-module pages
import { mountBackground } from './background.js';

const bg = mountBackground(document.body, {
  intensity: 0.45,   // 0..1 — multiplies every alpha. see presets below
  accent: true,      // false = no teal at all
  seed: 7,           // deterministic: same seed => same composition, for screenshots
});

bg.setIntensity(0.18);
bg.destroy();        // removes canvas, listeners, observers, rAF. Leaves no trace.
```

Presets to export as named constants: `TITLE = 0.9`, `CONTENT = 0.45`, `DENSE = 0.18`.

The lab demo mounts at `intensity: 0.5` — the teacher's call, decided after seeing the
spec. Do not change the demo's existing design in any way to accommodate the layer:
the only permitted edits to the host page are `position:relative; z-index:1` on its
layout regions and the mount call itself.
The composition must be a pure function of `(seed, width, height, elapsed)` — no
`Math.random()` after init; use a small seeded PRNG so a given seed is reproducible.

## Acceptance tests — report the result of each

Do not claim it works. Run these and paste the numbers.

1. **Hairline hierarchy.** Render a white card (`1px solid #e0e9f0`, radius 10) and
   `Heebo 900 72px #0d1f2b` text over the background. Sample pixels along the card
   border and along the strongest background stroke. The card border must be the
   higher-contrast edge. Report both contrast values.
2. **No patches.** Sample the background alone in 100×100 px tiles across the viewport.
   Report the max luminance spread within any single tile; it must stay under 3%.
3. **Reduced motion.** Emulate `prefers-reduced-motion: reduce`, instrument the draw
   function with a counter, wait 5 s. Report the counter; it must be exactly 1.
4. **Frame cost.** Run 30 s at 1920×1080 and report mean and 95th-percentile frame time
   from `performance.now()` around the draw call.
5. **Teardown.** Call `destroy()`, then report: canvas nodes remaining (0), rAF handle
   cancelled, and listener count on `window`/`document` back to its pre-mount value.
6. **Both sizes.** Screenshot at `1024×600` and `1920×1080`. The composition must read
   the same at both; say so or say what differs.
7. **Pointer transparency.** Report `getComputedStyle(canvas).pointerEvents` — `none`.

## Anti-goals — any one of these means start over

- Gradients, mesh gradients, radial glows, blurred shapes, aurora, animated noise, grain.
- Any shadow, anywhere.
- Saturated colour, or teal on more than one element at a time.
- Anything that moves faster than ~10 px/s, pulses, blinks, or scales.
- Parallax tied to scroll or pointer. The app is used on a projector and on weak laptops;
  pointer-reactive backgrounds are both a cost and a distraction.
- Particles that connect to each other with lines when they come close
  (the "constellation" demo) — it is the wrong metaphor and the wrong cost.
- Any dependency, bundler, or second file.
