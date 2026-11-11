# Image Studio

A browser-based image editing tool — everything is processed **locally**, nothing is uploaded.

Built with Next.js 16, React 19, and Tailwind CSS 4.

## Features

| Tool              | What it does                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Resize**        | Real interpolation — every destination pixel is computed from its source neighborhood via inverse mapping `sc = (dc + 0.5)·Ssrc/Sdst − 0.5`, never stretched. Methods: **Nearest**, **Bilinear**, **Bicubic** (Keys, a = −0.5), **Lanczos3** (windowed sinc), **Area** (box average for strong downscales), plus **Auto**. Includes multiplier presets (×2…×10), aspect lock, and a side-by-side method comparison strip.         |
| **Crop**          | Draggable crop box with 8 handles, aspect presets (1:1, 4:3, 16:9…), rule-of-thirds grid.                                                                                                                                                                                                                                                                                                                                         |
| **Rotate & Flip** | Lossless 90°/180° turns and horizontal/vertical mirrors; free-angle rotation by inverse mapping with bilinear/bicubic sampling and configurable corner fill.                                                                                                                                                                                                                                                                      |
| **Blur**          | Gaussian convolution `e^(−x²/2σ²)`, two separable 1-D passes, radius ⌈3σ⌉, live preview.                                                                                                                                                                                                                                                                                                                                          |
| **Draw**          | Pen, eraser, line, rectangle, ellipse, arrow, and text — each stroke commits to the full-resolution pixels.                                                                                                                                                                                                                                                                                                                       |
| **Export**        | PNG / JPEG / WebP / **real BMP** (hand-rolled 24-bit encoder — browsers can't write BMP natively), JPEG/WebP quality slider, DPI metadata (PNG pHYs / JPEG JFIF patching), background color for flattening transparency.                                                                                                                                                                                                          |
| **History**       | The original state plus the **last 10 edits**, each shown as a **before → after** thumbnail pair. Click a step to jump back and continue working from it; later steps stay listed (dimmed) until a new edit replaces them. Replayable edits (resize, crop, rotate, flip, blur) have a **Run again** button that re-executes the same operation on the current image. Session-only — cleared when you load a new image or refresh. |

All heavy pixel work runs in a **Web Worker** (separable kernels with precomputed
weight tables, premultiplied-alpha processing), so the UI never freezes on
large images. Undo/redo (`⌘Z` / `⌘⇧Z`) plus the visible History trail, both
backed by memory-capped snapshots (very large images may keep fewer than 10
edits to stay within the memory budget).

## Fixed from the original version

- Resize used `canvas.drawImage` (browser smoothing) — replaced with real interpolation kernels.
- BMP export silently produced PNG bytes (`canvas.toBlob` doesn't support BMP).
- PNG → JPEG conversion flattened transparency to black; now uses a chosen background.
- JPEG/WebP quality was hardcoded to 0.95; now adjustable.
- Crop preview and download used two separate code paths; now one working-image state.

## Development

```bash
npm install
npm run dev           # http://localhost:3000
npm run build         # production build
npm run lint          # eslint
npm run format        # prettier — write
npm run format:check  # prettier — CI check
```

## Why pure TypeScript (not numpy/OpenCV)?

The pixel algorithms are hand-written **TypeScript array math** (`Float32Array` /
`Uint8ClampedArray` loops — the same operations numpy expresses) running in a
Web Worker. That keeps everything client-side: no uploads, no server, static
hosting. numpy lives in Python, so using it would mean adding a backend server
— a different architecture. The kernels here implement the same math directly.

## Structure

```
src/lib/
  resample.ts      # interpolation kernels + separable engine
  effects.ts       # Gaussian blur
  geometry.ts      # rotate / flip / crop / free rotation
  bmp-encoder.ts   # 24-bit BMP encoder
  engine.ts        # worker façade (promise-based ops)
  worker/processor.ts
  history.ts       # undo/redo stack
  image-utils.ts   # file I/O, DPI byte-parsers, encoders
src/components/
  crop-editor.tsx  # crop modal
  draw-canvas.tsx  # annotation layer
  editor/          # tool panels (resize, rotate, blur, export, compare strip)
```
