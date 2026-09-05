import { describe, it, expect } from 'vitest';
import { Simulator, chooseCell, flattenMoves } from '@/lib/cam/sim/heightmap';
import { newProject, newTool, newMachine, newOperation } from '@/lib/model/defaults';
import { polylinePath } from '@/lib/geometry/path';
import { planProject } from '@/lib/cam/plan';
import { identity } from '@/lib/geometry/transform';
import type { Operation } from '@/lib/model/project';

describe('heightmap simulation', () => {
  it('a cutout with bridges leaves the bridges standing and cuts through elsewhere', () => {
    const tool = newTool({ id: 't', d: 6, cut: { stepDown: 4, stepOverPct: 40, n: 24000, vf: 2500, vfPlunge: 300 } });
    const machine = newMachine({ id: 'm' });
    const project = newProject('m', [tool]);
    project.stock = { ...project.stock, width: 120, height: 80, thickness: 12 };
    const rect = polylinePath([{ x: 20, y: 20 }, { x: 100, y: 20 }, { x: 100, y: 60 }, { x: 20, y: 60 }], true);
    project.shapes['s'] = { id: 's', name: 'r', kind: 'outline', paths: [rect] };
    project.placements['p'] = { id: 'p', shapeId: 's', name: 'r', transform: identity() };
    const op = newOperation('cutout', 't', tool, 13, 1) as Operation & { type: 'cutout' };
    op.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }];
    op.tabs = { count: 2, width: 10, height: 3, mode: 'auto' };
    project.operations[op.id] = op;
    const { program, tabMarks } = planProject(project, machine);
    const cell = chooseCell(120, 80, 200_000);
    const moves = flattenMoves(program.tools, project.stock.safeZ);
    const sim = new Simulator({ width: 120, height: 80, thickness: 12, zero: { x: 0, y: 0 }, zZero: 'top', cell, tools: [{ kind: 'endmill', d: 6 }], moves });
    sim.run(moves.length);
    const h = (x: number, y: number) => sim.heights[Math.round(y / cell) * sim.nx + Math.round(x / cell)];
    // untouched centre of the part and outside
    expect(h(60, 40)).toBeCloseTo(12, 5);
    expect(h(5, 5)).toBeCloseTo(12, 5);
    // through cut on the left edge tool path (x = 17) away from bridges: 13 mm in 12 mm stock -> 1 mm below the bed
    expect(h(17, 40)).toBeCloseTo(-1, 5);
    // bridges remain at 3 mm
    for (const m of tabMarks[op.id]) expect(h(m.x, m.y)).toBeCloseTo(3, 1);
  });
  it('v-bit footprint is a cone', () => {
    const sim = new Simulator({ width: 20, height: 20, thickness: 10, zero: { x: 0, y: 0 }, zZero: 'top', cell: 0.1, tools: [{ kind: 'vbit', d: 6, tipAngle: 90 }], moves: [{ k: 'rapid', x: 10, y: 10, z: 5, op: 0, f: 300 }, { k: 'line', x: 10, y: 10, z: -2, op: 0, f: 300 }] });
    sim.run(2);
    const h = (x: number, y: number) => sim.heights[Math.round(y / 0.1) * sim.nx + Math.round(x / 0.1)];
    expect(h(10, 10)).toBeCloseTo(8, 1);      // tip 2 mm deep
    expect(h(11, 10)).toBeCloseTo(9, 1);      // 45° flank: 1 mm out -> 1 mm shallower
    expect(h(12.5, 10)).toBeCloseTo(10, 1);   // beyond the 2 mm cutting radius at this depth
  });
});

describe('through-cut depth bookkeeping', () => {
  it('records exactly-through as 0 and deeper cuts as negative heights', () => {
    const mk = (z: number) => new Simulator({ width: 20, height: 20, thickness: 10, zero: { x: 0, y: 0 }, zZero: 'top', cell: 0.2, tools: [{ kind: 'endmill', d: 4 }], moves: [{ k: 'rapid', x: 5, y: 10, z: 5, op: 0, f: 300 }, { k: 'line', x: 5, y: 10, z, op: 0, f: 300 }, { k: 'line', x: 15, y: 10, z, op: 0, f: 1000 }] });
    const exact = mk(-10); exact.run(3);
    const deep = mk(-10.5); deep.run(3);
    const idx = Math.round(10 / 0.2) * exact.nx + Math.round(10 / 0.2);
    expect(exact.heights[idx]).toBeCloseTo(0, 6);
    expect(deep.heights[idx]).toBeCloseTo(-0.5, 6);
  });
});

describe('simulation region offset', () => {
  it('a region that does not start at the sheet origin still places cuts correctly', () => {
    const sim = new Simulator({ ox: 40, oy: 30, width: 20, height: 20, thickness: 10, zero: { x: 0, y: 0 }, zZero: 'top', cell: 0.1, tools: [{ kind: 'endmill', d: 4 }], moves: [{ k: 'rapid', x: 50, y: 40, z: 5, op: 0, f: 300 }, { k: 'line', x: 50, y: 40, z: -3, op: 0, f: 300 }] });
    sim.run(2);
    const h = (x: number, y: number) => sim.heights[Math.round((y - 30) / 0.1) * sim.nx + Math.round((x - 40) / 0.1)];
    expect(h(50, 40)).toBeCloseTo(7, 5);
    expect(h(51.5, 40)).toBeCloseTo(7, 5);
    expect(h(53, 40)).toBeCloseTo(10, 5);
  });
});

describe('capsule sweep', () => {
  const cfg = (moves: import('@/lib/cam/sim/heightmap').SimMove[], cell = 0.1) => ({ width: 60, height: 30, thickness: 12, zero: { x: 0, y: 0 }, zZero: 'top' as const, cell, tools: [{ kind: 'endmill' as const, d: 6 }], moves });
  /** brute force reference: dense stamping of the tool disc along the move */
  const reference = (moves: import('@/lib/cam/sim/heightmap').SimMove[], cell: number) => {
    const nx = Math.ceil(60 / cell) + 1, ny = Math.ceil(30 / cell) + 1;
    const H = new Float32Array(nx * ny).fill(12);
    for (let k = 1; k < moves.length; k++) {
      const a = moves[k - 1], b = moves[k]; if (b.k === 'rapid') continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y); const n = Math.max(1, Math.ceil(len / (cell / 4)));
      for (let s = 0; s <= n; s++) {
        const t = s / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, h = 12 + a.z + (b.z - a.z) * t;
        for (let j = Math.max(0, Math.floor((y - 3) / cell)); j <= Math.min(ny - 1, Math.ceil((y + 3) / cell)); j++)
          for (let i = Math.max(0, Math.floor((x - 3) / cell)); i <= Math.min(nx - 1, Math.ceil((x + 3) / cell)); i++)
            if (Math.hypot(i * cell - x, j * cell - y) <= 3 && h < H[j * nx + i]) H[j * nx + i] = h;
      }
    }
    return { H, nx };
  };
  it('matches dense stamping for a diagonal ramp and a level move', () => {
    const moves = [
      { k: 'rapid' as const, x: 5, y: 5, z: 5, op: 0, f: 0 }, { k: 'line' as const, x: 5, y: 5, z: 0, op: 0, f: 300 },
      { k: 'line' as const, x: 35, y: 20, z: -3, op: 0, f: 1000 }, { k: 'line' as const, x: 55, y: 20, z: -3, op: 0, f: 1000 },
    ];
    const cell = 0.2;
    const sim = new Simulator(cfg(moves, cell)); sim.run(moves.length);
    const ref = reference(moves, cell);
    let cutCells = 0;
    const ends = moves.map((m) => ({ x: m.x, y: m.y }));
    for (let k = 0; k < sim.heights.length; k++) {
      const d = Math.abs(sim.heights[k] - ref.H[k]);
      if (ref.H[k] < 12) cutCells++;
      if (d <= 0.02) continue; // the reference samples every quarter cell and lags the exact sweep by at most that
      // larger differences may only occur on cells exactly one tool radius from a move end, where the reference's hypot rounds out
      const x = (k % ref.nx) * cell, y = Math.floor(k / ref.nx) * cell;
      expect(ends.some((e) => Math.abs(Math.hypot(x - e.x, y - e.y) - 3) < 1e-6)).toBe(true);
    }
    expect(cutCells).toBeGreaterThan(1000);
  });
  it('a ramp cuts each cell to the deepest height the tool reaches over it', () => {
    const moves = [{ k: 'rapid' as const, x: 3, y: 15, z: 0, op: 0, f: 0 }, { k: 'line' as const, x: 33, y: 15, z: -3, op: 0, f: 1000 }];
    const sim = new Simulator(cfg(moves)); sim.run(2);
    const h = (x: number) => sim.heights[Math.round(15 / 0.1) * sim.nx + Math.round(x / 0.1)];
    // at x = 13 the tool's trailing edge passes when its centre is at 16 (t = 13/30) -> tip at -1.3
    expect(h(13)).toBeCloseTo(12 - 1.3, 3);
    expect(h(33)).toBeCloseTo(9, 3);
    expect(h(36)).toBeCloseTo(9, 3); // leading edge at the end of the move
    expect(h(36.2)).toBeCloseTo(12, 3);
  });
});
