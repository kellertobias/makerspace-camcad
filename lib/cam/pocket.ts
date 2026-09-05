import type { Path } from '@/lib/geometry/types';
import type { Operation } from '@/lib/model/project';
import type { Move } from './types';
import type { ContourCtx } from './contour';
import { orientForCut, chooseStart } from './contour';
import { offsetClosed, difference, union, clipLines, orient } from '@/lib/geometry/offset';
import { nestPaths } from '@/lib/geometry/containment';
import { bbox as pathBBox, pathLength, polylinePath, signedArea } from '@/lib/geometry/path';
import { depthPasses } from './depth';
import { movesAlong, rampEntry, rampLength } from './entry';
import { applyOvercut } from './overcut';
import { bboxUnion } from '@/lib/geometry/types';

type PocketOp = Operation & { type: 'pocket' };

export interface Exclusion { path: Path; margin: number }

/** Material removed around the contour for side 'outside', in mm (at least one tool width). */
export function outsideWidthMm(op: PocketOp, r: number): number {
  const raw = op.outsideWidth ?? 1;
  const mm = (op.outsideWidthUnit ?? 'mm') === 'tool' ? raw * 2 * r : raw;
  return Math.max(mm, 2 * r);
}

/**
 * Pocket geometry. The area to clear is expressed as the region the TOOL CENTRE may visit
 * (outers CCW, holes CW). The full interior of the contour is always cleared; `side` only decides where the
 * clean wall pass runs:
 *  inside  – wall at contour − r, interior cleared
 *  on      – wall on the contour, interior cleared (the wall removes r outside the line)
 *  outside – wall at contour + r plus a band around the contour up to `outsideWidth`; interior cleared as well
 * Exclusions (standoffs, mounting spots) are removed from the region, grown by r + margin, and get their own wall pass.
 */
export function pocketRegion(paths: Path[], op: PocketOp, r: number, exclusions: Exclusion[] = []): { region: Path[]; extraWalls: Path[]; warnings: string[] } {
  const closed = paths.filter((p) => p.closed);
  if (!closed.length) return { region: [], extraWalls: [], warnings: ['Pocket needs closed outlines'] };
  const nest = nestPaths(closed);
  const outers = orient(nest.filter((n) => n.depth % 2 === 0).map((n) => n.path), true);
  const autoIslands = op.islands === 'auto' ? nest.filter((n) => n.depth % 2 === 1).map((n) => ({ path: n.path, margin: 0 })) : [];
  const excl = [...autoIslands, ...exclusions];
  const side = op.side ?? 'inside';
  let region: Path[];
  const extraWalls: Path[] = [];
  if (side === 'inside') region = offsetClosed(outers, -r);
  else if (side === 'on') region = union(outers);
  else {
    const width = outsideWidthMm(op, r);
    region = offsetClosed(outers, Math.max(width - r, r));
    if (width - r > r + 1e-6) extraWalls.push(...offsetClosed(outers, r)); // the pass hugging the contour
  }
  for (const e of excl) {
    if (!region.length) break;
    const grown = offsetClosed(orient([e.path], true), r + Math.max(0, e.margin));
    if (grown.length) region = difference(region, grown);
  }
  return { region, extraWalls, warnings: region.length ? [] : ['Pocket too small for the tool'] };
}

export function pocketMoves(paths: Path[], op: PocketOp, ctx: ContourCtx, exclusions: Exclusion[] = []): { moves: Move[]; toolPaths: Path[]; warnings: string[] } {
  const r = ctx.tool.d / 2;
  const { region, extraWalls, warnings } = pocketRegion(paths, op, r, exclusions);
  if (!region.length) return { moves: [], toolPaths: [], warnings };
  // the fill must overlap the wall pass but never by a full tool width: clamp the step-over to 10–90 % of Ø
  const stepOver = Math.max(0.05, (Math.min(90, Math.max(10, op.stepOverPct ?? ctx.tool.cut.stepOverPct)) / 100) * ctx.tool.d);
  const moves: Move[] = [];
  const toolPaths: Path[] = [];

  // wall passes: the contour-hugging pass first (for 'outside' that is contour + r, material inside it), then the
  // region boundaries (CCW = material outside -> inside semantics, CW holes = exclusions -> material inside).
  let walls = [...extraWalls.map((w) => ({ path: w, materialInside: true })), ...region.map((w) => ({ path: w, materialInside: signedArea(w) < 0 }))];
  if (op.overcut.kind !== 'none') { const oc = op.overcut.kind; walls = walls.map((w) => (!w.materialInside ? { ...w, path: applyOvercut(w.path, w.path, r, oc) } : w)); }
  const wallPaths = walls.map((w) => chooseStart(orientForCut(w.path, w.materialInside ? 'outside' : 'inside', op.climb), op));

  // interior fill
  let fill: Path[] = [];
  if (op.strategy === 'offset') {
    let cur = region;
    let guard = 0;
    while (cur.length && guard++ < 1000) {
      const next = offsetClosed(cur, -stepOver).filter((p) => pathLength(p) > 0.05);
      if (!next.length) break;
      fill.push(...next.map((p) => chooseStart(orientForCut(p, signedArea(p) > 0 ? 'inside' : 'outside', op.climb), op)));
      cur = next;
    }
  } else {
    const b = region.map(pathBBox).reduce(bboxUnion);
    const ang = (op.rasterAngle * Math.PI) / 180;
    const dir = { x: Math.cos(ang), y: Math.sin(ang) };
    const nrm = { x: -dir.y, y: dir.x };
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const half = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + 1;
    const lines: { x: number; y: number }[][] = [];
    for (let o = -half; o <= half; o += stepOver) {
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
    const lines2 = keyed.map((k) => { if (Math.abs(k.o - lastO) > 1e-6) { flip = !flip; lastO = k.o; } return flip ? [...k.l].reverse() : k.l; });
    if (op.strategy === 'zigzag') {
      // chain neighbouring lines into one continuous path: across, step over along the wall, back, ...
      // a connection is only made when the two ends are adjacent (one step-over apart), otherwise the tool lifts
      const chains: { x: number; y: number }[][] = [];
      let cur: { x: number; y: number }[] = [];
      for (const l of lines2) {
        if (cur.length) {
          const e = cur[cur.length - 1], s0 = l[0];
          if (Math.hypot(e.x - s0.x, e.y - s0.y) <= stepOver * 2.2) { cur.push(...l); continue; }
          chains.push(cur);
        }
        cur = [...l];
      }
      if (cur.length) chains.push(cur);
      fill = chains.map((pts) => polylinePath(pts, false));
    } else fill = lines2.map((pts) => polylinePath(pts, false));
  }
  toolPaths.push(...wallPaths, ...fill);

  const stepDown = op.stepDown ?? ctx.tool.cut.stepDown;
  const zStart = ctx.zTop - op.zOffset - (ctx.groupDepth ?? 0);
  const passes = depthPasses(op.depth, stepDown, zStart);
  const first = wallPaths[0];
  const sequence = [...wallPaths, ...fill];
  moves.push({ k: 'rapid', x: first.start.x, y: first.start.y, z: ctx.safeZ, force: true });
  moves.push({ k: 'rapid', z: zStart + ctx.clearZ });
  let z = zStart;
  moves.push({ k: 'line', z, f: ctx.vfPlunge, s: ctx.s });
  for (const passZ of passes) {
    for (let i = 0; i < sequence.length; i++) {
      const p = sequence[i];
      if (i === 0) {
        if (op.entry.kind === 'ramp' && pathLength(p) > 0.5 && p.closed && rampLength(z - passZ, op.entry.angle) > 1e-6) {
          // forward ramp along the closed wall; the wall loop that follows clears the ramped section
          const L = Math.min(pathLength(p), rampLength(z - passZ, op.entry.angle));
          moves.push(...movesAlong(p, 0, L, z, passZ, ctx.vfPlunge));
          moves.push(...movesAlong(p, L, L + pathLength(p), passZ, passZ, ctx.vf));
          // return to the path start so the ring sequence below continues as planned
          moves.push(...movesAlong(p, L, pathLength(p), passZ, passZ, ctx.vf).slice(0, 0));
          continue;
        }
        if (op.entry.kind === 'ramp' && pathLength(p) > 0.5) moves.push(...rampEntry(p, z, passZ, op.entry.angle, ctx.vfPlunge)); else moves.push({ k: 'line', z: passZ, f: ctx.vfPlunge });
      } else {
        // move to the next path: rapid over uncut material is unsafe, so travel at cutting depth only when inside the
        // already cleared area; otherwise lift to clearance, rapid and plunge again.
        const far = Math.hypot(p.start.x - lastPt(moves).x, p.start.y - lastPt(moves).y) > stepOver * 2.5 || !p.closed;
        if (far) { moves.push({ k: 'rapid', z: zStart + ctx.clearZ }); moves.push({ k: 'rapid', x: p.start.x, y: p.start.y }); moves.push({ k: 'line', z: passZ, f: ctx.vfPlunge }); }
        else moves.push({ k: 'line', x: p.start.x, y: p.start.y, z: passZ, f: ctx.vf });
      }
      moves.push(...movesAlong(p, 0, pathLength(p), passZ, passZ, ctx.vf));
    }
    z = passZ;
    if (passZ !== passes[passes.length - 1]) { moves.push({ k: 'rapid', z: zStart + ctx.clearZ }); moves.push({ k: 'rapid', x: first.start.x, y: first.start.y }); moves.push({ k: 'line', z: passZ, f: ctx.vfPlunge }); }
  }
  moves.push({ k: 'rapid', z: ctx.safeZ });
  return { moves, toolPaths, warnings };
}

function lastPt(moves: Move[]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const m of moves) if ((m.k === 'rapid' || m.k === 'line' || m.k === 'arc')) { if (m.x !== undefined) x = m.x; if (m.y !== undefined) y = m.y; }
  return { x, y };
}
