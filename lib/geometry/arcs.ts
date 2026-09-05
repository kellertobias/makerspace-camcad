import type { Vec2, Segment } from './types';
import { sub, angle, dist, cross, fromAngle, add } from './vec';

/** Signed sweep angle (radians) of an arc from `from` to `to` around `c`. cw => negative. */
export function arcSweep(from: Vec2, to: Vec2, c: Vec2, cw: boolean): number {
  const a0 = angle(sub(from, c));
  const a1 = angle(sub(to, c));
  let sweep = a1 - a0;
  if (cw) { while (sweep > 1e-9) sweep -= 2 * Math.PI; while (sweep <= -2 * Math.PI - 1e-9) sweep += 2 * Math.PI; }
  else { while (sweep < -1e-9) sweep += 2 * Math.PI; while (sweep >= 2 * Math.PI + 1e-9) sweep -= 2 * Math.PI; }
  // A full circle is represented with from == to; treat that as a full sweep.
  if (Math.abs(sweep) < 1e-9 && dist(from, to) < 1e-9) return cw ? -2 * Math.PI : 2 * Math.PI;
  return sweep;
}

export const arcRadius = (from: Vec2, c: Vec2) => dist(from, c);
export const arcLength = (from: Vec2, to: Vec2, c: Vec2, cw: boolean) => Math.abs(arcSweep(from, to, c, cw)) * arcRadius(from, c);

/** Point on the arc at fraction t in [0,1]. */
export function arcPoint(from: Vec2, to: Vec2, c: Vec2, cw: boolean, t: number): Vec2 {
  const r = arcRadius(from, c);
  const a0 = angle(sub(from, c));
  const sweep = arcSweep(from, to, c, cw);
  return add(c, fromAngle(a0 + sweep * t, r));
}

/** Unit tangent direction of the arc at fraction t. */
export function arcTangent(from: Vec2, to: Vec2, c: Vec2, cw: boolean, t: number): Vec2 {
  const a0 = angle(sub(from, c));
  const sweep = arcSweep(from, to, c, cw);
  const a = a0 + sweep * t;
  return cw ? { x: Math.sin(a), y: -Math.cos(a) } : { x: -Math.sin(a), y: Math.cos(a) };
}

/** Number of chords needed to keep the chord error below `tol`. */
export function arcSteps(r: number, sweepAbs: number, tol: number): number {
  if (r <= tol) return 1;
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
  return Math.max(1, Math.ceil(sweepAbs / Math.max(maxStep, 1e-4)));
}

/** Arc segment from a DXF/LWPOLYLINE bulge between p0 and p1. Returns a line for zero bulge. */
export function segmentFromBulge(p0: Vec2, p1: Vec2, bulge: number): Segment {
  if (Math.abs(bulge) < 1e-12) return { k: 'L', to: p1 };
  const theta = 4 * Math.atan(bulge); // included angle, sign = direction (positive = ccw)
  const chord = dist(p0, p1);
  if (chord < 1e-12) return { k: 'L', to: p1 };
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const dir = sub(p1, p0);
  const n = { x: -dir.y / chord, y: dir.x / chord }; // left normal
  const sgn = Math.abs(theta) > Math.PI ? -1 : 1; // centre lies on the far side for arcs > 180°
  const s = bulge > 0 ? 1 : -1;
  const c = { x: mid.x + n.x * h * sgn * s, y: mid.y + n.y * h * sgn * s };
  return { k: 'A', to: p1, c, cw: bulge < 0 };
}

/** Arc through start/end with given centre, sweeping ccw from a0 to a1 (radians). */
export function arcFromAngles(c: Vec2, r: number, a0: number, a1: number, cw = false): { start: Vec2; seg: Segment } {
  const start = add(c, fromAngle(a0, r));
  const end = add(c, fromAngle(a1, r));
  return { start, seg: { k: 'A', to: end, c, cw } };
}

/**
 * SVG endpoint-parameterised elliptical arc to segments. Circular arcs (rx == ry, no rotation) become a
 * single 'A' segment, ellipses are flattened by the caller via `ellipsePoints`.
 */
export function svgArcCenter(p0: Vec2, rx: number, ry: number, phiDeg: number, largeArc: boolean, sweep: boolean, p1: Vec2) {
  const phi = (phiDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
  const x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = sign * Math.sqrt(Math.max(0, num / (den || 1)));
  const cx1 = coef * ((rx * y1) / ry), cy1 = coef * (-(ry * x1) / rx);
  const cx = cosP * cx1 - sinP * cy1 + (p0.x + p1.x) / 2;
  const cy = sinP * cx1 + cosP * cy1 + (p0.y + p1.y) / 2;
  const theta1 = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  let dTheta = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - theta1;
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  return { cx, cy, rx, ry, phi, theta1, dTheta };
}

export function ellipsePoint(cx: number, cy: number, rx: number, ry: number, phi: number, t: number): Vec2 {
  const ct = Math.cos(t), st = Math.sin(t);
  return { x: cx + rx * ct * Math.cos(phi) - ry * st * Math.sin(phi), y: cy + rx * ct * Math.sin(phi) + ry * st * Math.cos(phi) };
}

/** Orientation helper: >0 if p is left of a->b. */
export const side = (a: Vec2, b: Vec2, p: Vec2) => cross(sub(b, a), sub(p, a));
