"use client";

import { useEffect, useRef } from "react";
import type { RawImage } from "@/lib/image-utils";

/**
 * The visible edit trail: original + last 10 edits, each shown as a
 * before → after thumbnail pair. Click a row to jump to that state and
 * continue working from it; "Run again" re-executes a replayable edit on the
 * current image. Rows after the current one are the redo tail — they stay
 * listed (dimmed) until a new edit discards them.
 */

export interface HistoryRow {
  index: number;
  label: string;
  thumb: RawImage;
  dims: [number, number];
  isBase: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  replayable: boolean;
}

interface HistoryPanelProps {
  rows: HistoryRow[];
  busy: boolean;
  onJump: (index: number) => void;
  onReapply: (row: HistoryRow) => void;
}

const THUMB_PX = 44;

function Thumb({ raw, size = THUMB_PX }: { raw: RawImage; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = raw.width;
    canvas.height = raw.height;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.putImageData(new ImageData(raw.data, raw.width, raw.height), 0, 0);
  }, [raw]);
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size }}
      className="rounded-lg border border-border-soft checker shrink-0"
    />
  );
}

export function HistoryPanel({ rows, busy, onJump, onReapply }: HistoryPanelProps) {
  return (
    <div>
      <p className="text-xs text-muted leading-snug mb-4">
        The original state plus your last 10 edits, oldest first. Click a step to go back and
        continue from there; later steps are kept until you make a new edit. “Run again” repeats
        that edit on the current image.
      </p>

      <div className="space-y-1.5">
        {rows.map((row, i) => {
          const before = i > 0 ? rows[i - 1] : null;
          return (
            <div
              key={row.index}
              role="button"
              tabIndex={0}
              onClick={() => !row.isCurrent && !busy && onJump(row.index)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !row.isCurrent && !busy) {
                  e.preventDefault();
                  onJump(row.index);
                }
              }}
              className={`flex items-center gap-2.5 p-2 rounded-xl border transition-all cursor-pointer ${
                row.isCurrent
                  ? "border-accent/50 bg-accent/10 glow-accent"
                  : "border-border-soft hover:border-accent/40 hover:bg-accent/[0.04]"
              } ${row.isFuture ? "opacity-55" : ""}`}
            >
              {/* before → after pair */}
              {before ? (
                <>
                  <Thumb raw={before.thumb} size={40} />
                  <svg
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    className="text-muted shrink-0"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 12h14" />
                  </svg>
                </>
              ) : null}
              <Thumb raw={row.thumb} size={40} />

              {/* label + dims */}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate" title={row.label}>
                  {row.isBase ? "Original" : `${i}. ${row.label}`}
                </p>
                <p className="text-[10px] text-muted font-mono">
                  {row.dims[0]} × {row.dims[1]}
                  {before && (before.dims[0] !== row.dims[0] || before.dims[1] !== row.dims[1]) && (
                    <span className="text-muted/70">
                      {" "}
                      · from {before.dims[0]}×{before.dims[1]}
                    </span>
                  )}
                </p>
              </div>

              {/* badges + actions */}
              {row.isCurrent ? (
                <span className="text-[10px] font-medium text-accent border border-accent/50 bg-accent/10 rounded-full px-2 py-0.5 shrink-0">
                  Current
                </span>
              ) : row.isFuture ? (
                <span className="text-[10px] text-muted border border-border rounded-full px-2 py-0.5 shrink-0">
                  redo
                </span>
              ) : null}
              {!row.isBase && row.replayable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReapply(row);
                  }}
                  disabled={busy}
                  title={`Run "${row.label}" again on the current image`}
                  className="btn-ghost px-2 py-0.5 text-[10px] shrink-0"
                >
                  ↻ again
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
