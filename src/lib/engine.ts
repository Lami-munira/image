import type { CropRect, RawImage } from "./image-utils";
import { resample, type MethodChoice } from "./resample";
import { gaussianBlur } from "./effects";
import {
  rotateQuarter,
  flipHorizontal,
  flipVertical,
  cropImage,
  rotateFree,
  type RotateOptions,
} from "./geometry";
import type { PixelOp } from "./worker/processor";

/**
 * Main-thread façade over the pixel worker. One code path for every raster
 * operation; falls back to synchronous execution if Workers are unavailable.
 *
 * The caller's buffer is never detached — we send a copy with transfer so the
 * working image and its history entries stay valid.
 */

interface Pending {
  resolve: (raw: RawImage) => void;
  reject: (err: Error) => void;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./worker/processor.ts", import.meta.url));
      worker.onmessage = (
        e: MessageEvent<{ id: number; ok: boolean; result?: RawImage; error?: string }>
      ) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok && e.data.result) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error ?? "Processing failed"));
      };
      worker.onerror = () => {
        // Fail all in-flight ops; subsequent calls retry via runLocal
        for (const p of pending.values()) p.reject(new Error("Worker crashed"));
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    } catch {
      worker = null;
    }
  }
  return worker;
}

function runLocal(op: PixelOp): RawImage {
  switch (op.type) {
    case "resize":
      return resample(op.src, op.dw, op.dh, op.method);
    case "blur":
      return gaussianBlur(op.src, op.sigma);
    case "rotate-quarter":
      return rotateQuarter(op.src, op.quarter);
    case "flip":
      return op.axis === "h" ? flipHorizontal(op.src) : flipVertical(op.src);
    case "crop":
      return cropImage(op.src, op.rect);
    case "rotate-free":
      return rotateFree(op.src, op.options);
  }
}

export function runOp(op: PixelOp): Promise<RawImage> {
  const w = getWorker();
  if (!w) return Promise.resolve(runLocal(op));

  const id = ++seq;
  // Copy the buffer: transferring the caller's would detach the current state
  let copy: Uint8ClampedArray<ArrayBuffer>;
  try {
    copy = op.src.data.slice();
  } catch {
    // Source allocation failed (huge image) — don't even try the worker
    return Promise.reject(new Error("Not enough memory for this operation"));
  }
  const sendOp = {
    ...op,
    src: { data: copy, width: op.src.width, height: op.src.height },
  } as PixelOp;

  return new Promise<RawImage>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ id, op: sendOp }, [copy.buffer]);
    } catch {
      // Dead/terminated worker — retry synchronously on the main thread
      pending.delete(id);
      try {
        resolve(runLocal(op));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Processing failed"));
      }
    }
  });
}

/* Convenience wrappers ------------------------------------------------ */

export const engineResize = (src: RawImage, dw: number, dh: number, method: MethodChoice) =>
  runOp({ type: "resize", src, dw, dh, method });

export const engineBlur = (src: RawImage, sigma: number) => runOp({ type: "blur", src, sigma });

export const engineRotateQuarter = (src: RawImage, quarter: number) =>
  runOp({ type: "rotate-quarter", src, quarter });

export const engineFlip = (src: RawImage, axis: "h" | "v") => runOp({ type: "flip", src, axis });

export const engineCrop = (src: RawImage, rect: CropRect) => runOp({ type: "crop", src, rect });

export const engineRotateFree = (src: RawImage, options: RotateOptions) =>
  runOp({ type: "rotate-free", src, options });

/** Synchronous local resize — used for the tiny canvases in the comparison strip. */
export { resample };
