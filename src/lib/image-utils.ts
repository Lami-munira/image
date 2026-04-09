export interface ImageInfo {
  name: string;
  format: string;
  width: number;
  height: number;
  dpi: number;
  fileSize: number;
  mimeType: string;
}

export interface TransformOptions {
  width?: number;
  height?: number;
  dpi?: number;
  name?: string;
  format?: string;
}

const FORMAT_MIME: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
};

export const SUPPORTED_FORMATS = ["png", "jpeg", "webp", "bmp"];

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

export function loadImage(file: File): Promise<{ img: HTMLImageElement; buffer: ArrayBuffer }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const blob = new Blob([buffer], { type: file.type });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        resolve({ img, buffer });
        URL.revokeObjectURL(url);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
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

export async function transformImage(
  img: HTMLImageElement,
  original: ImageInfo,
  options: TransformOptions
): Promise<Blob> {
  const targetWidth = options.width ?? original.width;
  const targetHeight = options.height ?? original.height;
  const targetFormat = options.format ?? original.format;
  const mime = FORMAT_MIME[targetFormat] || "image/png";

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // Draw the image stretched/compressed to fit the target dimensions
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // For PNG with custom DPI, we can patch the pHYs chunk
  if (targetFormat === "png" && options.dpi && options.dpi !== original.dpi) {
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(new Blob());
          blob.arrayBuffer().then((buf) => {
            const patched = patchPngDpi(buf, options.dpi!);
            resolve(new Blob([patched], { type: "image/png" }));
          });
        },
        mime,
        1.0
      );
    });
  }

  // For JPEG with custom DPI, patch JFIF
  if ((targetFormat === "jpeg" || targetFormat === "jpg") && options.dpi && options.dpi !== original.dpi) {
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(new Blob());
          blob.arrayBuffer().then((buf) => {
            const patched = patchJpegDpi(buf, options.dpi!);
            resolve(new Blob([patched], { type: "image/jpeg" }));
          });
        },
        mime,
        0.95
      );
    });
  }

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || new Blob()),
      mime,
      mime === "image/jpeg" ? 0.95 : 1.0
    );
  });
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
  const view = new DataView(buffer);

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
