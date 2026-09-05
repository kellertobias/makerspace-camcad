import type { Vec2 } from '@/lib/geometry/types';
import type { Operation } from '@/lib/model/project';
import type { Move } from './types';
import type { ContourCtx } from './contour';

export function drillMoves(p: Vec2, op: Operation & { type: 'drill' }, ctx: ContourCtx): Move[] {
  const out: Move[] = [];
  const zTop = ctx.zTop - op.zOffset - (ctx.groupDepth ?? 0);
  const bottom = zTop - op.depth;
  out.push({ k: 'rapid', x: p.x, y: p.y, z: ctx.safeZ, force: true });
  out.push({ k: 'rapid', z: zTop + ctx.clearZ });
  if (op.mode === 'peck' && op.peck && op.peck > 0) {
    let z = zTop;
    while (z > bottom + 1e-9) {
      z = Math.max(bottom, z - op.peck);
      out.push({ k: 'line', z, f: ctx.vfPlunge, s: ctx.s });
      ctx.s = undefined;
      if (z > bottom + 1e-9) { out.push({ k: 'rapid', z: zTop + ctx.clearZ }); out.push({ k: 'rapid', z: z + 0.5 }); }
    }
  } else {
    out.push({ k: 'line', z: bottom, f: ctx.vfPlunge, s: ctx.s });
  }
  if (op.dwell && op.dwell > 0) out.push({ k: 'dwell', seconds: op.dwell });
  out.push({ k: 'rapid', z: ctx.safeZ });
  return out;
}
