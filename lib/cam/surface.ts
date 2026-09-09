import type { Operation, Path, Vec2 } from '@/lib/model/project';
import type { Move } from './types';
import type { ContourCtx } from './contour';
import { nestPaths } from '@/lib/geometry/containment';
import { closestPoint, polylinePath } from '@/lib/geometry/path';
import { offsetClosed, orient } from '@/lib/geometry/offset';
import { rasterLines } from './raster';
import { compileDepthExpression } from './surface-expression';

type SurfaceOp = Operation & { type: 'surface-3d' };
const MAX_SAMPLES = 250_000;

interface SampledLine { path: Path; points: Vec2[]; targetDepths: number[] }

function samplePolyline(points: Vec2[], step: number): Vec2[] {
  if (points.length < 2) return points;
  const out: Vec2[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/** Generate roughing layers plus one exact sampled finishing pass for a distance-from-boundary surface. */
export function surfaceMoves(paths: Path[], op: SurfaceOp, ctx: ContourCtx): { moves: Move[]; toolPaths: Path[]; warnings: string[] } {
  const warnings: string[] = [];
  const closed = paths.filter((p) => p.closed);
  if (!closed.length) return { moves: [], toolPaths: [], warnings: ['3D surface needs at least one closed contour'] };
  const nested = nestPaths(closed);
  const boundaries = nested.map((n) => orient([n.path], n.depth % 2 === 0)[0]);
  const region = offsetClosed(boundaries, -ctx.tool.d / 2, false);
  if (!region.length) return { moves: [], toolPaths: [], warnings: ['3D surface is too small for the tool diameter'] };

  let evaluate: ReturnType<typeof compileDepthExpression>;
  try { evaluate = compileDepthExpression(op.depthExpression); }
  catch (e) { return { moves: [], toolPaths: [], warnings: [(e as Error).message] }; }

  const stepOver = Math.max(0.05, (Math.min(90, Math.max(5, op.stepOverPct ?? ctx.tool.cut.stepOverPct)) / 100) * ctx.tool.d);
  const sampleStep = Math.max(0.05, op.sampleStep);
  const rawLines = rasterLines(region, stepOver, op.rasterAngle);
  const startDepth = op.zOffset + (ctx.groupDepth ?? 0);
  const maxDepth = startDepth + Math.max(0, op.depth);
  let samples = 0, clampedLow = 0, clampedHigh = 0;
  const lines: SampledLine[] = [];
  try {
    for (const raw of rawLines) {
      const points = samplePolyline(raw, sampleStep);
      samples += points.length;
      if (samples > MAX_SAMPLES) throw new Error(`3D surface needs more than ${MAX_SAMPLES.toLocaleString()} samples; increase the sampling distance or step-over`);
      const targetDepths = points.map((point) => {
        const distance = Math.min(...closed.map((boundary) => closestPoint(boundary, point).d));
        const requested = evaluate(distance, startDepth);
        if (requested < startDepth) clampedLow++;
        if (requested > maxDepth) clampedHigh++;
        return Math.min(maxDepth, Math.max(startDepth, requested));
      });
      if (points.length >= 2) lines.push({ path: polylinePath(points, false), points, targetDepths });
    }
  } catch (e) { return { moves: [], toolPaths: [], warnings: [(e as Error).message] }; }
  if (!lines.length) return { moves: [], toolPaths: [], warnings: ['3D surface produced no tool paths'] };
  if (clampedLow) warnings.push(`Surface formula values below the start depth were clamped (${clampedLow} samples)`);
  if (clampedHigh) warnings.push(`Surface formula values above the configured maximum were clamped (${clampedHigh} samples)`);
  if (ctx.tool.kind !== 'ballnose') warnings.push('A ball-nose tool is recommended for an accurate smooth 3D surface');

  const stepDown = Math.max(0.05, op.stepDown ?? ctx.tool.cut.stepDown);
  const requestedAllowance = Math.max(0, op.finishAllowance);
  const allowance = Math.min(requestedAllowance, stepDown);
  if (requestedAllowance > stepDown + 1e-9) warnings.push(`Finishing allowance was limited to the ${stepDown.toFixed(3)} mm step-down so the final pass cannot remove too much material`);
  const roughCaps: number[] = [];
  for (let depth = startDepth + stepDown; depth < maxDepth - 1e-9; depth += stepDown) roughCaps.push(depth);
  if (maxDepth > startDepth + 1e-9) roughCaps.push(maxDepth);
  const moves: Move[] = [];
  let spindle = ctx.s;
  const emitPass = (label: string, depthsOf: (line: SampledLine) => number[]) => {
    moves.push({ k: 'comment', text: label });
    for (const line of lines) {
      const depths = depthsOf(line);
      if (!depths.some((d) => d > startDepth + 1e-9)) continue;
      const p0 = line.points[0];
      moves.push({ k: 'rapid', x: p0.x, y: p0.y, z: ctx.safeZ, force: true });
      moves.push({ k: 'rapid', z: ctx.zTop - startDepth + ctx.clearZ });
      moves.push({ k: 'line', z: ctx.zTop - depths[0], f: ctx.vfPlunge, s: spindle });
      spindle = undefined;
      for (let i = 1; i < line.points.length; i++) moves.push({ k: 'line', x: line.points[i].x, y: line.points[i].y, z: ctx.zTop - depths[i], f: ctx.vf });
      moves.push({ k: 'rapid', z: ctx.safeZ });
    }
  };
  for (const cap of roughCaps) emitPass(`3D surface roughing to ${cap.toFixed(3)} mm`, (line) => line.targetDepths.map((d) => Math.max(startDepth, Math.min(cap, d - allowance))));
  emitPass('3D surface finishing pass', (line) => line.targetDepths);
  return { moves, toolPaths: lines.map((l) => l.path), warnings };
}
