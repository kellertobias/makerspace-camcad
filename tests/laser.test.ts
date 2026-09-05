import { describe, it, expect } from 'vitest';
import { polylinePath, circlePath, bbox } from '@/lib/geometry/path';
import { newProject, newTool, newMachine, newOperation } from '@/lib/model/defaults';
import { planProject } from '@/lib/cam/plan';
import { emitGcode } from '@/lib/post/emitter';
import { exportSvg } from '@/lib/post/svgExport';
import { grblLaser } from '@/lib/post/profiles/grbl';
import { identity } from '@/lib/geometry/transform';
import type { Operation, Project } from '@/lib/model/project';

const laserTool = newTool({ id: 'l', kind: 'laser', name: 'Laser', slot: 9, d: 0.2, cut: { stepDown: 1, stepOverPct: 100, vf: 600, power: 80, passes: 1 } });
const laserMachine = (dynamic = true) => newMachine({ id: 'lm', kind: 'laser', postId: 'grbl-laser', laser: { sMax: 1000, dynamic }, feedMax: { xy: 6000, z: 1000 } });
const setup = () => {
  const project: Project = newProject('lm', [laserTool]);
  project.stock = { ...project.stock, width: 200, height: 100, thickness: 3 };
  const rect = polylinePath([{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 60 }, { x: 20, y: 60 }], true);
  const hole = circlePath({ x: 50, y: 40 }, 8);
  project.shapes['s'] = { id: 's', name: 's', kind: 'outline', paths: [rect, hole] };
  project.placements['p'] = { id: 'p', shapeId: 's', name: 'p', transform: identity() };
  return { project, rect, hole };
};

describe('laser cut', () => {
  it('offsets by half the kerf, repeats passes, uses M4 with the scaled power and writes no Z', () => {
    const { project, rect } = setup();
    const op = newOperation('laser-cut', 'l', laserTool, 0, 1) as Operation & { type: 'laser-cut' };
    op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }]; op.power = 60; op.speed = 900; op.passes = 2; op.kerfSide = 'outside';
    project.operations[op.id] = op;
    const plan = planProject(project, laserMachine());
    const tp = plan.toolPaths[op.id][0];
    const b = bbox(tp);
    expect(b.minX).toBeCloseTo(20 - 0.1, 6); expect(b.maxX).toBeCloseTo(80 + 0.1, 6); // kerf/2 outside
    const g = emitGcode(plan.program, grblLaser, 5, { laserMode: 'M4' }).text;
    expect(g).toMatch(/M4 S600/);                       // 60 % of S max 1000
    expect(g).not.toMatch(/\bZ-?\d/);                    // laser profile has no Z word
    expect(g).toMatch(/G1 .*F900/);
    // two passes: the corner (80.1, 19.9) is reached twice while cutting
    expect((g.match(/G1 X80\.1 Y19\.9\b/g) ?? []).length + (g.match(/G1 Y19\.9\b/g) ?? []).length + (g.match(/G1 X80\.1\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(g.indexOf('M5')).toBeGreaterThan(g.indexOf('M4 S600'));
    expect(plan.program.tools[0].ops[0].warnings.some((w) => /CNC/.test(w))).toBe(false);
  });
  it('constant-power machines switch the beam per contour with M3', () => {
    const { project, rect, hole } = setup();
    const op = newOperation('laser-cut', 'l', laserTool, 0, 1) as Operation & { type: 'laser-cut' };
    op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }, { placementId: 'p', pathId: hole.id, pick: 'contour' }];
    project.operations[op.id] = op;
    const plan = planProject(project, laserMachine(false));
    const g = emitGcode(plan.program, grblLaser, 5, { laserMode: 'M3' }).text;
    expect((g.match(/^M3 S[1-9]/gm) ?? []).length).toBe(2); // beam on per contour (M3 S0 at program start does not count)
    expect((g.match(/^M5$/gm) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(g).not.toMatch(/M4/);
  });
  it('warns when a laser operation is planned on a CNC machine and vice versa', () => {
    const { project, rect } = setup();
    const op = newOperation('laser-cut', 'l', laserTool, 0, 1) as Operation & { type: 'laser-cut' };
    op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }];
    project.operations[op.id] = op;
    const cnc = newMachine({ id: 'c', kind: 'cnc' });
    expect(planProject(project, cnc).program.tools[0].ops[0].warnings.some((w) => /Laser operation on the CNC/.test(w))).toBe(true);
    const mill = newOperation('contour', 'l', laserTool, 3, 2) as Operation & { type: 'contour' };
    mill.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }];
    project.operations = { [mill.id]: mill };
    expect(planProject(project, laserMachine()).program.tools[0].ops[0].warnings.some((w) => /Milling operation on the laser/.test(w))).toBe(true);
  });
});

describe('laser engrave', () => {
  it('hatch fills the contour but leaves the hole clear, and traces the outline', () => {
    const { project, rect, hole } = setup();
    const op = newOperation('laser-engrave', 'l', laserTool, 0, 1) as Operation & { type: 'laser-engrave' };
    op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }, { placementId: 'p', pathId: hole.id, pick: 'contour' }];
    op.mode = 'hatch'; op.hatchPitch = 1; op.hatchAngle = 0; op.outline = true;
    project.operations[op.id] = op;
    const plan = planProject(project, laserMachine());
    const paths = plan.toolPaths[op.id];
    const lines = paths.filter((p) => !p.closed);
    expect(lines.length).toBeGreaterThan(40); // 40 mm tall at 1 mm pitch, rows through the hole are split in two
    for (const l of lines) for (const q of [l.start, ...l.segs.map((s) => s.to)]) {
      expect(q.x).toBeGreaterThanOrEqual(20 - 1e-6); expect(q.x).toBeLessThanOrEqual(80 + 1e-6);
      // no hatch point inside the hole
      expect(Math.hypot(q.x - 50, q.y - 40)).toBeGreaterThanOrEqual(8 - 0.02); // clipped against the flattened circle
    }
    expect(paths.filter((p) => p.closed).length).toBe(2); // outline + hole traced
  });
  it('vector mode traces the lines once per pass', () => {
    const { project, rect } = setup();
    const op = newOperation('laser-engrave', 'l', laserTool, 0, 1) as Operation & { type: 'laser-engrave' };
    op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }]; op.mode = 'vector'; op.passes = 3;
    project.operations[op.id] = op;
    const plan = planProject(project, laserMachine());
    const lines = plan.program.tools[0].ops[0].moves.filter((m) => m.k === 'line');
    expect(lines.length).toBe(4 * 3);
  });
});

describe('SVG export', () => {
  it('writes a sheet-sized mm SVG with one group per operation, y flipped', () => {
    const { project, rect } = setup();
    const op = newOperation('laser-cut', 'l', laserTool, 0, 1) as Operation & { type: 'laser-cut' };
    op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }]; op.kerfSide = 'on';
    project.operations[op.id] = op;
    const plan = planProject(project, laserMachine());
    const svg = exportSvg(project, plan);
    expect(svg).toMatch(/width="200mm" height="100mm" viewBox="0 0 200 100"/);
    expect(svg).toMatch(/data-op="laser-cut"/);
    expect(svg).toMatch(/stroke="#ff0000"/);
    // the rectangle's bottom edge y = 20 becomes 80 in the y-down SVG
    expect(svg).toMatch(/M20 80|M80 80/);
    expect(svg).toMatch(/ Z"/);
  });
});
