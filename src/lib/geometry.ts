import type { CropRect, RawImage } from "./image-utils";
import { premultiply, unpremultiply, sampleBilinear, sampleBicubic } from "./resample";

/**
 * Geometric operations: flips, quarter turns, cropping, free rotation.
 *
 * Flips and quarter turns are pure index permutations — every source pixel
 * lands exactly in one destination pixel (lossless).
 *
 * Free rotation uses INVERSE MAPPING like the resampler: for each destination
 * pixel we rotate its coordinate back into source space
 *
 *     [sx]   [ cosθ  sinθ ] [x − cx]   [sw/2]
 *     [sy] = [−sinθ  cosθ ] [y − cy] + [sh/2]
 *
 * and interpolate (bilinear or bicubic). Outside pixels take the fill color.
 */

/** Rotate 90° clockwise (pure index remap: dst(x,y) = src(y, H−1−x)). */
export function rotate90(src: RawImage): RawImage {
  const { width: w, height: h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = h - 1 - y;
      const dy = x;
      const si = (y * w + x) * 4;
      const di = (dy * h + dx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: h, height: w };
}

/** Rotate by `quarter` × 90° clockwise (1..3). */
export function rotateQuarter(src: RawImage, quarter: number): RawImage {
  let img = src;
  const q = ((quarter % 4) + 4) % 4;
  for (let i = 0; i < q; i++) img = rotate90(img);
  return img;
}

export function flipHorizontal(src: RawImage): RawImage {
  const { width: w, height: h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (y * w + (w - 1 - x)) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { data: out, width: w, height: h };
}

export function flipVertical(src: RawImage): RawImage {
  const { width: w, height: h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    const dstRow = y * w * 4;
    out.set(data.subarray(srcRow, srcRow + w * 4), dstRow);
  }
  return { data: out, width: w, height: h };
}

/** Copy a rectangular region (clamped to the image bounds). */
export function cropImage(src: RawImage, rect: CropRect): RawImage {
  const x = Math.max(0, Math.min(rect.x, src.width - 1));
  const y = Math.max(0, Math.min(rect.y, src.height - 1));
  const w = Math.max(1, Math.min(rect.w, src.width - x));
  const h = Math.max(1, Math.min(rect.h, src.height - y));

  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcOff = ((y + row) * src.width + x) * 4;
    out.set(src.data.subarray(srcOff, srcOff + w * 4), row * w * 4);
  }
  return { data: out, width: w, height: h };
}

export interface RotateOptions {
  /** Degrees clockwise, any real number. */
  angle: number;
  /** Interpolation for the inverse mapping. */
  method: "bilinear" | "bicubic";
  /** Fill color RGBA for pixels sampled outside the source. */
  fill: [number, number, number, number];
}

/**
 * Rotate by any angle. Output is sized to the rotated bounding box, so a 30°
 * rotation of a 400×300 image yields a larger canvas with the corners filled.
 */
export function rotateFree(src: RawImage, opts: RotateOptions): RawImage {
  const { width: sw, height: sh } = src;
  const theta = (opts.angle * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Rotated bounding box: project the four corners
  const corners = [
    [(-sw / 2) * cos - (-sh / 2) * sin, (-sw / 2) * sin + (-sh / 2) * cos],
    [(sw / 2) * cos - (-sh / 2) * sin, (sw / 2) * sin + (-sh / 2) * cos],
    [(sw / 2) * cos - (sh / 2) * sin, (sw / 2) * sin + (sh / 2) * cos],
    [(-sw / 2) * cos - (sh / 2) * sin, (-sw / 2) * sin + (sh / 2) * cos],
  ];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [px, py] of corners) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const dw = Math.max(1, Math.round(maxX - minX));
  const dh = Math.max(1, Math.round(maxY - minY));

  const prem = premultiply(src.data);
  const out = new Float32Array(dw * dh * 4);
  const sample = new Float32Array(4);
  const [fr, fg, fb, fa] = opts.fill;
  const useBicubic = opts.method === "bicubic";

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const px = x - dw / 2;
      const py = y - dh / 2;
      // Inverse rotation (by −θ) into source space
      const sx = px * cos + py * sin + sw / 2;
      const sy = -px * sin + py * cos + sh / 2;

      const o = (y * dw + x) * 4;
      if (sx < -1 || sx > sw || sy < -1 || sy > sh) {
        out[o] = fr;
        out[o + 1] = fg;
        out[o + 2] = fb;
        out[o + 3] = fa;
      } else {
        if (useBicubic) sampleBicubic(prem, sw, sh, sx, sy, sample);
        else sampleBilinear(prem, sw, sh, sx, sy, sample);
        out[o] = sample[0];
        out[o + 1] = sample[1];
        out[o + 2] = sample[2];
        out[o + 3] = sample[3];
      }
    }
  }

  return { data: unpremultiply(out), width: dw, height: dh };
}
