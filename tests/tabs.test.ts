import { describe, it, expect } from 'vitest';
import { polylinePath } from '@/lib/geometry/path';
import { insertTabs } from '@/lib/cam/tabs';

describe('bridge width', () => {
  it('is the material left standing: the tool centre stays up over width + tool diameter', () => {
    const path = polylinePath([{ x: 0, y: 0 }, { x: 100, y: 0 }], false);
    const tabs = { count: 1, width: 8, height: 3 };
    const moves = insertTabs(path, tabs, [50], -12, -9, 1000, 300, 90, 6);
    // moves at the bridge top (Z -9) that travel in X
    const up = moves.filter((m) => m.k === 'line' && m.z !== undefined && Math.abs(m.z + 9) < 1e-9 && m.x !== undefined) as { x: number }[];
    const upFrom = moves.findIndex((m) => m.k === 'rapid' && Math.abs((m.z ?? 0) + 9) < 1e-9);
    const before = moves[upFrom - 1] as { x: number };
    expect(before.x).toBeCloseTo(50 - 4 - 3, 6); // lifts one tool radius before the 8 mm bridge
    expect(Math.max(...up.map((m) => m.x))).toBeCloseTo(50 + 4 + 3, 6); // stays up until one radius past it
    // material left = span minus the tool diameter
    expect(Math.max(...up.map((m) => m.x)) - before.x - 6).toBeCloseTo(8, 6);
  });
});
