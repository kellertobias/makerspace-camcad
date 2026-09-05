import type { Path, Vec2 } from '@/lib/geometry/types';
import { asCircle, circlePath, pathLength, reverse, rotateStart, signedArea, pathEnd, segStart, flatten } from '@/lib/geometry/path';
import { offsetClosed, offsetOpenBand } from '@/lib/geometry/offset';
import { dist, sub, cross } from '@/lib/geometry/vec';
import type { Operation, Side, Tool, TabsSpec } from '@/lib/model/project';
import type { Move } from './types';
import { depthPasses } from './depth';
import { rampEntry, helixEntry, movesAlong } from './entry';
import { insertTabs, tabPositions, tabPoints } from './tabs';
import { applyOvercut } from './overcut';

export interface ContourCtx {
  tool: Tool;
  safeZ: number;
  clearZ: number;
  vf: number;
  vfPlunge: number;
  /** Spindle word to attach to the first cutting move (once per tool). */
  s?: number;
  zTop: number;
  thickness: number;
  /** Extra start depth from the group (positive = deeper). */
  groupDepth?: number;
  /** Manual bridge positions (world coordinates) for cutouts. */
  tabPoints?: Vec2[];
}

/** Compute the tool-centre path(s) for a geometry path with the given side. */
export function offsetForSide(path: Path, side: Side, r: number): Path[] {
  if (side === 'on' || r <= 0) return [path];
  if (path.closed) {
    const ccw = signedArea(path) > 0;
    const base = ccw ? path : reverse(path);
    if (side === 'outside' || side === 'left') return offsetClosed([base], r);
    if (side === 'inside' || side === 'right') return offsetClosed([base], -r);
    return [path];
  }
  // open path: offset band and pick the side by the sign of the cross product with the path direction
  const band = offsetOpenBand(path, r);
  if (!band.length) return [path];
  // The band outline is one closed loop; split it into the two halves parallel to the path by removing the end caps.
  const pts = flatten(band[0], 0.01);
  const dir = sub(pathEnd(path), path.start);
  const wantLeft = side === 'left';
  const startPt = path.start;
  const kept: Vec2[] = [];
  // classify points by side relative to the nearest path direction (approx: overall direction for short paths,
  // otherwise use local tangent by nearest sample)
  const samples = flatten(path, 0.05);
  const nearestTangent = (p: Vec2): Vec2 => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < samples.length; i++) { const d = dist(samples[i], p); if (d < bd) { bd = d; best = i; } }
    const a = samples[Math.max(0, best - 1)], b = samples[Math.min(samples.length - 1, best + 1)];
    return sub(b, a);
  };
  void dir; void startPt;
  for (const p of pts) {
    const t = nearestTangent(p);
    // point must be roughly r away from the path (not on an end cap) — cap points are within r of the endpoints too, filter by projection
    const nearStart = dist(p, path.start), nearEnd = dist(p, pathEnd(path));
    const onCap = (nearStart < r * 1.001 && dot2(sub(p, path.start), sub(path.start, samples[Math.min(1, samples.length - 1)])) > 0) ||
      (nearEnd < r * 1.001 && dot2(sub(p, pathEnd(path)), sub(pathEnd(path), samples[Math.max(0, samples.length - 2)])) > 0);
    if (onCap) continue;
    const left = cross(t, sub(p, nearestPoint(samples, p))) > 0;
    if (left === wantLeft) kept.push(p);
  }
  if (kept.length < 2) return [path];
  // order kept points along the path direction
  const order = kept.map((p) => ({ p, s: nearestIndex(samples, p) })).sort((a, b) => a.s - b.s).map((o) => o.p);
  return [{ id: path.id + ':off', start: order[0], segs: order.slice(1).map((to) => ({ k: 'L' as const, to })), closed: false, layer: path.layer }];
}
const dot2 = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
function nearestIndex(samples: Vec2[], p: Vec2): number { let bi = 0, bd = Infinity; for (let i = 0; i < samples.length; i++) { const d = dist(samples[i], p); if (d < bd) { bd = d; bi = i; } } return bi; }
function nearestPoint(samples: Vec2[], p: Vec2): Vec2 { return samples[nearestIndex(samples, p)]; }

/** Set traversal direction: climb => material on the left. */
export function orientForCut(path: Path, side: Side, climb: boolean): Path {
  if (!path.closed || side === 'on' || side === 'left' || side === 'right') return path;
  const ccw = signedArea(path) > 0;
  const wantCcw = side === 'outside' ? climb : !climb;
  return ccw === wantCcw ? path : reverse(path);
}

/** Choose start: explicit fraction, explicit angle for circles, or the vertex nearest bottom-left. */
export function chooseStart(path: Path, op: Operation): Path {
  if (!path.closed) return path;
  const circ = asCircle(path);
  if (op.startAngle !== undefined && circ) {
    const a = (op.startAngle * Math.PI) / 180;
    return circlePath(circ.c, circ.r, circ.cw, a, path.layer);
  }
  if (op.startT !== undefined) return rotateStart(path, op.startT);
  // default: vertex with minimal (y, x)
  let best = 0, bp = path.start;
  const verts: Vec2[] = [path.start, ...path.segs.map((s) => s.to)];
  for (let i = 1; i < verts.length; i++) {
    const v = verts[i];
    if (v.y < bp.y - 1e-9 || (Math.abs(v.y - bp.y) <= 1e-9 && v.x < bp.x)) { bp = v; best = i; }
  }
  if (best === 0) return path;
  // rotate so vertex `best` is the start
  const idx = best; // vertex i is end of seg i-1
  return { ...path, start: verts[idx], segs: [...path.segs.slice(idx), ...path.segs.slice(0, idx)] };
}

/**
 * Generate moves for milling along `toolPath` (already offset & oriented) with depth passes, entry and tabs.
 * Emits: rapid to XY at safe Z, rapid down to clear Z, feed to zTop, then passes.
 */
export function millPath(toolPath: Path, op: Operation, ctx: ContourCtx, tabs?: TabsSpec, entryOverride?: Operation['entry'], tabMarks?: Vec2[]): Move[] {
  const moves: Move[] = [];
  const stepDown = op.stepDown ?? ctx.tool.cut.stepDown;
  const zStart = ctx.zTop - op.zOffset - (ctx.groupDepth ?? 0);
  const passes = depthPasses(op.depth, stepDown, zStart);
  const start = toolPath.start;
  const len = pathLength(toolPath);
  const entry = entryOverride ?? op.entry;
  const circ = toolPath.closed ? asCircle(toolPath) : null;
  let first = true;
  const centres = tabs && tabs.count >= 0 ? tabPositions(toolPath, tabs, ctx.tabPoints) : [];
  if (tabMarks) tabMarks.push(...tabPoints(toolPath, centres));
  moves.push({ k: 'rapid', x: start.x, y: start.y, z: ctx.safeZ, force: true });
  moves.push({ k: 'rapid', z: zStart + ctx.clearZ });
  let z = zStart;
  moves.push({ k: 'line', z, f: ctx.vfPlunge, s: ctx.s });
  for (const passZ of passes) {
    // entry from z to passZ
    if (entry.kind === 'helix' && circ) moves.push(...helixEntry(circ.c, start, circ.cw, z, passZ, stepDown, ctx.vfPlunge));
    else if (entry.kind === 'ramp' && len > 0.01) moves.push(...rampEntry(toolPath, z, passZ, entry.angle, ctx.vfPlunge));
    else moves.push({ k: 'line', z: passZ, f: ctx.vfPlunge });
    // the pass itself
    const tabTop = tabs && centres.length ? ctx.zTop - ctx.thickness + tabs.height : null;
    if (tabs && tabTop !== null && passZ < tabTop - 1e-9) {
      moves.push(...insertTabs(toolPath, tabs, centres, passZ, tabTop, ctx.vf, ctx.vfPlunge, entry.kind === 'ramp' ? entry.angle : 10));
    } else {
      moves.push(...movesAlong(toolPath, 0, len, passZ, passZ, ctx.vf));
    }
    z = passZ;
    first = false;
  }
  void first;
  moves.push({ k: 'rapid', z: ctx.safeZ });
  return moves;
}

/** Full contour/cutout operation for one geometry path. */
export function contourMoves(geom: Path, op: Operation & ({ type: 'contour' } | { type: 'cutout' } | { type: 'engrave' }), ctx: ContourCtx): { moves: Move[]; toolPaths: Path[]; warnings: string[]; tabMarks: Vec2[] } {
  const r = ctx.tool.d / 2;
  const side: Side = op.type === 'engrave' ? op.side : op.side;
  const warnings: string[] = [];
  let paths = offsetForSide(geom, side, r);
  const tabMarks: Vec2[] = [];
  if (!paths.length) { warnings.push('Contour too small for the tool diameter'); return { moves: [], toolPaths: [], warnings, tabMarks }; }
  if ('overcut' in op && (side === 'inside' || side === 'right')) { const oc = op.overcut; if (oc.kind !== 'none') paths = paths.map((p) => applyOvercut(p, geom, r, oc.kind)); }
  const moves: Move[] = [];
  const toolPaths: Path[] = [];
  for (let p of paths) {
    p = orientForCut(p, side, op.climb);
    p = chooseStart(p, op);
    toolPaths.push(p);
    const tabs = op.type === 'cutout' ? op.tabs : undefined;
    const entry = op.type === 'cutout' && asCircle(p) && op.entry.kind !== 'plunge' ? ({ kind: 'helix' } as const) : undefined;
    moves.push(...millPath(p, op, ctx, tabs, entry, tabMarks));
  }
  void segStart;
  return { moves, toolPaths, warnings, tabMarks };
}
