import { describe, it, expect } from 'vitest';
import { polylinePath, signedArea, bbox, flatten, closestPoint } from '@/lib/geometry/path';
import { pocketMoves } from '@/lib/cam/pocket';
import { newOperation, newTool } from '@/lib/model/defaults';
import type { Operation } from '@/lib/model/project';
import type { ContourCtx } from '@/lib/cam/contour';

const rect = () => polylinePath([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], true);
const tool = newTool({ id: 't', d: 6, cut: { stepDown: 3, stepOverPct: 50, vfPlunge: 300, vf: 1000 } });
const ctx: ContourCtx = { tool, safeZ: 5, clearZ: 0.5, vf: 1000, vfPlunge: 300, zTop: 0, thickness: 12 };
const op = (side: 'inside' | 'on' | 'outside') => { const o = newOperation('pocket', 't', tool, 3, 1) as Operation & { type: 'pocket' }; o.side = side; o.outsideWidth = 12; o.outsideWidthUnit = 'mm'; o.entry = { kind: 'plunge' }; return o; };
const size = (p: ReturnType<typeof rect>) => { const b = bbox(p); return [Math.round((b.maxX - b.minX) * 100) / 100, Math.round((b.maxY - b.minY) * 100) / 100]; };

describe('pocket sides', () => {
  it('inside: wall is the contour shrunk by r, then rings inward', () => {
    const r = pocketMoves([rect()], op('inside'), ctx);
    expect(r.warnings).toEqual([]);
    expect(size(r.toolPaths[0])).toEqual([74, 34]);
    expect(r.toolPaths.length).toBeGreaterThan(3);
    expect(Math.abs(signedArea(r.toolPaths[1]))).toBeLessThan(Math.abs(signedArea(r.toolPaths[0])));
  });
  it('on: wall is the contour itself', () => {
    const r = pocketMoves([rect()], op('on'), ctx);
    expect(size(r.toolPaths[0])).toEqual([80, 40]);
    expect(size(r.toolPaths[1])).toEqual([74, 34]);
  });
  it('outside: contour+r wall first, then the band boundary at width − r, then the whole interior is cleared', () => {
    const r = pocketMoves([rect()], op('outside'), ctx);
    expect(r.warnings).toEqual([]);
    expect(size(r.toolPaths[0])).toEqual([86, 46]); // hugging pass at +3
    expect(size(r.toolPaths[1])).toEqual([98, 58]); // band boundary at +9 (12 mm removed around the contour)
    // rings continue inward past the contour: the smallest ring is well inside the part
    const minHeight = Math.min(...r.toolPaths.map((p) => size(p)[1]));
    expect(minHeight).toBeLessThan(10);
  });
  it('island is respected for inside pockets', () => {
    const island = polylinePath([{ x: 40, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 40 }, { x: 40, y: 40 }], true);
    const r = pocketMoves([rect(), island], op('inside'), ctx);
    // two wall paths: outer shrunk (74x34) and island grown (26x26)
    const sizes = r.toolPaths.slice(0, 2).map(size).sort((a, b) => a[0] - b[0]);
    expect(sizes).toEqual([[26, 26], [74, 34]]);
  });
});

describe('start depth', () => {
  it('cuts from start depth to start depth + depth', () => {
    const o = op('inside'); o.zOffset = 2; o.depth = 3; o.stepDown = 3;
    const r = pocketMoves([rect()], o, ctx);
    const zs = r.moves.filter((m) => m.k === 'line' || m.k === 'rapid').map((m) => (m as { z?: number }).z).filter((z): z is number => z !== undefined);
    expect(Math.min(...zs)).toBeCloseTo(-5, 6);
    // first feed move goes to the start depth
    const firstLine = r.moves.find((m) => m.k === 'line') as { z?: number };
    expect(firstLine.z).toBeCloseTo(-2, 6);
  });
});

describe('outside width units', () => {
  it('tool widths convert to mm and one tool width is just the wall pass', () => {
    const o = op('outside'); o.outsideWidth = 2; o.outsideWidthUnit = 'tool';
    const r = pocketMoves([rect()], o, ctx);
    const sizes = r.toolPaths.slice(0, 2).map(size).sort((a, b) => a[0] - b[0]);
    expect(sizes).toEqual([[86, 46], [98, 58]]); // +3 wall and +9 outer boundary (2 × 6 mm = 12 mm band)
    const o1 = op('outside'); o1.outsideWidth = 1; o1.outsideWidthUnit = 'tool';
    const r1 = pocketMoves([rect()], o1, ctx);
    expect(size(r1.toolPaths[0])).toEqual([86, 46]); // one tool width: the wall pass is the band
    expect(r1.toolPaths.length).toBeGreaterThan(1); // interior still cleared
  });
});

describe('exclusion zones', () => {
  it('keeps a standoff with a margin standing inside the pocket', () => {
    const post = polylinePath([{ x: 45, y: 25 }, { x: 55, y: 25 }, { x: 55, y: 35 }, { x: 45, y: 35 }], true);
    const r = pocketMoves([rect()], op('inside'), ctx, [{ path: post, margin: 4 }]);
    // walls: outer shrunk (74x34) and the standoff grown by r + margin = 7 -> 24x24
    const sizes = r.toolPaths.slice(0, 2).map(size).sort((a, b) => a[0] - b[0]);
    expect(sizes).toEqual([[24, 24], [74, 34]]);
    // no tool-centre path enters the protected square (10x10 grown by 7 => keep-out 24x24 around (50,30))
    const distToSquare = (q: { x: number; y: number }) => Math.hypot(Math.max(0, Math.abs(q.x - 50) - 5), Math.max(0, Math.abs(q.y - 30) - 5));
    for (const p of r.toolPaths) for (const q of flatten(p, 0.1)) expect(distToSquare(q)).toBeGreaterThan(7 - 0.05);
  });
});

describe('zig-zag strategy', () => {
  it('chains the raster lines into one continuous path', () => {
    const o = op('inside'); o.strategy = 'zigzag'; o.rasterAngle = 0;
    const r = pocketMoves([rect()], o, ctx);
    // wall + one chained fill path
    expect(r.toolPaths.length).toBe(2);
    const zz = r.toolPaths[1];
    expect(zz.closed).toBe(false);
    expect(zz.segs.length).toBeGreaterThan(10);
    // alternating direction: consecutive horizontal runs go opposite ways
    const xs = [zz.start.x, ...zz.segs.map((s) => s.to.x)];
    let dirChanges = 0;
    for (let i = 2; i < xs.length; i += 2) if (Math.sign(xs[i] - xs[i - 1]) !== Math.sign(xs[i - 2 + 1] - xs[i - 2]) ) dirChanges++;
    expect(dirChanges).toBeGreaterThan(3);
    // the raster strategy on the same pocket produces separate lines
    const o2 = op('inside'); o2.strategy = 'raster';
    expect(pocketMoves([rect()], o2, ctx).toolPaths.length).toBeGreaterThan(5);
  });
});

describe('ring linking', () => {
  const zOf = (m: { z?: number }) => m.z;
  it('stays at depth between rings and passes: one ramp per pass, no lift until the end', () => {
    const o = op('inside'); o.depth = 6; o.stepDown = 3; o.entry = { kind: 'ramp', angle: 10 };
    const r = pocketMoves([rect()], o, ctx);
    const ms = r.moves as { k: string; x?: number; y?: number; z?: number }[];
    let z = ctx.safeZ, lifts = 0;
    for (const m of ms) { const nz = zOf(m); if (nz === undefined) continue; if (nz > z + 1e-9) lifts++; z = nz; }
    // only the final retract to safe Z lifts the tool
    expect(lifts).toBe(1);
    // ramps are feed moves that travel in XY while descending; they come in one run per depth pass
    let runs = 0, prev = ctx.safeZ, inRun = false;
    for (const m of ms) {
      const nz = zOf(m);
      if (nz === undefined) { inRun = false; continue; }
      const ramp = m.k === 'line' && m.x !== undefined && nz < prev - 1e-9;
      if (ramp && !inRun) runs++;
      inRun = ramp;
      prev = nz;
    }
    expect(runs).toBe(2);
  });
  it('lifts to cross an island', () => {
    const island = polylinePath([{ x: 40, y: 15 }, { x: 60, y: 15 }, { x: 60, y: 45 }, { x: 40, y: 45 }], true);
    const o = op('inside'); o.entry = { kind: 'ramp', angle: 10 };
    const r = pocketMoves([rect(), island], o, ctx);
    const rapidsUp = r.moves.filter((m) => m.k === 'rapid' && (m as { z?: number }).z !== undefined && (m as { x?: number }).x === undefined);
    expect(rapidsUp.length).toBeGreaterThan(1);
  });
});

describe('disconnected pocket areas', () => {
  it('finishes one area (walls and fill) before travelling to the next: one lift per pass between two areas', () => {
    const other = polylinePath([{ x: 110, y: 10 }, { x: 170, y: 10 }, { x: 170, y: 50 }, { x: 110, y: 50 }], true);
    const o = op('inside'); o.depth = 6; o.stepDown = 3; o.entry = { kind: 'ramp', angle: 10 };
    const r = pocketMoves([rect(), other], o, ctx);
    let z = ctx.safeZ, lifts = 0;
    for (const m of r.moves) { const nz = (m as { z?: number }).z; if (nz === undefined) continue; if (nz > z + 1e-9) lifts++; z = nz; }
    // pass 1: area A -> area B (1 lift); pass 2 starts in B where the tool is, then B -> A (1 lift); final retract
    expect(lifts).toBe(3);
  });
  it('after a lift the tool plunges only to already cleared depth and ramps the rest', () => {
    const other = polylinePath([{ x: 110, y: 10 }, { x: 170, y: 10 }, { x: 170, y: 50 }, { x: 110, y: 50 }], true);
    const o = op('inside'); o.depth = 6; o.stepDown = 3; o.entry = { kind: 'ramp', angle: 10 };
    const r = pocketMoves([rect(), other], o, ctx);
    const ms = r.moves as { k: string; x?: number; z?: number }[];
    let z = ctx.safeZ, lifted = false;
    const reached = new Set<number>([0]); // depths the whole pocket has been cleared to
    for (const m of ms) {
      if (m.z === undefined) continue;
      if (m.z > z + 1e-9) lifted = true;
      else if (lifted && m.k === 'line' && m.x === undefined) { expect([...reached].some((d) => Math.abs(d - m.z!) < 1e-6)).toBe(true); lifted = false; }
      z = m.z;
      if (m.z <= -3 - 1e-9) reached.add(-3);
    }
    // and every pass depth is first reached by a ramp (a move that travels in XY), never by a Z-only plunge
    let prev = ctx.safeZ; const firstReach = new Map<number, string>();
    for (const m of ms) { if (m.z === undefined) continue; const key = Math.round(m.z * 1000) / 1000; if (m.z < prev - 1e-9 && !firstReach.has(key)) firstReach.set(key, m.x === undefined ? 'plunge' : 'ramp'); prev = m.z; }
    expect(firstReach.get(-3)).toBe('ramp');
    expect(firstReach.get(-6)).toBe('ramp');
  });
});

describe('zig-zag fill start', () => {
  it('the wall pass ends where the zig-zag begins, so the fill continues without a slot across the floor or a lift', () => {
    const o = op('inside'); o.strategy = 'zigzag'; o.depth = 3; o.stepDown = 3; o.entry = { kind: 'ramp', angle: 10 };
    const r = pocketMoves([rect()], o, ctx);
    const wall = r.toolPaths[0], firstLine = r.toolPaths[1];
    expect(wall.closed).toBe(true); expect(firstLine.closed).toBe(false);
    // the wall (after its forward ramp) is rotated so that the loop ends at the fill start
    const ms = r.moves as { k: string; x?: number; y?: number; z?: number }[];
    // find the first move that reaches the fill start
    const fs = firstLine.start;
    const idx = ms.findIndex((m) => m.x !== undefined && Math.abs(m.x - fs.x) < 1e-6 && Math.abs((m.y ?? NaN) - fs.y) < 1e-6);
    expect(idx).toBeGreaterThan(0);
    // no rapid (lift) between the beginning of the cut and that point
    expect(ms.slice(3, idx + 1).some((m) => m.k === 'rapid')).toBe(false);
    // and the tool centre never leaves the wall on the way there: every move up to the fill start lies on the wall outline
    const onWall = (x: number, y: number) => Math.abs(x - 13) < 1e-6 || Math.abs(x - 87) < 1e-6 || Math.abs(y - 13) < 1e-6 || Math.abs(y - 47) < 1e-6;
    expect(ms.slice(3, idx + 1).every((m) => m.x === undefined || onWall(m.x, m.y!))).toBe(true);
  });
  it('a raster line that is not adjacent to the previous one is reached at clearance height, not by cutting across', () => {
    const island = polylinePath([{ x: 40, y: 15 }, { x: 60, y: 15 }, { x: 60, y: 45 }, { x: 40, y: 45 }], true);
    const o = op('inside'); o.strategy = 'raster'; o.rasterAngle = 90; o.entry = { kind: 'ramp', angle: 10 };
    const r = pocketMoves([rect(), island], o, ctx);
    const ms = r.moves as { k: string; x?: number; y?: number; z?: number }[];
    const onPath = (a: { x: number; y: number }, b: { x: number; y: number }) => r.toolPaths.some((p) => closestPoint(p, a).d < 1e-3 && closestPoint(p, b).d < 1e-3);
    // every feed move that travels in XY is either a cutting move on a tool path or a short link to the neighbouring line
    let last: { x: number; y: number } | null = null, lifts = 0;
    for (const m of ms) {
      if (m.k === 'rapid' && m.z !== undefined && m.x === undefined) lifts++;
      if (m.x === undefined || m.y === undefined) continue;
      if (last && m.k === 'line') {
        const d = Math.hypot(m.x - last.x, m.y - last.y);
        if (d > 3 * 2.2 + 1e-6) expect(onPath(last, { x: m.x, y: m.y })).toBe(true);
      }
      last = { x: m.x, y: m.y };
    }
    // the island splits the raster into two groups: at least one lift is needed to get from one to the other
    expect(lifts).toBeGreaterThan(1);
  });
});
