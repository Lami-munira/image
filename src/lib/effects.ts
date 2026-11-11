import type { RawImage } from "./image-utils";

/**
 * Gaussian blur — the classic neighborhood operation g = Σ wᵢ · f(x+i).
 *
 * The 2-D Gaussian G(x,y) = e^(−(x²+y²)/2σ²) / (2πσ²) is SEPARABLE:
 * G(x,y) = g(x)·g(y), so instead of one 2-D convolution we run two cheap
 * 1-D passes (horizontal then vertical) with the 1-D kernel
 *
 *     g(x) = e^(−x²/2σ²),  radius = ⌈3σ⌉  (covers 99.7% of the weight)
 *
 * normalized so Σg = 1.
 *
 * Memory note: passes run on PREMULTIPLIED 8-bit intermediates (the same
 * precision browser canvas filters use) instead of Float32 — on a 24 MP image
 * that keeps the working set near ~300 MB instead of ~1.2 GB, which would
 * otherwise throw on allocation inside the worker. Applied on premultiplied
 * alpha either way so edges composite correctly.
 */

/** straight RGBA bytes → premultiplied RGBA bytes */
function premultiply8(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    out[i] = data[i] * a;
    out[i + 1] = data[i + 1] * a;
    out[i + 2] = data[i + 2] * a;
    out[i + 3] = data[i + 3];
  }
  return out;
}

/** premultiplied RGBA bytes → straight RGBA bytes */
function unpremultiply8(px: Uint8ClampedArray): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a > 0) {
      const f = 255 / a;
      out[i] = px[i] * f;
      out[i + 1] = px[i + 1] * f;
      out[i + 2] = px[i + 2] * f;
    }
    out[i + 3] = a;
  }
  return out;
}

/** 1-D convolution of an RGBA byte buffer along one axis (clamp-to-edge). */
function convolve1D(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: Float32Array,
  radius: number,
  horizontal: boolean
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const n = kernel.length;

  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0;
        for (let k = 0; k < n; k++) {
          let sx = x + k - radius;
          if (sx < 0) sx = 0;
          else if (sx >= width) sx = width - 1;
          const i = row + sx * 4;
          const w = kernel[k];
          r += w * src[i];
          g += w * src[i + 1];
          b += w * src[i + 2];
          a += w * src[i + 3];
        }
        const o = row + x * 4;
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = a;
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const outRow = y * width * 4;
      for (let k = 0; k < n; k++) {
        let sy = y + k - radius;
        if (sy < 0) sy = 0;
        else if (sy >= height) sy = height - 1;
        const srcRow = sy * width * 4;
        const w = kernel[k];
        for (let x = 0; x < width; x++) {
          const i = srcRow + x * 4;
          const o = outRow + x * 4;
          out[o] += w * src[i];
          out[o + 1] += w * src[i + 1];
          out[o + 2] += w * src[i + 2];
          out[o + 3] += w * src[i + 3];
        }
      }
    }
  }
  return out;
}

/**
 * Sliding-window box average of `src` into `dst` along one axis — O(1) per
 * pixel regardless of radius. Three stacked passes approximate a Gaussian.
 */
function boxBlurAxis(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean
): void {
  const div = 2 * radius + 1;
  if (horizontal) {
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      let ar = 0,
        ag = 0,
        ab = 0,
        aa = 0;
      for (let x = -radius; x <= radius; x++) {
        const i = row + Math.min(width - 1, Math.max(0, x)) * 4;
        ar += src[i];
        ag += src[i + 1];
        ab += src[i + 2];
        aa += src[i + 3];
      }
      for (let x = 0; x < width; x++) {
        const o = row + x * 4;
        dst[o] = ar / div;
        dst[o + 1] = ag / div;
        dst[o + 2] = ab / div;
        dst[o + 3] = aa / div;
        const addI = row + Math.min(width - 1, x + radius + 1) * 4;
        const subI = row + Math.max(0, x - radius) * 4;
        ar += src[addI] - src[subI];
        ag += src[addI + 1] - src[subI + 1];
        ab += src[addI + 2] - src[subI + 2];
        aa += src[addI + 3] - src[subI + 3];
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      const col = x * 4;
      let ar = 0,
        ag = 0,
        ab = 0,
        aa = 0;
      for (let y = -radius; y <= radius; y++) {
        const i = col + Math.min(height - 1, Math.max(0, y)) * width * 4;
        ar += src[i];
        ag += src[i + 1];
        ab += src[i + 2];
        aa += src[i + 3];
      }
      for (let y = 0; y < height; y++) {
        const o = col + y * width * 4;
        dst[o] = ar / div;
        dst[o + 1] = ag / div;
        dst[o + 2] = ab / div;
        dst[o + 3] = aa / div;
        const addI = col + Math.min(height - 1, y + radius + 1) * width * 4;
        const subI = col + Math.max(0, y - radius) * width * 4;
        ar += src[addI] - src[subI];
        ag += src[addI + 1] - src[subI + 1];
        ab += src[addI + 2] - src[subI + 2];
        aa += src[addI + 3] - src[subI + 3];
      }
    }
  }
}

/** Radii of 3 box filters approximating a Gaussian of `sigma` (Kutskir/W3C). */
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(((i < m ? wl : wu) - 1) / 2);
  return sizes;
}

/** Exact kernel (coursework path) vs box approximation, by estimated cost. */
const EXACT_COST_BUDGET = 400_000_000; // ≈ multiply-adds; ~0.5–1 s in the worker

/**
 * Blur `src` with a Gaussian of standard deviation `sigma` (pixels).
 * sigma = 0 returns a copy.
 *
 * Two paths by estimated cost:
 *  - small/medium images: the EXACT separable kernel below (the textbook math);
 *  - huge images: three sliding-window box passes with radii fitted to σ — the
 *    standard fast Gaussian approximation, O(1) per pixel so a 24 MP blur
 *    takes ~1 s instead of ~60 s. Visually indistinguishable.
 */
export function gaussianBlur(src: RawImage, sigma: number): RawImage {
  if (sigma <= 0.05) {
    return { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height };
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const pixels = src.width * src.height;
  const exact = pixels * (2 * radius + 1) * 8 <= EXACT_COST_BUDGET;

  const prem = premultiply8(src.data);
  let result: Uint8ClampedArray;

  if (exact) {
    const size = radius * 2 + 1;
    const kernel = new Float32Array(size);
    let sum = 0;
    const twoSigmaSq = 2 * sigma * sigma;
    for (let i = 0; i < size; i++) {
      const x = i - radius;
      kernel[i] = Math.exp(-(x * x) / twoSigmaSq);
      sum += kernel[i];
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum;

    // prem is not referenced after the horizontal pass, so the engine can
    // reclaim it while the vertical pass runs
    const h = convolve1D(prem, src.width, src.height, kernel, radius, true);
    result = convolve1D(h, src.width, src.height, kernel, radius, false);
  } else {
    const tmp = new Uint8ClampedArray(prem.length);
    const radii = boxesForGauss(sigma, 3);
    const a = prem;
    const b = tmp;
    for (const r of radii) {
      boxBlurAxis(a, b, src.width, src.height, Math.max(0, r), true);
      boxBlurAxis(b, a, src.width, src.height, Math.max(0, r), false);
    }
    result = a; // always ends back in `a` after each H+V pair
  }

  return { data: unpremultiply8(result), width: src.width, height: src.height };
}
