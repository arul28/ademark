// The bench mark turns into the hero title. The mark develops at the center in halftone, holds a moment, then
// unfolds: every dot of the title leaves from the matching place in the mark and travels to its letter.
// The pink bar spreads over the top of the letters and cools to ink on the way; the full stop stays pink.
// After that nothing moves and nothing is drawn.

import { markTargets, textTargets, type Target } from "./shapes";

const SIGNAL = "#ff0d50";
const BUCKETS = 24;
const SCHEMES = {
  light: { small: 201, big: 34 },
  dark: { small: 70, big: 226 },
};

// Timeline in ms from the start. A first-load intro is seen on every visit, so it stays near a second.
const DEVELOP = 260; // the mark's dots grow in, from the top left
const HOLD = 90; // just long enough to read the mark
const TRAVEL = 620; // one dot's flight
const SPREAD = 200; // the center leaves first, the ends last

const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 4;
// Emil Kowalski's strong ease-in-out, cubic-bezier(0.77, 0, 0.175, 1), for movement across the screen.
const easeInOut = bezier(0.77, 0, 0.175, 1);
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t: number) => {
    const x = clamp(t);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
// A fixed pseudo-random number per dot, so the dissolve pattern is the same on every frame.
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
function clamp(t: number): number {
  return Math.min(1, Math.max(0, t));
}

interface Flight {
  fromX: number;
  fromY: number;
  fromR: number;
  fromPink: boolean;
  x: number;
  y: number;
  r: number;
  ink: number;
  pink: boolean;
  leave: number;
  /** Height of the arc the dot flies on, in px; up for the top half, down for the bottom. */
  arc: number;
}

export function mountUnfold(canvas: HTMLCanvasElement, host: HTMLElement, title: HTMLElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ctx = context;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");

  let width = 0;
  let height = 0;
  let step = 10;
  let mark: (Target & { r: number; used: boolean; delay: number })[] = [];
  let flights: Flight[] = [];
  let start = 0;
  let played = reduceMotion;
  let frame = 0;
  // Where the hero's top is in the viewport, for the fade at the top edge.
  let hostTop = 0;
  // The highest dot's place in the viewport with the page at the top: the fade never touches the title at rest.
  let restY = 200;

  const radius = (t: Target) => (t.pink ? 0.95 : 0.095 + 0.905 * t.ink) * step * 0.42;

  function build(): void {
    const rect = host.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    hostTop = rect.top;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!width || !height) return;

    // About 24 dots to the em on a big title; a phone title gets fewer, larger dots so the letters stay legible.
    const fontSize = parseFloat(getComputedStyle(title).fontSize);
    step = Math.max(4, Math.round(fontSize / (fontSize >= 140 ? 24 : 17)));
    const text = textTargets(title, rect, step);
    if (!text.length) return;
    let tx0 = Infinity;
    let tx1 = -Infinity;
    let ty0 = Infinity;
    let ty1 = -Infinity;
    for (const d of text) {
      tx0 = Math.min(tx0, d.x);
      tx1 = Math.max(tx1, d.x);
      ty0 = Math.min(ty0, d.y);
      ty1 = Math.max(ty1, d.y);
    }

    // The mark stands where the title is, a little shorter than the two lines of it.
    const markH = Math.min((ty1 - ty0) * 0.82, width * 0.5);
    const cx = (tx0 + tx1) / 2;
    const cy = (ty0 + ty1) / 2;
    // Its grid is finer than the title's, so it holds about as many dots as the title has: one dot, one letter dot.
    const plain = text.filter((d) => !d.pink);
    const coarse = markTargets(cx, cy, markH, step).length || 1;
    const markStep = Math.max(2.5, step * Math.sqrt(coarse / plain.length));
    const markRadius = (d: Target) => (d.pink ? 0.95 : 0.095 + 0.905 * d.ink) * markStep * 0.42;
    const m = markTargets(cx, cy, markH, markStep);
    let mx0 = Infinity;
    let mx1 = -Infinity;
    let my0 = Infinity;
    let my1 = -Infinity;
    for (const d of m) {
      mx0 = Math.min(mx0, d.x);
      mx1 = Math.max(mx1, d.x);
      my0 = Math.min(my0, d.y);
      my1 = Math.max(my1, d.y);
    }
    mark = m.map((d) => ({ ...d, r: markRadius(d), used: false, delay: ((d.x - mx0) / (mx1 - mx0 || 1) + (d.y - my0) / (my1 - my0 || 1)) * 0.5 * (DEVELOP * 0.6) }));

    // Pairing: cut both into the same number of vertical bands with equal counts, then pair top to bottom inside
    // each band. Left of the mark goes to the left letters, its top to their tops, and no two dots share a start.
    const bands = Math.max(8, Math.round(Math.sqrt(plain.length) / 1.5));
    const byX = <T extends { x: number }>(list: T[]) => [...list].sort((p, q) => p.x - q.x);
    const textX = byX(plain);
    const markX = byX(mark);
    const pairs: [Target, (typeof mark)[number]][] = [];
    for (let b = 0; b < bands; b++) {
      const ts = textX.slice(Math.floor((b * textX.length) / bands), Math.floor(((b + 1) * textX.length) / bands)).sort((p, q) => p.y - q.y);
      const ms = markX.slice(Math.floor((b * markX.length) / bands), Math.floor(((b + 1) * markX.length) / bands)).sort((p, q) => p.y - q.y);
      if (!ms.length) continue;
      ts.forEach((d, i) => pairs.push([d, ms[Math.min(ms.length - 1, Math.floor((i * ms.length) / ts.length))]]));
    }
    // The full stop leaves from the right end of the pink bar, so it is pink from start to finish.
    const bar = mark.filter((d) => d.pink).sort((p, q) => q.x - p.x || p.y - q.y);
    text.filter((d) => d.pink).forEach((d, i) => pairs.push([d, bar[i % Math.max(1, bar.length)]]));

    restY = rect.top + window.scrollY + ty0;
    const half = (tx1 - tx0) / 2 || 1;
    flights = pairs.map(([d, src]) => {
      src.used = true;
      return {
        fromX: src.x,
        fromY: src.y,
        fromR: src.r,
        fromPink: src.pink,
        x: d.x,
        y: d.y,
        r: radius(d),
        ink: d.ink,
        pink: d.pink,
        leave: DEVELOP + HOLD + (Math.abs(d.x - cx) / half) * SPREAD + hash(d.y, d.x) * 40,
        arc: (d.y < cy ? -1 : 1) * Math.min(80, Math.hypot(d.x - src.x, d.y - src.y) * 0.12),
      };
    });
  }

  function draw(now: number): boolean {
    if (!width || !height) return false;
    const t = played ? Infinity : now - start;
    const colors = darkQuery.matches ? SCHEMES.dark : SCHEMES.light;
    const grays: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
    const pink = new Path2D();
    const MIX = 10;
    const mixes: Path2D[] = Array.from({ length: MIX }, () => new Path2D());
    const put = (path: Path2D, x: number, y: number, r: number) => {
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    };
    const add = (x: number, y: number, r: number, isPink: boolean, ink: number) => {
      if (r < 0.25) return;
      put(isPink ? pink : grays[Math.min(BUCKETS - 1, Math.floor(ink * BUCKETS))], x, y, r);
    };
    // As the title scrolls off, each dot shrinks as it nears the top edge of the screen, as if the ink ran out.
    const band = Math.max(60, Math.min(innerHeight * 0.24, restY - 8));

    const unfolding = t >= DEVELOP + HOLD;
    if (!unfolding) {
      for (const d of mark) add(d.x, d.y, d.r * easeOut((t - d.delay) / (DEVELOP * 0.55)), d.pink, d.ink);
    } else {
      // Mark dots that no letter takes shrink away where they stand.
      const fade = 1 - easeOut((t - DEVELOP - HOLD) / 220);
      if (fade > 0) for (const d of mark) if (!d.used) add(d.x, d.y, d.r * fade, d.pink, d.ink);
      for (const f of flights) {
        const e = easeInOut((t - f.leave) / TRAVEL);
        const flying = Math.sin(Math.PI * e);
        const x = f.fromX + (f.x - f.fromX) * e;
        const y = f.fromY + (f.y - f.fromY) * e + f.arc * flying;
        // A dot in flight is a little smaller, which reads as speed and keeps the crowd light.
        let r = (f.fromR + (f.r - f.fromR) * e) * (1 - 0.3 * flying);
        if (!reduceMotion && hostTop + y < band) r *= easeOut((hostTop + y) / band);
        if (r < 0.25) continue;
        if (f.pink) put(pink, x, y, r);
        // The bar's pink cools to ink across the flight, through ten steps of mix.
        else if (f.fromPink && e < 1) put(mixes[Math.min(MIX - 1, Math.floor(e * MIX))], x, y, r);
        else add(x, y, r, false, f.ink);
      }
    }

    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < BUCKETS; i++) {
      const g = Math.round(colors.small - (colors.small - colors.big) * ((i + 0.5) / BUCKETS));
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fill(grays[i]);
    }
    const ink = colors.big;
    for (let i = 0; i < MIX; i++) {
      const k = (i + 0.5) / MIX;
      ctx.fillStyle = `rgb(${Math.round(255 + (ink - 255) * k)},${Math.round(13 + (ink - 13) * k)},${Math.round(80 + (ink - 80) * k)})`;
      ctx.fill(mixes[i]);
    }
    ctx.fillStyle = SIGNAL;
    ctx.fill(pink);
    const end = DEVELOP + HOLD + SPREAD + TRAVEL + 40;
    if (t >= end) played = true;
    return t < end;
  }

  function loop(now: number): void {
    frame = draw(now) ? requestAnimationFrame(loop) : 0;
  }

  build();
  start = performance.now() + 60;
  if (played) draw(performance.now());
  else frame = requestAnimationFrame(loop);

  new ResizeObserver(() => {
    const rect = host.getBoundingClientRect();
    if (Math.abs(rect.width - width) < 1 && Math.abs(rect.height - height) < 1) return;
    build();
    // A resize after the opening shows the title at once; it does not play again.
    if (!frame) draw(performance.now());
  }).observe(host);
  darkQuery.addEventListener("change", () => {
    if (!frame) draw(performance.now());
  });

  if (reduceMotion) return;
  // One draw per frame at most while the page scrolls, and none once the hero is out of sight.
  let queued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const rect = host.getBoundingClientRect();
        if (rect.bottom < 0 && hostTop + height < 0) return;
        hostTop = rect.top;
        if (!frame) draw(performance.now());
      });
    },
    { passive: true },
  );
}
