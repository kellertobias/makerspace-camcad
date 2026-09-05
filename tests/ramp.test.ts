import { describe, it, expect } from 'vitest';
import { polylinePath } from '@/lib/geometry/path';
import { millPath } from '@/lib/cam/contour';
import { rampEntry } from '@/lib/cam/entry';
import { newOperation, newTool } from '@/lib/model/defaults';
import type { Operation } from '@/lib/model/project';
import type { ContourCtx } from '@/lib/cam/contour';
import type { Move } from '@/lib/cam/types';

const tool = newTool({ id: 't', d: 6, cut: { stepDown: 2, stepOverPct: 40, vf: 1000, vfPlunge: 300 } });
const ctx = (): ContourCtx => ({ tool, safeZ: 5, clearZ: 0.5, vf: 1000, vfPlunge: 300, zTop: 0, thickness: 12 });
const rect = () => polylinePath([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }, { x: 0, y: 40 }], true);
const xy = (m: Move) => (m.k === 'line' || m.k === 'arc' || m.k === 'rapid' ? { x: (m as { x?: number }).x, y: (m as { y?: number }).y } : null);
const travel = (moves: Move[]) => { let l = 0, p: { x: number; y: number } | null = null; for (const m of moves) { const q = xy(m); if (!q || q.x === undefined || q.y === undefined) continue; if (p && m.k !== 'rapid') l += Math.hypot(q.x - p.x, q.y - p.y); p = { x: q.x, y: q.y }; } return l; };

describe('ramp handling', () => {
  it('90° means a straight plunge', () => {
    const moves = rampEntry(rect(), 0, -2, 90, 300);
    expect(moves).toEqual([{ k: 'line', z: -2, f: 300 }]);
  });
  it('closed outline ramps forward only: per pass the travel is one loop plus one ramp length, never a reversal', () => {
    const op = newOperation('contour', 't', tool, 4, 1) as Operation & { type: 'contour' };
    op.entry = { kind: 'ramp', angle: 10 };
    const moves = millPath(rect(), op, ctx());
    const total = 240, L = 2 / Math.tan((10 * Math.PI) / 180); // 2 mm per pass at 10°
    expect(travel(moves)).toBeCloseTo(2 * (total + L), 3);
    // no direction reversal: consecutive horizontal moves never go back along the same edge
    const pts = moves.map(xy).filter((q): q is { x: number; y: number } => !!q && q.x !== undefined && q.y !== undefined);
    for (let i = 2; i < pts.length; i++) {
      const a = { x: pts[i - 1].x - pts[i - 2].x, y: pts[i - 1].y - pts[i - 2].y }, b = { x: pts[i].x - pts[i - 1].x, y: pts[i].y - pts[i - 1].y };
      const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
      if (la < 1e-9 || lb < 1e-9) continue;
      expect((a.x * b.x + a.y * b.y) / (la * lb)).toBeGreaterThan(-0.999); // > -1 => not a U-turn
    }
    // the lowest pass reaches full depth everywhere: last loop moves are all at -4
    const zs = moves.filter((m) => m.k === 'line').map((m) => (m as { z?: number }).z);
    expect(zs[zs.length - 1]).toBeCloseTo(-4, 6);
  });
  it('open path keeps the zig-zag ramp (must return to its start anyway)', () => {
    const open = polylinePath([{ x: 0, y: 0 }, { x: 100, y: 0 }], false);
    const op = newOperation('engrave', 't', tool, 1, 1) as Operation & { type: 'engrave' };
    op.entry = { kind: 'ramp', angle: 10 };
    const moves = millPath(open, op, ctx());
    expect(travel(moves)).toBeGreaterThan(100 + 5);
  });
});
