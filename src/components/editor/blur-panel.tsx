"use client";

import { useEffect, useRef, useState } from "react";
import type { RawImage } from "@/lib/image-utils";
import { gaussianBlur } from "@/lib/effects";
import { downscaleFast } from "@/lib/resample";

const PREVIEW_MAX = 560; // downscaled working copy used for the live preview
const DEBOUNCE_MS = 120;

interface BlurPanelProps {
  raw: RawImage;
  busy: boolean;
  onApply: (sigma: number) => void;
}

export function BlurPanel({ raw, busy, onApply }: BlurPanelProps) {
  const [sigma, setSigma] = useState(4);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live preview on a downscaled copy, with sigma scaled proportionally so it
  // matches what the full-resolution apply will look like. The downscale uses
  // the fast block subsampler — a full-kernel resample of a 24 MP source on
  // the main thread would freeze the UI on every slider move.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, PREVIEW_MAX / Math.max(raw.width, raw.height));
      const pw = Math.max(1, Math.round(raw.width * scale));
      const ph = Math.max(1, Math.round(raw.height * scale));
      const small = downscaleFast(raw, pw, ph);
      const blurred = sigma > 0.05 ? gaussianBlur(small, sigma * scale) : small;
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(new ImageData(blurred.data, pw, ph), 0, 0);
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [raw, sigma]);

  return (
    <div>
      <p className="text-xs text-muted leading-snug mb-4">
        Gaussian convolution g = Σ w·f with kernel e<sup>−x²/2σ²</sup>, applied as two separable 1-D
        passes (radius ⌈3σ⌉).
      </p>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0.5}
          max={20}
          step={0.5}
          value={sigma}
          onChange={(e) => setSigma(parseFloat(e.target.value))}
          className="flex-1"
        />
        <span className="w-16 text-right text-sm font-mono">σ={sigma}</span>
      </div>

      <canvas
        ref={canvasRef}
        className="mt-3 w-full rounded-md border border-border bg-[#0c0c0f]"
      />
      <p className="mt-1 text-[10px] text-muted">Live preview (downscaled copy)</p>

      <button
        onClick={() => onApply(sigma)}
        disabled={busy}
        className="mt-4 w-full px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "Processing…" : "Apply Blur"}
      </button>
    </div>
  );
}
