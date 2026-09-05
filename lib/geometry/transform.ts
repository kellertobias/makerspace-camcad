import type { Mat, Vec2, Path, Segment } from './types';

export const identity = (): Mat => [1, 0, 0, 1, 0, 0];
export const translation = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const rotation = (deg: number): Mat => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; };
export const scaling = (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0];
/** a ∘ b : apply b first, then a. */
export function compose(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export const apply = (m: Mat, p: Vec2): Vec2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const applyVec = (m: Mat, p: Vec2): Vec2 => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y });
export const det = (m: Mat) => m[0] * m[3] - m[1] * m[2];
export function invert(m: Mat): Mat {
  const d = det(m) || 1e-12;
  const a = m[3] / d, b = -m[1] / d, c = -m[2] / d, dd = m[0] / d;
  return [a, b, c, dd, -(a * m[4] + c * m[5]), -(b * m[4] + dd * m[5])];
}
/** Uniform scale factor (sqrt|det|). */
export const scaleOf = (m: Mat) => Math.sqrt(Math.abs(det(m)));
export const rotationOf = (m: Mat) => (Math.atan2(m[1], m[0]) * 180) / Math.PI;
export const isMirrored = (m: Mat) => det(m) < 0;

/** Transform a path. Arcs stay arcs for similarity transforms (rotation, uniform scale, mirror). */
export function transformPath(p: Path, m: Mat): Path {
  const flip = det(m) < 0;
  const segs: Segment[] = p.segs.map((s) =>
    s.k === 'L' ? { k: 'L', to: apply(m, s.to) } : { k: 'A', to: apply(m, s.to), c: apply(m, s.c), cw: flip ? !s.cw : s.cw },
  );
  return { ...p, start: apply(m, p.start), segs };
}

/** Decompose into translate/rotate/scale/mirror for the UI (mirror is expressed as negative sx). */
export function decompose(m: Mat) {
  const sx = Math.hypot(m[0], m[1]) * (det(m) < 0 ? -1 : 1);
  const sy = Math.hypot(m[2], m[3]);
  const rot = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  return { x: m[4], y: m[5], rot, sx, sy };
}

/** Build a matrix: scale (with mirror as negative sx/sy) then rotate then translate. */
export function build(x: number, y: number, rotDeg: number, sx = 1, sy = 1): Mat {
  return compose(translation(x, y), compose(rotation(rotDeg), scaling(sx, sy)));
}

/** Apply `m` about a pivot point: translate(-pivot) then m then translate(pivot). */
export function about(m: Mat, pivot: Vec2): Mat {
  return compose(translation(pivot.x, pivot.y), compose(m, translation(-pivot.x, -pivot.y)));
}
