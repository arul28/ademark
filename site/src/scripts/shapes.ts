// Halftone targets for the hero: the bench mark, and the title dot for dot on its own glyphs.
// Both sit on one hidden grid of `step` px from the top left of the hero.

export interface Target {
  x: number;
  y: number;
  /** 0 is the smallest dot, 1 the biggest. */
  ink: number;
  pink: boolean;
}

type Point = [number, number];

// The bench mark in its own 92 by 86 units: a pink bar over the chevron and the stem.
const CHEVRON: Point[] = [
  [46, 20],
  [88, 86],
  [74, 86],
  [46, 42],
  [18, 86],
  [4, 86],
];

function inPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * What the bench mark has at (u, v) in its own 92 by 86 units: nothing, ink or the pink bar. The test is mirrored
 * round the centre line, so a symmetric grid always gives a symmetric mark.
 */
export function markAt(u: number, v: number): "ink" | "pink" | null {
  if (u < 0 || u > 92 || v < 0 || v > 86) return null;
  const m = 46 - Math.abs(u - 46);
  if (v <= 12) return "pink";
  if (m >= 40 && v >= 32) return "ink";
  return inPolygon(m, v, CHEVRON) ? "ink" : null;
}

/** The bench mark, `height` px tall, centered on cx, cy, lit from the top left. */
export function markTargets(cx: number, cy: number, height: number, step: number): Target[] {
  const s = height / 86;
  const ox = cx - 46 * s;
  const oy = cy - 43 * s;
  const out: Target[] = [];
  for (let row = Math.ceil(oy / step); row * step <= oy + 86 * s; row++) {
    for (let col = Math.ceil(ox / step); col * step <= ox + 92 * s; col++) {
      const x = col * step;
      const y = row * step;
      const u = (x - ox) / s;
      const v = (y - oy) / s;
      if (v <= 12) {
        out.push({ x, y, ink: 1, pink: true });
        continue;
      }
      if (!(u >= 40 && u <= 52 && v >= 32) && !inPolygon(u, v, CHEVRON)) continue;
      const light = (u / 92) * 0.45 + (v / 86) * 0.55;
      out.push({ x, y, ink: Math.min(1, Math.max(0.3, 1 - 0.6 * light)), pink: false });
    }
  }
  return out;
}

/**
 * The text of `el` as halftone, dot for dot where the element's own glyphs are. The element keeps its
 * layout and stays readable to screen readers; it is drawn transparent and the dots take its place.
 * A full stop at the end of a word is pink.
 */
export function textTargets(el: HTMLElement, host: DOMRect, step: number): Target[] {
  const w = Math.ceil(host.width);
  const h = Math.ceil(host.height);
  const make = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c.getContext("2d", { willReadFrequently: true })!;
  };
  const ink = make();
  const pink = make();
  const cs = getComputedStyle(el);
  for (const g of [ink, pink]) {
    g.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = cs.letterSpacing;
    g.fillStyle = "#000";
  }

  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (const m of text.matchAll(/\S+/g)) {
      range.setStart(node, m.index!);
      range.setEnd(node, m.index! + m[0].length);
      const r = range.getBoundingClientRect();
      const x = r.left - host.left;
      const word = m[0];
      const y = r.top - host.top + ink.measureText(word).fontBoundingBoxAscent;
      if (word.endsWith(".")) {
        const body = word.slice(0, -1);
        ink.fillText(body, x, y);
        pink.fillText(".", x + ink.measureText(body).width, y);
      } else {
        ink.fillText(word, x, y);
      }
    }
  }

  const box = el.getBoundingClientRect();
  const left = Math.max(0, box.left - host.left - step);
  const top = Math.max(0, box.top - host.top - step);
  const right = Math.min(w - 1, box.right - host.left + step);
  const bottom = Math.min(h - 1, box.bottom - host.top + step);
  const a = ink.getImageData(0, 0, w, h).data;
  const p = pink.getImageData(0, 0, w, h).data;
  const alpha = (data: Uint8ClampedArray, x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
    return data[(yi * w + xi) * 4 + 3] / 255;
  };
  // Coverage of nine samples round each grid point: edges get smaller dots, as in a real halftone.
  const k = step / 3;
  const cover = (data: Uint8ClampedArray, x: number, y: number) => {
    let sum = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) sum += alpha(data, x + i * k, y + j * k);
    return sum / 9;
  };

  const out: Target[] = [];
  for (let row = Math.ceil(top / step); row * step <= bottom; row++) {
    for (let col = Math.ceil(left / step); col * step <= right; col++) {
      const x = col * step;
      const y = row * step;
      const cp = cover(p, x, y);
      if (cp > 0.4) {
        out.push({ x, y, ink: 1, pink: true });
        continue;
      }
      const c = cover(a, x, y);
      if (c < 0.4) continue;
      const light = (x - box.left + host.left) / box.width;
      out.push({ x, y, ink: Math.min(1, 0.4 + 0.62 * c - 0.12 * light), pink: false });
    }
  }
  return out;
}
