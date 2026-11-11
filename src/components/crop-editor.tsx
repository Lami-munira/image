"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CropRect } from "@/lib/image-utils";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CropEditorProps {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
}

const MIN_SIZE = 20;
const HANDLE_PX = 10;

const CURSOR: Record<Handle, string> = {
  nw: "nw-resize",
  n: "n-resize",
  ne: "ne-resize",
  e: "e-resize",
  se: "se-resize",
  s: "s-resize",
  sw: "sw-resize",
  w: "w-resize",
  move: "move",
};

const ASPECT_PRESETS: { label: string; value: number | null }[] = [
  { label: "Free", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "2:3", value: 2 / 3 },
  { label: "9:16", value: 9 / 16 },
];

export function CropEditor({
  src,
  naturalWidth,
  naturalHeight,
  onApply,
  onCancel,
}: CropEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startCrop: CropRect;
  } | null>(null);

  const [imgRect, setImgRect] = useState<DisplayRect | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  const measureImg = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const cb = container.getBoundingClientRect();
    const ib = img.getBoundingClientRect();
    const rect = {
      left: ib.left - cb.left,
      top: ib.top - cb.top,
      width: ib.width,
      height: ib.height,
    };
    setImgRect(rect);
    // First measurement also seeds the crop box (full image)
    setCrop((c) => c ?? { x: 0, y: 0, w: rect.width, h: rect.height });
  }, []);

  // Measure after first paint
  useEffect(() => {
    const raf = requestAnimationFrame(measureImg);
    return () => cancelAnimationFrame(raf);
  }, [measureImg]);

  // Re-measure on window resize
  useEffect(() => {
    window.addEventListener("resize", measureImg);
    return () => window.removeEventListener("resize", measureImg);
  }, [measureImg]);

  // Global mouse events for drag
  useEffect(() => {
    if (!imgRect) return;

    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const sc = drag.startCrop;
      const { handle } = drag;
      const { width: iw, height: ih } = imgRect;

      let { x, y, w, h } = sc;

      if (handle === "move") {
        x = Math.max(0, Math.min(iw - w, sc.x + dx));
        y = Math.max(0, Math.min(ih - h, sc.y + dy));
      } else {
        if (handle.includes("e")) w = Math.max(MIN_SIZE, Math.min(iw - x, sc.w + dx));
        if (handle.includes("s")) h = Math.max(MIN_SIZE, Math.min(ih - y, sc.h + dy));
        if (handle.includes("w")) {
          const nx = Math.max(0, Math.min(sc.x + sc.w - MIN_SIZE, sc.x + dx));
          w = sc.x + sc.w - nx;
          x = nx;
        }
        if (handle.includes("n")) {
          const ny = Math.max(0, Math.min(sc.y + sc.h - MIN_SIZE, sc.y + dy));
          h = sc.y + sc.h - ny;
          y = ny;
        }

        if (aspectRatio !== null) {
          const useW = handle === "n" || handle === "s";
          if (useW) {
            w = h * aspectRatio;
          } else {
            h = w / aspectRatio;
          }
          if (x + w > iw) {
            w = iw - x;
            h = w / aspectRatio;
          }
          if (y + h > ih) {
            h = ih - y;
            w = h * aspectRatio;
          }
          w = Math.max(MIN_SIZE, w);
          h = Math.max(MIN_SIZE, h);
        }
      }

      setCrop({ x, y, w, h });
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [imgRect, aspectRatio]);

  const startDrag = (e: React.MouseEvent, handle: Handle) => {
    e.preventDefault();
    if (!crop) return;
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startCrop: { ...crop } };
  };

  const handleApply = () => {
    if (!crop || !imgRect) return;
    const sx = naturalWidth / imgRect.width;
    const sy = naturalHeight / imgRect.height;
    onApply({
      x: Math.round(crop.x * sx),
      y: Math.round(crop.y * sy),
      w: Math.round(crop.w * sx),
      h: Math.round(crop.h * sy),
    });
  };

  const reset = () => {
    if (imgRect) setCrop({ x: 0, y: 0, w: imgRect.width, h: imgRect.height });
  };

  const handles: { id: Handle; cx: number; cy: number }[] = crop
    ? [
        { id: "nw", cx: crop.x, cy: crop.y },
        { id: "n", cx: crop.x + crop.w / 2, cy: crop.y },
        { id: "ne", cx: crop.x + crop.w, cy: crop.y },
        { id: "e", cx: crop.x + crop.w, cy: crop.y + crop.h / 2 },
        { id: "se", cx: crop.x + crop.w, cy: crop.y + crop.h },
        { id: "s", cx: crop.x + crop.w / 2, cy: crop.y + crop.h },
        { id: "sw", cx: crop.x, cy: crop.y + crop.h },
        { id: "w", cx: crop.x, cy: crop.y + crop.h / 2 },
      ]
    : [];

  const naturalCrop =
    crop && imgRect
      ? {
          x: Math.round((crop.x / imgRect.width) * naturalWidth),
          y: Math.round((crop.y / imgRect.height) * naturalHeight),
          w: Math.round((crop.w / imgRect.width) * naturalWidth),
          h: Math.round((crop.h / imgRect.height) * naturalHeight),
        }
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4 select-none">
      {/* Toolbar */}
      <div className="w-full max-w-5xl mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-white font-semibold text-base">Crop Image</h2>

        <div className="flex flex-wrap gap-1.5">
          {ASPECT_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setAspectRatio(p.value)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                aspectRatio === p.value
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-white/20 text-white/50 hover:border-white/40 hover:text-white/80"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="relative inline-flex items-center justify-center"
        style={{ maxWidth: "100%", maxHeight: "70vh" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt="Crop"
          onLoad={measureImg}
          draggable={false}
          style={{ maxWidth: "100%", maxHeight: "70vh", display: "block" }}
        />

        {imgRect && crop && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: imgRect.left,
              top: imgRect.top,
              width: imgRect.width,
              height: imgRect.height,
            }}
          >
            {/* Dim overlay — 4 quadrants around crop */}
            <div
              className="absolute bg-black/55"
              style={{ left: 0, top: 0, width: imgRect.width, height: crop.y }}
            />
            <div
              className="absolute bg-black/55"
              style={{
                left: 0,
                top: crop.y + crop.h,
                width: imgRect.width,
                height: imgRect.height - crop.y - crop.h,
              }}
            />
            <div
              className="absolute bg-black/55"
              style={{ left: 0, top: crop.y, width: crop.x, height: crop.h }}
            />
            <div
              className="absolute bg-black/55"
              style={{
                left: crop.x + crop.w,
                top: crop.y,
                width: imgRect.width - crop.x - crop.w,
                height: crop.h,
              }}
            />

            {/* Crop box */}
            <div
              className="absolute border border-white/90 pointer-events-auto"
              style={{
                left: crop.x,
                top: crop.y,
                width: crop.w,
                height: crop.h,
                cursor: CURSOR.move,
              }}
              onMouseDown={(e) => startDrag(e, "move")}
            >
              {/* Rule-of-thirds grid */}
              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="absolute top-0 bottom-0 border-l border-white/20"
                  style={{ left: "33.33%" }}
                />
                <div
                  className="absolute top-0 bottom-0 border-l border-white/20"
                  style={{ left: "66.66%" }}
                />
                <div
                  className="absolute left-0 right-0 border-t border-white/20"
                  style={{ top: "33.33%" }}
                />
                <div
                  className="absolute left-0 right-0 border-t border-white/20"
                  style={{ top: "66.66%" }}
                />
              </div>
              {/* Corner accent lines */}
              <div className="absolute top-0 left-0 w-4 h-0.5 bg-white" />
              <div className="absolute top-0 left-0 w-0.5 h-4 bg-white" />
              <div className="absolute top-0 right-0 w-4 h-0.5 bg-white" />
              <div className="absolute top-0 right-0 w-0.5 h-4 bg-white" />
              <div className="absolute bottom-0 left-0 w-4 h-0.5 bg-white" />
              <div className="absolute bottom-0 left-0 w-0.5 h-4 bg-white" />
              <div className="absolute bottom-0 right-0 w-4 h-0.5 bg-white" />
              <div className="absolute bottom-0 right-0 w-0.5 h-4 bg-white" />
            </div>

            {/* Resize handles */}
            {handles.map((h) => (
              <div
                key={h.id}
                onMouseDown={(e) => startDrag(e, h.id)}
                className="absolute bg-white rounded-sm shadow pointer-events-auto"
                style={{
                  width: HANDLE_PX,
                  height: HANDLE_PX,
                  left: h.cx - HANDLE_PX / 2,
                  top: h.cy - HANDLE_PX / 2,
                  cursor: CURSOR[h.id],
                  zIndex: 10,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dimensions readout */}
      <div className="mt-3 h-5 text-white/50 text-xs font-mono">
        {naturalCrop && (
          <span>
            {naturalCrop.x}, {naturalCrop.y} &nbsp;→&nbsp; {naturalCrop.w} × {naturalCrop.h} px
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg border border-white/20 text-white/60 text-sm hover:border-white/40 hover:text-white/80 transition-colors"
        >
          Reset
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-white/20 text-white/60 text-sm hover:border-white/40 hover:text-white/80 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleApply}
          className="px-6 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Apply Crop
        </button>
      </div>
    </div>
  );
}
