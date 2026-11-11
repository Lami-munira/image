import { encodeBmp } from "./bmp-encoder";

export interface ImageInfo {
  name: string;
  format: string;
  width: number;
  height: number;
  dpi: number;
  fileSize: number;
  mimeType: string;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The editor's working image: straight (non-premultiplied) RGBA bytes.
 * Every tool takes one of these in and produces a new one out.
 * The buffer generic keeps the type assignable to `new ImageData(...)`.
 */
export interface RawImage {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export function cloneRaw(raw: RawImage): RawImage {
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

/** Decode an <img> into working RGBA pixels. */
export function imgToRaw(img: HTMLImageElement): RawImage {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return {
    data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width,
    height: canvas.height,
  };
}

export function rawToCanvas(raw: RawImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = raw.width;
  canvas.height = raw.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(raw.data, raw.width, raw.height), 0, 0);
  return canvas;
}

export function rawToDataUrl(raw: RawImage): string {
  return rawToCanvas(raw).toDataURL("image/png");
}

const FORMAT_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
};

export const SUPPORTED_FORMATS = ["png", "jpeg", "webp", "bmp"];

export interface EncodeOptions {
  format: string;
  /** 1–100, used by lossy encoders (JPEG/WebP). */
  quality?: number;
  /** DPI metadata written into PNG pHYs / JPEG JFIF chunks. */
  dpi?: number;
  /** CSS color used to flatten transparency for JPEG/BMP. */
  background?: string;
}

export interface EncodeResult {
  blob: Blob;
  ext: string;
}

/**
 * Encode working pixels to an image file.
 * - PNG/JPEG/WebP via canvas; JPEG/BMP flatten alpha onto `background`
 *   (browsers would otherwise flatten JPEG onto black).
 * - BMP uses a real 24-bit encoder (canvas.toBlob cannot write BMP).
 * - DPI is patched into PNG pHYs / JPEG JFIF after encoding.
 */
export async function encodeImage(raw: RawImage, opts: EncodeOptions): Promise<EncodeResult> {
  const format = opts.format in FORMAT_MIME ? opts.format : "png";
  const ext = format === "jpeg" ? "jpg" : format;

  if (format === "bmp") {
    const buf = encodeBmp(raw.data, raw.width, raw.height, opts.background ?? "#ffffff");
    return { blob: new Blob([buf], { type: "image/bmp" }), ext };
  }

  const mime = FORMAT_MIME[format];
  let canvas = rawToCanvas(raw);

  if (format === "jpeg") {
    const flat = document.createElement("canvas");
    flat.width = raw.width;
    flat.height = raw.height;
    const fctx = flat.getContext("2d")!;
    fctx.fillStyle = opts.background ?? "#ffffff";
    fctx.fillRect(0, 0, flat.width, flat.height);
    fctx.drawImage(canvas, 0, 0);
    canvas = flat;
  }

  const quality = Math.min(100, Math.max(1, opts.quality ?? 95)) / 100;
  let blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b ?? new Blob()), mime, format === "png" ? undefined : quality);
  });

  if (opts.dpi && (format === "png" || format === "jpeg")) {
    const buf = await blob.arrayBuffer();
    const patched = format === "png" ? patchPngDpi(buf, opts.dpi) : patchJpegDpi(buf, opts.dpi);
    blob = new Blob([patched], { type: mime });
  }

  return { blob, ext };
}

export function getFileExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || "png";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Try to extract DPI from raw file bytes (JPEG JFIF / PNG pHYs).
 * Falls back to 72 if not found.
 */
export function extractDpi(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);

  // --- JPEG: look for JFIF APP0 marker ---
  if (view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8) {
    let offset = 2;
    while (offset < view.byteLength - 1) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xe0) {
        // APP0
        const units = view.getUint8(offset + 11);
        const xDensity = view.getUint16(offset + 12);
        if (units === 1) return xDensity; // DPI
        if (units === 2) return Math.round(xDensity * 2.54); // dots/cm → DPI
        return xDensity || 72;
      }
      const segLen = view.getUint16(offset + 2);
      offset += 2 + segLen;
    }
  }

  // --- PNG: look for pHYs chunk ---
  if (
    view.getUint8(0) === 0x89 &&
    view.getUint8(1) === 0x50 &&
    view.getUint8(2) === 0x4e &&
    view.getUint8(3) === 0x47
  ) {
    let offset = 8;
    while (offset < view.byteLength - 12) {
      const chunkLen = view.getUint32(offset);
      const chunkType = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7)
      );
      if (chunkType === "pHYs") {
        const pxPerUnitX = view.getUint32(offset + 8);
        const unit = view.getUint8(offset + 16);
        if (unit === 1) return Math.round(pxPerUnitX / 39.3701); // meters → inches
        return Math.round(pxPerUnitX / 39.3701) || 72;
      }
      offset += 12 + chunkLen;
    }
  }

  return 72;
}

/**
 * Decode an uploaded file.
 * Single-copy path: the File itself becomes the object URL source (no
 * FileReader → Blob re-wrap). DPI bytes are read once, only after the image
 * has decoded, so huge files aren't held twice in memory.
 */
export async function loadImage(
  file: File
): Promise<{ img: HTMLImageElement; buffer: ArrayBuffer }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });
    const buffer = await file.arrayBuffer(); // for DPI metadata extraction
    return { img, buffer };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function getImageInfo(file: File, img: HTMLImageElement, buffer: ArrayBuffer): ImageInfo {
  const ext = getFileExtension(file.name);
  return {
    name: file.name.replace(/\.[^.]+$/, ""),
    format: ext === "jpg" ? "jpeg" : ext,
    width: img.naturalWidth,
    height: img.naturalHeight,
    dpi: extractDpi(buffer),
    fileSize: file.size,
    mimeType: file.type,
  };
}

function patchPngDpi(buffer: ArrayBuffer, dpi: number): ArrayBuffer {
  const ppm = Math.round(dpi * 39.3701); // pixels per meter

  // Build pHYs chunk: 4 bytes X + 4 bytes Y + 1 byte unit(1=meter) = 9 data bytes
  const phys = new ArrayBuffer(21); // 4 len + 4 type + 9 data + 4 crc
  const pv = new DataView(phys);
  pv.setUint32(0, 9); // length
  // "pHYs"
  pv.setUint8(4, 0x70);
  pv.setUint8(5, 0x48);
  pv.setUint8(6, 0x59);
  pv.setUint8(7, 0x73);
  pv.setUint32(8, ppm); // X pixels per unit
  pv.setUint32(12, ppm); // Y pixels per unit
  pv.setUint8(16, 1); // unit = meter

  // Calculate CRC over type + data (13 bytes)
  const crc = crc32(new Uint8Array(phys, 4, 13));
  pv.setUint32(17, crc);

  // Insert pHYs right after IHDR (8 byte signature + IHDR chunk)
  const src = new Uint8Array(buffer);
  // Find end of IHDR
  const ihdrLen = new DataView(buffer).getUint32(8);
  const insertPos = 8 + 12 + ihdrLen; // signature(8) + len(4) + type(4) + data + crc(4)

  // Remove existing pHYs if present
  let cleanSrc = src;
  const existingPhys = findChunk(buffer, "pHYs");
  if (existingPhys >= 0) {
    const chunkTotalLen = 12 + new DataView(buffer).getUint32(existingPhys);
    const before = src.slice(0, existingPhys);
    const after = src.slice(existingPhys + chunkTotalLen);
    cleanSrc = new Uint8Array(before.length + after.length);
    cleanSrc.set(before);
    cleanSrc.set(after, before.length);
  }

  const result = new Uint8Array(cleanSrc.length + 21);
  result.set(cleanSrc.slice(0, insertPos));
  result.set(new Uint8Array(phys), insertPos);
  result.set(cleanSrc.slice(insertPos), insertPos + 21);

  return result.buffer;
}

function patchJpegDpi(buffer: ArrayBuffer, dpi: number): ArrayBuffer {
  const src = new Uint8Array(buffer);

  // Find APP0 JFIF segment
  if (src[0] === 0xff && src[1] === 0xd8 && src[2] === 0xff && src[3] === 0xe0) {
    const result = new Uint8Array(buffer.slice(0));
    const rv = new DataView(result.buffer);
    rv.setUint8(11, 1); // units = DPI
    rv.setUint16(12, dpi); // X density
    rv.setUint16(14, dpi); // Y density
    return result.buffer;
  }

  // No JFIF header — prepend one
  const jfif = new Uint8Array(20);
  const jv = new DataView(jfif.buffer);
  jfif[0] = 0xff;
  jfif[1] = 0xe0;
  jv.setUint16(2, 16); // segment length
  // "JFIF\0"
  jfif[4] = 0x4a;
  jfif[5] = 0x46;
  jfif[6] = 0x49;
  jfif[7] = 0x46;
  jfif[8] = 0x00;
  jfif[9] = 1; // version major
  jfif[10] = 1; // version minor
  jfif[11] = 1; // units = DPI
  jv.setUint16(12, dpi);
  jv.setUint16(14, dpi);
  jfif[16] = 0; // thumbnail w
  jfif[17] = 0; // thumbnail h

  const result = new Uint8Array(2 + jfif.length + src.length - 2);
  result[0] = 0xff;
  result[1] = 0xd8;
  result.set(jfif, 2);
  result.set(src.slice(2), 2 + jfif.length);
  return result.buffer;
}

function findChunk(buffer: ArrayBuffer, type: string): number {
  const view = new DataView(buffer);
  let offset = 8;
  while (offset < view.byteLength - 12) {
    const chunkLen = view.getUint32(offset);
    const ct = String.fromCharCode(
      view.getUint8(offset + 4),
      view.getUint8(offset + 5),
      view.getUint8(offset + 6),
      view.getUint8(offset + 7)
    );
    if (ct === type) return offset;
    offset += 12 + chunkLen;
  }
  return -1;
}

// CRC32 for PNG chunks
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
