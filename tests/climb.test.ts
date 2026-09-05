import { describe, it, expect } from 'vitest';
import { newProject, newTool, newMachine, newOperation } from '@/lib/model/defaults';
import { polylinePath, signedArea } from '@/lib/geometry/path';
import { planProject } from '@/lib/cam/plan';
import { identity } from '@/lib/geometry/transform';
import type { Operation } from '@/lib/model/project';

function run(climbAllowed: boolean, climb: boolean) {
  const tool = newTool({ id: 't1', d: 6, cut: { stepDown: 3, stepOverPct: 40, n: 24000, vf: 2500, vfPlunge: 300 } });
  const machine = newMachine({ id: 'm1', name: 'Holz CNC', climbAllowed });
  const project = newProject(machine.id, [tool]);
  const rect = polylinePath([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], true);
  project.shapes['s1'] = { id: 's1', name: 'r', kind: 'outline', paths: [rect] };
  project.placements['p1'] = { id: 'p1', shapeId: 's1', name: 'r', transform: identity() };
  const op = newOperation('contour', 't1', tool, 3, 1, climb) as Operation & { type: 'contour' };
  op.targets = [{ placementId: 'p1', pathId: rect.id, pick: 'contour' }];
  project.operations[op.id] = op;
  const { program, toolPaths } = planProject(project, machine);
  return { warnings: program.tools[0].ops[0].warnings, ccw: signedArea(toolPaths[op.id][0]) > 0 };
}

describe('climb milling permission', () => {
  it('machine default forbids climb: outside contour runs clockwise (conventional) with a warning', () => {
    expect(newMachine().climbAllowed).toBe(false);
    const r = run(false, true);
    expect(r.ccw).toBe(false);
    expect(r.warnings.some((w) => /Climb/i.test(w))).toBe(true);
  });
  it('machine allows climb: outside contour runs counter-clockwise', () => {
    const r = run(true, true);
    expect(r.ccw).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
