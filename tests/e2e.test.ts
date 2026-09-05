import { describe, it, expect } from 'vitest';
import { newProject, newTool, newMachine, newOperation } from '@/lib/model/defaults';
import { polylinePath, circlePath } from '@/lib/geometry/path';
import { planProject } from '@/lib/cam/plan';
import { emitGcode } from '@/lib/post/emitter';
import { estlcamHolz } from '@/lib/post/profiles/estlcam-holz';
import { identity } from '@/lib/geometry/transform';
import type { Operation } from '@/lib/model/project';

function setup() {
  const tool = newTool({ id: 't1', name: 'Spiralnutfraeser Gross', slot: 2, d: 6, z: 2, cut: { stepDown: 2, stepOverPct: 40, n: 24000, vf: 2500, vfPlunge: 300, rampAngle: 20 } });
  const machine = newMachine({ id: 'm1', name: 'Holz', postId: 'estlcam-holz', nMax: 24000, feedMax: { xy: 2500, z: 1000 }, climbAllowed: true });
  const project = newProject(machine.id, [tool]);
  project.name = 'test';
  project.stock.thickness = 11;
  const rect = polylinePath([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], true);
  project.shapes['s1'] = { id: 's1', name: 'rect', kind: 'outline', paths: [rect] };
  project.placements['p1'] = { id: 'p1', shapeId: 's1', name: 'rect', transform: identity() };
  return { project, machine, tool, rect };
}

describe('outside contour with tabs -> Estlcam G-code', () => {
  it('produces the expected structure', () => {
    const { project, machine, rect } = setup();
    const op = newOperation('cutout', 't1', project.tools['t1'], 12, 1) as Operation & { type: 'cutout' };
    op.name = 'Umriss'; op.targets = [{ placementId: 'p1', pathId: rect.id, pick: 'contour' }];
    op.tabs = { count: 2, width: 14, height: 3 };
    project.operations[op.id] = op;
    const { program } = planProject(project, machine, '0.1');
    const res = emitGcode(program, estlcamHolz, project.stock.safeZ, { version: '0.1' });
    const text = res.text;
    console.log(text.split('\n').slice(0, 60).join('\n'));
    expect(text).toContain('(Project test)');
    expect(text).toContain('T2 M06 (Spiralnutfraeser Gross)');
    expect(text).toContain('M03 S24000');
    expect(text).toContain('(No. 1 Ausschnitt bearbeiten: Umriss)');
    expect(text).toMatch(/G00 Z5\.0000\n/);
    expect(text).toMatch(/G00 Z0\.5000\n/);
    expect(text).toMatch(/G01 Z0\.0000 F300 S24000\n/);
    // ramp then contour at F2500
    expect(text).toMatch(/F2500\n/);
    // tab pattern: rapid up to tab top (-11+3 = -8), then ramp down
    expect(text).toMatch(/G00 Z-8\.0000\n/);
    // program end
    expect(text.trimEnd().endsWith('G00 Z5.0000\nG00 X0.0000 Y0.0000\nM05')).toBe(true);
    expect(res.warnings).toEqual([]);
  });

  it('circle cutout inside uses helix and G02 arcs with relative IJ', () => {
    const { project, machine } = setup();
    const circ = circlePath({ x: 30, y: 30 }, 4);
    project.shapes['s2'] = { id: 's2', name: 'hole', kind: 'outline', paths: [circ] };
    project.placements['p2'] = { id: 'p2', shapeId: 's2', name: 'hole', transform: identity() };
    const op = newOperation('cutout', 't1', project.tools['t1'], 5, 1) as Operation & { type: 'cutout' };
    op.side = 'inside'; op.tabs = undefined; op.name = 'Zapfen'; op.climb = true; // machine allows climb -> holes run clockwise (G02)
    op.targets = [{ placementId: 'p2', pathId: circ.id, pick: 'contour' }];
    project.operations[op.id] = op;
    const { program } = planProject(project, machine, '0.1');
    const res = emitGcode(program, estlcamHolz, project.stock.safeZ);
    console.log(res.text);
    expect(res.text).toMatch(/G02 X[\d.-]+ Y[\d.-]+ Z-[\d.]+ I[\d.-]+ J[\d.-]+ F(?!300\b)\d+/);
    expect(res.warnings).toEqual([]);
  });
});
