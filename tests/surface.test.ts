import { describe, expect, it } from 'vitest';
import { compileDepthExpression } from '@/lib/cam/surface-expression';
import { surfaceMoves } from '@/lib/cam/surface';
import { newMachine, newOperation, newProject, newTool } from '@/lib/model/defaults';
import { polylinePath } from '@/lib/geometry/path';
import type { ContourCtx } from '@/lib/cam/contour';
import type { Operation } from '@/lib/model/project';
import type { Move } from '@/lib/cam/types';
import { planProject } from '@/lib/cam/plan';
import { identity } from '@/lib/geometry/transform';

const lineWithZ = (m: Move): m is Move & { k: 'line'; z: number } => m.k === 'line' && m.z !== undefined;

describe('surface depth expressions', () => {
  it('supports JavaScript-style formulas, Math functions and conditionals', () => {
    const fn = compileDepthExpression('distance < 5 ? startDepth + Math.sin(distance) ** 2 : max(startDepth, 9)');
    expect(fn(0, 2)).toBe(2);
    expect(fn(Math.PI / 2, 2)).toBeCloseTo(3);
    expect(fn(8, 2)).toBe(9);
  });

  it('does not execute arbitrary JavaScript from imported projects', () => {
    expect(() => compileDepthExpression('globalThis.fetch("https://example.com")')).toThrow(/Unsupported|Expected/);
    expect(() => compileDepthExpression('distance / 0')(1, 0)).toThrow(/Infinity/);
  });
});

describe('formula-defined 3D surface toolpaths', () => {
  const tool = newTool({ id: 'ball', kind: 'ballnose', d: 2, cut: { stepDown: 3, stepOverPct: 50, vf: 1000, vfPlunge: 250 } });
  const ctx: ContourCtx = { tool, safeZ: 5, clearZ: 0.5, vf: 1000, vfPlunge: 250, zTop: 0, thickness: 30 };
  const rect = polylinePath([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 20 }, { x: 0, y: 20 }], true);

  function operation() {
    const op = newOperation('surface-3d', tool.id, tool, 20, 1) as Operation & { type: 'surface-3d' };
    op.zOffset = 2;
    op.depthExpression = 'startDepth + min(20, distance * 2)';
    op.sampleStep = 1;
    op.stepOverPct = 50;
    op.finishAllowance = 0.5;
    return op;
  }

  it('creates step-down-limited roughing layers and a final variable-Z pass', () => {
    const result = surfaceMoves([rect], operation(), ctx);
    expect(result.warnings).toEqual([]);
    const comments = result.moves.filter((m) => m.k === 'comment').map((m) => m.text);
    expect(comments.filter((x) => x.includes('roughing'))).toHaveLength(7);
    expect(comments.at(-1)).toBe('3D surface finishing pass');

    const finishAt = result.moves.findIndex((m) => m.k === 'comment' && m.text.includes('finishing'));
    const finishZ = result.moves.slice(finishAt + 1).filter(lineWithZ).map((m) => m.z);
    expect(new Set(finishZ.map((z) => z.toFixed(3))).size).toBeGreaterThan(5);
    expect(Math.min(...finishZ)).toBeGreaterThanOrEqual(-22);
    expect(Math.max(...finishZ)).toBeLessThanOrEqual(-2);
    expect(result.toolPaths.length).toBeGreaterThan(5);
  });

  it('leaves the finishing allowance everywhere during roughing', () => {
    const result = surfaceMoves([rect], operation(), ctx);
    const finishing = result.moves.findIndex((m) => m.k === 'comment' && m.text.includes('finishing'));
    const rough = result.moves.slice(0, finishing);
    const roughZ = rough.filter(lineWithZ).map((m) => m.z);
    expect(Math.min(...roughZ)).toBeGreaterThanOrEqual(-21.5 - 1e-9);
  });

  it('limits the finishing allowance to one step-down so the final pass stays safe', () => {
    const op = operation(); op.finishAllowance = 10;
    const result = surfaceMoves([rect], op, ctx);
    expect(result.warnings.join(' ')).toMatch(/limited.*step-down/);
    const finishing = result.moves.findIndex((m) => m.k === 'comment' && m.text.includes('finishing'));
    const lastRough = result.moves.slice(0, finishing).filter(lineWithZ).map((m) => m.z);
    expect(Math.min(...lastRough)).toBeGreaterThanOrEqual(-19 - 1e-9); // final depth 22 minus at most 3 mm
  });

  it('rejects open contours and reports invalid formulas without emitting cutting moves', () => {
    const open = { ...rect, closed: false };
    expect(surfaceMoves([open], operation(), ctx).warnings[0]).toMatch(/closed contour/);
    const op = operation(); op.depthExpression = 'Math.nope(distance)';
    const result = surfaceMoves([rect], op, ctx);
    expect(result.moves).toEqual([]);
    expect(result.warnings[0]).toMatch(/Unsupported/);
  });

  it('flows through project planning as variable-Z machine moves', () => {
    const machine = newMachine({ id: 'machine' });
    const project = newProject(machine.id, [tool]);
    project.shapes.shape = { id: 'shape', name: 'surface boundary', kind: 'outline', paths: [rect] };
    project.placements.placement = { id: 'placement', shapeId: 'shape', name: 'surface boundary', transform: identity() };
    const op = operation();
    op.targets = [{ placementId: 'placement', pathId: rect.id, pick: 'contour' }];
    project.operations[op.id] = op;
    const planned = planProject(project, machine);
    const plannedOp = planned.program.tools[0].ops[0];
    expect(plannedOp.typeLabel).toBe('3D-Oberfläche bearbeiten');
    expect(plannedOp.moves.some((m) => m.k === 'comment' && m.text === '3D surface finishing pass')).toBe(true);
    expect(new Set(plannedOp.moves.filter(lineWithZ).map((m) => m.z.toFixed(3))).size).toBeGreaterThan(5);
  });
});
