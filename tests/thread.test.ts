import { describe, it, expect } from 'vitest';
import { threadMoves } from '@/lib/cam/thread';
import { drillMoves } from '@/lib/cam/drill';
import { newOperation, newTool } from '@/lib/model/defaults';
import type { Operation } from '@/lib/model/project';
import type { ContourCtx } from '@/lib/cam/contour';

const tool = newTool({ id: 't', d: 4, cut: { stepDown: 2, stepOverPct: 40, vf: 600, vfPlunge: 200 } });
const ctx = (): ContourCtx => ({ tool, safeZ: 5, clearZ: 0.5, vf: 600, vfPlunge: 200, zTop: 0, thickness: 20 });

describe('start depth for drill and thread', () => {
  it('drill starts at the start depth and ends at start + depth', () => {
    const op = newOperation('drill', 't', tool, 6, 1) as Operation & { type: 'drill' }; op.zOffset = 3;
    const zs = drillMoves({ x: 10, y: 10 }, op, ctx()).map((m) => (m as { z?: number }).z).filter((z): z is number => z !== undefined);
    expect(Math.min(...zs)).toBeCloseTo(-9, 6);
    expect(zs).toContain(-3 + 0.5); // clearance above the start depth
  });
  it('internal M8 thread: helix radius = 4 − r, one pitch per revolution, from bottom up to the start depth', () => {
    const op = newOperation('thread', 't', tool, 10, 1) as Operation & { type: 'thread' };
    op.zOffset = 2; op.majorD = 8; op.pitch = 1.25; op.internal = true; op.passes = 1;
    const { moves, warnings } = threadMoves({ x: 10, y: 10 }, op, ctx());
    expect(warnings).toEqual([]);
    const arcs = moves.filter((m) => m.k === 'arc') as { x: number; y: number; z?: number }[];
    expect(arcs.length).toBeGreaterThan(8);
    for (const a of arcs) expect(Math.hypot(a.x - 10, a.y - 10)).toBeCloseTo(2, 6); // 8/2 − 4/2
    const zs = arcs.map((a) => a.z!);
    expect(zs[0]).toBeGreaterThan(-12); expect(zs[0]).toBeLessThanOrEqual(-12 + 1.25 / 4 + 1e-9);
    expect(zs[zs.length - 1]).toBeCloseTo(-2, 6);
    // four quarter arcs climb exactly one pitch
    expect(zs[3] - (-12)).toBeCloseTo(1.25, 6);
  });
  it('tool too large for the thread produces a warning and no moves', () => {
    const op = newOperation('thread', 't', tool, 5, 1) as Operation & { type: 'thread' }; op.majorD = 4;
    const r = threadMoves({ x: 0, y: 0 }, op, ctx());
    expect(r.moves).toEqual([]); expect(r.warnings.length).toBe(1);
  });
});
