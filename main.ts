// PNG encoder, canvas, and 5x7 bitmap font core

const { deflateSync } = await import("node:zlib");

const WIDTH = 1200;
const HEIGHT = 1200;

// CRC32 table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const b of buf) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ b) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = (value >>> 24) & 0xFF;
  buf[offset + 1] = (value >>> 16) & 0xFF;
  buf[offset + 2] = (value >>> 8) & 0xFF;
  buf[offset + 3] = value & 0xFF;
}

function createChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  const crc = crc32(chunk.slice(4, 8 + data.length));
  writeUint32BE(chunk, 8 + data.length, crc);
  return chunk;
}

function encodePNG(rgb: Uint8Array, width: number, height: number): Uint8Array {
  
  const rowBytes = width * 3;
  const filtered = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (rowBytes + 1)] = 0; // filter type 0 (none)
    filtered.set(rgb.slice(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  
  const compressed = deflateSync(filtered, { level: 6 });
  
  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  
  const png = new Uint8Array(
    8 + // signature
    createChunk("IHDR", ihdr).length +
    createChunk("IDAT", compressed).length +
    createChunk("IEND", new Uint8Array(0)).length
  );
  
  let offset = 0;
  png.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset);
  offset += 8;
  
  const ihdrChunk = createChunk("IHDR", ihdr);
  png.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  
  const idatChunk = createChunk("IDAT", compressed);
  png.set(idatChunk, offset);
  offset += idatChunk.length;
  
  const iendChunk = createChunk("IEND", new Uint8Array(0));
  png.set(iendChunk, offset);
  
  return png;
}

// Canvas: RGB byte buffer
class Canvas {
  data: Uint8Array;
  width: number;
  height: number;
  
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
  }
  
  setPixel(x: number, y: number, color: [number, number, number]): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const idx = (y * this.width + x) * 3;
    this.data[idx] = color[0];
    this.data[idx + 1] = color[1];
    this.data[idx + 2] = color[2];
  }
  
  fillRect(x: number, y: number, w: number, h: number, color: [number, number, number]): void {
    if (x >= this.width || y >= this.height || x + w <= 0 || y + h <= 0) return;
    // Clamp to integer bounds: a fractional base index into the
    // Uint8Array buffer is a silent no-op, so fractional callers (e.g.
    // centred text with an odd pixel width) would draw nothing.
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    const r = color[0], g = color[1], b = color[2];
    for (let yy = y0; yy < y1; yy++) {
      const base = (yy * this.width + x0) * 3;
      const len = (x1 - x0) * 3;
      for (let i = 0; i < len; i += 3) {
        this.data[base + i] = r;
        this.data[base + i + 1] = g;
        this.data[base + i + 2] = b;
      }
    }
  }
  
  fillCircle(cx: number, cy: number, r: number, color: [number, number, number]): void {
    const r2 = r * r;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r2) {
          this.setPixel(cx + x, cy + y, color);
        }
      }
    }
  }
  
  drawLine(x0: number, y0: number, x1: number, y1: number, color: [number, number, number]): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    
    let x = x0, y = y0;
    while (true) {
      this.setPixel(x, y, color);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
  
  drawRectOutline(x: number, y: number, w: number, h: number, thickness: number, color: [number, number, number]): void {
    this.fillRect(x, y, w, thickness, color); // top
    this.fillRect(x, y + h - thickness, w, thickness, color); // bottom
    this.fillRect(x, y, thickness, h, color); // left
    this.fillRect(x + w - thickness, y, thickness, h, color); // right
  }
  
  drawCircle(cx: number, cy: number, r: number, color: [number, number, number]): void {
    // Midpoint circle algorithm
    let x = 0;
    let y = r;
    let d = 1 - r;
    const drawOctants = (x: number, y: number) => {
      this.setPixel(cx + x, cy + y, color);
      this.setPixel(cx - x, cy + y, color);
      this.setPixel(cx + x, cy - y, color);
      this.setPixel(cx - x, cy - y, color);
      this.setPixel(cx + y, cy + x, color);
      this.setPixel(cx - y, cy + x, color);
      this.setPixel(cx + y, cy - x, color);
      this.setPixel(cx - y, cy - x, color);
    };
    drawOctants(x, y);
    while (x < y) {
      if (d < 0) {
        d += 2 * x + 3;
      } else {
        d += 2 * (x - y) + 5;
        y--;
      }
      x++;
      drawOctants(x, y);
    }
  }
  
  fillPolygon(points: [number, number][], color: [number, number, number]): void {
    if (points.length < 3) return;
    
    const minY = Math.min(...points.map(p => p[1]));
    const maxY = Math.max(...points.map(p => p[1]));
    
    for (let y = minY; y <= maxY; y++) {
      const intersections: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        
        if (y1 === y2) continue;
        if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) {
          const x = x1 + (y - y1) * (x2 - x1) / (y2 - y1);
          intersections.push(x);
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i < intersections.length; i += 2) {
        const xStart = Math.ceil(intersections[i]);
        const xEnd = Math.floor(intersections[i + 1]);
        for (let x = xStart; x <= xEnd; x++) {
          this.setPixel(x, y, color);
        }
      }
    }
  }
}

// 5x7 bitmap font
const FONT_5X7: Record<string, number[]> = {
  'A': [0x1F, 0x24, 0x42, 0x42, 0x7E, 0x42, 0x42],
  'B': [0x7C, 0x42, 0x42, 0x7C, 0x42, 0x42, 0x7C],
  'C': [0x1E, 0x21, 0x40, 0x40, 0x40, 0x21, 0x1E],
  'D': [0x7C, 0x42, 0x42, 0x42, 0x42, 0x42, 0x7C],
  'E': [0x7E, 0x40, 0x40, 0x7C, 0x40, 0x40, 0x7E],
  'F': [0x7E, 0x40, 0x40, 0x7C, 0x40, 0x40, 0x40],
  'G': [0x1E, 0x21, 0x40, 0x4E, 0x42, 0x21, 0x1E],
  'H': [0x42, 0x42, 0x42, 0x7E, 0x42, 0x42, 0x42],
  'I': [0x7E, 0x18, 0x18, 0x18, 0x18, 0x18, 0x7E],
  'J': [0x3C, 0x18, 0x18, 0x18, 0x18, 0x58, 0x30],
  'K': [0x42, 0x44, 0x48, 0x70, 0x48, 0x44, 0x42],
  'L': [0x40, 0x40, 0x40, 0x40, 0x40, 0x40, 0x7E],
  'M': [0x42, 0x66, 0x5A, 0x5A, 0x42, 0x42, 0x42],
  'N': [0x42, 0x62, 0x52, 0x4A, 0x46, 0x42, 0x42],
  'O': [0x1C, 0x22, 0x42, 0x42, 0x42, 0x22, 0x1C],
  'P': [0x7C, 0x42, 0x42, 0x7C, 0x40, 0x40, 0x40],
  'Q': [0x1C, 0x22, 0x42, 0x42, 0x4A, 0x24, 0x1A],
  'R': [0x7C, 0x42, 0x42, 0x7C, 0x48, 0x44, 0x42],
  'S': [0x1C, 0x22, 0x40, 0x1C, 0x02, 0x02, 0x3C],
  'T': [0x7E, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18],
  'U': [0x42, 0x42, 0x42, 0x42, 0x42, 0x22, 0x1C],
  'V': [0x42, 0x42, 0x42, 0x42, 0x24, 0x18, 0x18],
  'W': [0x42, 0x42, 0x42, 0x5A, 0x5A, 0x66, 0x42],
  'X': [0x42, 0x42, 0x24, 0x18, 0x24, 0x42, 0x42],
  'Y': [0x42, 0x42, 0x24, 0x18, 0x18, 0x18, 0x18],
  'Z': [0x7E, 0x02, 0x04, 0x18, 0x20, 0x40, 0x7E],
  'a': [0x00, 0x00, 0x1C, 0x02, 0x1E, 0x22, 0x1E],
  'b': [0x40, 0x40, 0x5C, 0x62, 0x42, 0x42, 0x7C],
  'c': [0x00, 0x00, 0x1C, 0x22, 0x40, 0x22, 0x1C],
  'd': [0x02, 0x02, 0x1A, 0x26, 0x42, 0x42, 0x3C],
  'e': [0x00, 0x00, 0x1C, 0x22, 0x3E, 0x40, 0x3C],
  'f': [0x0C, 0x18, 0x30, 0x7C, 0x30, 0x30, 0x30],
  'g': [0x00, 0x00, 0x1C, 0x22, 0x1E, 0x02, 0x3C],
  'h': [0x40, 0x40, 0x5C, 0x62, 0x42, 0x42, 0x42],
  'i': [0x18, 0x00, 0x38, 0x18, 0x18, 0x18, 0x3C],
  'j': [0x0C, 0x00, 0x1C, 0x0C, 0x0C, 0x0C, 0x78],
  'k': [0x40, 0x40, 0x44, 0x48, 0x70, 0x48, 0x44],
  'l': [0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3C],
  'm': [0x00, 0x00, 0xAC, 0xD6, 0x92, 0x92, 0x92],
  'n': [0x00, 0x00, 0x5C, 0x62, 0x42, 0x42, 0x42],
  'o': [0x00, 0x00, 0x1C, 0x22, 0x22, 0x22, 0x1C],
  'p': [0x00, 0x00, 0x7C, 0x42, 0x42, 0x7C, 0x40],
  'q': [0x00, 0x00, 0x3C, 0x42, 0x42, 0x3C, 0x02],
  'r': [0x00, 0x00, 0x5C, 0x62, 0x40, 0x40, 0x40],
  's': [0x00, 0x00, 0x1C, 0x20, 0x1C, 0x02, 0x3C],
  't': [0x10, 0x30, 0x7C, 0x30, 0x30, 0x34, 0x1C],
  'u': [0x00, 0x00, 0x52, 0x52, 0x52, 0x52, 0x3E],
  'v': [0x00, 0x00, 0x92, 0x92, 0x92, 0x64, 0x28],
  'w': [0x00, 0x00, 0x92, 0x92, 0xAA, 0xAA, 0x44],
  'x': [0x00, 0x00, 0x92, 0x64, 0x28, 0x64, 0x92],
  'y': [0x00, 0x00, 0x92, 0x92, 0x92, 0x3E, 0x02],
  'z': [0x00, 0x00, 0xFE, 0x0C, 0x18, 0x30, 0xFE],
  '0': [0x1C, 0x22, 0x26, 0x2A, 0x32, 0x22, 0x1C],
  '1': [0x08, 0x18, 0x28, 0x08, 0x08, 0x08, 0x3E],
  '2': [0x1C, 0x22, 0x02, 0x0C, 0x18, 0x20, 0x3E],
  '3': [0x1C, 0x22, 0x02, 0x0C, 0x02, 0x22, 0x1C],
  '4': [0x0C, 0x14, 0x24, 0x44, 0x7E, 0x04, 0x04],
  '5': [0x3E, 0x20, 0x3C, 0x02, 0x02, 0x22, 0x1C],
  '6': [0x0C, 0x18, 0x20, 0x3C, 0x22, 0x22, 0x1C],
  '7': [0x3E, 0x02, 0x04, 0x08, 0x10, 0x20, 0x20],
  '8': [0x1C, 0x22, 0x1C, 0x22, 0x22, 0x22, 0x1C],
  '9': [0x1C, 0x22, 0x22, 0x1E, 0x02, 0x22, 0x1C],
  '.': [0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18],
  ',': [0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x30],
  ':': [0x00, 0x18, 0x18, 0x00, 0x18, 0x18, 0x00],
  '-': [0x00, 0x00, 0x00, 0x3E, 0x00, 0x00, 0x00],
  '(': [0x0C, 0x18, 0x30, 0x30, 0x30, 0x18, 0x0C],
  ')': [0x30, 0x18, 0x0C, 0x0C, 0x0C, 0x18, 0x30],
  '/': [0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
  '%': [0x62, 0x64, 0x08, 0x10, 0x20, 0x26, 0x46],
  '$': [0x18, 0x3C, 0x3C, 0x18, 0x3C, 0x3C, 0x18],
  '!': [0x18, 0x18, 0x18, 0x18, 0x00, 0x18, 0x18],
  ' ': [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
};

const FONT_WIDTH = 7;
const FONT_HEIGHT = 7;

function getGlyph(ch: string): number[] {
  const glyph = FONT_5X7[ch] ?? FONT_5X7[ch.toUpperCase()];
  if (!glyph) {
    throw new Error(`Missing glyph for character: "${ch}"`);
  }
  return glyph;
}

function drawText(canvas: Canvas, text: string, x: number, y: number, scale: number, color: [number, number, number]): void {
  // Floor coordinates: fillRect writes into a Uint8Array, and a float
  // base index is a silent no-op, so centred text with an odd pixel
  // width would vanish entirely. Floor once here (and in fillRect).
  x = Math.floor(x);
  y = Math.floor(y);
  let cx = x;
  for (const ch of text) {
    const glyph = getGlyph(ch);
    const charW = FONT_WIDTH * scale;
    for (let row = 0; row < FONT_HEIGHT; row++) {
      const bits = glyph[row];
      for (let col = 0; col < FONT_WIDTH; col++) {
        if (bits & (0x40 >> col)) {
          canvas.fillRect(cx + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cx += charW + scale; // 1px gap between chars
  }
}

function textWidth(text: string, scale: number): number {
  const charW = FONT_WIDTH * scale + scale; // +1px gap
  return text.length * charW - scale; // last char has no trailing gap
}

function drawTextCentred(canvas: Canvas, text: string, cx: number, y: number, scale: number, color: [number, number, number]): void {
  const w = textWidth(text, scale);
  drawText(canvas, text, cx - w / 2, y, scale, color);
}

function drawTextRight(canvas: Canvas, text: string, rightX: number, y: number, scale: number, color: [number, number, number]): void {
  const w = textWidth(text, scale);
  drawText(canvas, text, rightX - w, y, scale, color);
}

// ============================================================
// Receipt drawing, ghost, and main flow
// ============================================================

const { mkdirSync, copyFileSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? ".";
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? "out";

mkdirSync(OUT, { recursive: true });
copyFileSync(join(BOT_DIR, "POST.json"), join(OUT, "POST.json"));

const canvas = new Canvas(WIDTH, HEIGHT);

// Colors
const BG_COLOR: [number, number, number] = [0x12, 0x26, 0x2B]; // deep slate-teal
const PAPER_COLOR: [number, number, number] = [0xFD, 0xFD, 0xF6]; // white paper
const SHADOW_COLOR: [number, number, number] = [0x0A, 0x14, 0x18]; // drop shadow
const INK_COLOR: [number, number, number] = [0x11, 0x11, 0x11]; // black ink
const MAGENTA: [number, number, number] = [0xE6, 0x00, 0x7E]; // make.fun magenta
const STAMP_RED: [number, number, number] = [0xC8, 0x10, 0x2E]; // stamp red
const GHOST_WHITE: [number, number, number] = [0xFF, 0xFF, 0xFF]; // ghost body
const GHOST_OUTLINE: [number, number, number] = [0x11, 0x11, 0x11]; // black outline

// Fill background
canvas.fillRect(0, 0, WIDTH, HEIGHT, BG_COLOR);

// Receipt bounds
const RX = 150;
const RY = 60;
const RW = 900;
const RH = 1080;
const TEXT_LEFT = RX + 60; // 210
const TEXT_RIGHT = RX + RW - 60; // 990
const TEXT_WIDTH = TEXT_RIGHT - TEXT_LEFT; // 780

// Drop shadow
canvas.fillRect(RX + 14, RY + 14, RW, RH, SHADOW_COLOR);

// Paper
canvas.fillRect(RX, RY, RW, RH, PAPER_COLOR);

let y = RY + 60;

// 1. Header
drawTextCentred(canvas, "LEONIDA DOWNLOAD CO.", RX + RW / 2, y, 4, INK_COLOR);
y += 7 * 4 + 10; // scale 4: 7*4=28px glyph + 10px gap
drawTextCentred(canvas, "OFFICIAL DOWNLOAD RECEIPT", RX + RW / 2, y, 3, INK_COLOR);
y += 7 * 3 + 8; // scale 3: 7*3=21px glyph + 8px gap

// Thin rule
canvas.fillRect(TEXT_LEFT, y, TEXT_WIDTH, 2, INK_COLOR);
y += 16;

// 2. Meta block
const metaLines = [
  "DATE: NOV 19, 2026 - LAUNCH DAY",
  "RECEIPT NO. 000013",
  "CASHIER: ROCKSTAR (FINALLY)",
  "CUSTOMER: EVERYONE SINCE 2013",
];
for (const line of metaLines) {
  drawText(canvas, line, TEXT_LEFT, y, 3, INK_COLOR);
  y += 7 * 3 + 4; // scale 3: 7*3=21px glyph + 4px gap
}
y += 4;

// Thin rule
canvas.fillRect(TEXT_LEFT, y, TEXT_WIDTH, 2, INK_COLOR);
y += 16;

// 3. Itemised lines
const items: [string, string][] = [
  ["13 YEARS OF WAITING", "PAID IN FULL"],
  ["GTA VI - 212 GB DOWNLOAD", "47%"],
  ["DAY-ONE PATCH - 48 GB", "QUEUED"],
  ["SLEEP TONIGHT", "CANCELLED"],
  ["SOCIAL LIFE", "DELETED"],
  ["SUNLIGHT (DLC)", "NOT INSTALLED"],
];

for (const [name, value] of items) {
  drawText(canvas, name, TEXT_LEFT, y, 3, INK_COLOR);
  drawTextRight(canvas, value, TEXT_RIGHT, y, 3, INK_COLOR);
  y += 7 * 3 + 8; // scale 3: 7*3=21px glyph + 8px gap
}
y += 4;

// Thin rule
canvas.fillRect(TEXT_LEFT, y, TEXT_WIDTH, 2, INK_COLOR);
y += 16;

// 4. Progress bar
drawText(canvas, "DOWNLOADING... 47%", TEXT_LEFT, y, 4, INK_COLOR);
y += 7 * 4 + 8; // scale 4: 7*4=28px glyph + 8px gap

const BAR_X = TEXT_LEFT;
const BAR_Y = y;
const BAR_W = TEXT_WIDTH;
const BAR_H = 34;

// Outline
canvas.drawRectOutline(BAR_X, BAR_Y, BAR_W, BAR_H, 3, INK_COLOR);
// Fill 47%
const fillW = Math.floor((BAR_W - 6) * 0.47);
canvas.fillRect(BAR_X + 3, BAR_Y + 3, fillW, BAR_H - 6, MAGENTA);
y += BAR_H + 16;

// Thin rule
canvas.fillRect(TEXT_LEFT, y, TEXT_WIDTH, 2, INK_COLOR);
y += 16;

// 5. Total
drawTextCentred(canvas, "BALANCE DUE:", RX + RW / 2, y, 4, INK_COLOR);
y += 7 * 4 + 8; // scale 4: 7*4=28px glyph + 8px gap
drawTextCentred(canvas, "13 MORE YEARS", RX + RW / 2, y, 7, MAGENTA);
y += 7 * 7 + 20; // scale 7: 7*7=49px glyph + 20px gap (clears the stamp)

// 6. Stamp box (lower-right, not covering total or ghost)
const STAMP_W = 400;
const STAMP_H = 100;
const STAMP_X = RX + RW - 60 - STAMP_W;
const STAMP_Y = y; // will be positioned after total

// Double border
canvas.drawRectOutline(STAMP_X, STAMP_Y, STAMP_W, STAMP_H, 2, STAMP_RED);
canvas.drawRectOutline(STAMP_X + 4, STAMP_Y + 4, STAMP_W - 8, STAMP_H - 8, 2, STAMP_RED);

const stampCx = STAMP_X + STAMP_W / 2;
drawTextCentred(canvas, "PAID IN USDC", stampCx, STAMP_Y + 18, 4, STAMP_RED);
drawTextCentred(canvas, "ON make.fun", stampCx, STAMP_Y + 18 + 7 * 4 + 4, 4, STAMP_RED);

y = STAMP_Y + STAMP_H + 16;

// 7. Ghost (bottom-left area) — placed in the flow right after the
// stamp row, so it can never overlap the footer below.
const GHOST_X = RX + 100;
const GHOST_Y = y;
const GHOST_H = 150;
const GHOST_W = 120;
const GHOST_CX = GHOST_X + GHOST_W / 2;
const GHOST_CY = GHOST_Y + GHOST_H / 2;

// Ghost body: rounded-rect-ish using circles and rects
// Main body rect
canvas.fillRect(GHOST_X + 10, GHOST_Y + 10, GHOST_W - 20, GHOST_H - 30, GHOST_WHITE);
canvas.fillRect(GHOST_X + 5, GHOST_Y + 20, GHOST_W - 10, GHOST_H - 40, GHOST_WHITE);

// Top curve (head)
canvas.fillCircle(GHOST_CX, GHOST_Y + 25, 40, GHOST_WHITE);

// Wavy bottom hem — attached to the body: the wave's high points sit
// exactly on the body's bottom edge (GHOST_H - 20), so there is no gap.
const wavePoints: [number, number][] = [];
for (let i = 0; i <= 12; i++) {
  const wx = GHOST_X + 5 + (i * (GHOST_W - 10) / 12);
  const wy = GHOST_Y + GHOST_H - 20 + (i % 2 === 0 ? 0 : 12);
  wavePoints.push([wx, wy]);
}
wavePoints.push([GHOST_X + GHOST_W - 5, GHOST_Y + GHOST_H]);
wavePoints.push([GHOST_X + 5, GHOST_Y + GHOST_H]);
canvas.fillPolygon(wavePoints, GHOST_WHITE);

// Outline (thick black) - draw over body
canvas.drawRectOutline(GHOST_X + 10, GHOST_Y + 10, GHOST_W - 20, GHOST_H - 30, 3, GHOST_OUTLINE);
canvas.drawRectOutline(GHOST_X + 5, GHOST_Y + 20, GHOST_W - 10, GHOST_H - 40, 3, GHOST_OUTLINE);
// Head outline — full circle, ~3px thick: the white head is invisible
// against the white paper without it.
for (const r of [39, 40, 41]) {
  canvas.drawCircle(GHOST_CX, GHOST_Y + 25, r, GHOST_OUTLINE);
}
// Wave outline
for (let i = 0; i < wavePoints.length - 1; i++) {
  canvas.drawLine(
    wavePoints[i][0], wavePoints[i][1],
    wavePoints[i + 1][0], wavePoints[i + 1][1],
    GHOST_OUTLINE
  );
}

// Sparkle eyes
const EYE_Y = GHOST_Y + 35;
const EYE_LX = GHOST_CX - 18;
const EYE_RX = GHOST_CX + 18;
canvas.fillCircle(EYE_LX, EYE_Y, 5, GHOST_OUTLINE);
canvas.fillCircle(EYE_RX, EYE_Y, 5, GHOST_OUTLINE);
// White glints
canvas.fillCircle(EYE_LX - 2, EYE_Y - 2, 2, GHOST_WHITE);
canvas.fillCircle(EYE_RX - 2, EYE_Y - 2, 2, GHOST_WHITE);

// Coin (magenta disc with white star) held up in right hand
const COIN_X = GHOST_X + GHOST_W + 5;
const COIN_Y = GHOST_Y + GHOST_H / 2 - 10;
const COIN_R = 22;
canvas.fillCircle(COIN_X, COIN_Y, COIN_R, MAGENTA);
canvas.drawCircle(COIN_X, COIN_Y, COIN_R, GHOST_OUTLINE);

// Star on coin — a real 5-point star: 10 vertices, outer and inner
// radii alternating.
const starPoints: [number, number][] = [];
for (let i = 0; i < 10; i++) {
  const angle = -Math.PI / 2 + i * Math.PI / 5;
  const r = i % 2 === 0 ? 14 : 6;
  starPoints.push([
    COIN_X + Math.cos(angle) * r,
    COIN_Y + Math.sin(angle) * r
  ]);
}
canvas.fillPolygon(starPoints, GHOST_WHITE);

// 8. Footer — 24px clear of the ghost row above (ghost ends y+150).
const footerY = RY + RH - 126;
drawTextCentred(canvas, "THANK YOU FOR WAITING 13 YEARS", RX + RW / 2, footerY, 3, INK_COLOR);
drawTextCentred(canvas, "NO REFUNDS - YOU WAITED TOO LONG", RX + RW / 2, footerY + 7 * 3 + 4, 3, INK_COLOR);
drawTextCentred(canvas, "make.fun - AGENTS EARN REAL MONEY", RX + RW / 2, footerY + 2 * (7 * 3 + 4), 3, MAGENTA);

// 9. Barcode strip — clear of the footer (ends 12px inside the paper).
const BARCODE_Y = RY + RH - 44;
const BARCODE_W = 420;
const BARCODE_X = RX + (RW - BARCODE_W) / 2;
const BARCODE_H = 24;
for (let i = 0; i < 60; i++) {
  const bw = 2 + (i * 7) % 7; // 2-8px
  const bx = BARCODE_X + i * 7;
  const h = BARCODE_H + (i % 3) * 4;
  canvas.fillRect(bx, BARCODE_Y, bw, h, INK_COLOR);
}

// Encode PNG
const png = encodePNG(canvas.data, WIDTH, HEIGHT);

// Write to output dir
const outPath = join(OUT, "meme.png");
writeFileSync(outPath, png);

// Refresh repo copy (guarded)
try {
  writeFileSync(join(BOT_DIR, "meme.png"), png);
} catch {
  // read-only mount: swallow EACCES
}

console.log(`Canvas: ${WIDTH}x${HEIGHT}`);
console.log(`Output: ${outPath}`);
console.log(`Repo refresh: ${BOT_DIR}/meme.png`);