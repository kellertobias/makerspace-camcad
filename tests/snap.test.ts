import { describe, it, expect } from 'vitest';
import { polylinePath, circlePath } from '@/lib/geometry/path';
import { snapPointsOfPath, referencePoints, nearestSnap, centerOf } from '@/lib/geometry/snap';
import { resolveTarget } from '@/lib/cam/plan';
import type { Project } from '@/lib/model/project';
import { newProject } from '@/lib/model/defaults';

const near = (pts: { x: number; y: number }[], x: number, y: number) => pts.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);

describe('snap points', () => {
  it('a line segment offers its ends, centre, thirds and quarters', () => {
    const line = polylinePath([{ x: 0, y: 0 }, { x: 12, y: 0 }], false);
    const pts = snapPointsOfPath(line, 'p', 0);
    for (const x of [0, 12, 6, 4, 8, 3, 9]) expect(near(pts, x, 0)).toBe(true);
    expect(pts.find((p) => p.x === 6)?.label).toBe('½');
    expect(pts.find((p) => p.x === 4)?.label).toBe('⅓');
    expect(pts.find((p) => p.x === 9)?.label).toBe('¾');
  });
  it('a closed contour offers the centre of every side and the shape centre', () => {
    const rect = polylinePath([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }], true);
    const pts = snapPointsOfPath(rect, 'p', 0);
    expect(near(pts, 20, 0)).toBe(true); // bottom centre
    expect(near(pts, 40, 10)).toBe(true); // right centre
    expect(near(pts, 20, 10)).toBe(true); // shape centre
    expect(pts.find((p) => p.x === 20 && p.y === 10)?.kind).toBe('center');
    expect(centerOf(rect)).toEqual({ x: 20, y: 10 });
  });
  it('a circle offers its centre', () => {
    const pts = snapPointsOfPath(circlePath({ x: 5, y: 7 }, 3), 'p', 0);
    expect(pts.some((p) => p.kind === 'arc-center' && Math.abs(p.x - 5) < 1e-6 && Math.abs(p.y - 7) < 1e-6)).toBe(true);
  });
  it('two references span a line with ¼ ⅓ ½ ⅔ ¾ points', () => {
    const a = { x: 0, y: 0, kind: 'end' as const, placementId: 'p', instance: 0, label: '·' };
    const b = { x: 0, y: 12, kind: 'end' as const, placementId: 'p', instance: 0, label: '·' };
    const pts = referencePoints(a, b);
    expect(pts.map((p) => p.y).sort((u, v) => u - v)).toEqual([3, 4, 6, 8, 9]);
    expect(pts.every((p) => p.kind === 'ref' && p.placementId === 'p')).toBe(true);
  });
  it('nearestSnap respects the tolerance', () => {
    const pts = snapPointsOfPath(polylinePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], false), 'p', 0);
    expect(nearestSnap(pts, { x: 5.2, y: 0.3 }, 1)?.label).toBe('½');
    expect(nearestSnap(pts, { x: 5.2, y: 3 }, 1)).toBeNull();
  });
});

describe('point targets', () => {
  it('a point is local to its placement and replicated over array instances', () => {
    const project: Project = newProject('m', []);
    project.shapes['s'] = { id: 's', name: 's', kind: 'outline', paths: [polylinePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], false)] };
    project.placements['p'] = { id: 'p', shapeId: 's', name: 'p', transform: [1, 0, 0, 1, 100, 50], array: { nx: 2, ny: 1, dx: 30, dy: 0 } };
    const r = resolveTarget(project, { placementId: 'p', pick: 'point', point: { x: 5, y: 0 } });
    expect(r.points).toEqual([{ x: 105, y: 50 }, { x: 135, y: 50 }]);
  });
  it('a point without a placement is in sheet coordinates', () => {
    const r = resolveTarget(newProject('m', []), { placementId: '', pick: 'point', point: { x: 12, y: 34 } });
    expect(r.points).toEqual([{ x: 12, y: 34 }]);
  });
});
