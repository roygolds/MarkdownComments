// Type surface for fenceFoldRanges.js (authored as dependency-free JS so the
// unit tests can require it without TypeScript compilation). Mirrors the
// threadFocus.d.ts convention.

/** A fence's line span, in 0-based editor line numbers. */
export interface FenceLineSpan {
  startLine: number;
  endLine: number;
}

/** A foldable region: keep `start` visible, hide `start + 1`..`end`. */
export interface FoldRegion {
  start: number;
  end: number;
}

/**
 * Map fence spans to foldable regions, keeping only those that cover more than a
 * single line (`endLine > startLine`). `null` entries are skipped and order is
 * preserved.
 */
export function fenceFoldRegions(spans: Array<FenceLineSpan | null>): FoldRegion[];

/** The start line of each foldable region, in order. */
export function fenceFoldStartLines(spans: Array<FenceLineSpan | null>): number[];
