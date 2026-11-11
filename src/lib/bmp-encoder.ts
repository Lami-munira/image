/**
 * Minimal 24-bit uncompressed BMP encoder.
 *
 * Why hand-rolled: browsers do NOT support `canvas.toBlob(cb, "image/bmp")`
 * (Chrome/Firefox/Safari silently fall back to PNG). The old export path
 * claimed BMP support but produced mislabeled PNG bytes.
 *
 * BMP files store rows bottom-up and BGR, padded to 4-byte boundaries.
 * 24-bit BMP has no alpha channel, so transparency is composited over
 * `background`.
 */

export interface BgColor {
  r: number;
  g: number;
  b: number;
}

/** Parse any CSS color (#rgb, #rrggbb, rgb(), names) into RGB. Falls back to white. */
export function parseBgColor(css: string): BgColor {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  const ctx = canvas?.getContext("2d");
  if (ctx) {
    ctx.fillStyle = css;
    const v = ctx.fillStyle; // normalized to "#rrggbb" or rgba()
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) {
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    const rgba = /^rgba?\(([^)]+)\)$/i.exec(v);
    if (rgba) {
      const parts = rgba[1].split(",").map((s) => parseFloat(s));
      return { r: parts[0] | 0, g: parts[1] | 0, b: parts[2] | 0 };
    }
  }
  return { r: 255, g: 255, b: 255 };
}

export function encodeBmp(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  backgroundCss = "#ffffff"
): ArrayBuffer {
  const bg = parseBgColor(backgroundCss);

  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const rowSize = rowBytes + padding;
  const pixelSize = rowSize * height;
  const headerSize = 14 + 40; // BITMAPFILEHEADER + BITMAPINFOHEADER
  const total = headerSize + pixelSize;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // --- BITMAPFILEHEADER ---
  bytes[0] = 0x42; // 'B'
  bytes[1] = 0x4d; // 'M'
  view.setUint32(2, total, true); // bfSize
  view.setUint16(10, headerSize, true); // bfOffBits

  // --- BITMAPINFOHEADER ---
  view.setUint32(14, 40, true); // biSize
  view.setInt32(18, width, true); // biWidth
  view.setInt32(22, height, true); // biHeight (positive = bottom-up rows)
  view.setUint16(26, 1, true); // biPlanes
  view.setUint16(28, 24, true); // biBitCount
  view.setUint32(30, 0, true); // biCompression = BI_RGB
  view.setUint32(34, pixelSize, true); // biSizeImage
  view.setUint32(38, 2835, true); // biXPelsPerMeter (72 DPI)
  view.setUint32(42, 2835, true); // biYPelsPerMeter

  // --- Pixels, bottom-up, BGR, alpha composited over background ---
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y; // bottom-up
    let off = headerSize + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (srcY * width + x) * 4;
      const a = data[i + 3] / 255;
      const inv = 1 - a;
      bytes[off++] = Math.round(data[i + 2] * a + bg.b * inv);
      bytes[off++] = Math.round(data[i + 1] * a + bg.g * inv);
      bytes[off++] = Math.round(data[i] * a + bg.r * inv);
    }
  }

  return buf;
}
