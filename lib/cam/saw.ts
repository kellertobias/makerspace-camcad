import type { Path } from '@/lib/geometry/types';
import type { Operation } from '@/lib/model/project';
import type { Move } from './types';
import type { ContourCtx } from './contour';
import { offsetForSide } from './contour';
import { segStart } from '@/lib/geometry/path';

/**
 * Saw grooves along the straight segments of a path: the blade (tool diameter = blade thickness) is offset to the
 * chosen side, plunged to the full depth at the segment start and drawn to its end. Arcs cannot be sawn and are skipped.
 */
export function sawMoves(geom: Path, op: Operation & { type: 'saw' }, ctx: ContourCtx): { moves: Move[]; toolPaths: Path[]; warnings: string[] } {
  const r = ctx.tool.d / 2;
  const warnings: string[] = [];
  const paths = offsetForSide(geom, op.side, r);
  const moves: Move[] = [];
  const toolPaths: Path[] = [];
  const zStart = ctx.zTop - op.zOffset - (ctx.groupDepth ?? 0);
  const z = zStart - op.depth;
  let arcs = 0;
  for (const p of paths) {
    for (let i = 0; i < p.segs.length; i++) {
      const s = p.segs[i];
      if (s.k !== 'L') { arcs++; continue; }
      const a = segStart(p, i), b = s.to;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
      toolPaths.push({ id: `${p.id}:saw${i}`, start: a, segs: [{ k: 'L', to: b }], closed: false, layer: p.layer });
      moves.push({ k: 'rapid', x: a.x, y: a.y, z: ctx.safeZ, force: true });
      moves.push({ k: 'rapid', z: zStart + ctx.clearZ });
      moves.push({ k: 'line', z, f: ctx.vfPlunge, s: ctx.s });
      ctx.s = undefined;
      moves.push({ k: 'line', x: b.x, y: b.y, z, f: ctx.vf });
      moves.push({ k: 'rapid', z: ctx.safeZ });
    }
  }
  if (arcs) warnings.push(`${arcs} arc segment(s) skipped: the saw only cuts straight grooves`);
  return { moves, toolPaths, warnings };
}
