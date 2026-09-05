import DxfParser, { type IDxf, type IEntity, type IArcEntity, type ICircleEntity, type IEllipseEntity, type IInsertEntity, type ILineEntity, type ILwpolylineEntity, type IPolylineEntity, type ISplineEntity, type IPointEntity } from 'dxf-parser';
import type { Path, Mat, Segment, Vec2 } from '@/lib/geometry/types';
import { compose, rotation, scaling, translation, transformPath } from '@/lib/geometry/transform';
import { circlePath, polylinePath } from '@/lib/geometry/path';
import { segmentFromBulge, ellipsePoint } from '@/lib/geometry/arcs';
import { refitArcs } from '@/lib/geometry/fit';
import { bsplinePoints } from './curves';
import type { ImportedDrawing } from './types';
import { newId } from '@/lib/model/ids';

/** $INSUNITS codes -> mm per unit. */
const INSUNITS: Record<number, [number, string]> = {
  1: [25.4, 'inch'], 2: [304.8, 'foot'], 4: [1, 'mm'], 5: [10, 'cm'], 6: [1000, 'm'], 8: [0.0254, 'microinch'], 9: [0.0254, 'mil'], 10: [914.4, 'yard'],
  11: [1e-7, 'Å'], 12: [1e-6, 'nm'], 13: [1e-3, 'µm'], 14: [100, 'dm'], 15: [1e4, 'dam'], 16: [1e5, 'hm'],
};

export function importDxf(text: string): ImportedDrawing {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('Could not parse DXF');
  const warnings: string[] = [];
  const unitsCode = typeof dxf.header?.$INSUNITS === 'number' ? (dxf.header.$INSUNITS as number) : 0;
  const unit = INSUNITS[unitsCode];
  const scale = unit ? unit[0] : 1;
  const paths: Path[] = [];
  const layers = new Set<string>();
  const skipped = new Map<string, number>();

  const emit = (p: Path, m: Mat, layer: string) => {
    const tp = transformPath(p, m);
    tp.layer = layer; tp.id = newId('pa');
    paths.push(tp); layers.add(layer);
  };

  const handle = (e: IEntity, m: Mat, depth: number) => {
    const layer = e.layer || '0';
    switch (e.type) {
      case 'LINE': { const l = e as ILineEntity & { vertices: Vec2[] }; if (l.vertices?.length >= 2) emit(polylinePath([l.vertices[0], l.vertices[1]], false), m, layer); break; }
      case 'LWPOLYLINE': case 'POLYLINE': {
        const pl = e as ILwpolylineEntity | IPolylineEntity;
        const vs = (pl.vertices ?? []) as { x: number; y: number; bulge?: number }[];
        if (vs.length < 2) break;
        if ((pl as IPolylineEntity).is3dPolygonMesh || (pl as IPolylineEntity).isPolyfaceMesh) { skipped.set('3D mesh', (skipped.get('3D mesh') ?? 0) + 1); break; }
        const closed = !!pl.shape;
        const segs: Segment[] = [];
        for (let i = 1; i < vs.length; i++) segs.push(segmentFromBulge(vs[i - 1], vs[i], vs[i - 1].bulge ?? 0));
        if (closed) segs.push(segmentFromBulge(vs[vs.length - 1], vs[0], vs[vs.length - 1].bulge ?? 0));
        emit({ id: '', start: { x: vs[0].x, y: vs[0].y }, segs, closed }, m, layer);
        break;
      }
      case 'CIRCLE': { const c = e as ICircleEntity; emit(circlePath({ x: c.center.x, y: c.center.y }, c.radius, false), m, layer); break; }
      case 'ARC': {
        const a = e as IArcEntity;
        const a0 = a.startAngle, a1 = a.endAngle; // dxf-parser converts to radians
        const s = { x: a.center.x + a.radius * Math.cos(a0), y: a.center.y + a.radius * Math.sin(a0) };
        const t = { x: a.center.x + a.radius * Math.cos(a1), y: a.center.y + a.radius * Math.sin(a1) };
        emit({ id: '', start: s, segs: [{ k: 'A', to: t, c: { x: a.center.x, y: a.center.y }, cw: false }], closed: false }, m, layer);
        break;
      }
      case 'ELLIPSE': {
        const el = e as IEllipseEntity;
        const rx = Math.hypot(el.majorAxisEndPoint.x, el.majorAxisEndPoint.y);
        const ry = rx * el.axisRatio;
        const phi = Math.atan2(el.majorAxisEndPoint.y, el.majorAxisEndPoint.x);
        let t0 = el.startAngle, t1 = el.endAngle;
        if (t1 <= t0) t1 += 2 * Math.PI;
        const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
        const n = Math.max(16, Math.ceil(((t1 - t0) * Math.max(rx, ry)) / 0.5));
        const pts: Vec2[] = [];
        for (let k = 0; k <= (full ? n - 1 : n); k++) pts.push(ellipsePoint(el.center.x, el.center.y, rx, ry, phi, t0 + ((t1 - t0) * k) / n));
        emit(polylinePath(pts, full), m, layer);
        break;
      }
      case 'SPLINE': {
        const sp = e as ISplineEntity;
        let pts: Vec2[] = [];
        if (sp.controlPoints && sp.controlPoints.length > sp.degreeOfSplineCurve) {
          const ctrl = sp.controlPoints.map((p) => ({ x: p.x, y: p.y }));
          const weights = (sp as unknown as { weights?: number[] }).weights;
          const samples = Math.max(16, ctrl.length * 12);
          pts = bsplinePoints(ctrl, sp.degreeOfSplineCurve || 3, sp.knotValues ?? [], weights, samples);
        } else if (sp.fitPoints?.length) pts = sp.fitPoints.map((p) => ({ x: p.x, y: p.y }));
        if (pts.length >= 2) {
          const closed = !!sp.closed || Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6;
          if (closed && pts.length > 2) pts.pop();
          const fitted = refitArcs(pts, closed, 0.02);
          emit(fitted, m, layer);
        }
        break;
      }
      case 'POINT': { const p = e as IPointEntity & { position: Vec2 }; if (p.position) emit({ id: '', start: { x: p.position.x, y: p.position.y }, segs: [], closed: false }, m, layer); break; }
      case 'INSERT': {
        const ins = e as IInsertEntity;
        const block = dxf.blocks?.[ins.name];
        if (!block || depth > 8) break;
        const cols = Math.max(1, ins.columnCount || 1), rows = Math.max(1, ins.rowCount || 1);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const pos = { x: (ins.position?.x ?? 0) + c * (ins.columnSpacing || 0), y: (ins.position?.y ?? 0) + r * (ins.rowSpacing || 0) };
          const bm = compose(m, compose(translation(pos.x, pos.y), compose(rotation(ins.rotation ?? 0), compose(scaling(ins.xScale || 1, ins.yScale || 1), translation(-(block.position?.x ?? 0), -(block.position?.y ?? 0))))));
          for (const be of block.entities ?? []) handle(be, bm, depth + 1);
        }
        break;
      }
      case 'TEXT': case 'MTEXT': case 'DIMENSION': case 'ATTDEF': case 'SOLID': case '3DFACE':
        skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1); break;
      default: skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
    }
  };

  const unitM: Mat = scaling(scale);
  for (const e of (dxf as IDxf).entities ?? []) handle(e, unitM, 0);
  for (const [k, n] of skipped) warnings.push(`${n} × ${k} ignored`);
  return { paths, layers: [...layers], unitKnown: !!unit, unitName: unit ? unit[1] : 'unitless (assumed mm)', warnings };
}
