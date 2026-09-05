import type { Path, Vec2 } from './types';
import { flatten, signedArea } from './path';

export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

export interface NestNode { path: Path; depth: number; parent: number | null; children: number[] }

/** Build a nesting tree of closed paths. depth 0 = outermost. Even depth = solid boundary, odd = hole. */
export function nestPaths(paths: Path[]): NestNode[] {
  const polys = paths.map((p) => flatten(p, 0.05));
  const areas = paths.map((p) => Math.abs(signedArea(p)));
  const order = paths.map((_, i) => i).sort((a, b) => areas[b] - areas[a]);
  const nodes: NestNode[] = paths.map((path) => ({ path, depth: 0, parent: null, children: [] }));
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    // find the smallest larger polygon containing this one
    let best: number | null = null;
    for (let m = k - 1; m >= 0; m--) {
      const j = order[m];
      if (pointInPolygon(polys[i][0], polys[j])) {
        if (best === null || areas[j] < areas[best]) best = j;
      }
    }
    nodes[i].parent = best;
    if (best !== null) nodes[best].children.push(i);
  }
  const setDepth = (i: number, d: number) => { nodes[i].depth = d; for (const c of nodes[i].children) setDepth(c, d + 1); };
  for (let i = 0; i < nodes.length; i++) if (nodes[i].parent === null) setDepth(i, 0);
  return nodes;
}
