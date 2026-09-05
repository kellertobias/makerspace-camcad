import type { Placement, Project, Path, Mat } from '@/lib/model/project';
import { compose, translation, transformPath } from '@/lib/geometry/transform';
import type { BBox } from '@/lib/geometry/types';
import { emptyBBox, bboxAdd } from '@/lib/geometry/types';
import { flatten } from '@/lib/geometry/path';

/** Expand a placement (with optional array) into world transforms. */
export function instanceTransforms(pl: Placement): Mat[] {
  if (!pl.array || (pl.array.nx <= 1 && pl.array.ny <= 1)) return [pl.transform];
  const out: Mat[] = [];
  for (let j = 0; j < Math.max(1, pl.array.ny); j++) for (let i = 0; i < Math.max(1, pl.array.nx); i++) out.push(compose(translation(i * pl.array.dx, j * pl.array.dy), pl.transform));
  return out;
}

/** World-space paths of a placement (all instances). */
export function worldPaths(project: Project, pl: Placement): { path: Path; instance: number }[] {
  const shape = project.shapes[pl.shapeId];
  if (!shape) return [];
  const out: { path: Path; instance: number }[] = [];
  instanceTransforms(pl).forEach((m, k) => { for (const p of shape.paths) out.push({ path: transformPath(p, m), instance: k }); });
  return out;
}

export function placementBBox(project: Project, pl: Placement): BBox {
  const b = emptyBBox();
  for (const { path } of worldPaths(project, pl)) for (const q of flatten(path, 0.1)) bboxAdd(b, q.x, q.y);
  if (!Number.isFinite(b.minX)) { const p = { x: pl.transform[4], y: pl.transform[5] }; bboxAdd(b, p.x, p.y); }
  return b;
}

export function allPartsBBox(project: Project): BBox {
  const b = emptyBBox();
  for (const pl of Object.values(project.placements)) { const pb = placementBBox(project, pl); if (Number.isFinite(pb.minX)) { bboxAdd(b, pb.minX, pb.minY); bboxAdd(b, pb.maxX, pb.maxY); } }
  return b;
}
