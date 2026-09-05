import type { Path, Vec2 } from '@/lib/geometry/types';
import type { Operation } from '@/lib/model/project';
import type { Move } from './types';
import type { ContourCtx } from './contour';
import { offsetForSide, chooseStart } from './contour';
import { pathLength, signedArea, reverse, polylinePath } from '@/lib/geometry/path';
import { nestPaths } from '@/lib/geometry/containment';
import { movesAlong } from './entry';
import { rasterLines } from './raster';

export interface LaserCtx {
  /** S value for the requested power (already scaled to the machine's S max) */
  s: number;
  /** M4 dynamic power: the beam is off during rapids, so it is switched on once per operation */
  dynamic: boolean;
  /** Z used for the simulation only (the laser post disables the Z word): stock bottom for cuts, just below the top for engraving */
  z: number;
}

type CutOp = Operation & { type: 'laser-cut' };
type EngraveOp = Operation & { type: 'laser-engrave' };

/** Beam on before, off after a run of cutting moves (constant-power machines), or once per operation (dynamic). */
function withBeam(moves: Move[], laser: LaserCtx, body: () => void, perRun: boolean) {
  if (perRun && !laser.dynamic) { moves.push({ k: 'spindle', on: true, s: laser.s, dynamic: false }); body(); moves.push({ k: 'spindle', on: false }); }
  else body();
}

/** Laser cut along a contour, offset by half the kerf to the chosen side, repeated `passes` times. */
export function laserCutMoves(geom: Path, op: CutOp, ctx: ContourCtx, laser: LaserCtx): { moves: Move[]; toolPaths: Path[]; warnings: string[] } {
  const r = ctx.tool.d / 2;
  const warnings: string[] = [];
  const paths = offsetForSide(geom, op.kerfSide, r);
  if (!paths.length) { warnings.push('Contour too small for the kerf width'); return { moves: [], toolPaths: [], warnings }; }
  const moves: Move[] = [];
  const toolPaths: Path[] = [];
  const passes = Math.max(1, Math.round(op.passes));
  if (laser.dynamic) moves.push({ k: 'spindle', on: true, s: laser.s, dynamic: true });
  for (let p of paths) {
    if (p.closed && signedArea(p) < 0) p = reverse(p); // cut counter-clockwise by convention
    p = chooseStart(p, op);
    toolPaths.push(p);
    const len = pathLength(p);
    moves.push({ k: 'rapid', x: p.start.x, y: p.start.y, z: laser.z, force: true });
    withBeam(moves, laser, () => { for (let k = 0; k < passes; k++) moves.push(...movesAlong(p, 0, len, laser.z, laser.z, ctx.vf)); }, true);
  }
  if (laser.dynamic) moves.push({ k: 'spindle', on: false });
  return { moves, toolPaths, warnings };
}

/**
 * Laser engraving: 'vector' traces the lines themselves; 'hatch' fills closed contours (holes respected) with parallel
 * lines at the pitch and angle, optionally tracing the outline as well.
 */
export function laserEngraveMoves(paths: Path[], op: EngraveOp, ctx: ContourCtx, laser: LaserCtx): { moves: Move[]; toolPaths: Path[]; warnings: string[] } {
  const moves: Move[] = [];
  const toolPaths: Path[] = [];
  const warnings: string[] = [];
  const passes = Math.max(1, Math.round(op.passes ?? 1));
  const lines: Path[] = [];
  if (op.mode === 'hatch') {
    const closed = paths.filter((p) => p.closed && p.segs.length);
    if (!closed.length) warnings.push('Hatch engraving needs closed contours');
    // even nesting depth = area, odd = hole; CCW outers and CW holes form the region
    const region = nestPaths(closed).map((n) => { const ccw = signedArea(n.path) > 0; const wantCcw = n.depth % 2 === 0; return ccw === wantCcw ? n.path : reverse(n.path); });
    // keep the beam inside the contour: shrink the region by half the kerf is not needed for hatching, clip lines directly
    for (const l of rasterLines(region, Math.max(0.02, op.hatchPitch), op.hatchAngle)) lines.push(polylinePath(l, false));
    if (op.outline !== false) for (const p of closed) lines.push(p);
    for (const p of paths.filter((p) => !p.closed)) lines.push(p);
  } else for (const p of paths) lines.push(p);
  if (!lines.length) return { moves, toolPaths, warnings };
  if (laser.dynamic) moves.push({ k: 'spindle', on: true, s: laser.s, dynamic: true });
  let cur: Vec2 | null = null;
  for (let p of lines) {
    // enter each line at the end nearer to where the beam is
    if (cur && !p.closed) { const e = p.segs.length ? p.segs[p.segs.length - 1].to : p.start; if (Math.hypot(e.x - cur.x, e.y - cur.y) < Math.hypot(p.start.x - cur.x, p.start.y - cur.y)) p = reverse(p); }
    if (p.closed) p = chooseStart(p, op);
    toolPaths.push(p);
    const len = pathLength(p);
    moves.push({ k: 'rapid', x: p.start.x, y: p.start.y, z: laser.z, force: true });
    withBeam(moves, laser, () => { for (let k = 0; k < passes; k++) moves.push(...movesAlong(p, 0, len, laser.z, laser.z, ctx.vf)); }, true);
    cur = p.closed ? p.start : (p.segs.length ? p.segs[p.segs.length - 1].to : p.start);
  }
  if (laser.dynamic) moves.push({ k: 'spindle', on: false });
  return { moves, toolPaths, warnings };
}
