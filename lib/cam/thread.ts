import type { Vec2 } from '@/lib/geometry/types';
import type { Operation } from '@/lib/model/project';
import type { Move } from './types';
import type { ContourCtx } from './contour';

/**
 * Thread milling with a single-point / multi-tooth thread mill: a helix with one pitch per revolution, cut from the
 * bottom upwards (internal threads, climb), quarter arcs so every controller can follow the helix.
 * Radial passes approach the final radius from the inside (internal) or outside (external).
 */
export function threadMoves(c: Vec2, op: Operation & { type: 'thread' }, ctx: ContourCtx): { moves: Move[]; warnings: string[] } {
  const warnings: string[] = [];
  const r = ctx.tool.d / 2;
  const pitch = Math.max(0.05, op.pitch);
  const finalR = op.internal ? op.majorD / 2 - r : op.majorD / 2 + r;
  if (op.internal && finalR <= 0.05) { warnings.push(`Tool Ø${ctx.tool.d} too large for an internal M${op.majorD} thread`); return { moves: [], warnings }; }
  const zStart = ctx.zTop - op.zOffset - (ctx.groupDepth ?? 0);
  const zBottom = zStart - op.depth;
  const passes = Math.max(1, Math.round(op.passes));
  const moves: Move[] = [];
  moves.push({ k: 'rapid', x: c.x, y: c.y, z: ctx.safeZ, force: true });
  moves.push({ k: 'rapid', z: zStart + ctx.clearZ });
  moves.push({ k: 'line', x: c.x, y: c.y, z: zBottom, f: ctx.vfPlunge, s: ctx.s });
  ctx.s = undefined;
  for (let p = 1; p <= passes; p++) {
    // radial engagement grows towards the final radius; external threads approach from outside
    const frac = p / passes;
    const R = op.internal ? finalR * (0.6 + 0.4 * frac) : finalR + (1 - frac) * r;
    // move to the start of the helix at the bottom
    moves.push({ k: 'line', x: c.x + R, y: c.y, z: zBottom, f: ctx.vf });
    let z = zBottom;
    let ang = 0;
    const revs = Math.ceil((zStart - zBottom) / pitch);
    for (let i = 0; i < revs * 4; i++) {
      ang += Math.PI / 2;
      z = Math.min(zStart, z + pitch / 4);
      moves.push({ k: 'arc', x: c.x + R * Math.cos(ang), y: c.y + R * Math.sin(ang), z, cx: c.x, cy: c.y, cw: !op.internal ? true : false, f: ctx.vf });
      if (z >= zStart - 1e-9 && i % 4 === 3) break;
    }
    // back to the centre before the next pass / retract (internal) or step out (external)
    if (op.internal) moves.push({ k: 'line', x: c.x, y: c.y, f: ctx.vf });
    if (p < passes) moves.push({ k: 'line', z: zBottom, f: ctx.vfPlunge });
  }
  if (!op.internal) moves.push({ k: 'rapid', z: ctx.safeZ });
  moves.push({ k: 'rapid', z: ctx.safeZ });
  return { moves, warnings };
}
