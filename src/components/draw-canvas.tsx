"use client";

import { useEffect, useRef, useState } from "react";
import type { RawImage } from "@/lib/image-utils";

/**
 * Draw/annotate layer: an overlay canvas on top of the working image.
 * Strokes are drawn live on the overlay at display scale, then stamped into
 * the full-resolution pixels on pointer-up (one history entry per stroke).
 *
 * The overlay uses the SAME internal resolution as the image, so display
 * coordinates are mapped once: full = (client − rect.topleft) × W/rect.width.
 */

type DrawTool = "pen" | "eraser" | "line" | "rect" | "ellipse" | "arrow" | "text";

interface DrawCanvasProps {
  raw: RawImage;
  version: number;
  busy: boolean;
  /** Commit stamped pixels as a new history entry. */
  onCommit: (next: RawImage, label: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}

const TOOLS: { id: DrawTool; label: string; icon: string }[] = [
  {
    id: "pen",
    label: "Pen",
    icon: "M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586",
  },
  {
    id: "eraser",
    label: "Erase",
    icon: "M20 20H8.5L3 14.5a2 2 0 010-2.8l8.7-8.7a2 2 0 012.8 0l5.6 5.6a2 2 0 010 2.8L13 19",
  },
  { id: "line", label: "Line", icon: "M5 19L19 5" },
  { id: "rect", label: "Rect", icon: "M4 5h16v14H4z" },
  { id: "ellipse", label: "Oval", icon: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z" },
  { id: "arrow", label: "Arrow", icon: "M5 19L19 5M19 5h-7M19 5v7" },
  { id: "text", label: "Text", icon: "M4 6V4h16v2M12 4v16M9 20h6" },
];

const SWATCHES = [
  "#111111",
  "#ffffff",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#3a2d28",
  "#a48374",
  "#cbad8d",
  "#d1c7bd",
];

interface Pt {
  x: number;
  y: number;
}

/** Longest side of the visible draw canvas, in canvas pixels. */
const MAX_BASE_PX = 2048;

export function DrawCanvas({ raw, version, busy, onCommit, onUndo, canUndo }: DrawCanvasProps) {
  const [tool, setTool] = useState<DrawTool>("pen");
  const [color, setColor] = useState("#ef4444");
  const [width, setWidth] = useState(4);
  const [fontSize, setFontSize] = useState(28);
  const [textBox, setTextBox] = useState<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    value: string;
  } | null>(null);

  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    start: Pt;
    last: Pt;
    points: Pt[];
    tool: DrawTool;
  } | null>(null);

  // Redraw the base when the working image changes; clear the overlay.
  // The pixels are materialized at full resolution once, then GPU-scaled into
  // a size-capped visible canvas (putImageData can't scale).
  useEffect(() => {
    const base = baseRef.current;
    const ov = overlayRef.current;
    if (!base || !ov) return;

    const full = document.createElement("canvas");
    full.width = raw.width;
    full.height = raw.height;
    full.getContext("2d")!.putImageData(new ImageData(raw.data, raw.width, raw.height), 0, 0);

    const scale = Math.min(1, MAX_BASE_PX / Math.max(raw.width, raw.height));
    const dw = Math.max(1, Math.round(raw.width * scale));
    const dh = Math.max(1, Math.round(raw.height * scale));
    base.width = dw;
    base.height = dh;
    const ctx = base.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(full, 0, 0, dw, dh);

    // Overlay matches the visible base exactly (its own resolution stays
    // capped; pointer coords map through the shared rect, so strokes still
    // stamp at full resolution)
    ov.width = dw;
    ov.height = dh;
    ov.getContext("2d")!.clearRect(0, 0, dw, dh);
  }, [raw, version]);

  /** Map a pointer event to full-resolution image coordinates. */
  const toImagePt = (e: React.PointerEvent): Pt => {
    const ov = overlayRef.current!;
    const rect = ov.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (raw.width / rect.width),
      y: (e.clientY - rect.top) * (raw.height / rect.height),
    };
  };

  /**
   * The overlay canvas is size-capped like the base, but stroke previews are
   * computed in full-resolution coordinates — scale the context so they land
   * in the right place without touching the drawing code.
   */
  const alignOverlay = (ctx: CanvasRenderingContext2D) => {
    const ov = overlayRef.current!;
    const k = ov.width / raw.width;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  };

  const styleCtx = (ctx: CanvasRenderingContext2D, k: number) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width * k;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
  };

  const drawShape = (ctx: CanvasRenderingContext2D, t: DrawTool, a: Pt, b: Pt, k: number) => {
    ctx.beginPath();
    if (t === "line" || t === "arrow") {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (t === "arrow") {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.max(10 * k, ctx.lineWidth * 3);
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
        ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      }
    } else if (t === "rect") {
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.stroke();
    } else if (t === "ellipse") {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      ctx.ellipse(cx, cy, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const stampAndCommit = (
    label: string,
    paint: (ctx: CanvasRenderingContext2D, k: number) => void
  ) => {
    const ov = overlayRef.current!;
    const rect = ov.getBoundingClientRect();
    const k = raw.width / rect.width; // display → full-res scale
    const canvas = document.createElement("canvas");
    canvas.width = raw.width;
    canvas.height = raw.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(new ImageData(raw.data, raw.width, raw.height), 0, 0);
    styleCtx(ctx, k);
    paint(ctx, k);
    const next = ctx.getImageData(0, 0, canvas.width, canvas.height);
    onCommit({ data: next.data, width: next.width, height: next.height }, label);
    const octx = overlayRef.current?.getContext("2d");
    if (octx) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, octx.canvas.width, octx.canvas.height);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    const pt = toImagePt(e);

    if (tool === "text") {
      const rect = overlayRef.current!.getBoundingClientRect();
      setTextBox({
        x: pt.x,
        y: pt.y,
        dx: e.clientX - rect.left,
        dy: e.clientY - rect.top,
        value: "",
      });
      return;
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic/already-released pointers — drag still works via overlay listeners
    }
    dragRef.current = { start: pt, last: pt, points: [pt], tool };

    const ctx = overlayRef.current?.getContext("2d");
    if (ctx && (tool === "pen" || tool === "eraser")) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = tool === "eraser" ? "black" : color; // erased pixels ignore color
      ctx.lineWidth = width * (tool === "eraser" ? 3 : 1);
      alignOverlay(ctx); // persists across the drag's move events
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x + 0.01, pt.y); // dot on click
      ctx.stroke();
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || busy) return;
    const pt = toImagePt(e);
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;

    if (drag.tool === "pen" || drag.tool === "eraser") {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = drag.tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = drag.tool === "eraser" ? "black" : color;
      ctx.lineWidth = width * (drag.tool === "eraser" ? 3 : 1);
      alignOverlay(ctx);
      ctx.beginPath();
      ctx.moveTo(drag.last.x, drag.last.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.restore();
      drag.last = pt;
      drag.points.push(pt);
    } else {
      // Shapes: preview from scratch each move
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      alignOverlay(ctx);
      drawShape(ctx, drag.tool, drag.start, pt, 1);
      ctx.restore();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || busy) return;
    const pt = toImagePt(e);

    if (drag.tool === "pen" || drag.tool === "eraser") {
      if (drag.last.x !== pt.x || drag.last.y !== pt.y) drag.points.push(pt);
      drag.last = pt;
      const replay = (ctx: CanvasRenderingContext2D) => {
        ctx.beginPath();
        ctx.moveTo(drag.points[0].x, drag.points[0].y);
        for (let i = 1; i < drag.points.length; i++) ctx.lineTo(drag.points[i].x, drag.points[i].y);
        ctx.stroke();
      };
      if (drag.tool === "pen") stampAndCommit("Draw", replay);
      else
        stampAndCommit("Erase", (ctx) => {
          ctx.globalCompositeOperation = "destination-out";
          ctx.lineWidth = width * 3;
          replay(ctx);
        });
    } else {
      stampAndCommit("Draw", (ctx) => drawShape(ctx, drag.tool, drag.start, pt, 1));
    }
  };

  const commitText = () => {
    if (!textBox || !textBox.value.trim()) {
      setTextBox(null);
      return;
    }
    const tb = textBox;
    stampAndCommit("Draw text", (ctx) => {
      const rect = overlayRef.current!.getBoundingClientRect();
      const k = raw.width / rect.width;
      ctx.fillStyle = color;
      ctx.font = `${Math.round(fontSize * k)}px sans-serif`;
      ctx.fillText(tb.value, tb.x, tb.y);
    });
    setTextBox(null);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.label}
            onClick={() => setTool(t.id)}
            className={`btn-soft w-8 h-8 p-0 ${tool === t.id ? "on" : ""}`}
          >
            <svg
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
            </svg>
          </button>
        ))}
        <span className="w-px h-5 bg-border mx-1" />
        {SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            title={c}
            className={`w-5 h-5 rounded-full border ${color === c ? "ring-2 ring-accent" : "border-border"}`}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          title="Custom color"
        />
        <span className="w-px h-5 bg-border mx-1" />
        <label className="text-[11px] text-muted flex items-center gap-1.5">
          w
          <input
            type="range"
            min={1}
            max={40}
            value={width}
            onChange={(e) => setWidth(parseInt(e.target.value))}
            className="w-20"
          />
          <span className="w-5 font-mono">{width}</span>
        </label>
        {tool === "text" && (
          <label className="text-[11px] text-muted flex items-center gap-1.5">
            size
            <input
              type="range"
              min={10}
              max={120}
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="w-16"
            />
            <span className="w-6 font-mono">{fontSize}</span>
          </label>
        )}
        <span className="w-px h-5 bg-border mx-1" />
        <button
          onClick={onUndo}
          disabled={!canUndo || busy}
          className="btn-ghost"
          title="Undo last stroke (⌘Z)"
        >
          Undo stroke
        </button>
      </div>

      {/* Canvas stack: inner wrapper shrink-wraps the base canvas so the
          overlay aligns with the visible image exactly */}
      <div className="checker rounded-2xl border border-border-soft overflow-hidden flex justify-center">
        <div className="relative inline-block">
          <canvas ref={baseRef} className="block max-w-full max-h-[52vh] w-auto h-auto" />
          <canvas
            ref={overlayRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={`absolute inset-0 w-full h-full ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
            style={{ touchAction: "none" }}
          />
          {textBox && (
            <div className="absolute inset-0" onPointerDown={(e) => e.preventDefault()}>
              <input
                autoFocus
                value={textBox.value}
                onChange={(e) => setTextBox({ ...textBox, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText();
                  if (e.key === "Escape") setTextBox(null);
                }}
                onBlur={commitText}
                placeholder="Type, Enter to place"
                className="absolute px-2.5 py-1.5 rounded-lg bg-card/95 backdrop-blur-sm border border-accent/60 text-foreground text-sm outline-none min-w-48 shadow-lg"
                style={{ left: textBox.dx, top: textBox.dy }}
              />
            </div>
          )}
          {busy && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <span className="inline-block w-7 h-7 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-[10px] text-muted">
        {tool === "text"
          ? "Click on the image to place text, Enter commits, Esc cancels."
          : "Draw on the image — each stroke commits to the full-resolution pixels."}
      </p>
    </div>
  );
}
