"use client";

import { useState } from "react";
import type { RawImage } from "@/lib/image-utils";
import {
  RESAMPLE_HINTS,
  RESAMPLE_LABELS,
  type MethodChoice,
  type ResampleMethod,
} from "@/lib/resample";
import { CompareStrip } from "./compare-strip";

const MAX_DIM = 12000;
const PRESETS = [2, 3, 4, 5, 10];
const METHODS: MethodChoice[] = ["auto", "nearest", "bilinear", "bicubic", "lanczos3", "area"];

interface ResizePanelProps {
  raw: RawImage;
  version: number;
  busy: boolean;
  onApply: (dw: number, dh: number, method: MethodChoice) => void;
}

export function ResizePanel({ raw, version, busy, onApply }: ResizePanelProps) {
  const [width, setWidth] = useState(raw.width);
  const [height, setHeight] = useState(raw.height);
  const [lock, setLock] = useState(true);
  const [method, setMethod] = useState<MethodChoice>("auto");
  const [syncedDims, setSyncedDims] = useState<[number, number]>([raw.width, raw.height]);

  // Re-sync when the working image changes underneath us (undo, crop, …) —
  // adjusting state during render per the React "you might not need an effect" guide
  if (syncedDims[0] !== raw.width || syncedDims[1] !== raw.height) {
    setSyncedDims([raw.width, raw.height]);
    setWidth(raw.width);
    setHeight(raw.height);
  }

  const setW = (w: number) => {
    const cw = Math.max(1, Math.min(MAX_DIM, Math.round(w || 1)));
    setWidth(cw);
    if (lock) setHeight(Math.max(1, Math.round((cw * raw.height) / raw.width)));
  };

  const setH = (h: number) => {
    const ch = Math.max(1, Math.min(MAX_DIM, Math.round(h || 1)));
    setHeight(ch);
    if (lock) setWidth(Math.max(1, Math.round((ch * raw.width) / raw.height)));
  };

  const scaleBy = (p: number) => {
    setW(raw.width * p);
    setH(raw.height * p);
  };

  const changed = width !== raw.width || height !== raw.height;
  const autoNote =
    method === "auto"
      ? "Auto: bicubic on upscale · Lanczos3 mild downscale · area ≥3× downscale"
      : RESAMPLE_HINTS[method as ResampleMethod];

  return (
    <div>
      <p className="text-xs text-muted leading-snug mb-4">
        Extra pixels are computed by interpolation — each destination pixel is reconstructed from
        its source neighborhood, never stretched.
      </p>

      {/* Presets */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => scaleBy(p)}
            className="px-2.5 py-1 rounded-md text-xs font-medium border border-border text-muted hover:border-accent hover:text-accent transition-colors"
          >
            ×{p}
          </button>
        ))}
        <span className="px-1 py-1 text-[11px] text-muted self-center">
          {raw.width}×{raw.height} →
        </span>
      </div>

      {/* Dimensions */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Width (px)</label>
          <input
            type="number"
            min={1}
            max={MAX_DIM}
            value={width}
            onChange={(e) => setW(parseInt(e.target.value))}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Height (px)</label>
          <input
            type="number"
            min={1}
            max={MAX_DIM}
            value={height}
            onChange={(e) => setH(parseInt(e.target.value))}
            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          onClick={() => setLock((v) => !v)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
            lock ? "border-accent text-accent" : "border-border text-muted"
          }`}
        >
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            {lock ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
              />
            )}
          </svg>
          {lock ? "Aspect locked" : "Aspect free"}
        </button>
        <span className="text-[11px] text-muted font-mono">
          {width} × {height}
        </span>
      </div>

      {/* Method */}
      <div className="mt-4">
        <label className="block text-xs text-muted mb-1">Interpolation method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as MethodChoice)}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m === "auto" ? "Auto (recommended)" : RESAMPLE_LABELS[m as ResampleMethod]}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-muted leading-snug">{autoNote}</p>
      </div>

      <button
        onClick={() => onApply(width, height, method)}
        disabled={busy || !changed}
        className="mt-4 w-full px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "Processing…" : "Apply Resize"}
      </button>

      <CompareStrip raw={raw} version={version} />
    </div>
  );
}
