export type { Vec2, Mat, Segment, Path } from '@/lib/model/project';
export interface BBox { minX: number; minY: number; maxX: number; maxY: number }
export const EPS = 1e-6;
/** Geometric tolerance used for joining, comparison and arc refitting (mm). */
export const TOL = 0.01;

export const emptyBBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export function bboxAdd(b: BBox, x: number, y: number) {
  if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
  if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
}
export function bboxUnion(a: BBox, b: BBox): BBox {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}
export const bboxValid = (b: BBox) => Number.isFinite(b.minX) && b.maxX >= b.minX;
export const bboxCenter = (b: BBox) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
