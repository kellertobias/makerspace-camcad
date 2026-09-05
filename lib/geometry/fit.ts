import type { Vec2, Segment, Path } from './types';
import { TOL } from './types';
import { dist, sub, cross } from './vec';
import { newId } from '@/lib/model/ids';

/** Circle through three points, or null when (nearly) collinear. */
export function circleFrom3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const centre = { x: ux, y: uy };
  return { c: centre, r: dist(centre, a) };
}

/** Least-squares (Kåsa) circle fit. */
export function fitCircle(pts: Vec2[]): { c: Vec2; r: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  const mx = sx / n, my = sy / n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; suv += u * v; svv += v * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const A = 0.5 * (suuu + suvv), B = 0.5 * (svvv + svuu);
  const uc = (A * svv - B * suv) / det, vc = (B * suu - A * suv) / det;
  const c = { x: uc + mx, y: vc + my };
  let r = 0;
  for (const p of pts) r += dist(p, c);
  return { c, r: r / n };
}

function maxDeviation(pts: Vec2[], c: Vec2, r: number): number {
  let m = 0;
  for (const p of pts) m = Math.max(m, Math.abs(dist(p, c) - r));
  return m;
}

function maxSagitta(pts: Vec2[], r: number): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) {
    const c = dist(pts[i - 1], pts[i]);
    if (c >= 2 * r) return Infinity;
    m = Math.max(m, r - Math.sqrt(r * r - (c / 2) * (c / 2)));
  }
  return m;
}

/** True when points i..j all lie on the same side and the polyline turns monotonically (no inflection). */
function monotonicTurn(pts: Vec2[], i: number, j: number): number {
  let sign = 0;
  for (let k = i + 1; k < j; k++) {
    const s = cross(sub(pts[k], pts[k - 1]), sub(pts[k + 1], pts[k]));
    if (Math.abs(s) < 1e-12) continue;
    const sg = s > 0 ? 1 : -1;
    if (sign === 0) sign = sg; else if (sg !== sign) return 0;
  }
  return sign;
}

/**
 * Convert a polyline into a mixed line/arc path. Greedy: extend an arc while all points stay within `tol`
 * of the fitted circle. Collinear runs become single lines.
 */
export function refitArcs(pts: Vec2[], closed: boolean, tol = TOL, minArcPoints = 4): Path {
  const n = pts.length;
  const segs: Segment[] = [];
  if (n < 2) return { id: newId('pa'), start: pts[0] ?? { x: 0, y: 0 }, segs, closed };
  const count = closed ? n : n - 1; // number of edges
  const P = (i: number) => pts[i % n];
  let i = 0;
  while (i < count) {
    // try the longest arc starting at i
    let bestJ = -1;
    let bestCircle: { c: Vec2; r: number } | null = null;
    let j = i + minArcPoints - 1;
    const maxJ = closed ? i + n - 1 : n - 1;
    let lastGood: { j: number; circle: { c: Vec2; r: number } } | null = null;
    while (j <= maxJ) {
      const run: Vec2[] = [];
      for (let k = i; k <= j; k++) run.push(P(k));
      const turn = monotonicTurn(run, 0, run.length - 1);
      if (turn === 0) break;
      const circle = fitCircle(run);
      if (!circle || circle.r > 1e5) break;
      if (maxDeviation(run, circle.c, circle.r) > tol) break;
      // every chord must hug the circle: the sagitta of each edge must stay within tol, otherwise the points
      // merely happen to be co-circular (e.g. the four corners of a rectangle)
      if (maxSagitta(run, circle.r) > tol * 2) break;
      lastGood = { j, circle };
      j++;
    }
    if (lastGood) { bestJ = lastGood.j; bestCircle = lastGood.circle; }
    if (bestJ > 0 && bestCircle) {
      const run: Vec2[] = [];
      for (let k = i; k <= bestJ; k++) run.push(P(k));
      const turn = monotonicTurn(run, 0, run.length - 1);
      // refine centre from first/last/middle for exact endpoint matching
      const exact = circleFrom3(run[0], run[Math.floor(run.length / 2)], run[run.length - 1]) ?? bestCircle;
      segs.push({ k: 'A', to: P(bestJ), c: exact.c, cw: turn < 0 });
      i = bestJ;
      continue;
    }
    // collinear run
    let k = i + 1;
    while (k < count) {
      const a = P(i), b = P(k), c = P(k + 1);
      const ab = sub(b, a), bc = sub(c, b);
      const crossv = Math.abs(cross(ab, bc)) / (Math.hypot(ab.x, ab.y) || 1);
      const dotv = ab.x * bc.x + ab.y * bc.y;
      // straight runs are exact in offset output, so use a tight tolerance and do not let lines eat the start of arcs
      if (crossv > Math.min(tol / 4, 0.0025) || dotv <= 0) break;
      k++;
    }
    segs.push({ k: 'L', to: P(k) });
    i = k;
  }
  let start = pts[0];
  if (closed) {
    // last segment must return to start
    const last = segs[segs.length - 1];
    if (last && dist(last.to, pts[0]) > 1e-9) last.to = pts[0];
    // merge the wrap-around: Clipper often starts mid-arc / mid-edge, which would split one arc or line in two
    if (segs.length >= 3) {
      const a = segs[0], b = segs[segs.length - 1];
      const prevStart = segs[segs.length - 2].to;
      if (a.k === 'A' && b.k === 'A' && a.cw === b.cw && dist(a.c, b.c) < tol) {
        start = prevStart;
        segs.pop();
      } else if (a.k === 'L' && b.k === 'L') {
        const d1 = sub(pts[0], prevStart), d2 = sub(a.to, pts[0]);
        if (Math.abs(cross(d1, d2)) / (Math.hypot(d1.x, d1.y) || 1) < tol && d1.x * d2.x + d1.y * d2.y > 0) { start = prevStart; segs.pop(); }
      }
    }
  }
  return { id: newId('pa'), start, segs, closed };
}
