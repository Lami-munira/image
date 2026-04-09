"use client";

import { useCallback, useRef, useState } from "react";
import {
  ImageInfo,
  TransformOptions,
  SUPPORTED_FORMATS,
  formatFileSize,
  getImageInfo,
  loadImage,
  transformImage,
} from "@/lib/image-utils";

type Status = "idle" | "loading" | "ready" | "processing";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [original, setOriginal] = useState<ImageInfo | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [options, setOptions] = useState<TransformOptions>({});
  const [lockRatio, setLockRatio] = useState(true);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setStatus("loading");
    try {
      const { img, buffer } = await loadImage(file);
      imgRef.current = img;
      const info = getImageInfo(file, img, buffer);
      setOriginal(info);
      setOptions({});
      setPreview(URL.createObjectURL(file));
      setStatus("ready");
    } catch {
      setStatus("idle");
      alert("Could not load image. Please try a different file.");
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleWidthChange = (w: number) => {
    if (!original) return;
    const newOpts: TransformOptions = { ...options, width: w };
    if (lockRatio) {
      const ratio = original.height / original.width;
      newOpts.height = Math.round(w * ratio);
    }
    setOptions(newOpts);
  };

  const handleHeightChange = (h: number) => {
    if (!original) return;
    const newOpts: TransformOptions = { ...options, height: h };
    if (lockRatio) {
      const ratio = original.width / original.height;
      newOpts.width = Math.round(h * ratio);
    }
    setOptions(newOpts);
  };

  const handleDownload = async () => {
    if (!imgRef.current || !original) return;
    setStatus("processing");
    try {
      const blob = await transformImage(imgRef.current, original, options);
      const ext = options.format ?? original.format;
      const name = options.name ?? original.name;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.${ext === "jpeg" ? "jpg" : ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to process image.");
    }
    setStatus("ready");
  };

  const reset = () => {
    setStatus("idle");
    setOriginal(null);
    setPreview("");
    setOptions({});
    imgRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
  };

  const hasChanges =
    options.width !== undefined ||
    options.height !== undefined ||
    options.dpi !== undefined ||
    options.name !== undefined ||
    options.format !== undefined;

  const effectiveWidth = options.width ?? original?.width ?? 0;
  const effectiveHeight = options.height ?? original?.height ?? 0;

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Image Resizer</h1>
        <p className="text-muted mt-1 text-sm">
          Upload, resize, convert, and download — all in your browser
        </p>
      </header>

      {/* Upload zone */}
      {status === "idle" && (
        <div
          ref={dropRef}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-2xl p-16 text-center cursor-pointer hover:border-accent transition-colors"
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
          <p className="text-lg font-medium">
            Drop an image here or click to browse
          </p>
          <p className="text-muted text-sm mt-1">
            Supports PNG, JPEG, WebP, BMP, and more
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
      {(status === "ready" || status === "processing") && original && (
        <div className="space-y-6">
          {/* Preview + Info */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Image Preview */}
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                  Preview
                </h2>
                <button
                  onClick={reset}
                  className="text-xs text-muted hover:text-danger transition-colors"
                >
                  Remove
                </button>
              </div>
              <div className="relative bg-[#0c0c0f] rounded-lg overflow-hidden flex items-center justify-center min-h-[240px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt="Preview"
                  className="max-w-full max-h-[400px] object-contain"
                />
              </div>
            </div>

            {/* Original Info */}
            <div className="bg-card rounded-xl border border-border p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
                Original Info
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="File Name" value={original.name} />
                <InfoCard label="Format" value={original.format.toUpperCase()} />
                <InfoCard
                  label="Dimensions"
                  value={`${original.width} × ${original.height} px`}
                />
                <InfoCard label="DPI" value={String(original.dpi)} />
                <InfoCard
                  label="File Size"
                  value={formatFileSize(original.fileSize)}
                />
                <InfoCard label="MIME" value={original.mimeType} />
              </div>
            </div>
          </div>

          {/* Transform Controls */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-4">
              Transform
            </h2>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* File name */}
              <div>
                <label className="block text-xs text-muted mb-1">File Name</label>
                <input
                  type="text"
                  placeholder={original.name}
                  value={options.name ?? ""}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      name: e.target.value || undefined,
                    }))
                  }
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              {/* Format */}
              <div>
                <label className="block text-xs text-muted mb-1">Format</label>
                <select
                  value={options.format ?? original.format}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      format:
                        e.target.value === original.format
                          ? undefined
                          : e.target.value,
                    }))
                  }
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
                >
                  {SUPPORTED_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              {/* DPI */}
              <div>
                <label className="block text-xs text-muted mb-1">DPI</label>
                <input
                  type="number"
                  placeholder={String(original.dpi)}
                  value={options.dpi ?? ""}
                  onChange={(e) =>
                    setOptions((o) => ({
                      ...o,
                      dpi: e.target.value
                        ? parseInt(e.target.value)
                        : undefined,
                    }))
                  }
                  min={1}
                  max={2400}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              {/* Width */}
              <div>
                <label className="block text-xs text-muted mb-1">
                  Width (px)
                </label>
                <input
                  type="number"
                  placeholder={String(original.width)}
                  value={options.width ?? ""}
                  onChange={(e) =>
                    handleWidthChange(parseInt(e.target.value) || original.width)
                  }
                  min={1}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              {/* Height */}
              <div>
                <label className="block text-xs text-muted mb-1">
                  Height (px)
                </label>
                <input
                  type="number"
                  placeholder={String(original.height)}
                  value={options.height ?? ""}
                  onChange={(e) =>
                    handleHeightChange(
                      parseInt(e.target.value) || original.height
                    )
                  }
                  min={1}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              {/* Lock ratio toggle */}
              <div className="flex items-end pb-2">
                <button
                  onClick={() => setLockRatio((v) => !v)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    lockRatio
                      ? "border-accent text-accent"
                      : "border-border text-muted"
                  }`}
                >
                  <svg
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    {lockRatio ? (
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
                  {lockRatio ? "Ratio Locked" : "Ratio Unlocked"}
                </button>
              </div>
            </div>

            {/* Summary of changes */}
            {hasChanges && (
              <div className="mt-4 p-3 bg-background rounded-lg border border-border text-sm">
                <p className="text-muted text-xs uppercase tracking-wider mb-2 font-semibold">
                  Changes
                </p>
                <div className="flex flex-wrap gap-2">
                  {options.name && (
                    <ChangeBadge
                      label="Name"
                      from={original.name}
                      to={options.name}
                    />
                  )}
                  {options.format && (
                    <ChangeBadge
                      label="Format"
                      from={original.format}
                      to={options.format}
                    />
                  )}
                  {options.dpi && (
                    <ChangeBadge
                      label="DPI"
                      from={String(original.dpi)}
                      to={String(options.dpi)}
                    />
                  )}
                  {(options.width || options.height) && (
                    <ChangeBadge
                      label="Size"
                      from={`${original.width}×${original.height}`}
                      to={`${effectiveWidth}×${effectiveHeight}`}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={reset}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-card-hover transition-colors"
            >
              Start Over
            </button>
            <button
              onClick={handleDownload}
              disabled={status === "processing" || !hasChanges}
              className="px-6 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === "processing" ? (
                <span className="flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </span>
              ) : (
                "Download"
              )}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background rounded-lg p-3 border border-border">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-medium mt-0.5 truncate" title={value}>
        {value}
      </p>
    </div>
  );
}

function ChangeBadge({
  label,
  from,
  to,
}: {
  label: string;
  from: string;
  to: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-card text-xs border border-border">
      <span className="font-medium text-accent">{label}:</span>
      <span className="text-muted line-through">{from}</span>
      <span>→</span>
      <span className="text-success">{to}</span>
    </span>
  );
}
