import type { Path, Vec2, Segment } from '@/lib/geometry/types';
import { segStart } from '@/lib/geometry/path';
import { sub, norm, cross, add, mul, dot } from '@/lib/geometry/vec';

/**
 * Add dog-bone or T-bone overcuts at sharp inner corners so a round tool clears the true corner.
 * Works on the offset (tool-centre) path; a corner is "inner" when the path turns towards the material side,
 * which for an inside offset of a CCW path means a right turn (cross < 0) in the tool path's own direction.
 */
export function applyOvercut(toolPath: Path, _geom: Path, r: number, kind: 'dogbone' | 'tbone'): Path {
  if (!toolPath.closed) return toolPath;
  const segs = toolPath.segs;
  const n = segs.length;
  const verts: Vec2[] = [toolPath.start, ...segs.slice(0, -1).map((s) => s.to)];
  // orientation sign: interior is on the left for CCW paths
  let area = 0;
  for (let i = 0; i < n; i++) { const a = verts[i], b = verts[(i + 1) % n]; area += a.x * b.y - b.x * a.y; }
  const ccw = area > 0;
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const prev = segs[(i - 1 + n) % n];
    const cur = segs[i];
    const v = verts[i];
    const from = segStart(toolPath, i);
    void from;
    if (prev.k !== 'L' || cur.k !== 'L') { out.push(cur); continue; }
    const dIn = norm(sub(v, verts[(i - 1 + n) % n]));
    const dOut = norm(sub(cur.to, v));
    const turn = cross(dIn, dOut);
    // a corner pointing into the "hole" (convex from the material's point of view) for an inside path is where
    // the tool path turns away from the interior. For CCW tool path interior on left: inner corner => turn right (turn<0)
    const isInner = ccw ? turn < -1e-6 : turn > 1e-6;
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(dIn, dOut))));
    if (!isInner || ang < 0.1) { out.push(cur); continue; }
    // bisector pointing away from interior of tool path (into the corner of the material)
    let bis = norm(sub(dOut, dIn));
    // material corner distance: tool centre must move so circle covers the corner: length = r*(1/sin(theta/2) - 1)? for 90°: r(√2-1)
    const half = (Math.PI - ang) / 2; // half interior angle of the material corner
    const depth = r / Math.sin(half) - r;
    if (depth < 0.01) { out.push(cur); continue; }
    let target: Vec2;
    if (kind === 'dogbone') target = add(v, mul(bis, depth));
    else {
      // T-bone: along the longer of the two adjacent edges, extended past the vertex
      const lenIn = Math.hypot(verts[(i - 1 + n) % n].x - v.x, verts[(i - 1 + n) % n].y - v.y);
      const lenOut = Math.hypot(cur.to.x - v.x, cur.to.y - v.y);
      const dir = lenIn >= lenOut ? dIn : mul(dOut, -1);
      // move so the tool circle reaches the corner: along-edge distance = r*(1-cos(theta))/sin(theta)... approximate with sqrt(depth*(2r+depth))
      const t = Math.sqrt(Math.max(0, depth * (2 * r + depth)));
      target = add(v, mul(dir, t));
    }
    void bis;
    // insert: from v go to target and back to v before continuing with cur
    // The previous segment ended at v (out has it). Add two lines.
    out.push({ k: 'L', to: target });
    out.push({ k: 'L', to: v });
    out.push(cur);
  }
  return { ...toolPath, segs: out };
}
