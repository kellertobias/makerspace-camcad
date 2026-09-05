import type { Path } from '@/lib/geometry/types';
import type { Operation } from '@/lib/model/project';
import type { Move } from './types';
import type { ContourCtx } from './contour';
import { orientForCut, chooseStart } from './contour';
import { offsetClosed, difference, union, clipLines, orient } from '@/lib/geometry/offset';
import { nestPaths, pointInPolygon } from '@/lib/geometry/containment';
import { bbox as pathBBox, closestPoint, flatten, pathEnd, pathLength, polylinePath, reverse, rotateStart, samplePath, signedArea } from '@/lib/geometry/path';
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
  const stepDown = op.stepDown ?? ctx.tool.cut.stepDown;
  const zStart = ctx.zTop - op.zOffset - (ctx.groupDepth ?? 0);
  const passes = depthPasses(op.depth, stepDown, zStart);
  const first = wallPaths[0];
  // Raster / zig-zag fills start at a corner of the region. Unless the user fixed the start point, the wall pass is
  // rotated so that it ends exactly there (ramp length included): the fill continues where the contour ended instead
  // of the tool cutting a slot across the floor to reach it.
  const lineFill = op.strategy !== 'offset' && fill.length > 0 && first.closed && op.startT === undefined && op.startAngle === undefined;
  const rampAngle = op.entry.kind === 'ramp' ? op.entry.angle : 90;
  const alignedFirst = (drop: number): Path => {
    if (!lineFill) return first;
    const len = pathLength(first);
    const L = Math.min(len, rampLength(drop, rampAngle));
    const t = closestPoint(first, fill[0].start).t * len;
    return rotateStart(first, ((((t - L) % len) + len) % len) / len);
  };
  // The tool only descends once per depth pass (ramping along the first wall) and then links ring to ring at cutting
  // depth: every ring starts at its point closest to where the previous one ended, and the straight link is checked
  // against the pocket region (grown a hair, ring starts lie exactly on its boundary) so it never crosses an island or
  // leaves the pocket. Only when a link would, or between two raster lines that are not neighbours, the tool lifts.
  const linkRegion = offsetClosed(region, 0.02, false);
  const linkInside = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-6) return true;
    const kept = clipLines([[a, b]], linkRegion).reduce((acc, l) => {
      for (let i = 1; i < l.length; i++) acc += Math.hypot(l[i].x - l[i - 1].x, l[i].y - l[i - 1].y);
      return acc;
    }, 0);
    return kept >= d - 0.05;
  };
  /** Where a path would be entered when coming from `from`: the closest point of a ring, the nearer end of a line. */
  const entryOf = (p: Path, from: { x: number; y: number }): { path: Path; d: number } => {
    if (p.closed) { const { d, t } = closestPoint(p, from); return { path: rotateStart(p, t), d }; }
    const ds = Math.hypot(p.start.x - from.x, p.start.y - from.y), de = Math.hypot(pathEnd(p).x - from.x, pathEnd(p).y - from.y);
    return de < ds ? { path: reverse(p), d: de } : { path: p, d: ds };
  };
  /** Next path from `pool`: the nearest one reachable at depth, else the nearest one (which then needs a lift). */
  const pickNext = (pool: Path[], from: { x: number; y: number }): { idx: number; path: Path; lift: boolean } => {
    // candidates by a cheap lower bound (distance to the bounding box) so closest-point work stops early
    const cands = pool.map((p, idx) => {
      const b = pathBBox(p);
      return { idx, p, lower: Math.hypot(Math.max(b.minX - from.x, 0, from.x - b.maxX), Math.max(b.minY - from.y, 0, from.y - b.maxY)) };
    }).sort((a, b) => a.lower - b.lower);
    let bestOk: { idx: number; path: Path; d: number } | null = null;
    let bestAny: { idx: number; path: Path; d: number } | null = null;
    for (const c of cands) {
      if (bestOk && c.lower >= bestOk.d) break;
      const e = entryOf(c.p, from);
      if (!bestAny || e.d < bestAny.d) bestAny = { idx: c.idx, path: e.path, d: e.d };
      // a raster / zig-zag line is only entered at depth from its neighbour; anything farther is reached at clearance
      const adjacent = e.path.closed || e.d <= stepOver * 2.2 + 1e-6;
      if ((!bestOk || e.d < bestOk.d) && adjacent && linkInside(from, e.path.start)) bestOk = { idx: c.idx, path: e.path, d: e.d };
    }
    return bestOk ? { ...bestOk, lift: false } : { ...bestAny!, lift: true };
  };

  // Group walls and fill by connected pocket area (one outer region loop each) so an area is finished, walls first,
  // before the tool travels to the next one; otherwise every pass would cross between areas twice.
  const outers = region.filter((p) => signedArea(p) > 0);
  const outerPolys = outers.map((o) => offsetClosed([o], 0.05, false).map((g) => flatten(g, 0.05)));
  const areaOf = (p: Path): number => {
    const pts = samplePath(p, Math.max(0.5, pathLength(p) / 32));
    let best = 0, bestN = -1;
    outerPolys.forEach((polys, i) => { let n = 0; for (const q of pts) if (polys.some((poly) => pointInPolygon(q, poly))) n++; if (n > bestN) { bestN = n; best = i; } });
    return best;
  };
  const areaWalls: Path[][] = outers.map(() => []), areaFill: Path[][] = outers.map(() => []);
  const areaIndex = new Map<Path, number>();
  for (const w of wallPaths) { const i = areaOf(w); areaIndex.set(w, i); if (w !== first) areaWalls[i].push(w); }
  for (const f of fill) { const i = areaOf(f); areaIndex.set(f, i); areaFill[i].push(f); }

  const first0 = alignedFirst(zStart - passes[0]);
  moves.push({ k: 'rapid', x: first0.start.x, y: first0.start.y, z: ctx.safeZ, force: true });
  moves.push({ k: 'rapid', z: zStart + ctx.clearZ });
  let z = zStart;
  moves.push({ k: 'line', z, f: ctx.vfPlunge, s: ctx.s });
  let cur = { x: first0.start.x, y: first0.start.y };
  for (let pi = 0; pi < passes.length; pi++) {
    const passZ = passes[pi];
    const zPrev = pi === 0 ? zStart : passes[pi - 1]; // depth already cleared everywhere: safe to plunge to after a lift
    // the first pass enters at the chosen start point; later passes begin with the nearest wall from where the tool is
    // (line fills: always the wall aligned with the fill start, reached across the already cleared floor)
    let firstEntry: { idx: number; path: Path; lift: boolean };
    if (pi === 0) firstEntry = { idx: -1, path: first0, lift: false };
    else if (lineFill) { const a = alignedFirst(zPrev - passZ); firstEntry = { idx: 0, path: a, lift: !linkInside(cur, a.start) }; }
    else firstEntry = pickNext(wallPaths, cur);
    const firstPath = pi === 0 || lineFill ? first : wallPaths[firstEntry.idx];
    let queue: { path: Path; lift: boolean; firstEver: boolean } = { path: firstEntry.path, lift: firstEntry.lift, firstEver: pi === 0 };
    let area = areaIndex.get(firstPath) ?? 0;
    const remaining = new Set(outers.map((_, i) => i));
    // per area: walls, then fill; within each group nearest-reachable first
    let pools: Path[][] = [[...wallPaths.filter((w) => areaIndex.get(w) === area && w !== firstPath)], [...areaFill[area]]];
    let gi = 0;
    for (;;) {
      let p = queue.path;
      if (!queue.firstEver) {
        // link at the current depth (the previous pass has already cleared it) or lift when the link is not inside
        if (!queue.lift) moves.push({ k: 'line', x: p.start.x, y: p.start.y, z, f: ctx.vf });
        else {
          // the new spot may still be uncut at this pass depth: plunge only to the previous pass depth and ramp from there
          z = Math.max(zPrev, z);
          moves.push({ k: 'rapid', z: zStart + ctx.clearZ }); moves.push({ k: 'rapid', x: p.start.x, y: p.start.y }); moves.push({ k: 'line', z, f: ctx.vfPlunge });
        }
      }
      const len = pathLength(p);
      if (passZ < z - 1e-9) {
        // descend to this pass: forward ramp along a closed wall (the loop then clears the ramped stretch), zig-zag ramp
        // on an open path, straight plunge otherwise
        const angle = op.entry.kind === 'ramp' ? op.entry.angle : 90;
        const L = len > 0.5 ? Math.min(len, rampLength(z - passZ, angle)) : 0;
        if (L > 1e-6 && p.closed) {
          moves.push(...movesAlong(p, 0, L, z, passZ, ctx.vf));
          p = rotateStart(p, L / len);
        } else if (L > 1e-6) moves.push(...rampEntry(p, z, passZ, angle, ctx.vf));
        else moves.push({ k: 'line', z: passZ, f: ctx.vfPlunge });
      }
      moves.push(...movesAlong(p, 0, len, passZ, passZ, ctx.vf));
      z = passZ;
      cur = lastPt(moves);
      if (pi === 0) toolPaths.push(p);
      while (gi < pools.length && !pools[gi].length) gi++;
      if (gi >= pools.length) {
        // area finished: continue with the nearest remaining area, entering through one of its walls
        remaining.delete(area);
        const walls: Path[] = [];
        for (const i of remaining) walls.push(...(areaWalls[i].length ? areaWalls[i] : areaFill[i]));
        if (!walls.length) break;
        const nx = pickNext(walls, cur);
        const chosen = walls[nx.idx];
        area = areaIndex.get(chosen) ?? 0;
        pools = [areaWalls[area].filter((w) => w !== chosen), areaFill[area].filter((f) => f !== chosen)];
        gi = 0;
        queue = { path: nx.path, lift: nx.lift, firstEver: false };
        continue;
      }
      const nx = pickNext(pools[gi], cur);
      pools[gi].splice(nx.idx, 1);
      queue = { path: nx.path, lift: nx.lift, firstEver: false };
    }
  }
  moves.push({ k: 'rapid', z: ctx.safeZ });
  return { moves, toolPaths, warnings };
}

function lastPt(moves: Move[]): { x: number; y: number } {
  let x = 0, y = 0;
  for (const m of moves) if ((m.k === 'rapid' || m.k === 'line' || m.k === 'arc')) { if (m.x !== undefined) x = m.x; if (m.y !== undefined) y = m.y; }
  return { x, y };
}
