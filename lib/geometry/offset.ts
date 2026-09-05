import ClipperLib from 'clipper-lib';
import type { Path, Vec2 } from './types';
import { flatten, asCircle, circlePath, signedArea, reverse } from './path';
import { refitArcs } from './fit';
import { newId } from '@/lib/model/ids';

/** Integer scale for Clipper (0.1 µm resolution). */
export const SCALE = 1e4;
const FLAT_TOL = 0.005;
/** Arc tolerance for round joins in Clipper units. */
const ARC_TOL = 0.003 * SCALE;

type CPath = ClipperLib.Path;
type CPaths = ClipperLib.Paths;

export function toClipper(pts: Vec2[]): CPath {
  return pts.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) }));
}
export function fromClipper(p: CPath): Vec2[] {
  return p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }));
}
export function pathsToClipper(paths: Path[], tol = FLAT_TOL): CPaths {
  return paths.map((p) => toClipper(flatten(p, tol)));
}
export function clipperToPaths(paths: CPaths, closed = true, refit = true, tol = 0.01): Path[] {
  const out: Path[] = [];
  for (const p of paths) {
    if (p.length < (closed ? 3 : 2)) continue;
    const pts = fromClipper(p);
    out.push(refit ? refitArcs(pts, closed, tol) : { id: newId('pa'), start: pts[0], segs: pts.slice(1).map((to) => ({ k: 'L' as const, to })), closed });
  }
  return out;
}

function inflate(subject: CPaths, delta: number, endType: number): CPaths {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOL);
  co.AddPaths(subject, ClipperLib.JoinType.jtRound, endType);
  const sol: CPaths = [];
  co.Execute(sol, delta * SCALE);
  return sol;
}

/**
 * Offset closed paths by `delta` (positive = outward for CCW outers, holes must be CW). Returns arc-refitted paths.
 * A single full circle is offset analytically so it stays an exact circle.
 */
export function offsetClosed(paths: Path[], delta: number, refit = true): Path[] {
  if (Math.abs(delta) < 1e-9) return paths;
  if (paths.length === 1) {
    const circ = asCircle(paths[0]);
    if (circ) {
      const ccw = signedArea(paths[0]) > 0;
      const r = circ.r + (ccw ? delta : -delta);
      if (r <= 1e-6) return [];
      const a0 = Math.atan2(paths[0].start.y - circ.c.y, paths[0].start.x - circ.c.x);
      return [circlePath(circ.c, r, circ.cw, a0, paths[0].layer)];
    }
  }
  // Clipper requires consistent orientation: outers positive (CCW in Y-up), holes negative.
  const subject = pathsToClipper(paths);
  const res = inflate(subject, delta, ClipperLib.EndType.etClosedPolygon);
  return clipperToPaths(ClipperLib.Clipper.CleanPolygons(res, SCALE * 0.001), true, refit);
}

/** Offset an open path on both sides (returns the outline polygon of the swept band). */
export function offsetOpenBand(path: Path, delta: number): Path[] {
  const res = inflate([toClipper(flatten(path, FLAT_TOL))], Math.abs(delta), ClipperLib.EndType.etOpenRound);
  return clipperToPaths(res, true, true);
}

function boolean(op: number, subject: Path[], clip: Path[]): Path[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(pathsToClipper(subject), ClipperLib.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(pathsToClipper(clip), ClipperLib.PolyType.ptClip, true);
  const sol: CPaths = [];
  c.Execute(op, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return clipperToPaths(sol, true, true);
}
export const union = (paths: Path[]) => boolean(ClipperLib.ClipType.ctUnion, paths, []);
export const difference = (subject: Path[], clip: Path[]) => boolean(ClipperLib.ClipType.ctDifference, subject, clip);
export const intersection = (subject: Path[], clip: Path[]) => boolean(ClipperLib.ClipType.ctIntersection, subject, clip);

/** Clip open polylines (as point arrays) against closed polygons; returns the inside parts. */
export function clipLines(lines: Vec2[][], polygons: Path[]): Vec2[][] {
  const c = new ClipperLib.Clipper();
  for (const l of lines) c.AddPath(toClipper(l), ClipperLib.PolyType.ptSubject, false);
  c.AddPaths(pathsToClipper(polygons), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctIntersection, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return ClipperLib.Clipper.OpenPathsFromPolyTree(tree).map((p) => fromClipper(p));
}

/** Force orientation: ccw=true makes every path counter-clockwise. */
export function orient(paths: Path[], ccw = true): Path[] {
  return paths.map((p) => ((signedArea(p) > 0) === ccw ? p : reverse(p)));
}
