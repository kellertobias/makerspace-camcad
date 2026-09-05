import type { Machine, Operation, Project, Path, Tool, Target } from '@/lib/model/project';
import type { Move, OpToolpath, Program, ToolProgram } from './types';
import { contourMoves, type ContourCtx } from './contour';
import { resolveFeeds } from './feeds';
import { worldPaths, allPartsBBox, instanceTransforms } from './instances';
import { zeroPoint } from './zero';
import { estimateSeconds } from './time';
import { bbox as pathBBox } from '@/lib/geometry/path';
import { bboxCenter } from '@/lib/geometry/types';
import { apply } from '@/lib/geometry/transform';
import { drillMoves } from './drill';
import { threadMoves } from './thread';
import { pocketMoves, type Exclusion } from './pocket';
import { laserCutMoves, laserEngraveMoves, type LaserCtx } from './laser';
import { apply as applyMat } from '@/lib/geometry/transform';

export const OP_TYPE_LABELS: Record<Operation['type'], string> = {
  contour: 'Kontur bearbeiten', cutout: 'Ausschnitt bearbeiten', pocket: 'Räumen', engrave: 'Gravur bearbeiten', drill: 'Bohrung bearbeiten',
  thread: 'Gewinde bearbeiten', 'laser-cut': 'Laser schneiden', 'laser-engrave': 'Laser gravieren',
};

export interface PlanResult { program: Program; /** tool-centre paths per op for drawing */ toolPaths: Record<string, Path[]>; /** bridge centre positions per cutout op (world) */ tabMarks: Record<string, { x: number; y: number }[]> }

/** Resolve the world geometry a target refers to. */
export function resolveTarget(project: Project, t: Target): { paths: Path[]; points: { x: number; y: number }[] } {
  const pl = project.placements[t.placementId];
  // free point: local to its placement (replicated per array instance) or in sheet coordinates when unattached
  if (t.point) return { paths: [], points: pl ? instanceTransforms(pl).map((m) => apply(m, t.point!)) : [{ x: t.point.x, y: t.point.y }] };
  if (!pl) return { paths: [], points: [] };
  const shape = project.shapes[pl.shapeId];
  if (!shape) return { paths: [], points: [] };
  const ws = worldPaths(project, pl);
  if (t.pick === 'shape-center') {
    const pts = instanceTransforms(pl).map((m, k) => {
      const inst = ws.filter((w) => w.instance === k).map((w) => w.path);
      if (!inst.length) return apply(m, { x: 0, y: 0 });
      const b = inst.map(pathBBox).reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY), maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY) }));
      return bboxCenter(b);
    });
    return { paths: [], points: pts };
  }
  const matching = ws.filter((w) => !t.pathId || w.path.id === t.pathId || w.path.id.startsWith(t.pathId));
  // transformPath keeps ids, so compare against the shape path id
  const byId = ws.filter((w) => shape.paths.some((sp) => sp.id === t.pathId && w.path.id === sp.id));
  const list = t.pathId ? (byId.length ? byId : matching) : ws;
  if (t.pick === 'point') return { paths: [], points: list.map((w) => w.path.start) };
  if (t.pick === 'line-center') {
    return { paths: [], points: list.map((w) => { const b = pathBBox(w.path); return bboxCenter(b); }) };
  }
  return { paths: list.map((w) => w.path), points: [] };
}

export function planProject(project: Project, machine: Machine, version = 'dev'): PlanResult {
  const warnings: string[] = [];
  const toolPaths: Record<string, Path[]> = {};
  const tabMarks: Record<string, { x: number; y: number }[]> = {};
  const ops = Object.values(project.operations).filter((o) => o.enabled && o.targets.length).sort((a, b) => a.order - b.order);
  const zero = zeroPoint(project, allPartsBBox(project));
  const zTop = project.stock.zZero === 'top' ? 0 : project.stock.thickness;
  const shift = (moves: Move[]): Move[] => moves.map((m) => {
    if (m.k === 'rapid' || m.k === 'line') return { ...m, x: m.x === undefined ? undefined : m.x - zero.x, y: m.y === undefined ? undefined : m.y - zero.y };
    if (m.k === 'arc') return { ...m, x: m.x - zero.x, y: m.y - zero.y, cx: m.cx - zero.x, cy: m.cy - zero.y };
    return m;
  });

  // Operations run strictly in the user's order; consecutive operations sharing a tool form one block,
  // and every block boundary is a tool change.
  const blocks: { toolId: string; ops: Operation[] }[] = [];
  for (const op of ops) {
    const last = blocks[blocks.length - 1];
    if (last && last.toolId === op.toolId) last.ops.push(op); else blocks.push({ toolId: op.toolId, ops: [op] });
  }
  const tools: ToolProgram[] = [];
  let order = 0;
  for (const block of blocks) {
    const tool: Tool | undefined = project.tools[block.toolId];
    if (!tool) { warnings.push(`Tool ${block.toolId} missing`); continue; }
    const tp: ToolProgram = { tool, s: 0, ops: [] };
    let firstCut = true;
    for (let op of block.ops) {
      order++;
      const { feeds, warnings: fw } = resolveFeeds(op, tool, machine);
      if (op.climb && machine.climbAllowed !== true) { fw.push(`Climb milling is not allowed on ${machine.name}; conventional milling used`); op = { ...op, climb: false }; }
      tp.s = tp.s || feeds.s;
      const group = Object.values(project.groups).find((g) => op.targets.some((t) => project.placements[t.placementId]?.groupId === g.id));
      const ctx: ContourCtx = {
        tool, safeZ: project.stock.safeZ + (zTop), clearZ: project.stock.clearZ, vf: feeds.vf, vfPlunge: feeds.vfPlunge,
        s: firstCut ? feeds.s : undefined, zTop, groupDepth: group?.zOffset ?? 0, thickness: project.stock.thickness,
      };
      const isLaserOp = op.type === 'laser-cut' || op.type === 'laser-engrave';
      if (isLaserOp && machine.kind !== 'laser') fw.push(`Laser operation on the CNC machine ${machine.name}: check machine and post-processor`);
      if (!isLaserOp && machine.kind === 'laser') fw.push(`Milling operation on the laser machine ${machine.name}: no Z axis, the program will not cut as intended`);
      const laser: LaserCtx = { s: feeds.s, dynamic: machine.laser?.dynamic ?? true, z: op.type === 'laser-cut' ? zTop - project.stock.thickness : zTop - 0.3 };
      const opTp: OpToolpath = { opId: op.id, order, typeLabel: OP_TYPE_LABELS[op.type], name: op.name || `${op.type} ${order}`, moves: [], warnings: [...fw] };
      toolPaths[op.id] = [];
      tabMarks[op.id] = [];
      if (op.type === 'cutout' && op.tabs?.points?.length) {
        ctx.tabPoints = op.tabs.points.map((pt) => { const pl = project.placements[pt.placementId]; return pl ? applyMat(pl.transform, { x: pt.x, y: pt.y }) : { x: pt.x, y: pt.y }; });
      }
      if (op.type === 'pocket') {
        // all cut targets form one pocket; exclusion targets are subtracted with their margin
        const cut: Path[] = [];
        const exclusions: Exclusion[] = [];
        for (const target of op.targets) {
          const geo = resolveTarget(project, target);
          if (target.role === 'exclude') exclusions.push(...geo.paths.filter((p) => p.closed).map((p) => ({ path: p, margin: target.margin ?? 0 })));
          else cut.push(...geo.paths);
        }
        if (cut.length) {
          const r = pocketMoves(cut, op, ctx, exclusions);
          opTp.moves.push(...r.moves); toolPaths[op.id].push(...r.toolPaths); opTp.warnings.push(...r.warnings);
          if (r.moves.length) { firstCut = false; ctx.s = undefined; }
        } else if (op.targets.length) opTp.warnings.push('Pocket has only exclusion contours');
      }
      if (op.type === 'laser-engrave') {
        // all targets together so holes inside a hatched area stay clear
        const all: Path[] = [];
        for (const target of op.targets) all.push(...resolveTarget(project, target).paths);
        const r = laserEngraveMoves(all, op, ctx, laser);
        opTp.moves.push(...r.moves); toolPaths[op.id].push(...r.toolPaths); opTp.warnings.push(...r.warnings);
        if (r.moves.length) firstCut = false;
      }
      for (const target of op.type === 'pocket' || op.type === 'laser-engrave' ? [] : op.targets) {
        const geo = resolveTarget(project, target);
        switch (op.type) {
          case 'contour': case 'cutout': case 'engrave':
            for (const g of geo.paths) {
              const r = contourMoves(g, op, ctx);
              opTp.moves.push(...r.moves); toolPaths[op.id].push(...r.toolPaths); opTp.warnings.push(...r.warnings); tabMarks[op.id].push(...r.tabMarks);
              if (r.moves.length) { firstCut = false; ctx.s = undefined; }
            }
            break;
          case 'drill': {
            const pts = geo.points.length ? geo.points : geo.paths.map((p) => bboxCenter(pathBBox(p)));
            for (const p of pts) { opTp.moves.push(...drillMoves(p, op, ctx)); if (opTp.moves.length) { firstCut = false; ctx.s = undefined; } }
            break;
          }
          case 'thread': {
            const pts = geo.points.length ? geo.points : geo.paths.map((p) => bboxCenter(pathBBox(p)));
            for (const p of pts) { const r = threadMoves(p, op, ctx); opTp.moves.push(...r.moves); opTp.warnings.push(...r.warnings); if (r.moves.length) firstCut = false; }
            break;
          }
          case 'laser-cut':
            for (const g of geo.paths) {
              const r = laserCutMoves(g, op, ctx, laser);
              opTp.moves.push(...r.moves); toolPaths[op.id].push(...r.toolPaths); opTp.warnings.push(...r.warnings);
              if (r.moves.length) firstCut = false;
            }
            break;
          default:
            opTp.warnings.push(`Operation type "${op.type}" is not implemented yet`);
        }
      }
      opTp.moves = shift(opTp.moves);
      tp.ops.push(opTp);
    }
    tools.push(tp);
  }
  // program end: retract, go home
  const program: Program = { tools, meta: { project: project.name, seconds: 0, version }, warnings };
  program.meta.seconds = estimateSeconds(program, machine);
  return { program, toolPaths, tabMarks };
}
