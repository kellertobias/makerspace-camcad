import type { Path, Vec2 } from './types';
import { segStart, segPoint, pointAt, bbox } from './path';

/**
 * Snap points on drawing geometry for placing drill/thread points and bridges:
 * segment ends, the centre of every segment, its 1/3 + 2/3 and 1/4 + 3/4 points, arc/circle centres,
 * the centre of closed contours and the centre of open multi-segment lines. Two picked points span a
 * reference line whose 1/4, 1/3, 1/2, 2/3 and 3/4 points snap as well.
 */
export type SnapKind = 'end' | 'mid' | 'third' | 'quarter' | 'center' | 'arc-center' | 'ref';

export interface SnapPoint extends Vec2 {
  kind: SnapKind;
  /** Placement + array instance the point belongs to (empty placementId = sheet coordinates). */
  placementId: string;
  instance: number;
  /** Short label such as ½, ⅓, ¼, ⌖ */
  label: string;
}

const FRACTIONS: { t: number; kind: SnapKind; label: string }[] = [
  { t: 0.5, kind: 'mid', label: '½' },
  { t: 1 / 3, kind: 'third', label: '⅓' }, { t: 2 / 3, kind: 'third', label: '⅔' },
  { t: 0.25, kind: 'quarter', label: '¼' }, { t: 0.75, kind: 'quarter', label: '¾' },
];

/** All snap candidates of one (world) path. */
export function snapPointsOfPath(path: Path, placementId: string, instance: number): SnapPoint[] {
  const out: SnapPoint[] = [];
  const seen = new Set<string>();
  const add = (p: Vec2, kind: SnapKind, label: string) => {
    const key = `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x: p.x, y: p.y, kind, placementId, instance, label });
  };
  if (!path.segs.length) { add(path.start, 'end', '·'); return out; }
  for (let i = 0; i < path.segs.length; i++) {
    const from = segStart(path, i);
    const s = path.segs[i];
    add(from, 'end', '·');
    add(s.to, 'end', '·');
    if (s.k === 'A') add(s.c, 'arc-center', '⌖');
    for (const f of FRACTIONS) add(segPoint(from, s, f.t), f.kind, f.label);
  }
  if (path.closed) add(centerOf(path), 'center', '⌖');
  else if (path.segs.length > 1) add(pointAt(path, 0.5).pt, 'mid', '½');
  return out;
}

/** Centre of a contour: the bounding-box centre (what the shape-centre pick uses as well). */
export function centerOf(path: Path): Vec2 {
  const b = bbox(path);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Points along the reference line between two picked points. */
export function referencePoints(a: SnapPoint, b: SnapPoint): SnapPoint[] {
  return FRACTIONS.map((f) => ({ x: a.x + (b.x - a.x) * f.t, y: a.y + (b.y - a.y) * f.t, kind: 'ref' as SnapKind, placementId: a.placementId, instance: a.instance, label: f.label }));
}

/** Nearest candidate within `tol` (mm). Reference-line points win ties so a placed line stays usable. */
export function nearestSnap(cands: SnapPoint[], pt: Vec2, tol: number): SnapPoint | null {
  let best: SnapPoint | null = null, bd = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.x - pt.x, c.y - pt.y) - (c.kind === 'ref' ? tol * 0.25 : 0);
    if (d <= tol && d < bd) { bd = d; best = c; }
  }
  return best;
}
