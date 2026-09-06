import { describe, it, expect } from 'vitest';
import { polylinePath, circlePath } from '@/lib/geometry/path';
import { newProject, newTool, newMachine, newOperation } from '@/lib/model/defaults';
import { planProject } from '@/lib/cam/plan';
import { exportFmc, encodeCp1252 } from '@/lib/post/fmc';
import { exportProgram } from '@/lib/post';
import { imaFmc } from '@/lib/post/profiles/ima';
import { identity } from '@/lib/geometry/transform';
import type { Operation, Project } from '@/lib/model/project';

const mill = newTool({ id: 'm618', kind: 'endmill', name: '18mm Wendeplattenfräser', slot: 618, d: 18, z: 2, cut: { stepDown: 18, stepOverPct: 50, vf: 4000, vfPlunge: 1000, n: 18000 } });
const drill = newTool({ id: 'd6', kind: 'drill', name: '6mm Bohrer', slot: 1, d: 6, z: 1, cut: { stepDown: 12, stepOverPct: 50, vf: 1000, vfPlunge: 1000, n: 4000 } });
const saw = newTool({ id: 's426', kind: 'saw', name: 'Nutsäge', slot: 426, d: 2.8, z: 1, cut: { stepDown: 100, stepOverPct: 50, vf: 3000, vfPlunge: 1000, n: 9000 } });
const ima = newMachine({ id: 'ima', name: 'IMA', postId: 'ima-fmc', nMax: 24000, feedMax: { xy: 20000, z: 5000 }, rapid: { xy: 55000, z: 25000 } });
const setup = () => {
  const project: Project = newProject('ima', [mill, drill, saw]);
  project.name = 'Regalboden Nr 1';
  project.stock = { ...project.stock, width: 800, height: 400, thickness: 19, zZero: 'top', safeZ: 30, clearZ: 2 };
  const rect = polylinePath([{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }, { x: 100, y: 200 }], true);
  const circle = circlePath({ x: 500, y: 150 }, 20);
  const line = polylinePath([{ x: 100, y: 300 }, { x: 700, y: 300 }], false);
  project.shapes['s'] = { id: 's', name: 's', kind: 'outline', paths: [rect, circle, line] };
  project.placements['p'] = { id: 'p', shapeId: 's', name: 'p', transform: identity() };
  return { project, rect, circle, line };
};

describe('IMA FMC export', () => {
  it('writes program head, mill call with lines and arcs, bores, saw grooves and park position', () => {
    const { project, rect, circle, line } = setup();
    const c = newOperation('contour', 'm618', mill, 10, 1) as Operation & { type: 'contour' };
    c.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }, { placementId: 'p', pathId: circle.id, pick: 'contour' }]; c.side = 'outside'; c.entry = { kind: 'plunge' };
    const d = newOperation('drill', 'd6', drill, 15, 2) as Operation & { type: 'drill' };
    d.targets = [{ placementId: 'p', pick: 'point', point: { x: 50, y: 50 } }, { placementId: 'p', pick: 'point', point: { x: 750, y: 50 } }]; d.mode = 'peck'; d.peck = 5;
    const sw = newOperation('saw', 's426', saw, 8, 3) as Operation & { type: 'saw' };
    sw.targets = [{ placementId: 'p', pathId: line.id, pick: 'contour' }];
    project.operations = { [c.id]: c, [d.id]: d, [sw.id]: sw };
    const plan = planProject(project, ima);
    const r = exportFmc(plan.program, project, ima, 'test');
    expect(r.files.length).toBe(1);
    const t = r.files[0].text;
    expect(r.files[0].name).toBe('Regalbod.fmc'); // 8 characters
    expect(t.match(/\[HAUPTPRG\]/g)?.length).toBe(1);
    expect(t).toMatch(/RTL=800\n/);
    expect(t).toMatch(/FTL=800/); expect(t).toMatch(/FTB=400/); expect(t).toMatch(/FTD=19/);
    expect(t).toMatch(/\[CAD_F_S\][\s\S]*?TNR=618\n/);
    expect(t).toMatch(/\[N'G1-XYZ\]/);
    // arcs with absolute centre; Z above the bed: contour depth 10 in 19 mm stock -> EPZ=9
    expect(t).toMatch(/\[N'G[23]R-XY\][\s\S]*?MPX=500\nMPY=150/);
    expect(t).toMatch(/EPZ=9\n/);
    expect(t.match(/\[KO'AB_N2\]/g)?.length).toBe(1); // one tool call + contour end per operation (rapids between paths stay inside)
    // two bores 15 deep with 5 mm pecks, diameter 6
    expect(t.match(/\[VB'D\]/g)?.length).toBe(2);
    expect(t).toMatch(/DM=6\n/); expect(t).toMatch(/TI=15\n/); expect(t).toMatch(/ZSM=5\n/);
    // one saw groove of blade width 2.8 and depth 8
    expect(t.match(/\[ZY'SNW_N\]/g)?.length).toBe(1);
    expect(t).toMatch(/NB=2.8\n/); expect(t).toMatch(/TI=8\nTNR=426/); expect(t).toMatch(/SPX=100\nSPY=300/); expect(t).toMatch(/EPX=700\nEPY=300/);
    expect(t.match(/\[PROGEND2\]/g)?.length).toBe(1);
    expect(t.endsWith('\n\n')).toBe(true);
    expect(r.warnings.some((w) => /shortened/.test(w))).toBe(true);
  });
  it('warns about non-IMA mill numbers and skips laser operations', () => {
    const { project, rect } = setup();
    const odd = newTool({ id: 'odd', name: 'odd', slot: 3, d: 6, z: 2, cut: { stepDown: 3, stepOverPct: 40, vf: 1000, vfPlunge: 300, n: 18000 } });
    project.tools[odd.id] = odd;
    const c = newOperation('contour', 'odd', odd, 5, 1) as Operation & { type: 'contour' };
    c.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }];
    project.operations = { [c.id]: c };
    const r = exportFmc(planProject(project, ima).program, project, ima, 'test');
    expect(r.warnings.some((w) => /not an IMA mill number/.test(w))).toBe(true);
  });
  it('finished part size, zero offset and format saw go into the program head', () => {
    const { project, rect } = setup();
    project.stock.part = { width: 600, height: 300, formatSaw: true };
    project.stock.origin = { mode: 'manual', corner: 'bl', manual: { x: 100, y: 50 } };
    const c = newOperation('contour', 'm618', mill, 5, 1) as Operation & { type: 'contour' };
    c.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }];
    project.operations = { [c.id]: c };
    const t = exportFmc(planProject(project, ima).program, project, ima, 'test').files[0].text;
    expect(t).toMatch(/FTL=600\n/); expect(t).toMatch(/FTB=300\n/); expect(t).toMatch(/RTL=800\n/);
    expect(t).toMatch(/AXV=100\nAYV=50/);
    expect(t).toMatch(/\[FOSAEG25\]/); expect(t).toMatch(/\[S_HALT\]/);
    expect(t.indexOf('[FOSAEG25]')).toBeLessThan(t.indexOf('[CAD_F_S]'));
  });
  it('splits at 64 bores per file, every file complete', () => {
    const { project } = setup();
    const d = newOperation('drill', 'd6', drill, 10, 1) as Operation & { type: 'drill' };
    d.targets = Array.from({ length: 150 }, (_, i) => ({ placementId: 'p', pick: 'point' as const, point: { x: 20 + (i % 30) * 25, y: 20 + Math.floor(i / 30) * 60 } }));
    project.operations = { [d.id]: d };
    const r = exportFmc(planProject(project, ima).program, project, ima, 'test');
    expect(r.files.length).toBe(3);
    let bores = 0;
    for (const fl of r.files) {
      const n = fl.text.match(/\[VB'D\]/g)?.length ?? 0; bores += n;
      expect(n).toBeLessThanOrEqual(64);
      expect(fl.text.match(/\[HAUPTPRG\]/g)?.length).toBe(1);
      expect(fl.text.match(/\[PROGEND2\]/g)?.length).toBe(1);
      expect(fl.name.length).toBeLessThanOrEqual(12); // 8 + .fmc
    }
    expect(bores).toBe(150);
    expect(r.files[1].name).not.toBe(r.files[0].name);
  });
  it('encodes cp1252 and the export entry point returns the files', () => {
    const bytes = encodeCp1252('Nutsäge € ✓');
    expect(Array.from(bytes)).toEqual([0x4e, 0x75, 0x74, 0x73, 0xe4, 0x67, 0x65, 0x20, 0x80, 0x20, 0x3f]);
    const { project, rect } = setup();
    const c = newOperation('contour', 'm618', mill, 5, 1) as Operation & { type: 'contour' };
    c.targets = [{ placementId: 'p', pathId: rect.id, pick: 'contour' }];
    project.operations = { [c.id]: c };
    const res = exportProgram(planProject(project, ima).program, imaFmc, 30, 'test', { project, machine: ima });
    expect(res.format).toBe('fmc'); expect(res.files?.length).toBe(1); expect(res.filename).toBe('Regalbod.fmc');
  });
});
