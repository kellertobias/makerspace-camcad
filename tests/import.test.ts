import { describe, it, expect } from 'vitest';
import { parseSvgPath } from '@/lib/import/svgPath';
import { arcPoint } from '@/lib/geometry/arcs';
import { offsetClosed } from '@/lib/geometry/offset';
import { orientCcw, joinPaths } from '@/lib/import/normalize';
import { importDxf } from '@/lib/import/dxf';
import { signedArea, pathLength, polylinePath } from '@/lib/geometry/path';
import { readFileSync } from 'node:fs';

describe('svg path arcs', () => {
  it('sweep flag 1 sweeps in positive angle direction (raw y-down coordinates)', () => {
    const [p] = parseSvgPath('M0,0 A10,10 0 0 1 20,0');
    const s = p.segs[0];
    expect(s.k).toBe('A');
    if (s.k !== 'A') return;
    const mid = arcPoint(p.start, s.to, s.c, s.cw, 0.5);
    expect(mid.x).toBeCloseTo(10, 5);
    expect(mid.y).toBeCloseTo(-10, 5);
  });
  it('rounded rectangle offsets to 4 lines + 4 arcs of radius r+3', () => {
    const [p] = orientCcw(parseSvgPath('M20,5 H80 A15,15 0 0 1 95,20 V48 A15,15 0 0 1 80,63 H20 A15,15 0 0 1 5,48 V20 A15,15 0 0 1 20,5 Z'));
    // in raw y-down coordinates this rect is drawn clockwise on screen => ccw in math => outward offset is +3
    const [o] = offsetClosed([p], 3);
    const arcs = o.segs.filter((s) => s.k === 'A');
    expect(arcs.length).toBe(4);
    expect(o.segs.filter((s) => s.k === 'L').length).toBe(4);
    for (const a of arcs) if (a.k === 'A') expect(Math.hypot(a.to.x - a.c.x, a.to.y - a.c.y)).toBeCloseTo(18, 2);
  });
});

describe('dxf import', () => {
  it('reads the sample: joins lines, keeps bulges as arcs, circles and arcs', () => {
    const d = importDxf(readFileSync('public/samples/slot-plate.dxf', 'utf8'));
    expect(d.unitKnown).toBe(true);
    const paths = joinPaths(d.paths);
    expect(paths.length).toBe(4);
    const slot = paths.find((p) => p.closed && p.segs.some((s) => s.k === 'A') && Math.abs(Math.abs(signedArea(p)) - (40 * 20 + Math.PI * 100)) < 1);
    expect(slot).toBeTruthy();
    const rect = paths.find((p) => p.closed && p.segs.every((s) => s.k === 'L'));
    expect(rect && Math.abs(Math.abs(signedArea(rect)) - 60 * 20) < 1e-6).toBe(true);
    const arc = paths.find((p) => !p.closed);
    expect(arc && Math.abs(pathLength(arc) - Math.PI * 6) < 1e-6).toBe(true);
  });
});

describe('joinPaths', () => {
  it('chains segments in mixed directions into a closed loop', () => {
    const segs = [polylinePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], false), polylinePath([{ x: 10, y: 10 }, { x: 10, y: 0 }], false), polylinePath([{ x: 10, y: 10 }, { x: 0, y: 10 }], false), polylinePath([{ x: 0, y: 0 }, { x: 0, y: 10 }], false)];
    const out = joinPaths(segs);
    expect(out.length).toBe(1);
    expect(out[0].closed).toBe(true);
    expect(Math.abs(signedArea(out[0]))).toBeCloseTo(100, 6);
  });
});
