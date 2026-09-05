import type { Path, Vec2 } from '@/lib/geometry/types';
import { TOL } from '@/lib/geometry/types';
import { pathEnd, reverse, signedArea } from '@/lib/geometry/path';
import { dist } from '@/lib/geometry/vec';
import { newId } from '@/lib/model/ids';

/**
 * Chain open paths whose endpoints coincide (within tol) into longer paths, closing them when the loop closes.
 * Uses a spatial hash on endpoints so large drawings stay fast.
 */
export function joinPaths(paths: Path[], tol = TOL): Path[] {
  const closed = paths.filter((p) => p.closed || p.segs.length === 0);
  let open = paths.filter((p) => !p.closed && p.segs.length > 0);
  // Also close open paths whose own ends meet
  open = open.map((p) => (dist(p.start, pathEnd(p)) <= tol && p.segs.length > 1 ? { ...p, closed: true } : p));
  const result: Path[] = [...closed, ...open.filter((p) => p.closed)];
  open = open.filter((p) => !p.closed);

  const cell = Math.max(tol * 4, 0.05);
  const key = (p: Vec2) => `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
  const neighbours = (p: Vec2) => {
    const cx = Math.round(p.x / cell), cy = Math.round(p.y / cell);
    const keys: string[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) keys.push(`${cx + dx},${cy + dy}`);
    return keys;
  };
  const used = new Set<number>();
  const index = new Map<string, number[]>();
  open.forEach((p, i) => {
    for (const q of [p.start, pathEnd(p)]) { const k = key(q); const arr = index.get(k); if (arr) arr.push(i); else index.set(k, [i]); }
  });
  const findAt = (pt: Vec2, self: number): { i: number; atStart: boolean } | null => {
    for (const k of neighbours(pt)) for (const i of index.get(k) ?? []) {
      if (used.has(i) || i === self) continue;
      if (dist(open[i].start, pt) <= tol) return { i, atStart: true };
      if (dist(pathEnd(open[i]), pt) <= tol) return { i, atStart: false };
    }
    return null;
  };

  for (let i = 0; i < open.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let cur: Path = { ...open[i], id: newId('pa'), segs: [...open[i].segs] };
    // extend forward
    let guard = 0;
    while (guard++ < 100000) {
      const end = pathEnd(cur);
      if (cur.segs.length > 1 && dist(end, cur.start) <= tol) { cur.closed = true; cur.segs[cur.segs.length - 1].to = cur.start; break; }
      const nxt = findAt(end, i);
      if (!nxt) break;
      used.add(nxt.i);
      const q = nxt.atStart ? open[nxt.i] : reverse(open[nxt.i]);
      cur.segs.push(...q.segs);
    }
    // extend backward
    if (!cur.closed) {
      guard = 0;
      while (guard++ < 100000) {
        const prev = findAt(cur.start, i);
        if (!prev) break;
        used.add(prev.i);
        const q = prev.atStart ? reverse(open[prev.i]) : open[prev.i];
        cur = { ...cur, start: q.start, segs: [...q.segs, ...cur.segs] };
        if (cur.segs.length > 1 && dist(pathEnd(cur), cur.start) <= tol) { cur.closed = true; break; }
      }
    }
    result.push(cur);
  }
  return result;
}

/** Remove zero-length segments and degenerate paths. */
export function cleanPaths(paths: Path[], tol = 1e-6): Path[] {
  const out: Path[] = [];
  for (const p of paths) {
    let prev = p.start;
    const segs = p.segs.filter((s) => { const keep = !(s.k === 'L' && dist(prev, s.to) <= tol); prev = s.to; return keep; });
    if (segs.length === 0 && p.segs.length > 0) continue; // collapsed
    if (p.closed && segs.length < 2) continue;
    out.push({ ...p, segs });
  }
  return out;
}

/** Make all closed paths counter-clockwise (outer orientation). Nesting is applied later by operations. */
export function orientCcw(paths: Path[]): Path[] {
  return paths.map((p) => (p.closed && signedArea(p) < 0 ? reverse(p) : p));
}

export function normalize(paths: Path[]): Path[] {
  return orientCcw(cleanPaths(joinPaths(cleanPaths(paths))));
}
