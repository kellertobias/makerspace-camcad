import type { Path, Project, Vec2 } from '@/lib/model/project';
import { resolveTarget, type PlanResult } from '@/lib/cam/plan';
import type { SnapPoint } from '@/lib/geometry/snap';
import { worldPaths } from '@/lib/cam/instances';
import { segStart } from '@/lib/geometry/path';
import { arcSweep } from '@/lib/geometry/arcs';
import { sub, angle } from '@/lib/geometry/vec';
import type { Selection } from '@/lib/store/ui';
import type { BBox } from '@/lib/geometry/types';

export interface View { scale: number; ox: number; oy: number; w: number; h: number; dpr: number }

export const toScreen = (v: View, p: Vec2): Vec2 => ({ x: p.x * v.scale + v.ox, y: v.h - (p.y * v.scale + v.oy) });
export const toWorld = (v: View, p: Vec2): Vec2 => ({ x: (p.x - v.ox) / v.scale, y: (v.h - p.y - v.oy) / v.scale });

export function tracePath(ctx: CanvasRenderingContext2D, v: View, p: Path) {
  const s0 = toScreen(v, p.start);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 0; i < p.segs.length; i++) {
    const s = p.segs[i];
    if (s.k === 'L') { const q = toScreen(v, s.to); ctx.lineTo(q.x, q.y); }
    else {
      const from = segStart(p, i);
      const r = Math.hypot(from.x - s.c.x, from.y - s.c.y) * v.scale;
      const c = toScreen(v, s.c);
      const a0 = -angle(sub(from, s.c));
      const sweep = arcSweep(from, s.to, s.c, s.cw);
      // screen Y is flipped: world ccw (positive sweep) becomes canvas anticlockwise=true
      ctx.arc(c.x, c.y, r, a0, a0 - sweep, sweep > 0);
    }
  }
  if (p.closed) ctx.closePath();
}

const TOOL_COLORS = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#a23b72', '#3d5a80', '#f18f01'];
/** Colours of the milled area per operation type (Fräsbild). */
export const OP_TYPE_COLORS: Record<string, string> = {
  contour: '#3d8bfd', cutout: '#e4572e', pocket: '#76b041', engrave: '#ffc914', drill: '#a23b72', thread: '#17bebb', 'laser-cut': '#e4572e', 'laser-engrave': '#ffc914',
};

export interface DrawOpts {
  project: Project; plan: PlanResult | null; selection: Selection; showGrid: boolean; showMilling: boolean; showToolpaths: boolean; showRapids: boolean;
  zero: Vec2; marquee?: BBox | null; dark: boolean; hover?: { placementId: string; pathId: string } | null;
  /** operation whose bridges are being placed */
  tabPlacing?: string | null;
  /** drill/thread operation whose points are being placed */
  pointPlacing?: string | null;
  /** snapping: the point under the cursor, pinned references (a dotted line between two) and candidates of the hovered contour */
  snap?: SnapPoint | null;
  snapRefs?: SnapPoint[];
  snapHints?: SnapPoint[];
  /** reference-line snap points (between two pinned references) */
  refPoints?: SnapPoint[];
}

export function draw(ctx: CanvasRenderingContext2D, v: View, o: DrawOpts) {
  const { project } = o;
  ctx.save();
  ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  ctx.clearRect(0, 0, v.w, v.h);
  const text = o.dark ? '#e8eaee' : '#1c1f24';
  const muted = o.dark ? '#5a6472' : '#9aa3b0';
  // sheet
  const a = toScreen(v, { x: 0, y: 0 }), b = toScreen(v, { x: project.stock.width, y: project.stock.height });
  ctx.fillStyle = o.dark ? '#1a1f26' : '#fbfbfc';
  ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
  // grid
  if (o.showGrid) {
    const step = v.scale > 8 ? 5 : v.scale > 2 ? 10 : v.scale > 0.6 ? 50 : 100;
    ctx.lineWidth = 1;
    for (let x = 0; x <= project.stock.width + 1e-9; x += step) {
      const sx = Math.round(toScreen(v, { x, y: 0 }).x) + 0.5;
      ctx.strokeStyle = x % (step * 5) === 0 ? (o.dark ? '#2c333d' : '#d9dde3') : (o.dark ? '#20262e' : '#eef0f3');
      ctx.beginPath(); ctx.moveTo(sx, b.y); ctx.lineTo(sx, a.y); ctx.stroke();
    }
    for (let y = 0; y <= project.stock.height + 1e-9; y += step) {
      const sy = Math.round(toScreen(v, { x: 0, y }).y) + 0.5;
      ctx.strokeStyle = y % (step * 5) === 0 ? (o.dark ? '#2c333d' : '#d9dde3') : (o.dark ? '#20262e' : '#eef0f3');
      ctx.beginPath(); ctx.moveTo(a.x, sy); ctx.lineTo(b.x, sy); ctx.stroke();
    }
  }
  ctx.strokeStyle = muted; ctx.lineWidth = 1.5;
  ctx.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);

  // milled areas (Fräsbild): the tool-width band of every operation, coloured by operation type
  const opsSorted = Object.values(project.operations).filter((op) => op.enabled).sort((a, b) => a.order - b.order);
  // with an operation selected, every other operation is muted to a quarter of its opacity
  const anyOpSelected = o.selection.operations.length > 0;
  const dim = (op: { id: string }) => anyOpSelected && !o.selection.operations.includes(op.id);
  if (o.showMilling && o.plan) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const op of opsSorted) {
      const paths = o.plan.toolPaths[op.id];
      const tool = project.tools[op.toolId];
      if (!paths?.length || !tool) continue;
      const selected = o.selection.operations.includes(op.id);
      ctx.globalAlpha = dim(op) ? 0.25 : 1;
      ctx.strokeStyle = (OP_TYPE_COLORS[op.type] ?? '#888') + (selected ? 'aa' : '77');
      ctx.lineWidth = Math.max(1.5, tool.d * v.scale);
      ctx.beginPath(); for (const p of paths) tracePath(ctx, v, p); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // tool centre lines
  if (o.showToolpaths && o.plan) {
    const toolIndex = new Map<string, number>();
    Object.values(project.tools).forEach((t, i) => toolIndex.set(t.id, i));
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    for (const op of opsSorted) {
      const paths = o.plan.toolPaths[op.id];
      if (!paths?.length) continue;
      const color = TOOL_COLORS[(toolIndex.get(op.toolId) ?? 0) % TOOL_COLORS.length];
      const selected = o.selection.operations.includes(op.id);
      ctx.globalAlpha = dim(op) ? 0.25 : 1;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = o.showMilling ? (o.dark ? '#ffffffcc' : '#000000aa') : color;
      ctx.beginPath(); for (const p of paths) tracePath(ctx, v, p); ctx.stroke();
      // start markers
      ctx.fillStyle = o.showMilling ? (o.dark ? '#fff' : '#000') : color;
      for (const p of paths) { const s0 = toScreen(v, p.start); ctx.beginPath(); ctx.arc(s0.x, s0.y, 3, 0, Math.PI * 2); ctx.fill(); }
      // bridge markers
      const marks = o.plan.tabMarks?.[op.id];
      if (op.type === 'cutout' && marks?.length) {
        const placing = o.tabPlacing === op.id;
        const size = Math.max(7, (op.tabs?.width ?? 8) * v.scale);
        for (const m of marks) {
          const q = toScreen(v, m);
          ctx.fillStyle = placing ? '#ff7a00' : (o.dark ? '#e8eaee' : '#1c1f24');
          ctx.strokeStyle = color; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.rect(q.x - size / 2, q.y - size / 2, size, size); ctx.fill(); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  // rapids (dotted)
  if (o.showRapids && o.plan) {
    {
      ctx.setLineDash([3, 4]); ctx.strokeStyle = '#c678dd'; ctx.lineWidth = 1.2;
      let cur: Vec2 | null = null;
      ctx.beginPath();
      for (const tp of o.plan.program.tools) for (const op of tp.ops) for (const m of op.moves) {
        if (m.k === 'rapid' || m.k === 'line' || m.k === 'arc') {
          const prev: Vec2 | null = cur;
          const nx: number = m.x !== undefined ? m.x + o.zero.x : prev ? prev.x : o.zero.x;
          const ny: number = m.y !== undefined ? m.y + o.zero.y : prev ? prev.y : o.zero.y;
          if (m.k === 'rapid' && cur && (m.x !== undefined || m.y !== undefined)) { const p0 = toScreen(v, cur), p1 = toScreen(v, { x: nx, y: ny }); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
          cur = { x: nx, y: ny };
        }
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // shapes
  for (const pl of Object.values(project.placements)) {
    if (pl.visible === false) continue;
    const selectedPl = o.selection.placements.includes(pl.id) || (pl.groupId && o.selection.groups.includes(pl.groupId));
    const ws = worldPaths(project, pl);
    for (const { path } of ws) {
      const key = `${pl.id}:${path.id}`;
      const selPath = o.selection.paths.includes(key);
      const hov = o.hover && o.hover.placementId === pl.id && o.hover.pathId === path.id;
      ctx.lineWidth = selectedPl || selPath ? 2 : 1.2;
      ctx.strokeStyle = selPath ? '#ff7a00' : selectedPl ? '#1f6feb' : hov ? '#4c8dff' : text;
      ctx.beginPath();
      if (path.segs.length === 0) { const q = toScreen(v, path.start); ctx.moveTo(q.x - 5, q.y); ctx.lineTo(q.x + 5, q.y); ctx.moveTo(q.x, q.y - 5); ctx.lineTo(q.x, q.y + 5); }
      else tracePath(ctx, v, path);
      ctx.stroke();
    }
  }
  // selection bbox
  const selIds = new Set(o.selection.placements);
  for (const g of o.selection.groups) for (const pl of Object.values(project.placements)) if (pl.groupId === g) selIds.add(pl.id);
  if (selIds.size || o.selection.paths.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (path: Path) => { const bb = pathBBoxFast(path); minX = Math.min(minX, bb.minX); minY = Math.min(minY, bb.minY); maxX = Math.max(maxX, bb.maxX); maxY = Math.max(maxY, bb.maxY); };
    for (const id of selIds) { const pl = project.placements[id]; if (!pl) continue; for (const { path } of worldPaths(project, pl)) grow(path); }
    for (const key of o.selection.paths) { const [pid, pathId] = key.split(':'); const pl = project.placements[pid]; if (!pl) continue; for (const { path } of worldPaths(project, pl)) if (path.id === pathId) grow(path); }
    if (Number.isFinite(minX)) {
      const p0 = toScreen(v, { x: minX, y: minY }), p1 = toScreen(v, { x: maxX, y: maxY });
      ctx.setLineDash([5, 3]); ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = 1;
      ctx.strokeRect(p0.x - 4, p1.y - 4, p1.x - p0.x + 8, p0.y - p1.y + 8); ctx.setLineDash([]);
      ctx.fillStyle = muted; ctx.font = '11px system-ui';
      ctx.fillText(`${(maxX - minX).toFixed(1)} × ${(maxY - minY).toFixed(1)} mm`, p0.x, p1.y - 8);
    }
  }
  // drill / thread points: circle in the tool diameter with a crosshair, muted unless the operation is selected
  {
    const anySel = o.selection.operations.length > 0;
    for (const op of Object.values(project.operations)) {
      if ((op.type !== 'drill' && op.type !== 'thread') || !op.enabled) continue;
      const selected = o.selection.operations.includes(op.id);
      const placing = o.pointPlacing === op.id;
      const tool = project.tools[op.toolId];
      const rad = Math.max(4, ((op.type === 'thread' ? op.majorD : tool?.d ?? 4) / 2) * v.scale);
      ctx.globalAlpha = anySel && !selected ? 0.25 : 1;
      ctx.strokeStyle = placing ? '#ff7a00' : OP_TYPE_COLORS[op.type]; ctx.lineWidth = selected ? 2 : 1.2;
      for (const tg of op.targets) {
        for (const pt of resolveTarget(project, tg).points) {
          const q = toScreen(v, pt);
          ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(q.x - rad - 3, q.y); ctx.lineTo(q.x + rad + 3, q.y); ctx.moveTo(q.x, q.y - rad - 3); ctx.lineTo(q.x, q.y + rad + 3); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
  // snapping overlay
  if (o.snapHints?.length) {
    ctx.fillStyle = o.dark ? '#7fb2ff' : '#1f6feb';
    for (const h of o.snapHints) { const q = toScreen(v, h); ctx.beginPath(); ctx.arc(q.x, q.y, h.kind === 'end' ? 1.5 : 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
  if (o.snapRefs?.length) {
    ctx.strokeStyle = '#ff7a00'; ctx.fillStyle = '#ff7a00'; ctx.lineWidth = 1.5;
    for (const r of o.snapRefs) { const q = toScreen(v, r); ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(q.x, q.y, 1.5, 0, Math.PI * 2); ctx.fill(); }
    if (o.snapRefs.length === 2) {
      const a = toScreen(v, o.snapRefs[0]), b = toScreen(v, o.snapRefs[1]);
      ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
      // tick marks at the fraction points
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const r of o.refPoints ?? []) {
        const q = toScreen(v, r);
        ctx.beginPath(); ctx.moveTo(q.x - nx * 4, q.y - ny * 4); ctx.lineTo(q.x + nx * 4, q.y + ny * 4); ctx.stroke();
        ctx.fillStyle = o.dark ? '#ffb370' : '#c65a00';
        ctx.fillText(r.label, q.x + nx * 11, q.y + ny * 11);
      }
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    }
  }
  if (o.snap) {
    const q = toScreen(v, o.snap);
    ctx.strokeStyle = '#ff7a00'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (o.snap.kind === 'end') ctx.rect(q.x - 5, q.y - 5, 10, 10);
    else if (o.snap.kind === 'center' || o.snap.kind === 'arc-center') { ctx.arc(q.x, q.y, 6, 0, Math.PI * 2); ctx.moveTo(q.x - 9, q.y); ctx.lineTo(q.x + 9, q.y); ctx.moveTo(q.x, q.y - 9); ctx.lineTo(q.x, q.y + 9); }
    else { ctx.moveTo(q.x, q.y - 7); ctx.lineTo(q.x + 7, q.y); ctx.lineTo(q.x, q.y + 7); ctx.lineTo(q.x - 7, q.y); ctx.closePath(); }
    ctx.stroke();
    ctx.font = 'bold 11px system-ui'; ctx.fillStyle = o.dark ? '#ffb370' : '#c65a00';
    ctx.fillText(o.snap.label, q.x + 10, q.y - 8);
  }
  // zero point
  const z = toScreen(v, o.zero);
  ctx.strokeStyle = '#d2413a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(z.x - 12, z.y); ctx.lineTo(z.x + 12, z.y); ctx.moveTo(z.x, z.y - 12); ctx.lineTo(z.x, z.y + 12); ctx.stroke();
  ctx.beginPath(); ctx.arc(z.x, z.y, 6, 0, Math.PI * 2); ctx.stroke();
  // marquee
  if (o.marquee) {
    const p0 = toScreen(v, { x: o.marquee.minX, y: o.marquee.minY }), p1 = toScreen(v, { x: o.marquee.maxX, y: o.marquee.maxY });
    ctx.fillStyle = 'rgba(31,111,235,0.1)'; ctx.strokeStyle = '#1f6feb'; ctx.lineWidth = 1;
    ctx.fillRect(p0.x, p1.y, p1.x - p0.x, p0.y - p1.y); ctx.strokeRect(p0.x, p1.y, p1.x - p0.x, p0.y - p1.y);
  }
  ctx.restore();
}

/** Bounding box from vertices and arc extremes (fast approximation using arc sampling at 8 points). */
export function pathBBoxFast(p: Path): BBox {
  let minX = p.start.x, minY = p.start.y, maxX = p.start.x, maxY = p.start.y;
  const add = (q: Vec2) => { if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; };
  for (let i = 0; i < p.segs.length; i++) {
    const s = p.segs[i];
    add(s.to);
    if (s.k === 'A') {
      const from = segStart(p, i);
      const r = Math.hypot(from.x - s.c.x, from.y - s.c.y);
      const a0 = angle(sub(from, s.c)), sw = arcSweep(from, s.to, s.c, s.cw);
      for (let k = 1; k < 8; k++) { const a = a0 + (sw * k) / 8; add({ x: s.c.x + r * Math.cos(a), y: s.c.y + r * Math.sin(a) }); }
    }
  }
  return { minX, minY, maxX, maxY };
}
