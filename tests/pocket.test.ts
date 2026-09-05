import { describe, it, expect } from 'vitest';
import { polylinePath, signedArea, bbox, flatten } from '@/lib/geometry/path';
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
