import { describe, it, expect } from 'vitest';
import { polylinePath, circlePath, signedArea, pathLength, flatten } from '@/lib/geometry/path';
import { offsetClosed, difference, clipLines } from '@/lib/geometry/offset';

const rect = () => polylinePath([{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], true);

describe('offsetClosed', () => {
  it('outward offset of a rectangle gives 4 lines + 4 arcs with the right area', () => {
    const [o] = offsetClosed([rect()], 3);
    const arcs = o.segs.filter((s) => s.k === 'A'), lines = o.segs.filter((s) => s.k === 'L');
    expect(arcs.length).toBe(4);
    expect(lines.length).toBe(4);
    const expected = 86 * 46 - (4 - Math.PI) * 9;
    expect(Math.abs(signedArea(o, 0.001) - expected)).toBeLessThan(0.5);
    for (const q of flatten(o, 0.01)) {
      const dx = Math.max(0, 10 - q.x, q.x - 90), dy = Math.max(0, 10 - q.y, q.y - 50);
      expect(Math.abs(Math.hypot(dx, dy) - 3)).toBeLessThan(0.02);
    }
  });
  it('inward offset of a rectangle is a smaller rectangle', () => {
    const [o] = offsetClosed([rect()], -3);
    expect(o.segs.length).toBe(4);
    expect(Math.abs(Math.abs(signedArea(o)) - 74 * 34)).toBeLessThan(0.01);
  });
  it('circle stays an exact circle', () => {
    const [o] = offsetClosed([circlePath({ x: 0, y: 0 }, 10)], 2);
    expect(o.segs.every((s) => s.k === 'A')).toBe(true);
    expect(Math.abs(pathLength(o) - 2 * Math.PI * 12)).toBeLessThan(1e-6);
  });
  it('difference and open-line clipping work', () => {
    const island = polylinePath([{ x: 40, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 40 }, { x: 40, y: 40 }], true);
    const d = difference([rect()], [island]);
    expect(d.length).toBe(2);
    const lines = clipLines([[{ x: 0, y: 30 }, { x: 100, y: 30 }]], [rect()]);
    expect(lines.length).toBe(1);
    expect(Math.abs(Math.abs(lines[0][0].x - lines[0][lines[0].length - 1].x) - 80)).toBeLessThan(0.01);
  });
});
