"use client";

import { useEffect, useRef } from "react";
import type { RawImage } from "@/lib/image-utils";
import { resample, type ResampleMethod } from "@/lib/resample";

/**
 * Side-by-side quality comparison: the same source region rendered by each
 * interpolation algorithm. Computed synchronously on the main thread — the
 * buffers are tiny (≤37×37 → ~148×148), so a worker isn't worth it here.
 */

const TILE = 148;
const MAX_SRC = 37; // ~4× upscale so the differences are visible

const METHODS: { id: ResampleMethod; label: string; caption: string; pixelated?: boolean }[] = [
  { id: "nearest", label: "Nearest", caption: "closest pixel — blocky", pixelated: true },
  { id: "bilinear", label: "Bilinear", caption: "4-neighbor average — soft" },
  { id: "bicubic", label: "Bicubic", caption: "16-pixel cubic — sharp" },
  { id: "lanczos3", label: "Lanczos3", caption: "36-pixel sinc — sharpest" },
];

export function CompareStrip({ raw, version }: { raw: RawImage; version: number }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const srcSize = Math.min(MAX_SRC, raw.width, raw.height);

  useEffect(() => {
    const s = srcSize;
    if (s <= 0) return;

    // Center crop of the working image as the comparison region
    const x0 = Math.floor((raw.width - s) / 2);
    const y0 = Math.floor((raw.height - s) / 2);
    const region: RawImage = { data: new Uint8ClampedArray(s * s * 4), width: s, height: s };
    for (let y = 0; y < s; y++) {
      const off = ((y0 + y) * raw.width + x0) * 4;
      region.data.set(raw.data.subarray(off, off + s * 4), y * s * 4);
    }

    METHODS.forEach((m, idx) => {
      const canvas = refs.current[idx];
      if (!canvas) return;
      const out = resample(region, TILE, TILE, m.id);
      canvas.width = TILE;
      canvas.height = TILE;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.putImageData(new ImageData(out.data, TILE, TILE), 0, 0);
    });
  }, [raw, version, srcSize]);

  return (
    <div className="mt-5 pt-5 border-t border-border-soft">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          Method comparison
        </p>
        {srcSize > 0 && (
          <p className="text-[10px] text-muted font-mono">
            {srcSize}×{srcSize} → ×{(TILE / srcSize).toFixed(1)}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {METHODS.map((m, idx) => (
          <div key={m.id}>
            <canvas
              ref={(el) => {
                refs.current[idx] = el;
              }}
              width={TILE}
              height={TILE}
              className={`w-full rounded-lg border border-border-soft bg-background ${m.pixelated ? "pixelated" : ""}`}
            />
            <p className="mt-1 text-[11px] font-medium">{m.label}</p>
            <p className="text-[10px] text-muted leading-tight">{m.caption}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted leading-snug">
        Area-average belongs to strong downscales (≥3×), so it isn&apos;t shown for an upscale.
      </p>
    </div>
  );
}
