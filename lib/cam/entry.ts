import type { Path, Vec2 } from '@/lib/geometry/types';
import { pathLength, pointAt, segStart, segPoint, segLength } from '@/lib/geometry/path';
import type { Move } from './types';

/**
 * Emit the moves that follow a path from arc-length `from` to `to` (both in mm, to may exceed the length for
 * closed paths in which case it wraps), interpolating Z linearly from z0 to z1. Arcs stay arcs.
 */
export function movesAlong(path: Path, from: number, to: number, z0: number, z1: number, f?: number): Move[] {
  const total = pathLength(path);
  const out: Move[] = [];
  if (total <= 1e-9 || to <= from) return out;
  const dir = 1;
  let acc = 0;
  let pos = from;
  // walk segments
  const segs = path.segs;
  // locate starting segment
  let i = 0;
  let segFrom = path.start;
  let lens: number[] = segs.map((s, k) => segLength(segStart(path, k), s));
  let offset = from % total;
  while (i < segs.length && offset > lens[i] + 1e-9) { offset -= lens[i]; i++; }
  if (i >= segs.length) { i = 0; offset = 0; }
  segFrom = segStart(path, i);
  let remaining = to - from;
  let lt0 = lens[i] > 0 ? offset / lens[i] : 0;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 100000) {
    const s = segs[i];
    const segLen = lens[i];
    const available = segLen * (1 - lt0);
    const take = Math.min(available, remaining);
    const lt1 = segLen > 0 ? lt0 + take / segLen : 1;
    acc += take;
    const z = z0 + ((z1 - z0) * Math.min(1, acc / (to - from)));
    if (s.k === 'L') {
      const p = lt1 >= 1 - 1e-9 ? s.to : segPoint(segFrom, s, lt1);
      out.push({ k: 'line', x: p.x, y: p.y, z, f });
    } else {
      const p = lt1 >= 1 - 1e-9 ? s.to : segPoint(segFrom, s, lt1);
      out.push({ k: 'arc', x: p.x, y: p.y, z, cx: s.c.x, cy: s.c.y, cw: s.cw, f });
    }
    remaining -= take;
    pos += take;
    if (lt1 >= 1 - 1e-9) {
      i++; lt0 = 0;
      if (i >= segs.length) {
        if (!path.closed) break;
        i = 0;
      }
      segFrom = segStart(path, i);
    } else lt0 = lt1;
    void dir; void pos;
  }
  return out;
}

/**
 * Estlcam-style zig-zag ramp: descend half the step forward along the path, then the other half back to the
 * start point. Requires the path to start at the entry point. Returns moves ending at (start, zEnd).
 */
export function rampEntry(path: Path, zStart: number, zEnd: number, angleDeg: number, fPlunge: number): Move[] {
  const drop = zStart - zEnd;
  if (drop <= 1e-9) return [];
  const total = pathLength(path);
  const angle = Math.max(1, Math.min(80, angleDeg));
  let len = (drop / 2) / Math.tan((angle * Math.PI) / 180);
  if (len > total) len = total; // for short paths ramp along the whole length
  if (len < 1e-6) return [{ k: 'line', z: zEnd, f: fPlunge }];
  const forward = movesAlong(path, 0, len, zStart, zStart - drop / 2, fPlunge);
  const back = movesAlongReverse(path, len, 0, zStart - drop / 2, zEnd, fPlunge);
  return [...forward, ...back];
}

/** Moves travelling backwards along the path from arc-length `from` down to `to` while descending z0 -> z1. */
export function movesAlongReverse(path: Path, from: number, to: number, z0: number, z1: number, f?: number): Move[] {
  const out: Move[] = [];
  const span = from - to;
  if (span <= 1e-9) return out;
  const lens = path.segs.map((s, k) => segLength(segStart(path, k), s));
  let i = 0, offset = from;
  while (i < path.segs.length - 1 && offset > lens[i] + 1e-9) { offset -= lens[i]; i++; }
  let remaining = span;
  let acc = 0;
  let lt = lens[i] > 0 ? Math.min(1, offset / lens[i]) : 0;
  let guard = 0;
  while (remaining > 1e-9 && guard++ < 100000) {
    const s = path.segs[i];
    const segFrom = segStart(path, i);
    const take = Math.min(lens[i] * lt, remaining);
    const lt1 = lens[i] > 0 ? lt - take / lens[i] : 0;
    acc += take;
    const z = z0 + (z1 - z0) * Math.min(1, acc / span);
    const p: Vec2 = lt1 <= 1e-9 ? segFrom : segPoint(segFrom, s, lt1);
    if (s.k === 'L') out.push({ k: 'line', x: p.x, y: p.y, z, f });
    else out.push({ k: 'arc', x: p.x, y: p.y, z, cx: s.c.x, cy: s.c.y, cw: !s.cw, f });
    remaining -= take;
    if (lt1 <= 1e-9) { i--; if (i < 0) { if (!path.closed) break; i = path.segs.length - 1; } lt = 1; } else lt = lt1;
  }
  return out;
}

/** Helical entry for a circular path: one revolution per stepDown while descending, then the caller cuts flat. */
export function helixEntry(c: Vec2, start: Vec2, cw: boolean, zStart: number, zEnd: number, stepDown: number, fPlunge: number): Move[] {
  const out: Move[] = [];
  const drop = zStart - zEnd;
  const revs = Math.max(1, Math.ceil(drop / Math.max(0.05, stepDown)));
  const per = drop / revs;
  // half-circle opposite point for arc splitting so any controller handles full circles
  const opp = { x: 2 * c.x - start.x, y: 2 * c.y - start.y };
  let z = zStart;
  for (let r = 0; r < revs; r++) {
    out.push({ k: 'arc', x: opp.x, y: opp.y, z: z - per / 2, cx: c.x, cy: c.y, cw, f: fPlunge });
    z -= per;
    out.push({ k: 'arc', x: start.x, y: start.y, z, cx: c.x, cy: c.y, cw, f: fPlunge });
  }
  return out;
}

export { pointAt };
