import type { Path, Vec2 } from '@/lib/geometry/types';
import { pathLength, segStart, segLength, pointAt, closestPoint, bbox } from '@/lib/geometry/path';
import { bboxCenter } from '@/lib/geometry/types';
import type { TabsSpec } from '@/lib/model/project';
import type { Move } from './types';
import { movesAlong, movesAlongReverse } from './entry';

/**
 * Arc-length positions (mm) of bridge centres along the (already offset and oriented) tool path.
 *  manual  – nearest points on the path to the given world points
 *  auto    – straight segments first, choosing sides opposite to each other around the centre; if there are no
 *            usable straight segments, evenly spaced anywhere on the contour
 */
export function tabPositions(path: Path, tabs: TabsSpec, manualPoints?: Vec2[]): number[] {
  const total = pathLength(path);
  if (total <= tabs.width * 2) return [];
  if ((tabs.mode ?? 'auto') === 'manual') {
    const pts = manualPoints ?? [];
    return pts.map((p) => closestPoint(path, p).t * total).sort((a, b) => a - b);
  }
  if (tabs.positions?.length) return tabs.positions.map((t) => (((t % 1) + 1) % 1) * total).sort((a, b) => a - b);
  const n = Math.max(0, Math.round(tabs.count));
  if (n === 0) return [];
  // candidate straight segments long enough to hold a bridge
  const lens = path.segs.map((s, k) => segLength(segStart(path, k), s));
  const c = bboxCenter(bbox(path));
  const cands: { pos: number; angle: number; len: number }[] = [];
  let acc = 0;
  for (let k = 0; k < path.segs.length; k++) {
    if (path.segs[k].k === 'L' && lens[k] >= tabs.width * 1.5) {
      const mid = pointAt(path, (acc + lens[k] / 2) / total).pt;
      cands.push({ pos: acc + lens[k] / 2, angle: Math.atan2(mid.y - c.y, mid.x - c.x), len: lens[k] });
    }
    acc += lens[k];
  }
  if (!cands.length) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(((i + 0.5) / n) * total);
    return out;
  }
  // greedy: longest segment first, then the candidate whose direction from the centre is farthest (in angle)
  // from the already chosen ones -> opposite sides first
  const chosen: typeof cands = [];
  const remaining = [...cands].sort((a, b) => b.len - a.len);
  chosen.push(remaining.shift()!);
  const angDist = (a: number, b: number) => { let d = Math.abs(a - b) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
  while (chosen.length < n && remaining.length) {
    let best = 0, bestScore = -1;
    remaining.forEach((cand, i) => { const score = Math.min(...chosen.map((ch) => angDist(ch.angle, cand.angle))); if (score > bestScore) { bestScore = score; best = i; } });
    chosen.push(remaining.splice(best, 1)[0]);
  }
  // more bridges wanted than straight segments: spread the extra ones evenly along long segments
  let extra = n - chosen.length;
  const out = chosen.map((ch) => ch.pos);
  if (extra > 0) {
    const long = [...cands].sort((a, b) => b.len - a.len);
    let k = 0;
    while (extra-- > 0 && long.length) { const seg = long[k % long.length]; const off = (seg.len / 3) * ((k % 2) ? -1 : 1); out.push(seg.pos + off); k++; }
  }
  return out.sort((a, b) => a - b);
}

/** World positions of the bridge centres, for drawing. */
export function tabPoints(path: Path, positions: number[]): Vec2[] {
  const total = pathLength(path) || 1;
  return positions.map((p) => pointAt(path, p / total).pt);
}

/**
 * One depth pass with bridges: cut at passZ, and at each bridge rapid up to tabTop, cross the bridge, then ramp back
 * down (zig-zag over the ramp length) — the Estlcam pattern.
 */
export function insertTabs(path: Path, tabs: TabsSpec, centres: number[], passZ: number, tabTop: number, vf: number, vfPlunge: number, rampAngle: number): Move[] {
  const total = pathLength(path);
  if (!centres.length) return movesAlong(path, 0, total, passZ, passZ, vf);
  const half = tabs.width / 2;
  const out: Move[] = [];
  let pos = 0;
  const drop = tabTop - passZ;
  const rampLen = Math.min((drop / 2) / Math.tan((Math.max(1, rampAngle) * Math.PI) / 180), total / 4);
  for (const c of centres) {
    const a = Math.max(pos, c - half), b = Math.min(total, c + half);
    if (a > pos) out.push(...movesAlong(path, pos, a, passZ, passZ, vf));
    out.push({ k: 'rapid', z: tabTop });
    out.push(...movesAlong(path, a, b, tabTop, tabTop, vf));
    const fwdEnd = Math.min(total, b + rampLen);
    if (fwdEnd > b + 1e-6) {
      out.push(...movesAlong(path, b, fwdEnd, tabTop, tabTop - drop / 2, vfPlunge));
      out.push(...movesAlongReverse(path, fwdEnd, b, tabTop - drop / 2, passZ, vfPlunge));
    } else out.push({ k: 'line', z: passZ, f: vfPlunge });
    pos = b;
  }
  if (pos < total) out.push(...movesAlong(path, pos, total, passZ, passZ, vf));
  return out;
}
