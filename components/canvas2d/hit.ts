import type { Project, Vec2, Path } from '@/lib/model/project';
import { worldPaths } from '@/lib/cam/instances';
import { closestPoint } from '@/lib/geometry/path';
import { pathBBoxFast } from './renderer';

export interface Hit { placementId: string; pathId: string; d: number }

/** Nearest path to a world point within `tol` mm. */
export function hitTest(project: Project, pt: Vec2, tol: number): Hit | null {
  let best: Hit | null = null;
  for (const pl of Object.values(project.placements)) {
    if (pl.visible === false) continue;
    for (const { path } of worldPaths(project, pl)) {
      const bb = pathBBoxFast(path);
      if (pt.x < bb.minX - tol || pt.x > bb.maxX + tol || pt.y < bb.minY - tol || pt.y > bb.maxY + tol) continue;
      const d = path.segs.length ? closestPoint(path, pt).d : Math.hypot(path.start.x - pt.x, path.start.y - pt.y);
      if (d <= tol && (!best || d < best.d)) best = { placementId: pl.id, pathId: path.id, d };
    }
  }
  return best;
}

/** Contours (as `${placementId}:${pathId}`) whose bounding box lies fully inside the rectangle. */
export function pathsInRect(project: Project, r: { minX: number; minY: number; maxX: number; maxY: number }): string[] {
  const out: string[] = [];
  for (const pl of Object.values(project.placements)) {
    if (pl.visible === false) continue;
    for (const { path } of worldPaths(project, pl)) {
      const bb = pathBBoxFast(path);
      const key = `${pl.id}:${path.id}`;
      if (bb.minX >= r.minX && bb.maxX <= r.maxX && bb.minY >= r.minY && bb.maxY <= r.maxY && !out.includes(key)) out.push(key);
    }
  }
  return out;
}
export type { Path };
