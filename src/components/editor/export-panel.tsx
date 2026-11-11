"use client";

import { useState } from "react";
import {
  encodeImage,
  formatFileSize,
  SUPPORTED_FORMATS,
  type ImageInfo,
  type RawImage,
} from "@/lib/image-utils";

interface ExportPanelProps {
  raw: RawImage;
  original: ImageInfo;
  busy: boolean;
}

export function ExportPanel({ raw, original, busy }: ExportPanelProps) {
  const [format, setFormat] = useState(
    SUPPORTED_FORMATS.includes(original.format) ? original.format : "png"
  );
  const [quality, setQuality] = useState(92);
  const [dpi, setDpi] = useState(original.dpi);
  const [background, setBackground] = useState("#ffffff");
  const [name, setName] = useState(original.name);
  const [saving, setSaving] = useState(false);
  const [lastSize, setLastSize] = useState<number | null>(null);

  const lossy = format === "jpeg" || format === "webp";
  const flattens = format === "jpeg" || format === "bmp";

  const handleDownload = async () => {
    setSaving(true);
    try {
      const { blob, ext } = await encodeImage(raw, {
        format,
        quality,
        dpi: dpi !== original.dpi ? dpi : undefined,
        background,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name || original.name}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setLastSize(blob.size);
    } catch {
      alert("Failed to encode image.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 p-3 rounded-xl bg-raised/60 border border-border-soft text-xs text-muted font-mono">
        {raw.width} × {raw.height} px
        {lastSize !== null && ` · last export ${formatFileSize(lastSize)}`}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-muted mb-1">File Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={original.name}
            className="input"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">Format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="input">
            {SUPPORTED_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
          {flattens && (
            <p className="mt-1.5 text-[11px] text-muted leading-snug">
              {format === "bmp"
                ? "BMP is encoded directly (24-bit) — browsers can't write it natively."
                : ""}
              {format === "jpeg" && " Transparency is flattened onto the background color."}
            </p>
          )}
        </div>

        {lossy && (
          <div>
            <label className="flex justify-between text-xs text-muted mb-1">
              <span>Quality</span>
              <span className="font-mono">{quality}</span>
            </label>
            <input
              type="range"
              min={1}
              max={100}
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        )}

        <div>
          <label className="block text-xs text-muted mb-1">DPI metadata</label>
          <input
            type="number"
            min={1}
            max={2400}
            value={dpi}
            onChange={(e) => setDpi(parseInt(e.target.value) || 72)}
            className="input"
          />
          <p className="mt-1.5 text-[11px] text-muted leading-snug">
            Written into PNG pHYs / JPEG JFIF chunks — pixel data is unchanged.
          </p>
        </div>

        {flattens && (
          <div>
            <label className="block text-xs text-muted mb-1">Background (for transparency)</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
              />
              <span className="text-[11px] text-muted font-mono">{background}</span>
            </div>
          </div>
        )}

        <button
          onClick={handleDownload}
          disabled={saving || busy}
          className="btn-primary w-full py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <span className="inline-block w-4 h-4 border-2 border-accent-ink border-t-transparent rounded-full animate-spin" />
              Encoding…
            </span>
          ) : (
            "Download"
          )}
        </button>
      </div>
    </div>
  );
}
