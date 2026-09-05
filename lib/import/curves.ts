import type { Vec2 } from '@/lib/geometry/types';

/** Flatten a cubic bezier adaptively by chord-length subdivision count. */
export function cubicPoints(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tol = 0.01): Vec2[] {
  const est = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const n = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(est / tol) * 0.7)));
  const out: Vec2[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, mt = 1 - t;
    const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
    out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y });
  }
  return out;
}

export function quadPoints(p0: Vec2, p1: Vec2, p2: Vec2, tol = 0.01): Vec2[] {
  const c1 = { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) };
  const c2 = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) };
  return cubicPoints(p0, c1, c2, p2, tol);
}

/** Evaluate a NURBS/B-spline (De Boor) and return sampled points. */
export function bsplinePoints(ctrl: Vec2[], degree: number, knots: number[], weights: number[] | undefined, samples: number): Vec2[] {
  const n = ctrl.length - 1;
  const w = weights && weights.length === ctrl.length ? weights : ctrl.map(() => 1);
  if (knots.length !== n + degree + 2) {
    // uniform clamped knots as a fallback
    knots = [];
    for (let i = 0; i <= n + degree + 1; i++) knots.push(i <= degree ? 0 : i >= n + 1 ? n - degree + 1 : i - degree);
  }
  const u0 = knots[degree], u1 = knots[n + 1];
  const out: Vec2[] = [];
  for (let s = 0; s <= samples; s++) {
    let u = u0 + ((u1 - u0) * s) / samples;
    if (s === samples) u = u1 - 1e-12;
    let k = degree;
    while (k < n && u >= knots[k + 1]) k++;
    const d: { x: number; y: number; w: number }[] = [];
    for (let j = 0; j <= degree; j++) {
      const idx = k - degree + j;
      d.push({ x: ctrl[idx].x * w[idx], y: ctrl[idx].y * w[idx], w: w[idx] });
    }
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j;
        const den = knots[i + degree - r + 1] - knots[i];
        const a = den === 0 ? 0 : (u - knots[i]) / den;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y, w: (1 - a) * d[j - 1].w + a * d[j].w };
      }
    }
    out.push({ x: d[degree].x / d[degree].w, y: d[degree].y / d[degree].w });
  }
  return out;
}
