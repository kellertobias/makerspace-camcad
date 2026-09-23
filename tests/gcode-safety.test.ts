import { describe, expect, it } from 'vitest';
import { newMachine, newOperation, newProject, newTool } from '@/lib/model/defaults';
import { polylinePath } from '@/lib/geometry/path';
import { identity } from '@/lib/geometry/transform';
import { planProject } from '@/lib/cam/plan';
import { emitGcode } from '@/lib/post/emitter';
import { estlcamHolz } from '@/lib/post/profiles/estlcam-holz';
import { grblMill } from '@/lib/post/profiles/grbl';
import type { Operation } from '@/lib/model/project';

type Point = { x: number; y: number; z: number };
type Motion = { line: string; kind: 0 | 1 | 2 | 3; from: Point; to: Point; feed: number; spindle: boolean; i: number; j: number };

/** Interpret the emitted program, including modal coordinates/feed and omitted G words. */
function motions(gcode: string): Motion[] {
  const out: Motion[] = [];
  let p: Point = { x: 0, y: 0, z: 0 };
  let feed = 0, spindle = false, mode: Motion['kind'] = 0;
  for (const raw of gcode.split(/\r?\n/)) {
    const line = raw.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!line) continue;
    const words = [...line.matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)].map((m) => [m[1].toUpperCase(), Number(m[2])] as const);
    for (const [word, value] of words) {
      if (word === 'M') {
        if (value === 3 || value === 4) spindle = true;
        if (value === 5 || value === 6) spindle = false;
      }
    }
    const g = words.filter(([word]) => word === 'G').map(([, value]) => value).find((v) => v >= 0 && v <= 3);
    if (g !== undefined) mode = g as Motion['kind'];
    const get = (word: string) => words.find(([w]) => w === word)?.[1];
    feed = get('F') ?? feed;
    const x = get('X'), y = get('Y'), z = get('Z');
    if (x === undefined && y === undefined && z === undefined) continue;
    const to = { x: x ?? p.x, y: y ?? p.y, z: z ?? p.z };
    out.push({ line: raw, kind: mode, from: p, to, feed, spindle, i: get('I') ?? 0, j: get('J') ?? 0 });
    p = to;
  }
  return out;
}

function samples(m: Motion): Point[] {
  const { from: a, to: b } = m;
  const arc = m.kind === 2 || m.kind === 3;
  const cx = a.x + m.i, cy = a.y + m.j;
  const radius = Math.hypot(a.x - cx, a.y - cy);
  let sweep = 0;
  if (arc) {
    const a0 = Math.atan2(a.y - cy, a.x - cx), a1 = Math.atan2(b.y - cy, b.x - cx);
    sweep = a1 - a0;
    if (m.kind === 2) { while (sweep >= -1e-8) sweep -= 2 * Math.PI; }
    else { while (sweep <= 1e-8) sweep += 2 * Math.PI; }
  }
  const length = arc ? radius * Math.abs(sweep) : Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(1, Math.ceil(length / 0.5));
  return Array.from({ length: count + 1 }, (_, n) => {
    const t = n / count;
    if (!arc) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    const angle = Math.atan2(a.y - cy, a.x - cx) + sweep * t;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), z: a.z + (b.z - a.z) * t };
  });
}

function violations(gcode: string, cuttingFeed: number): string[] {
  const errors: string[] = [];
  for (const m of motions(gcode)) {
    const xy = m.kind === 2 || m.kind === 3 || Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > 0.01;
    const inStock = Math.min(m.from.z, m.to.z) < -0.01;
    if (!inStock) continue;
    if (xy && m.kind === 0) errors.push(`rapid XY inside stock: ${m.line}`);
    if (!m.spindle) errors.push(`spindle off inside stock: ${m.line}`);
    if (m.kind !== 0 && xy && (m.feed < cuttingFeed * 0.9 || m.feed > cuttingFeed * 1.1))
      errors.push(`horizontal cut at F${m.feed}, expected ${cuttingFeed}: ${m.line}`);
    if (m.kind !== 0 && (!Number.isFinite(m.feed) || m.feed <= 0 || m.feed > cuttingFeed * 1.1))
      errors.push(`cutting feed exceeds tool limit or is absent: ${m.line}`);
  }
  return errors;
}

function fixture() {
  const tool = newTool({ id: 't', d: 6, cut: { stepDown: 3, stepOverPct: 40, n: 18000, vf: 1200, vfPlunge: 250, rampAngle: 10 } });
  const machine = newMachine({ id: 'm', feedMax: { xy: 3000, z: 1000 }, rapid: { xy: 5000, z: 2000 } });
  const project = newProject(machine.id, [tool]);
  project.stock.width = 180; project.stock.height = 80; project.stock.thickness = 10;
  const add = (id: string, points: { x: number; y: number }[]) => {
    const path = polylinePath(points, true);
    project.shapes[id] = { id, name: id, kind: 'outline', paths: [path] };
    project.placements[id] = { id, shapeId: id, name: id, transform: identity() };
    return { placementId: id, pathId: path.id, pick: 'contour' as const };
  };
  const left = add('left', [{ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 60 }, { x: 10, y: 60 }]);
  const right = add('right', [{ x: 110, y: 10 }, { x: 160, y: 10 }, { x: 160, y: 60 }, { x: 110, y: 60 }]);
  return { project, machine, tool, left, right };
}

describe('emitted milling G-code safety', () => {
  it.each([['Estlcam', estlcamHolz], ['GRBL', grblMill]])('%s uses cutting feed for every horizontal move in material', (_, profile) => {
    const { project, machine, tool, left, right } = fixture();
    const pocket = newOperation('pocket', tool.id, tool, 6, 1) as Operation & { type: 'pocket' };
    pocket.targets = [left, right]; pocket.strategy = 'raster'; pocket.rasterAngle = 90;
    project.operations[pocket.id] = pocket;
    const cutout = newOperation('cutout', tool.id, tool, 8, 2) as Operation & { type: 'cutout' };
    cutout.targets = [left]; cutout.tabs = { count: 2, width: 8, height: 2 };
    project.operations[cutout.id] = cutout;
    const { program } = planProject(project, machine);
    const gcode = emitGcode(program, profile, project.stock.safeZ).text;
    expect(motions(gcode).some((m) => m.kind !== 0 && m.to.z < 0 && m.feed === 1200)).toBe(true);
    expect(violations(gcode, 1200)).toEqual([]);
  });

  it('crosses the uncut gap between separate pockets only above the stock', () => {
    const { project, machine, tool, left, right } = fixture();
    const op = newOperation('pocket', tool.id, tool, 6, 1) as Operation & { type: 'pocket' };
    op.targets = [left, right]; op.strategy = 'offset';
    project.operations[op.id] = op;
    const gcode = emitGcode(planProject(project, machine).program, estlcamHolz, project.stock.safeZ).text;
    const crossing = motions(gcode).flatMap((m) => samples(m).filter((p) => p.x > 65 && p.x < 105 && p.y >= 0 && p.y <= 80).map((p) => ({ m, p })));
    expect(crossing.length).toBeGreaterThan(0);
    expect(crossing.filter(({ p }) => p.z < -0.01).map(({ m }) => m.line)).toEqual([]);
  });

  it('never routes a pocket move through an uncut island', () => {
    const { project, machine, tool, left } = fixture();
    const island = polylinePath([{ x: 30, y: 25 }, { x: 45, y: 25 }, { x: 45, y: 45 }, { x: 30, y: 45 }], true);
    project.shapes.island = { id: 'island', name: 'island', kind: 'outline', paths: [island] };
    project.placements.island = { id: 'island', shapeId: 'island', name: 'island', transform: identity() };
    const op = newOperation('pocket', tool.id, tool, 6, 1) as Operation & { type: 'pocket' };
    op.targets = [left, { placementId: 'island', pathId: island.id, pick: 'contour', role: 'exclude' }];
    op.strategy = 'raster'; op.rasterAngle = 90;
    project.operations[op.id] = op;
    const gcode = emitGcode(planProject(project, machine).program, estlcamHolz, project.stock.safeZ).text;
    const insideIsland = motions(gcode).flatMap((m) => samples(m).filter((p) => p.x > 30 && p.x < 45 && p.y > 25 && p.y < 45).map((p) => ({ m, p })));
    expect(insideIsland.length).toBeGreaterThan(0);
    expect(insideIsland.filter(({ p }) => p.z < -0.01).map(({ m }) => m.line)).toEqual([]);
  });

  it('catches unsafe rapid, stopped spindle, and slow or excessive cutting feeds', () => {
    const prefix = 'M03 S18000\nG00 X10 Y10 Z5\nG01 Z-2 F250\n';
    expect(violations(prefix + 'G00 X20 Y10\n', 1200)).toContain('rapid XY inside stock: G00 X20 Y10');
    expect(violations(prefix + 'M05\nG01 X20 Y10 F1200\n', 1200)).toContain('spindle off inside stock: G01 X20 Y10 F1200');
    expect(violations(prefix + 'G01 X20 Y10 F250\n', 1200)).toContain('horizontal cut at F250, expected 1200: G01 X20 Y10 F250');
    expect(violations(prefix + 'G01 X20 Y10 F3000\n', 1200)).toContain('horizontal cut at F3000, expected 1200: G01 X20 Y10 F3000');
  });
});
