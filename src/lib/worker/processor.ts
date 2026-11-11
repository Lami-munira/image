import type { RawImage } from "../image-utils";
import { resample, type MethodChoice } from "../resample";
import { gaussianBlur } from "../effects";
import {
  rotateQuarter,
  flipHorizontal,
  flipVertical,
  cropImage,
  rotateFree,
  type RotateOptions,
} from "../geometry";

/**
 * Pixel-processing Web Worker. Heavy operations (kernel resampling, blur,
 * rotation) run off the main thread so the UI never freezes on large images.
 */

export type PixelOp =
  | { type: "resize"; src: RawImage; dw: number; dh: number; method: MethodChoice }
  | { type: "blur"; src: RawImage; sigma: number }
  | { type: "rotate-quarter"; src: RawImage; quarter: number }
  | { type: "flip"; src: RawImage; axis: "h" | "v" }
  | { type: "crop"; src: RawImage; rect: { x: number; y: number; w: number; h: number } }
  | { type: "rotate-free"; src: RawImage; options: RotateOptions };

/** A PixelOp with the source image factored out — the replayable part of an edit. */
export type PixelOpParams = {
  [K in PixelOp["type"]]: Omit<Extract<PixelOp, { type: K }>, "src">;
}[PixelOp["type"]];

interface WorkerRequest {
  id: number;
  op: PixelOp;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: RawImage;
  error?: string;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void;
};

function runOp(op: PixelOp): RawImage {
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

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, op } = e.data;
  try {
    const result = runOp(op);
    ctx.postMessage({ id, ok: true, result }, [result.data.buffer]);
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : "Processing failed",
    });
  }
};
