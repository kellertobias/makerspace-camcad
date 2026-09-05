import type { Path, Vec2 } from '@/lib/geometry/types';
import { clipLines } from '@/lib/geometry/offset';
import { bbox as pathBBox } from '@/lib/geometry/path';
import { bboxUnion } from '@/lib/geometry/types';

/**
 * Parallel lines at `pitch` and `angleDeg` clipped to `region` (CCW outers, CW holes), ordered row by row with
 * alternating direction (serpentine). Used for pocket rasters and laser hatching.
 */
export function rasterLines(region: Path[], pitch: number, angleDeg: number): Vec2[][] {
  if (!region.length || pitch <= 1e-6) return [];
  const b = region.map(pathBBox).reduce(bboxUnion);
  const ang = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };
  const nrm = { x: -dir.y, y: dir.x };
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const half = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + 1;
  const lines: Vec2[][] = [];
  for (let o = -half; o <= half; o += pitch) {
    const px = cx + nrm.x * o, py = cy + nrm.y * o;
    lines.push([{ x: px - dir.x * half, y: py - dir.y * half }, { x: px + dir.x * half, y: py + dir.y * half }]);
  }
  const clipped = clipLines(lines, region)
    .filter((l) => l.length >= 2 && Math.hypot(l[0].x - l[l.length - 1].x, l[0].y - l[l.length - 1].y) > 0.05)
    // Clipper returns open paths in arbitrary direction: make every line run along +dir first
    .map((l) => { const e = l[l.length - 1]; return (e.x - l[0].x) * dir.x + (e.y - l[0].y) * dir.y < 0 ? [...l].reverse() : l; });
  const keyed = clipped.map((l) => ({ l, o: (l[0].x - cx) * nrm.x + (l[0].y - cy) * nrm.y, a: (l[0].x - cx) * dir.x + (l[0].y - cy) * dir.y }));
  keyed.sort((p, q) => p.o - q.o || p.a - q.a);
  let flip = false, lastO = Infinity;
  return keyed.map((k) => { if (Math.abs(k.o - lastO) > 1e-6) { flip = !flip; lastO = k.o; } return flip ? [...k.l].reverse() : k.l; });
}
