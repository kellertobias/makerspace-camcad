import { describe, it, expect } from 'vitest';
import { newProject, newTool, newMachine, newOperation } from '@/lib/model/defaults';
import { polylinePath } from '@/lib/geometry/path';
import { planProject } from '@/lib/cam/plan';
import { emitGcode } from '@/lib/post/emitter';
import { estlcamHolz } from '@/lib/post/profiles/estlcam-holz';
import { identity } from '@/lib/geometry/transform';
import type { Operation } from '@/lib/model/project';

describe('operation order', () => {
  it('runs operations in user order and inserts a tool change whenever the tool changes', () => {
    const t6 = newTool({ id: 't6', name: 'Six', slot: 1, d: 6, cut: { stepDown: 3, stepOverPct: 40, n: 24000, vf: 2500, vfPlunge: 300 } });
    const t3 = newTool({ id: 't3', name: 'Three', slot: 2, d: 3, cut: { stepDown: 1.5, stepOverPct: 40, n: 24000, vf: 1200, vfPlunge: 300 } });
    const machine = newMachine({ id: 'm', name: 'Holz' });
    const project = newProject(machine.id, [t6, t3]);
    const rect = polylinePath([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], true);
    project.shapes['s'] = { id: 's', name: 'r', kind: 'outline', paths: [rect] };
    project.placements['p'] = { id: 'p', shapeId: 's', name: 'r', transform: identity() };
    const mk = (type: 'pocket' | 'engrave' | 'cutout', toolId: string, order: number, name: string) => {
      const op = newOperation(type, toolId, project.tools[toolId], 3, order) as Operation;
      op.name = name; op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }];
      if (op.type === 'cutout') op.tabs = undefined;
      project.operations[op.id] = op;
    };
    mk('pocket', 't6', 1, 'A pocket 6');
    mk('engrave', 't3', 2, 'B engrave 3');
    mk('cutout', 't6', 3, 'C cutout 6');
    const { program } = planProject(project, machine);
    expect(program.tools.map((b) => b.tool.id)).toEqual(['t6', 't3', 't6']);
    expect(program.tools.flatMap((b) => b.ops.map((o) => o.name))).toEqual(['A pocket 6', 'B engrave 3', 'C cutout 6']);
    const text = emitGcode(program, estlcamHolz, 5).text;
    expect(text.match(/T\d M06/g)?.length).toBe(3);
    expect(text.indexOf('(No. 1 ')).toBeLessThan(text.indexOf('(No. 2 '));
    expect(text.indexOf('(No. 2 ')).toBeLessThan(text.indexOf('(No. 3 '));
    // header lists each tool once
    expect(text.split('\n').filter((l) => l === '(Six)').length).toBe(1);
  });
});
