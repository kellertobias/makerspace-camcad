import type { Path, Segment, Vec2, BBox } from './types';
import { emptyBBox, bboxAdd, TOL } from './types';
import { dist, lerp, sub, norm, eq } from './vec';
import { arcLength, arcPoint, arcTangent, arcSweep, arcSteps, arcRadius } from './arcs';
import { newId } from '@/lib/model/ids';

export function segStart(p: Path, i: number): Vec2 { return i === 0 ? p.start : p.segs[i - 1].to; }

export function segLength(from: Vec2, s: Segment): number {
  return s.k === 'L' ? dist(from, s.to) : arcLength(from, s.to, s.c, s.cw);
}

export function pathLength(p: Path): number {
  let l = 0;
  for (let i = 0; i < p.segs.length; i++) l += segLength(segStart(p, i), p.segs[i]);
  return l;
}

export function pathEnd(p: Path): Vec2 { return p.segs.length ? p.segs[p.segs.length - 1].to : p.start; }

export function segPoint(from: Vec2, s: Segment, t: number): Vec2 {
  return s.k === 'L' ? lerp(from, s.to, t) : arcPoint(from, s.to, s.c, s.cw, t);
}

export function segTangent(from: Vec2, s: Segment, t: number): Vec2 {
  return s.k === 'L' ? norm(sub(s.to, from)) : arcTangent(from, s.to, s.c, s.cw, t);
}

/** Point at arc-length fraction t (0..1) along the path, plus segment index and local t. */
export function pointAt(p: Path, t: number): { pt: Vec2; i: number; lt: number } {
  const total = pathLength(p);
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < p.segs.length; i++) {
    const from = segStart(p, i);
    const l = segLength(from, p.segs[i]);
    if (target <= l || i === p.segs.length - 1) {
      const lt = l > 0 ? Math.max(0, Math.min(1, target / l)) : 0;
      return { pt: segPoint(from, p.segs[i], lt), i, lt };
    }
    target -= l;
  }
  return { pt: p.start, i: 0, lt: 0 };
}

/** Flatten to a polyline (points). Closed paths do not repeat the first point. */
export function flatten(p: Path, tol = 0.005): Vec2[] {
  const pts: Vec2[] = [p.start];
  for (let i = 0; i < p.segs.length; i++) {
    const s = p.segs[i];
    const from = segStart(p, i);
    if (s.k === 'L') pts.push(s.to);
    else {
      const sweep = arcSweep(from, s.to, s.c, s.cw);
      const n = arcSteps(arcRadius(from, s.c), Math.abs(sweep), tol);
      for (let k = 1; k <= n; k++) pts.push(k === n ? s.to : arcPoint(from, s.to, s.c, s.cw, k / n));
    }
  }
  if (p.closed && pts.length > 1 && eq(pts[0], pts[pts.length - 1], 1e-9)) pts.pop();
  return pts;
}

/** Signed area (shoelace) of a closed path using its flattened polygon. >0 = counter-clockwise. */
export function signedArea(p: Path, tol = 0.01): number {
  const pts = flatten(p, tol);
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const q = pts[i], r = pts[(i + 1) % n];
    a += q.x * r.y - r.x * q.y;
  }
  return a / 2;
}

export function bbox(p: Path): BBox {
  const b = emptyBBox();
  for (const q of flatten(p, 0.05)) bboxAdd(b, q.x, q.y);
  return b;
}

export function reverse(p: Path): Path {
  const segs: Segment[] = [];
  for (let i = p.segs.length - 1; i >= 0; i--) {
    const s = p.segs[i];
    const from = segStart(p, i);
    segs.push(s.k === 'L' ? { k: 'L', to: from } : { k: 'A', to: from, c: s.c, cw: !s.cw });
  }
  return { ...p, start: pathEnd(p), segs };
}

/** Split a segment at local parameter t into two segments. */
export function splitSeg(from: Vec2, s: Segment, t: number): [Segment, Segment] {
  const mid = segPoint(from, s, t);
  if (s.k === 'L') return [{ k: 'L', to: mid }, { k: 'L', to: s.to }];
  return [{ k: 'A', to: mid, c: s.c, cw: s.cw }, { k: 'A', to: s.to, c: s.c, cw: s.cw }];
}

/** Rotate a closed path so it starts at arc-length fraction t. */
export function rotateStart(p: Path, t: number): Path {
  if (!p.closed || p.segs.length === 0) return p;
  const { i, lt } = pointAt(p, t);
  const from = segStart(p, i);
  let segs: Segment[];
  let start: Vec2;
  if (lt <= 1e-9) { start = from; segs = [...p.segs.slice(i), ...p.segs.slice(0, i)]; }
  else if (lt >= 1 - 1e-9) { start = p.segs[i].to; segs = [...p.segs.slice(i + 1), ...p.segs.slice(0, i + 1)]; }
  else {
    const [a, b] = splitSeg(from, p.segs[i], lt);
    start = a.to;
    segs = [b, ...p.segs.slice(i + 1), ...p.segs.slice(0, i), a];
  }
  return { ...p, start, segs };
}

/** Rotate a closed path so that it starts at the point nearest to `pt`. Returns the path and the fraction used. */
export function rotateStartNearest(p: Path, pt: Vec2): { path: Path; t: number } {
  const { t } = closestPoint(p, pt);
  return { path: rotateStart(p, t), t };
}

/** Closest point on the path to `pt` (sampled arcs), with distance and arc-length fraction. */
export function closestPoint(p: Path, pt: Vec2): { pt: Vec2; d: number; t: number } {
  let best = { pt: p.start, d: dist(p.start, pt), t: 0 };
  const total = pathLength(p) || 1;
  let acc = 0;
  for (let i = 0; i < p.segs.length; i++) {
    const from = segStart(p, i);
    const s = p.segs[i];
    const l = segLength(from, s);
    if (s.k === 'L') {
      const ab = sub(s.to, from);
      const ll = ab.x * ab.x + ab.y * ab.y || 1;
      const u = Math.max(0, Math.min(1, ((pt.x - from.x) * ab.x + (pt.y - from.y) * ab.y) / ll));
      const q = lerp(from, s.to, u);
      const d = dist(q, pt);
      if (d < best.d) best = { pt: q, d, t: (acc + u * l) / total };
    } else {
      const n = Math.max(8, arcSteps(arcRadius(from, s.c), Math.abs(arcSweep(from, s.to, s.c, s.cw)), 0.05));
      for (let k = 0; k <= n; k++) {
        const q = arcPoint(from, s.to, s.c, s.cw, k / n);
        const d = dist(q, pt);
        if (d < best.d) best = { pt: q, d, t: (acc + (k / n) * l) / total };
      }
    }
    acc += l;
  }
  return best;
}

/** True when the path is a single full circle (one or two arcs with the same centre closing on the start). */
export function asCircle(p: Path): { c: Vec2; r: number; cw: boolean } | null {
  if (!p.closed || p.segs.length === 0 || p.segs.length > 4) return null;
  const first = p.segs[0];
  if (first.k !== 'A') return null;
  const r = arcRadius(p.start, first.c);
  for (const s of p.segs) {
    if (s.k !== 'A' || s.cw !== first.cw) return null;
    if (dist(s.c, first.c) > TOL || Math.abs(arcRadius(s.to, s.c) - r) > TOL) return null;
  }
  if (!eq(p.segs[p.segs.length - 1].to, p.start, TOL)) return null;
  return { c: first.c, r, cw: first.cw };
}

export function circlePath(c: Vec2, r: number, cw = false, startAngle = Math.PI, layer?: string): Path {
  const a0 = startAngle;
  const p0 = { x: c.x + r * Math.cos(a0), y: c.y + r * Math.sin(a0) };
  const p1 = { x: c.x + r * Math.cos(a0 + Math.PI), y: c.y + r * Math.sin(a0 + Math.PI) };
  return { id: newId('pa'), start: p0, closed: true, layer, segs: [{ k: 'A', to: p1, c, cw }, { k: 'A', to: p0, c, cw }] };
}

export function polylinePath(pts: Vec2[], closed: boolean, layer?: string): Path {
  return ensureClosed({ id: newId('pa'), start: pts[0], segs: pts.slice(1).map((to) => ({ k: 'L', to }) as Segment), closed, layer });
}

/** Closed paths always carry an explicit closing segment (the CAM walker relies on it). */
export function ensureClosed(p: Path): Path {
  if (!p.closed || p.segs.length === 0) return p;
  const end = pathEnd(p);
  if (dist(end, p.start) <= 1e-9) return p;
  return { ...p, segs: [...p.segs, { k: 'L', to: p.start }] };
}

/** Sample points along the path at approximately `step` spacing (used for simulation and hit tests). */
export function samplePath(p: Path, step: number): Vec2[] {
  const out: Vec2[] = [p.start];
  for (let i = 0; i < p.segs.length; i++) {
    const from = segStart(p, i);
    const s = p.segs[i];
    const l = segLength(from, s);
    const n = Math.max(1, Math.ceil(l / step));
    for (let k = 1; k <= n; k++) out.push(segPoint(from, s, k / n));
  }
  return out;
}
