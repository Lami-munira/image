"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CropRect,
  ImageInfo,
  RawImage,
  formatFileSize,
  getImageInfo,
  imgToRaw,
  loadImage,
  rawToDataUrl,
} from "@/lib/image-utils";
import { ImageHistory } from "@/lib/history";
import {
  engineBlur,
  engineCrop,
  engineFlip,
  engineResize,
  engineRotateFree,
  engineRotateQuarter,
  runOp,
} from "@/lib/engine";
import type { MethodChoice } from "@/lib/resample";
import type { PixelOp, PixelOpParams } from "@/lib/worker/processor";
import { CropEditor } from "@/components/crop-editor";
import { DrawCanvas } from "@/components/draw-canvas";
import { ResizePanel } from "@/components/editor/resize-panel";
import { RotatePanel } from "@/components/editor/rotate-panel";
import { BlurPanel } from "@/components/editor/blur-panel";
import { ExportPanel } from "@/components/editor/export-panel";
import { HistoryPanel, type HistoryRow } from "@/components/editor/history-panel";

type Tool = "resize" | "crop" | "rotate" | "blur" | "draw" | "export" | "history";
type Status = "idle" | "loading" | "ready";

/** Longest visible-preview side, in canvas pixels (CSS scales it further). */
const MAX_PREVIEW_PX = 2048;

interface HistoryRowInfo {
  index: number;
  label: string;
  thumb: RawImage;
  dims: [number, number];
  isBase: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  replayable: boolean;
}

interface HistoryInfo {
  edits: number;
  capacity: number;
  canUndo: boolean;
  canRedo: boolean;
  rows: HistoryRowInfo[];
}

const TABS: { id: Tool; label: string; icon: string }[] = [
  { id: "resize", label: "Resize", icon: "M3 8V3h5M21 16v5h-5M3 3l7 7M21 21l-7-7" },
  { id: "crop", label: "Crop", icon: "M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" },
  { id: "rotate", label: "Rotate", icon: "M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" },
  { id: "blur", label: "Blur", icon: "M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z" },
  {
    id: "draw",
    label: "Draw",
    icon: "M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z",
  },
  {
    id: "export",
    label: "Export",
    icon: "M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3",
  },
  { id: "history", label: "History", icon: "M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
];

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [original, setOriginal] = useState<ImageInfo | null>(null);
  const [tool, setTool] = useState<Tool>("resize");
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [histInfo, setHistInfo] = useState<HistoryInfo>({
    edits: 0,
    capacity: 11,
    canUndo: false,
    canRedo: false,
    rows: [],
  });
  const [showCropper, setShowCropper] = useState(false);
  const [cropperSrc, setCropperSrc] = useState("");

  const imgStateRef = useRef<RawImage | null>(null);
  const historyRef = useRef<ImageHistory | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  /** Full-resolution raster of the current state, rebuilt once per commit; the
   * visible preview is GPU-scaled down from it (see MAX_PREVIEW_PX). */
  const fullCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const syncHist = useCallback(() => {
    const h = historyRef.current;
    if (!h) return;
    const rows: HistoryRowInfo[] = h.entriesList.map((e, i) => ({
      index: i,
      label: e.label,
      thumb: e.thumb,
      dims: [e.raw.width, e.raw.height] as [number, number],
      isBase: i === 0,
      isCurrent: i === h.position,
      isFuture: i > h.position,
      replayable: !!e.op,
    }));
    setHistInfo({
      edits: h.edits,
      capacity: h.capacity,
      canUndo: h.canUndo,
      canRedo: h.canRedo,
      rows,
    });
  }, []);

  const renderPreview = useCallback(() => {
    const canvas = previewRef.current;
    const raw = imgStateRef.current;
    if (!canvas || !raw) return;

    // Materialize the full-resolution pixels once per commit
    let full = fullCanvasRef.current;
    if (!full || full.width !== raw.width || full.height !== raw.height) {
      full = document.createElement("canvas");
      full.width = raw.width;
      full.height = raw.height;
      fullCanvasRef.current = full;
    }
    const fctx = full.getContext("2d")!;
    fctx.putImageData(new ImageData(raw.data, raw.width, raw.height), 0, 0);

    // Cap the visible canvas — putImageData of a 24 MP image is a ~150 ms
    // main-thread copy, and the browser then composites that huge canvas every
    // frame. drawImage's GPU scaler makes a ≤2048 px preview visually identical.
    const scale = Math.min(1, MAX_PREVIEW_PX / Math.max(raw.width, raw.height));
    const dw = Math.max(1, Math.round(raw.width * scale));
    const dh = Math.max(1, Math.round(raw.height * scale));
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(full, 0, 0, dw, dh);
  }, []);

  // Paint the preview whenever the working image, page state, or tool changes
  // (switching tools remounts the preview canvas)
  useEffect(() => {
    if (status === "ready") renderPreview();
  }, [version, status, tool, renderPreview]);

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("loading");
      try {
        const { img, buffer } = await loadImage(file);
        const raw = imgToRaw(img);
        imgStateRef.current = raw;
        if (!historyRef.current) historyRef.current = new ImageHistory();
        historyRef.current.reset(raw);
        syncHist();
        setOriginal(getImageInfo(file, img, buffer));
        setTool("resize");
        setVersion((v) => v + 1);
        setStatus("ready");
      } catch {
        setStatus("idle");
        alert("Could not load image. Please try a different file.");
      }
    },
    [syncHist]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  /** Commit an async (worker) operation as a new history state. */
  const commit = useCallback(
    async (label: string, p: Promise<RawImage>, op?: PixelOpParams) => {
      if (!imgStateRef.current || !historyRef.current) return;
      setBusy(label);
      try {
        const next = await p;
        imgStateRef.current = next;
        historyRef.current.push(next, { label, op });
        syncHist();
        setVersion((v) => v + 1);
      } catch (err) {
        console.error("Operation failed:", err);
        alert(
          "Operation failed. If the image is very large, the browser may have run out of memory."
        );
      } finally {
        setBusy(null);
      }
    },
    [syncHist]
  );

  /** Commit already-computed pixels (draw tool) as a new history state. */
  const commitRaw = useCallback(
    (next: RawImage, label: string) => {
      if (!historyRef.current) return;
      imgStateRef.current = next;
      historyRef.current.push(next, { label });
      syncHist();
      setVersion((v) => v + 1);
    },
    [syncHist]
  );

  /** Time-travel to a history entry and continue working from it. */
  const handleJump = useCallback(
    (index: number) => {
      const h = historyRef.current;
      if (!h) return;
      imgStateRef.current = h.jumpTo(index);
      syncHist();
      setVersion((v) => v + 1);
    },
    [syncHist]
  );

  /** Re-run a stored (replayable) edit on the current working image. */
  const handleReapply = useCallback(
    (row: HistoryRow) => {
      const h = historyRef.current;
      const cur = imgStateRef.current;
      if (!h || !cur) return;
      const entry = h.entriesList[row.index];
      if (!entry?.op) return;
      const op = entry.op;
      commit(`Again: ${entry.label}`, runOp({ ...op, src: cur } as PixelOp), op);
    },
    [commit]
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    const prev = h?.undo();
    if (h && prev) {
      imgStateRef.current = prev;
      syncHist();
      setVersion((v) => v + 1);
    }
  }, [syncHist]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const next = h?.redo();
    if (h && next) {
      imgStateRef.current = next;
      syncHist();
      setVersion((v) => v + 1);
    }
  }, [syncHist]);

  const resetToBase = useCallback(() => {
    const h = historyRef.current;
    const base = h?.resetToBase();
    if (h && base) {
      imgStateRef.current = base;
      syncHist();
      setVersion((v) => v + 1);
    }
  }, [syncHist]);

  const startOver = () => {
    setStatus("idle");
    setOriginal(null);
    imgStateRef.current = null;
    historyRef.current = null;
    setHistInfo({ edits: 0, capacity: 11, canUndo: false, canRedo: false, rows: [] });
    setShowCropper(false);
    setCropperSrc("");
    if (inputRef.current) inputRef.current.value = "";
  };

  // ⌘Z / ⌘⇧Z / ⌘Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))
        return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const openCropper = () => {
    if (!imgStateRef.current) return;
    setCropperSrc(rawToDataUrl(imgStateRef.current));
    setShowCropper(true);
  };

  const handleCropApply = (crop: CropRect) => {
    setShowCropper(false);
    if (imgStateRef.current) {
      commit("Crop", engineCrop(imgStateRef.current, crop), { type: "crop", rect: crop });
    }
  };

  const cur = imgStateRef.current;

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Image Studio</h1>
          <p className="text-muted mt-1 text-sm">
            Resize, crop, rotate, blur, draw, convert — all math, all in your browser
          </p>
        </header>

        {/* Upload zone */}
        {status === "idle" && (
          <div
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="max-w-3xl mx-auto border-2 border-dashed border-border rounded-2xl p-16 text-center cursor-pointer hover:border-accent transition-colors"
          >
            <svg
              className="mx-auto mb-4 text-muted"
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-lg font-medium">Drop an image here or click to browse</p>
            <p className="text-muted text-sm mt-1">
              Everything is processed locally — nothing is uploaded
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>
        )}

        {/* Loading */}
        {status === "loading" && (
          <div className="text-center py-16">
            <div className="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-muted">Loading image...</p>
          </div>
        )}

        {/* Editor */}
        {status === "ready" && original && cur && (
          <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
            {/* Main column */}
            <div className="space-y-4 min-w-0">
              {tool === "draw" ? (
                <div className="bg-card rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                      Draw
                    </h2>
                    <button
                      onClick={startOver}
                      className="text-xs text-muted hover:text-danger transition-colors"
                    >
                      Start Over
                    </button>
                  </div>
                  <DrawCanvas
                    raw={cur}
                    version={version}
                    busy={busy !== null}
                    onCommit={commitRaw}
                    onUndo={undo}
                    canUndo={histInfo.canUndo}
                  />
                </div>
              ) : (
                <div className="bg-card rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                      Preview
                    </h2>
                    <button
                      onClick={startOver}
                      className="text-xs text-muted hover:text-danger transition-colors"
                    >
                      Start Over
                    </button>
                  </div>
                  <div className="relative checker rounded-lg border border-border overflow-hidden flex justify-center items-center min-h-[240px]">
                    <canvas
                      ref={previewRef}
                      className="block max-w-full max-h-[52vh] w-auto h-auto"
                    />
                    <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md font-mono">
                      {cur.width} × {cur.height} px
                      {histInfo.edits > 0 && (
                        <span className="text-white/50">
                          {" "}
                          · from {original.width} × {original.height}
                        </span>
                      )}
                    </div>
                    {busy && (
                      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-3">
                        <span className="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        <span className="text-white/80 text-sm">{busy}…</span>
                      </div>
                    )}
                  </div>

                  {/* History bar */}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={undo}
                      disabled={!histInfo.canUndo || busy !== null}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ⟲ Undo
                    </button>
                    <button
                      onClick={redo}
                      disabled={!histInfo.canRedo || busy !== null}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted hover:border-accent hover:text-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Redo ⟳
                    </button>
                    <button
                      onClick={resetToBase}
                      disabled={histInfo.edits === 0 || busy !== null}
                      className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted hover:border-danger hover:text-danger transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Reset
                    </button>
                    <span className="ml-auto text-[11px] text-muted">
                      {histInfo.edits} / {histInfo.capacity - 1} edits ·{" "}
                      <button
                        onClick={() => setTool("history")}
                        className="underline hover:text-accent transition-colors"
                      >
                        view trail
                      </button>{" "}
                      · ⌘Z
                    </span>
                  </div>
                </div>
              )}

              {/* Info chips */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <InfoCard label="File" value={original.name} />
                <InfoCard label="Format" value={original.format.toUpperCase()} />
                <InfoCard label="Dimensions" value={`${original.width} × ${original.height}`} />
                <InfoCard label="DPI" value={String(original.dpi)} />
                <InfoCard label="Size" value={formatFileSize(original.fileSize)} />
                <InfoCard label="Current" value={`${cur.width} × ${cur.height}`} />
              </div>
            </div>

            {/* Sidebar */}
            <aside className="bg-card rounded-xl border border-border p-4 lg:sticky lg:top-4">
              <div className="grid grid-cols-4 gap-1.5 mb-4">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTool(t.id)}
                    className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg border text-[11px] font-medium transition-colors ${
                      tool === t.id
                        ? "border-accent text-accent bg-accent/10"
                        : "border-border text-muted hover:border-accent hover:text-accent"
                    }`}
                  >
                    <svg
                      width="15"
                      height="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                    </svg>
                    {t.label}
                  </button>
                ))}
              </div>

              {tool === "resize" && (
                <ResizePanel
                  raw={cur}
                  version={version}
                  busy={busy !== null}
                  onApply={(w, h, m: MethodChoice) =>
                    commit(`Resize to ${w}×${h}`, engineResize(cur, w, h, m), {
                      type: "resize",
                      dw: w,
                      dh: h,
                      method: m,
                    })
                  }
                />
              )}

              {tool === "crop" && (
                <div>
                  <p className="text-xs text-muted leading-snug mb-4">
                    Drag a region with aspect presets (1:1, 4:3, 16:9…), then apply. The crop
                    commits to the working image — undo anytime.
                  </p>
                  <button
                    onClick={openCropper}
                    disabled={busy !== null}
                    className="w-full px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40"
                  >
                    Open Crop Editor
                  </button>
                  <div className="mt-4 p-3 bg-background rounded-lg border border-border text-xs text-muted font-mono">
                    working: {cur.width} × {cur.height} px
                  </div>
                </div>
              )}

              {tool === "rotate" && (
                <RotatePanel
                  busy={busy !== null}
                  onQuarter={(q) =>
                    commit(`Rotate ${(q * 90) % 360}°`, engineRotateQuarter(cur, q), {
                      type: "rotate-quarter",
                      quarter: q,
                    })
                  }
                  onFlip={(axis) =>
                    commit(
                      axis === "h" ? "Flip horizontal" : "Flip vertical",
                      engineFlip(cur, axis),
                      {
                        type: "flip",
                        axis,
                      }
                    )
                  }
                  onFree={(deg, method, fill) =>
                    commit(`Rotate ${deg}°`, engineRotateFree(cur, { angle: deg, method, fill }), {
                      type: "rotate-free",
                      options: { angle: deg, method, fill },
                    })
                  }
                />
              )}

              {tool === "blur" && (
                <BlurPanel
                  raw={cur}
                  busy={busy !== null}
                  onApply={(sigma) =>
                    commit(`Blur σ${sigma}`, engineBlur(cur, sigma), { type: "blur", sigma })
                  }
                />
              )}

              {tool === "export" && (
                <ExportPanel raw={cur} original={original} busy={busy !== null} />
              )}

              {tool === "history" && (
                <HistoryPanel
                  rows={histInfo.rows}
                  busy={busy !== null}
                  onJump={handleJump}
                  onReapply={handleReapply}
                />
              )}
            </aside>
          </div>
        )}

        {showCropper && cur && (
          <CropEditor
            src={cropperSrc}
            naturalWidth={cur.width}
            naturalHeight={cur.height}
            onApply={handleCropApply}
            onCancel={() => setShowCropper(false)}
          />
        )}
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg p-3 border border-border">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-medium mt-0.5 truncate" title={value}>
        {value}
      </p>
    </div>
  );
}
