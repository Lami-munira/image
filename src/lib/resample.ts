import type { RawImage } from "./image-utils";

/**
 * Mathematical image resampling — the engine behind "fill the extra pixels
 * in proportion to what is present in the original image".
 *
 * Every method uses INVERSE MAPPING: for each destination pixel we compute the
 * corresponding continuous source coordinate
 *
 *     sc = (dc + 0.5) * srcSize / dstSize - 0.5
 *
 * and reconstruct the value there with a convolution kernel evaluated over the
 * surrounding source pixels. Pixels are never stretched; they are interpolated.
 *
 * All kernels are applied SEPARABLY (horizontal pass, then vertical pass) with
 * per-destination weight tables precomputed once, so a full resample costs
 * O(W·H·k) instead of O(W·H·k²).
 *
 * Resampling happens on PREMULTIPLIED alpha so transparent regions don't bleed
 * dark fringes into semi-transparent edges.
 */

export type ResampleMethod = "nearest" | "bilinear" | "bicubic" | "lanczos3" | "area";

export type MethodChoice = ResampleMethod | "auto";

export const RESAMPLE_LABELS: Record<ResampleMethod, string> = {
  nearest: "Nearest",
  bilinear: "Bilinear",
  bicubic: "Bicubic",
  lanczos3: "Lanczos3",
  area: "Area",
};

export const RESAMPLE_HINTS: Record<ResampleMethod, string> = {
  nearest: "copies the closest source pixel — blocky, fast, pixel-art safe",
  bilinear: "weighted average of the 4 surrounding pixels — smooth, slightly soft",
  bicubic: "cubic spline (Keys, a = −0.5) over 16 pixels — sharp, natural",
  lanczos3: "windowed sinc over 36 pixels — sharpest, may ring near edges",
  area: "true box average of every covered source pixel — downscale only, no aliasing",
};

/** Pick a concrete method for "auto": bicubic up, area for heavy downscales, lanczos otherwise. */
export function resolveMethod(
  method: MethodChoice,
  sw: number,
  sh: number,
  dw: number,
  dh: number
): ResampleMethod {
  if (method !== "auto") return method;
  const down = Math.max(sw / dw, sh / dh);
  if (down >= 3) return "area";
  if (down > 1) return "lanczos3";
  return "bicubic";
}

/* ------------------------------------------------------------------ */
/* Kernel functions u(s) — evaluated at the fractional distance s      */
/* ------------------------------------------------------------------ */

/** Triangle: support 1. */
export function uBilinear(s: number): number {
  const a = Math.abs(s);
  return a < 1 ? 1 - a : 0;
}

/** Keys cubic convolution with a = −0.5 (the standard 2-lobe cubic), support 2. u(0)=1, u(±1)=u(±2)=0. */
export function uBicubic(s: number, a = -0.5): number {
  const x = Math.abs(s);
  if (x <= 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1;
  if (x < 2) return a * (x * x * x - 5 * x * x + 8 * x - 4);
  return 0;
}

/** Lanczos3: sinc(s) · sinc(s/3), support 3. */
export function uLanczos(s: number): number {
  const x = Math.abs(s);
  if (x < 1e-8) return 1;
  if (x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/* ------------------------------------------------------------------ */
/* Weight tables: for every destination index, the source taps + weights */
/* ------------------------------------------------------------------ */

export interface AxisTable {
  /** First source index for each destination pixel (may be negative at edges; clamped per tap). */
  start: Int32Array;
  /** Number of taps for each destination pixel. */
  count: Int32Array;
  /** Flattened weights: [dst * maxTaps + tap]. Normalized so each row sums to 1. */
  weights: Float32Array;
  /** Upper bound on taps per destination pixel. */
  maxTaps: number;
}

/**
 * Build the tap table mapping srcSize → dstSize along one axis.
 *
 * area: box filter of width = srcSize/dstSize when downscaling (weights are
 * the overlap lengths with each source pixel — exact area weighting). When
 * upscaling it degenerates to bilinear.
 */
export function buildAxisTable(
  srcSize: number,
  dstSize: number,
  method: ResampleMethod
): AxisTable {
  const inv = srcSize / dstSize; // source pixels per destination pixel
  const downscale = inv > 1;

  let support = 0;
  let kernel: ((s: number) => number) | null = null;
  if (method === "nearest") {
    support = 0.5;
    kernel = null; // single tap, weight 1
  } else if (method === "bilinear" || (method === "area" && !downscale)) {
    support = 1;
    kernel = uBilinear;
  } else if (method === "bicubic") {
    support = 2;
    kernel = uBicubic;
  } else if (method === "lanczos3") {
    support = 3;
    kernel = uLanczos;
  } else {
    support = inv / 2; // area downscale: box of width `inv`
    kernel = null; // handled via overlap lengths below
  }

  const isAreaDown = method === "area" && downscale;
  const maxTaps = isAreaDown
    ? Math.min(srcSize, Math.ceil(inv) + 2)
    : Math.min(srcSize, Math.ceil(support * 2) + 2);

  const start = new Int32Array(dstSize);
  const count = new Int32Array(dstSize);
  const weights = new Float32Array(dstSize * maxTaps);

  for (let d = 0; d < dstSize; d++) {
    const center = (d + 0.5) * inv - 0.5; // continuous source coordinate
    let firstTap: number;
    let taps: number;

    if (method === "nearest") {
      firstTap = Math.round(center);
      taps = 1;
      weights[d * maxTaps] = 1;
    } else if (isAreaDown) {
      const half = inv / 2;
      const lo = center - half;
      const hi = center + half;
      const s0 = Math.floor(lo);
      const s1 = Math.ceil(hi);
      let sum = 0;
      let n = 0;
      firstTap = -1;
      for (let i = s0; i <= s1; i++) {
        const ov = Math.min(i + 1, hi) - Math.max(i, lo);
        if (ov <= 0) continue;
        if (firstTap < 0) firstTap = i;
        weights[d * maxTaps + n++] = ov;
        sum += ov;
      }
      if (n === 0) {
        // degenerate: snap to nearest
        firstTap = Math.round(center);
        n = 1;
        weights[d * maxTaps] = 1;
        sum = 1;
      }
      for (let t = 0; t < n; t++) weights[d * maxTaps + t] /= sum;
      taps = n;
    } else {
      const s0 = Math.ceil(center - support);
      const s1 = Math.floor(center + support);
      taps = s1 - s0 + 1;
      firstTap = s0;
      if (taps <= 0) {
        firstTap = Math.round(center);
        taps = 1;
        weights[d * maxTaps] = 1;
      } else {
        let sum = 0;
        for (let t = 0; t < taps; t++) {
          const w = kernel!(center - (firstTap + t));
          weights[d * maxTaps + t] = w;
          sum += w;
        }
        if (sum < 1e-8) {
          weights.fill(0, d * maxTaps, d * maxTaps + taps);
          weights[d * maxTaps] = 1;
          sum = 1;
        }
        for (let t = 0; t < taps; t++) weights[d * maxTaps + t] /= sum;
      }
    }

    start[d] = firstTap; // raw; each tap is clamped into [0, srcSize-1] at apply time
    count[d] = Math.min(taps, maxTaps);
  }

  return { start, count, weights, maxTaps };
}

/* ------------------------------------------------------------------ */
/* Premultiplied-alpha helpers                                         */
/* ------------------------------------------------------------------ */

/** straight RGBA bytes → premultiplied RGBA floats (0..255 scale) */
export function premultiply(data: Uint8ClampedArray): Float32Array {
  const n = data.length / 4;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    out[i * 4] = data[i * 4] * a;
    out[i * 4 + 1] = data[i * 4 + 1] * a;
    out[i * 4 + 2] = data[i * 4 + 2] * a;
    out[i * 4 + 3] = data[i * 4 + 3];
  }
  return out;
}

/** premultiplied RGBA floats → straight RGBA bytes */
export function unpremultiply(px: Float32Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a > 0.5) {
      const f = 255 / a;
      out[i] = px[i] * f;
      out[i + 1] = px[i + 1] * f;
      out[i + 2] = px[i + 2] * f;
    }
    out[i + 3] = a;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Separable passes                                                    */
/* ------------------------------------------------------------------ */

/**
 * Apply `t` along the horizontal axis.
 * `src` is a premultiplied float buffer of width sw × height sh; output width = dst length.
 */
function passHorizontal(src: Float32Array, sw: number, sh: number, t: AxisTable): Float32Array {
  const dw = t.start.length;
  const out = new Float32Array(dw * sh * 4);
  for (let y = 0; y < sh; y++) {
    const rowOff = y * sw * 4;
    const outRowOff = y * dw * 4;
    for (let d = 0; d < dw; d++) {
      const n = t.count[d];
      const wOff = d * t.maxTaps;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let k = 0; k < n; k++) {
        const w = t.weights[wOff + k];
        if (w === 0) continue;
        let x = t.start[d] + k;
        if (x < 0) x = 0;
        else if (x >= sw) x = sw - 1; // clamp-to-edge
        const i = rowOff + x * 4;
        r += w * src[i];
        g += w * src[i + 1];
        b += w * src[i + 2];
        a += w * src[i + 3];
      }
      const o = outRowOff + d * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}

/** Apply `t` along the vertical axis. */
function passVertical(src: Float32Array, sw: number, sh: number, t: AxisTable): Float32Array {
  const dh = t.start.length;
  const out = new Float32Array(sw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const n = t.count[y];
    const wOff = y * t.maxTaps;
    const outRow = y * sw * 4;
    for (let k = 0; k < n; k++) {
      const w = t.weights[wOff + k];
      if (w === 0) continue;
      let sy = t.start[y] + k;
      if (sy < 0) sy = 0;
      else if (sy >= sh) sy = sh - 1; // clamp-to-edge
      const rowOff = sy * sw * 4;
      for (let x = 0; x < sw; x++) {
        const si = rowOff + x * 4;
        const di = outRow + x * 4;
        out[di] += w * src[si];
        out[di + 1] += w * src[si + 1];
        out[di + 2] += w * src[si + 2];
        out[di + 3] += w * src[si + 3];
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Fast preview downscale via block subsampling: each destination pixel
 * averages a few evenly-spaced samples of its source block instead of running
 * the full convolution kernel over every source pixel — O(dest·k²) instead of
 * O(source·kernel). For previews/thumbnails where exactness doesn't matter;
 * the Resize tool itself always uses `resample`.
 */
export function downscaleFast(src: RawImage, dw: number, dh: number, samplesPerAxis = 3): RawImage {
  dw = Math.max(1, Math.floor(dw));
  dh = Math.max(1, Math.floor(dh));
  if (dw >= src.width && dh >= src.height) {
    return { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height };
  }

  const out = new Uint8ClampedArray(dw * dh * 4);
  const stepX = src.width / dw;
  const stepY = src.height / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = Math.floor(dy * stepY);
    const blockH = Math.max(1, Math.floor(stepY));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = Math.floor(dx * stepX);
      const blockW = Math.max(1, Math.floor(stepX));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let sy = 0; sy < samplesPerAxis; sy++) {
        const py = Math.min(
          src.height - 1,
          y0 + Math.floor(((sy + 0.5) / samplesPerAxis) * blockH)
        );
        for (let sx = 0; sx < samplesPerAxis; sx++) {
          const px = Math.min(
            src.width - 1,
            x0 + Math.floor(((sx + 0.5) / samplesPerAxis) * blockW)
          );
          const i = (py * src.width + px) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          n++;
        }
      }
      const o = (dy * dw + dx) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { data: out, width: dw, height: dh };
}

/**
 * Resample `src` to dw×dh with the chosen interpolation method.
 * This is the core of the resize tool: every destination pixel is computed
 * from its neighborhood in the source, in proportion to the original image.
 */
export function resample(src: RawImage, dw: number, dh: number, method: MethodChoice): RawImage {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  const m = resolveMethod(method, src.width, src.height, dw, dh);
  if (dw === src.width && dh === src.height) {
    return { data: new Uint8ClampedArray(src.data), width: dw, height: dh };
  }

  const tx = buildAxisTable(src.width, dw, m);
  const ty = buildAxisTable(src.height, dh, m);

  // Inlining premultiply lets the engine reclaim the Float32 source during the
  // vertical pass — on a 24 MP upscale this is ~100 MB less peak memory.
  const mid = passHorizontal(premultiply(src.data), src.width, src.height, tx);
  const out = passVertical(mid, dw, src.height, ty);

  return { data: unpremultiply(out), width: dw, height: dh };
}

/* ------------------------------------------------------------------ */
/* Point samplers for arbitrary coordinates (used by free rotation)    */
/* ------------------------------------------------------------------ */

function clampIdx(v: number, max: number): number {
  return v < 0 ? 0 : v > max ? max : v;
}

/** Bilinear sample at continuous coordinates on a premultiplied float buffer. */
export function sampleBilinear(
  px: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  out: Float32Array
): void {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  for (let dy = 0; dy <= 1; dy++) {
    const sy = clampIdx(y0 + dy, h - 1);
    const wy = dy === 0 ? 1 - fy : fy;
    for (let dx = 0; dx <= 1; dx++) {
      const sx = clampIdx(x0 + dx, w - 1);
      const wx = dx === 0 ? 1 - fx : fx;
      const wgt = wx * wy;
      const i = (sy * w + sx) * 4;
      out[0] += wgt * px[i];
      out[1] += wgt * px[i + 1];
      out[2] += wgt * px[i + 2];
      out[3] += wgt * px[i + 3];
    }
  }
}

/** Bicubic (Keys a=−0.5) sample at continuous coordinates, 4×4 neighborhood. */
export function sampleBicubic(
  px: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  out: Float32Array
): void {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const fx = x - x0,
    fy = y - y0;
  const wxs = [uBicubic(1 + fx), uBicubic(fx), uBicubic(1 - fx), uBicubic(2 - fx)];
  const wys = [uBicubic(1 + fy), uBicubic(fy), uBicubic(1 - fy), uBicubic(2 - fy)];
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  for (let j = 0; j < 4; j++) {
    const sy = clampIdx(y0 - 1 + j, h - 1);
    for (let i = 0; i < 4; i++) {
      const sx = clampIdx(x0 - 1 + i, w - 1);
      const wgt = wxs[i] * wys[j];
      if (wgt === 0) continue;
      const idx = (sy * w + sx) * 4;
      out[0] += wgt * px[idx];
      out[1] += wgt * px[idx + 1];
      out[2] += wgt * px[idx + 2];
      out[3] += wgt * px[idx + 3];
    }
  }
}
