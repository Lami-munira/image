import type { RawImage } from "./image-utils";
import { downscaleFast } from "./resample";
import type { PixelOpParams } from "./worker/processor";

/**
 * Undo/redo history with a visible edit trail.
 *
 * Keeps the ORIGINAL state plus the last MAX_EDIT_STATES-1 edits (default:
 * original + 10 edits). Each entry carries the full pixel snapshot, a label,
 * a small thumbnail for the before/after strip, and — when the edit is
 * replayable — the stored operation parameters.
 *
 * Two caps: entry count and total bytes; the oldest states are evicted beyond
 * either, so very large images may keep fewer than 10 edits.
 */

export const MAX_EDIT_STATES = 11; // original + 10 edits
const THUMB_BOX = 64; // thumbnails fit inside 64×64
const THUMB_SAMPLES = 3; // samples per axis inside each source block (see downscaleFast)

export interface HistoryEntry {
  raw: RawImage;
  label: string;
  /** Small preview of this state (used as "before" of the next entry). */
  thumb: RawImage;
  time: number;
  /** Replayable op parameters; undefined for the original and for draw strokes. */
  op?: PixelOpParams;
}

export interface PushMeta {
  label: string;
  op?: PixelOpParams;
}

function makeThumb(raw: RawImage): RawImage {
  const scale = Math.min(1, THUMB_BOX / Math.max(raw.width, raw.height));
  const w = Math.max(1, Math.round(raw.width * scale));
  const h = Math.max(1, Math.round(raw.height * scale));
  if (w === raw.width && h === raw.height) {
    return { data: new Uint8ClampedArray(raw.data), width: w, height: h };
  }
  return downscaleFast(raw, w, h, THUMB_SAMPLES);
}

export class ImageHistory {
  private entries: HistoryEntry[] = [];
  private index = 0; // position of the current state
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  /** Running byte total — kept incrementally so eviction never re-scans the trail (O(n²) → O(n)). */
  private byteTotal = 0;

  constructor(maxEntries = MAX_EDIT_STATES, maxBytes = 192 * 1024 * 1024) {
    this.maxEntries = Math.max(2, maxEntries);
    this.maxBytes = maxBytes;
  }

  /** Start a fresh session with `base` as the "Original" state. */
  reset(base: RawImage): void {
    this.entries = [{ raw: base, label: "Original", thumb: makeThumb(base), time: Date.now() }];
    this.byteTotal = this.entries[0].raw.data.byteLength;
    this.index = 0;
  }

  /** Commit a new state; clears the redo tail and evicts old entries if over budget. */
  push(next: RawImage, meta: PushMeta): void {
    // Discard the redo tail, adjusting the running byte total
    for (let i = this.entries.length - 1; i > this.index; i--) {
      this.byteTotal -= this.entries[i].raw.data.byteLength;
    }
    this.entries.splice(this.index + 1);

    const entry: HistoryEntry = {
      raw: next,
      label: meta.label,
      thumb: makeThumb(next),
      time: Date.now(),
      op: meta.op,
    };
    this.entries.push(entry);
    this.byteTotal += next.data.byteLength;
    this.index = this.entries.length - 1;

    // Evict oldest entries; the running total makes this O(evicted) not O(n·passes)
    while (
      this.index > 0 &&
      (this.entries.length > this.maxEntries || this.byteTotal > this.maxBytes)
    ) {
      this.byteTotal -= this.entries[0].raw.data.byteLength;
      this.entries.shift();
      this.index--;
    }
  }

  /** Time-travel to entry i; later entries stay listed until a new edit is committed. */
  jumpTo(i: number): RawImage {
    this.index = Math.max(0, Math.min(i, this.entries.length - 1));
    return this.entries[this.index].raw;
  }

  get current(): RawImage {
    return this.entries[this.index].raw;
  }

  get entriesList(): HistoryEntry[] {
    return this.entries;
  }

  get position(): number {
    return this.index;
  }

  get size(): number {
    return this.entries.length;
  }

  /** How many states the trail can hold (original + edits). */
  get capacity(): number {
    return this.maxEntries;
  }

  get canUndo(): boolean {
    return this.index > 0;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  undo(): RawImage | null {
    if (!this.canUndo) return null;
    return this.jumpTo(this.index - 1);
  }

  redo(): RawImage | null {
    if (!this.canRedo) return null;
    return this.jumpTo(this.index + 1);
  }

  /** Jump back to the very first state (the untouched upload). */
  resetToBase(): RawImage | null {
    if (this.entries.length === 0) return null;
    return this.jumpTo(0);
  }

  get edits(): number {
    return this.index;
  }
}
