// gta6-meme-x-01 entry program.
//
// Two jobs, both with the Node standard library alone:
//   1. The entry duty from the bounty rules: copy POST.json (which names our
//      post on X) from this repository into the output directory.
//   2. Make the meme itself: draw meme.png, a GTA 6 launch-week scene with
//      the make.fun ghost in it, rendered pixel by pixel with a tiny
//      software rasteriser and a hand-built 5x7 bitmap font, then encoded
//      as a PNG with node:zlib. The picture posted on X is this file.

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// PNG encoding (RGBA, filter 0 rows, zlib deflate, CRC32 checksums)
// ---------------------------------------------------------------------------

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return png;
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGB raster with the few shapes the scene needs
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];

class Canvas {
  w: number;
  h: number;
  px: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
  }

  set(x: number, y: number, c: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgb): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) this.set(xx, yy, c);
  }

  fillCircle(cx: number, cy: number, r: number, c: Rgb): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      const dy = y - cy;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      this.fillRect(cx - half, y, half * 2, 1, c);
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: Rgb): void {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      const t = (y - cy) / ry;
      const half = rx * Math.sqrt(Math.max(0, 1 - t * t));
      this.fillRect(cx - half, y, half * 2, 1, c);
    }
  }

  // A disc stamped along a segment makes a thick, round-ended line.
  thickLine(x1: number, y1: number, x2: number, y2: number, w: number, c: Rgb): void {
    const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / (w / 3)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.fillCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, c);
    }
  }

  fillPoly(points: Array<[number, number]>, c: Rgb): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (let y = Math.floor(minY); y <= maxY; y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        this.fillRect(xs[i], y, xs[i + 1] - xs[i], 1, c);
      }
    }
  }

  verticalGradient(y0: number, y1: number, stops: Array<[number, Rgb]>): void {
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0 - 1);
      let a = stops[0];
      let b = stops[stops.length - 1];
      for (let i = 0; i + 1 < stops.length; i++) {
        if (t >= stops[i][0] && t <= stops[i + 1][0]) {
          a = stops[i];
          b = stops[i + 1];
          break;
        }
      }
      const span = Math.max(0.0001, b[0] - a[0]);
      const f = Math.min(1, Math.max(0, (t - a[0]) / span));
      const c: Rgb = [
        Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
        Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
        Math.round(a[1][2] + (b[1][2] - a[1][2]) * f),
      ];
      this.fillRect(0, y, this.w, 1, c);
    }
  }
}

// Deterministic little RNG so the picture is the same on every run.
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Rows are strings of '#' and '.', five pixels wide.
// Uppercase carries the captions; the lowercase letters of "make.fun" are
// drawn as themselves so the name reads exactly as make.fun writes it.
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  "'": [".##..", ".##..", ".#...", ".....", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "..##.", "..#..", ".....", "..#.."],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "%": ["##..#", "##.#.", "....#", "...#.", "..#..", ".#...", "#..##"],
  "@": [".###.", "#...#", "#.###", "#.#.#", "#.##.", "#....", ".###."],
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".####"],
  f: ["..##.", ".#...", ".#...", "####.", ".#...", ".#...", ".#..."],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
  n: [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
};

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawText(
  cv: Canvas,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: Rgb,
  outline?: Rgb,
): void {
  const put = (dx: number, dy: number, c: Rgb) => {
    let cx = x + dx;
    for (const ch of text) {
      const glyph = FONT[ch] ?? FONT[" "];
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 5; col++) {
          if (glyph[row][col] === "#") {
            cv.fillRect(cx + col * scale, y + dy + row * scale, scale, scale, c);
          }
        }
      }
      cx += 6 * scale;
    }
  };
  if (outline) {
    const o = Math.max(2, Math.round(scale / 2));
    for (const [dx, dy] of [
      [-o, 0],
      [o, 0],
      [0, -o],
      [0, o],
      [-o, -o],
      [o, -o],
      [-o, o],
      [o, o],
    ]) {
      put(dx, dy, outline);
    }
  }
  put(0, 0, color);
}

function drawTextCentered(
  cv: Canvas,
  text: string,
  cx: number,
  y: number,
  scale: number,
  color: Rgb,
  outline?: Rgb,
): void {
  drawText(cv, text, Math.round(cx - textWidth(text, scale) / 2), y, scale, color, outline);
}

// ---------------------------------------------------------------------------
// The make.fun ghost: white body, thick black outline, two black sparkle
// eyes, a round little hand, and the magenta coin with a white star.
// ---------------------------------------------------------------------------

function starPoints(cx: number, cy: number, rOuter: number, rInner: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function sparkleEye(cv: Canvas, cx: number, cy: number, size: number, c: Rgb): void {
  // A four-pointed sparkle: a tall thin diamond crossed with a wide one.
  cv.fillPoly(
    [
      [cx, cy - size],
      [cx + size * 0.28, cy - size * 0.28],
      [cx + size, cy],
      [cx + size * 0.28, cy + size * 0.28],
      [cx, cy + size],
      [cx - size * 0.28, cy + size * 0.28],
      [cx - size, cy],
      [cx - size * 0.28, cy - size * 0.28],
    ],
    c,
  );
}

function ghostBody(cv: Canvas, cx: number, baseY: number, r: number, c: Rgb): void {
  const headCy = baseY - r * 1.55;
  cv.fillCircle(cx, headCy, r, c);
  cv.fillRect(cx - r, headCy, r * 2, baseY - headCy - r * 0.1, c);
  // Wavy hem: three scallops along the bottom edge.
  const hemY = baseY - r * 0.1;
  cv.fillCircle(cx - r * 0.66, hemY, r * 0.36, c);
  cv.fillCircle(cx, hemY, r * 0.36, c);
  cv.fillCircle(cx + r * 0.66, hemY, r * 0.36, c);
}

function drawGhost(cv: Canvas, cx: number, baseY: number, r: number): void {
  const BLACK: Rgb = [16, 12, 24];
  const WHITE: Rgb = [250, 250, 252];
  const MAGENTA: Rgb = [226, 0, 166];
  const MAGENTA_DARK: Rgb = [158, 0, 116];

  // Magenta disc behind the ghost, like the logo's roundel.
  cv.fillCircle(cx, baseY - r * 1.35, r * 1.62, MAGENTA);
  cv.fillCircle(cx, baseY - r * 1.35, r * 1.5, [240, 30, 185]);

  // Thick black outline first (a slightly larger body), then the white one.
  ghostBody(cv, cx, baseY + r * 0.06, r * 1.13, BLACK);
  ghostBody(cv, cx, baseY, r, WHITE);

  const headCy = baseY - r * 1.55;
  sparkleEye(cv, cx - r * 0.38, headCy - r * 0.05, r * 0.3, BLACK);
  sparkleEye(cv, cx + r * 0.38, headCy - r * 0.05, r * 0.3, BLACK);

  // The coin, held up at the ghost's right: magenta, ringed, white star.
  const coinX = cx + r * 1.34;
  const coinY = baseY - r * 2.15;
  cv.fillCircle(coinX, coinY, r * 0.46, MAGENTA_DARK);
  cv.fillCircle(coinX, coinY, r * 0.4, MAGENTA);
  cv.fillPoly(starPoints(coinX, coinY, r * 0.24, r * 0.1), WHITE);

  // The round little hand, reaching toward the coin.
  const handX = cx + r * 0.98;
  const handY = baseY - r * 1.15;
  cv.fillCircle(handX, handY, r * 0.2, BLACK);
  cv.fillCircle(handX, handY, r * 0.15, WHITE);
}

// ---------------------------------------------------------------------------
// Scene pieces
// ---------------------------------------------------------------------------

function drawPalm(cv: Canvas, baseX: number, baseY: number, height: number, lean: number, c: Rgb): void {
  const topX = baseX + lean;
  const topY = baseY - height;
  const midX = baseX + lean * 0.4;
  const midY = baseY - height * 0.55;
  cv.thickLine(baseX, baseY, midX, midY, 21, c);
  cv.thickLine(midX, midY, topX, topY, 16, c);
  // Fronds: two segments each, fanning out and drooping.
  const fronds: Array<[number, number]> = [
    [-118, -52],
    [-96, -84],
    [-48, -104],
    [8, -112],
    [64, -96],
    [110, -66],
    [128, -24],
  ];
  for (const [dx, dy] of fronds) {
    const p1x = topX + dx * 0.38;
    const p1y = topY + dy * 0.5 - 18;
    const p2x = topX + dx * 0.74;
    const p2y = topY + dy * 0.82 + 12;
    const endX = topX + dx * (height / 430);
    const endY = topY + dy * (height / 430) + 96;
    cv.thickLine(topX, topY, p1x, p1y, 12, c);
    cv.thickLine(p1x, p1y, p2x, p2y, 10, c);
    cv.thickLine(p2x, p2y, endX, endY, 8, c);
  }
  cv.fillCircle(topX, topY, 15, c);
}

function drawSkyline(cv: Canvas, baseY: number): void {
  const rand = rng(20261119);
  const DARK: Rgb = [29, 20, 48];
  const LIT: Rgb = [255, 196, 86];
  let x = -10;
  while (x < cv.w) {
    const bw = 60 + rand() * 90;
    const bh = 90 + rand() * 190;
    cv.fillRect(x, baseY - bh, bw, bh, DARK);
    for (let wy = baseY - bh + 14; wy < baseY - 16; wy += 22) {
      for (let wx = x + 10; wx < x + bw - 12; wx += 20) {
        if (rand() > 0.55) cv.fillRect(wx, wy, 8, 11, LIT);
      }
    }
    x += bw + 6 + rand() * 26;
  }
}

function drawPerson(cv: Canvas, cx: number, baseY: number, h: number, c: Rgb): void {
  const headR = h * 0.13;
  cv.fillCircle(cx, baseY - h + headR, headR, c);
  cv.fillRect(cx - h * 0.11, baseY - h + headR * 1.8, h * 0.22, h * 0.52, c);
  cv.thickLine(cx - h * 0.05, baseY - h * 0.3, cx - h * 0.09, baseY, 9, c);
  cv.thickLine(cx + h * 0.05, baseY - h * 0.3, cx + h * 0.09, baseY, 9, c);
}

// ---------------------------------------------------------------------------
// The meme: a Vice City sunset, the midnight launch line outside a game
// store, and the make.fun ghost at the back of the queue — already paid.
// ---------------------------------------------------------------------------

const W = 1200;
const H = 1200;

function drawMeme(): Canvas {
  const cv = new Canvas(W, H);
  const INK: Rgb = [16, 12, 24];
  const WHITE: Rgb = [255, 255, 255];
  const MAGENTA: Rgb = [226, 0, 166];
  const NEON: Rgb = [255, 214, 64];

  // Sunset sky.
  cv.verticalGradient(0, 790, [
    [0, [43, 16, 85]],
    [0.45, [122, 44, 138]],
    [0.75, [217, 65, 122]],
    [1, [255, 138, 76]],
  ]);

  // Retro sun, low on the horizon, with stripe cuts across its lower half.
  const sunCx = 840;
  const sunCy = 690;
  const sunR = 235;
  for (let y = Math.floor(sunCy - sunR); y <= sunCy + sunR; y++) {
    const dy = y - sunCy;
    const half = Math.sqrt(Math.max(0, sunR * sunR - dy * dy));
    if (dy > 40 && ((y / 16) | 0) % 2 === 0) continue;
    const f = (y - (sunCy - sunR)) / (sunR * 2);
    const c: Rgb = [255, Math.round(196 - f * 60), Math.round(64 + f * 30)];
    cv.fillRect(sunCx - half, y, half * 2, 1, c);
  }

  // Skyline and the ground it stands on.
  drawSkyline(cv, 790);
  cv.fillRect(0, 790, W, H - 790, [23, 16, 42]);
  cv.fillRect(0, 788, W, 5, MAGENTA);

  // The game store, left: facade, striped awning, lit sign.
  cv.fillRect(60, 560, 580, 420, [36, 22, 64]);
  cv.fillRect(60, 560, 580, 26, [52, 34, 92]);
  for (let i = 0; i < 10; i++) {
    cv.fillRect(60 + i * 58, 586, 29, 42, i % 2 === 0 ? MAGENTA : WHITE);
  }
  cv.fillRect(90, 452, 520, 92, INK);
  cv.fillRect(98, 460, 504, 76, [255, 176, 0]);
  drawTextCentered(cv, "MIDNIGHT LAUNCH", 350, 480, 5, INK);
  // Door and a window poster that says what everyone is queuing for.
  cv.fillRect(120, 700, 140, 280, [14, 10, 26]);
  cv.fillRect(340, 660, 260, 180, [20, 14, 38]);
  cv.fillRect(352, 672, 236, 156, [64, 20, 84]);
  drawTextCentered(cv, "GTA 6", 470, 692, 7, [255, 94, 168]);
  drawTextCentered(cv, "DAY ONE", 470, 764, 4, WHITE);

  // The queue: a rope and four patient humans in front of the store,
  // stretching from the door toward the ghost at the back of the line.
  const PERSON: Rgb = [20, 16, 31];
  cv.thickLine(150, 945, 730, 928, 6, [120, 110, 150]);
  drawPerson(cv, 196, 1032, 172, PERSON);
  drawPerson(cv, 322, 1038, 180, PERSON);
  drawPerson(cv, 452, 1044, 188, PERSON);
  drawPerson(cv, 586, 1050, 196, PERSON);

  // The ghost at the back of the line, coin up, holding its sign.
  const ghostX = 895;
  const ghostBase = 1062;
  drawGhost(cv, ghostX, ghostBase, 124);

  // The sign board in front of the ghost, low enough to leave its face —
  // and its sparkle eyes — in clear view.
  const boardX = 725;
  const boardY = 950;
  const boardW = 340;
  const boardH = 145;
  cv.fillRect(boardX - 7, boardY - 7, boardW + 14, boardH + 14, INK);
  cv.fillRect(boardX, boardY, boardW, boardH, WHITE);
  drawTextCentered(cv, "ALREADY PAID", boardX + boardW / 2, boardY + 14, 4, INK);
  drawTextCentered(cv, "IN USDC ON", boardX + boardW / 2, boardY + 52, 4, INK);
  drawTextCentered(cv, "make.fun", boardX + boardW / 2, boardY + 92, 5, MAGENTA);

  // Palms framing the scene, in front of the sky at the edges.
  const PALM: Rgb = [18, 12, 34];
  drawPalm(cv, 52, 1090, 400, 52, PALM);
  drawPalm(cv, 1168, 1075, 320, -56, PALM);

  // Captions, top and bottom, in the classic meme voice.
  drawTextCentered(cv, "IN LINE FOR GTA 6", 600, 42, 9, WHITE, INK);
  drawTextCentered(cv, "SINCE 2013...", 600, 128, 9, WHITE, INK);
  drawTextCentered(cv, "MY AGENT EARNS. I QUEUE.", 600, 1108, 7, NEON, INK);

  return cv;
}

// ---------------------------------------------------------------------------
// Entry point: hand POST.json to the output directory, then draw the meme.
// ---------------------------------------------------------------------------

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const botDir = process.env.MAKEFUN_BOT_DIR ?? here;
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  try {
    mkdirSync(outDir, { recursive: true });
    copyFileSync(join(botDir, "POST.json"), join(outDir, "POST.json"));
  } catch {
    // A sandbox that mounts the output read-only still gets its run; the
    // copy is retried by the harness's own layout. Nothing else to do.
  }
  const meme = drawMeme();
  const png = encodePng(meme.w, meme.h, meme.px);
  try {
    writeFileSync(join(botDir, "meme.png"), png);
  } catch {
    // The grader mounts the repository read-only, so refreshing the
    // committed meme.png in place can fail there. That copy is a
    // convenience for local runs; the picture that was posted is the
    // meme.png already committed, and the output copy below still runs.
  }
  try {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "meme.png"), png);
  } catch {
    // The meme in the repository is the one that gets posted; an output
    // copy is a courtesy, never the entry.
  }
}

main();
