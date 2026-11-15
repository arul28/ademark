// The poster hero: the bench mark printed as big halftone dots in one ink, with the pink bar in a second ink.
// Every dot is a touch uneven, like ink on paper: the press leaves some areas fuller than others, each dot is a
// little out of round, and the pink plate sits slightly off the black one. The dots develop once on load (about
// half a second), then nothing is drawn until the page scrolls; scrolling off, dots near the top edge lose their ink.

import { markAt } from "./shapes";

const SIGNAL = "#ff0d50";
const DEVELOP = 520;

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 4;
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
/** Slow variation across the sheet, 0 to 1: where the press put down a little more ink. */
const pressure = (x: number, y: number) =>
  0.5 + 0.28 * Math.sin(x * 0.0123 + y * 0.0071 + 1.7) + 0.22 * Math.sin(x * 0.0041 - y * 0.0113 + 0.4);

interface Dot {
  x: number;
  y: number;
  r: number;
  /** Out of round: the two radii differ by this share, at this angle. */
  e: number;
  a: number;
  pink: boolean;
  delay: number;
}

export function mountPoster(canvas: HTMLCanvasElement, slot: HTMLElement): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ctx = context;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");

  let width = 0;
  let height = 0;
  let step = 20;
  let dots: Dot[] = [];
  let start = performance.now() + 80;
  let done = reduceMotion;
  let frame = 0;
  let top = 0;
  let restTop = 0;

  function build(): void {
    const rect = slot.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    top = rect.top;
    restTop = rect.top + window.scrollY;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!width || !height) return;

    // A printed image: a full field of dots, small where there is paper and full where the mark is, in one ink.
    // The pink bar prints in the second ink. The grid has an odd number of columns with one on the centre line,
    // and the mark is sampled on that same grid, so it comes out symmetric.
    step = Math.min(26, Math.max(12, Math.round(width / 54)));
    let cols = Math.floor(width / step);
    if (cols % 2 === 0) cols -= 1;
    const rows = Math.floor(height / step);
    const ox = width / 2 - ((cols - 1) / 2) * step;
    const oy = (height - (rows - 1) * step) / 2;
    // The mark spans whole rows: its top row is the bar's first row and its last row sits on the feet.
    const markRows = Math.max(7, rows - 1);
    const s = ((markRows - 1) * step) / 86;
    const mx = width / 2 - 46 * s;
    const my = oy + ((rows - markRows) / 2) * step;
    dots = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = ox + col * step;
        const y = oy + row * step;
        const hit = markAt((x - mx) / s, (y - my) / s);
        const n = hash(x, y);
        const m = hash(y * 1.31, x * 0.77);
        const ink = hit ? 1 : 0.14 + 0.06 * n;
        // Dot gain follows the press: fuller where it pressed harder, with a little noise per dot.
        const gain = 0.93 + 0.11 * pressure(x, y) + 0.05 * (n - 0.5);
        dots.push({
          x: x + (hash(y, x) - 0.5) * step * 0.05,
          y: y + (n - 0.5) * step * 0.05,
          r: (0.12 + 0.88 * ink) * step * 0.47 * gain,
          e: hit ? 0.015 + 0.035 * m : 0.04 * m,
          a: m * Math.PI,
          pink: hit === "pink",
          delay: ((x / width) * 0.55 + (y / height) * 0.45) * (DEVELOP * 0.55),
        });
      }
    }
  }

  function draw(now: number): boolean {
    if (!width || !height) return false;
    const t = done ? Infinity : now - start;
    const ink = getComputedStyle(slot).getPropertyValue("--color-text").trim() || (darkQuery.matches ? "#ececec" : "#0a0a0a");
    // Scrolling off: dots within this band of the top edge of the screen shrink as they reach it.
    const band = Math.max(60, Math.min(innerHeight * 0.24, restTop - 8));
    // The pink plate is registered a little off the black one, as in a two-ink print.
    const shiftX = step * 0.045;
    const shiftY = -step * 0.03;
    const grays = new Path2D();
    const pinks = new Path2D();
    let busy = false;
    for (const d of dots) {
      const grow = easeOut((t - d.delay) / (DEVELOP * 0.45));
      if (grow < 1) busy = true;
      let r = d.r * grow;
      const edge = top + d.y;
      if (!reduceMotion && edge < band) r *= easeOut(edge / band);
      if (r < 0.3) continue;
      const path = d.pink ? pinks : grays;
      const x = d.pink ? d.x + shiftX : d.x;
      const y = d.pink ? d.y + shiftY : d.y;
      path.moveTo(x + r, y);
      path.ellipse(x, y, r * (1 + d.e), r * (1 - d.e), d.a, 0, Math.PI * 2);
    }
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = ink;
    ctx.fill(grays);
    ctx.fillStyle = SIGNAL;
    ctx.fill(pinks);
    if (!busy) done = true;
    return busy;
  }

  function loop(now: number): void {
    frame = draw(now) ? requestAnimationFrame(loop) : 0;
  }

  build();
  if (done) draw(performance.now());
  else frame = requestAnimationFrame(loop);

  new ResizeObserver(() => {
    const rect = slot.getBoundingClientRect();
    if (Math.abs(rect.width - width) < 1 && Math.abs(rect.height - height) < 1) return;
    build();
    if (!frame) draw(performance.now());
  }).observe(slot);
  darkQuery.addEventListener("change", () => {
    if (!frame) draw(performance.now());
  });

  let queued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (queued || reduceMotion) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        const rect = slot.getBoundingClientRect();
        if (rect.bottom < -40 && top + height < -40) return;
        top = rect.top;
        if (!frame) draw(performance.now());
      });
    },
    { passive: true },
  );
}

/** Sets the title's font size so its one line runs exactly the width of its box. */
export function fitTitle(title: HTMLElement): void {
  const fit = () => {
    if (innerWidth < 900) {
      title.style.fontSize = "";
      return;
    }
    title.style.fontSize = "100px";
    const target = title.parentElement!.clientWidth;
    title.style.fontSize = `${(100 * target) / title.getBoundingClientRect().width}px`;
  };
  fit();
  new ResizeObserver(fit).observe(title.parentElement!);
}
