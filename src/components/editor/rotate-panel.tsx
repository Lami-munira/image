"use client";

import { useState } from "react";

interface RotatePanelProps {
  busy: boolean;
  onQuarter: (quarter: number) => void;
  onFlip: (axis: "h" | "v") => void;
  onFree: (
    deg: number,
    method: "bilinear" | "bicubic",
    fill: [number, number, number, number]
  ) => void;
}

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

const QUARTER_BTNS: {
  label: string;
  title: string;
  act: () => { kind: "quarter"; q: number } | { kind: "flip"; axis: "h" | "v" };
}[] = [
  { label: "⟲ 90°", title: "Rotate 90° counter-clockwise", act: () => ({ kind: "quarter", q: 3 }) },
  { label: "⟳ 90°", title: "Rotate 90° clockwise", act: () => ({ kind: "quarter", q: 1 }) },
  { label: "180°", title: "Rotate 180°", act: () => ({ kind: "quarter", q: 2 }) },
  { label: "⇋ Flip H", title: "Mirror horizontally", act: () => ({ kind: "flip", axis: "h" }) },
  { label: "⇅ Flip V", title: "Mirror vertically", act: () => ({ kind: "flip", axis: "v" }) },
];

export function RotatePanel({ busy, onQuarter, onFlip, onFree }: RotatePanelProps) {
  const [deg, setDeg] = useState(15);
  const [method, setMethod] = useState<"bilinear" | "bicubic">("bicubic");
  const [transparent, setTransparent] = useState(true);
  const [fillColor, setFillColor] = useState("#111111");

  return (
    <div>
      <p className="text-xs text-muted leading-snug mb-4">
        Quarter turns and mirrors are lossless pixel remaps. Free angles rotate by inverse mapping
        with interpolation.
      </p>

      {/* Lossless buttons */}
      <div className="grid grid-cols-3 gap-2">
        {QUARTER_BTNS.slice(0, 3).map((b) => (
          <button
            key={b.label}
            title={b.title}
            disabled={busy}
            onClick={() => {
              const a = b.act();
              if (a.kind === "quarter") onQuarter(a.q);
            }}
            className="btn-soft py-2.5"
          >
            {b.label}
          </button>
        ))}
        {QUARTER_BTNS.slice(3).map((b) => (
          <button
            key={b.label}
            title={b.title}
            disabled={busy}
            onClick={() => {
              const a = b.act();
              if (a.kind === "flip") onFlip(a.axis);
            }}
            className="btn-soft py-2.5"
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Free angle */}
      <div className="mt-6 pt-5 border-t border-border-soft">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Free angle</p>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={deg}
            onChange={(e) => setDeg(parseInt(e.target.value))}
            className="flex-1"
          />
          <span className="w-14 text-right text-sm font-mono">{deg}°</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted mb-1">Sampling</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "bilinear" | "bicubic")}
              className="input"
            >
              <option value="bicubic">Bicubic</option>
              <option value="bilinear">Bilinear</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Corner fill</label>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
                title="Transparent corners"
              />
              <input
                type="color"
                value={fillColor}
                onChange={(e) => setFillColor(e.target.value)}
                disabled={transparent}
                title="Fill color for corners"
              />
              <span className="text-[11px] text-muted">
                {transparent ? "transparent" : fillColor}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => onFree(deg, method, hexToRgba(fillColor, transparent ? 0 : 255))}
          disabled={busy || deg === 0}
          className="btn-primary w-full mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Processing…" : "Apply Rotation"}
        </button>
      </div>
    </div>
  );
}
