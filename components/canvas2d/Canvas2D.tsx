'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useProject } from '@/lib/store/project';
import { useUi } from '@/lib/store/ui';
import { usePlan } from '@/lib/store/plan';
import { draw, toWorld, type View } from './renderer';
import { hitTest, pathsInRect } from './hit';
import { OP_TYPE_COLORS } from './renderer';
import { useCursor } from './cursor';
import { zeroPoint } from '@/lib/cam/zero';
import { allPartsBBox } from '@/lib/cam/instances';
import { compose, translation, invert, apply } from '@/lib/geometry/transform';
import { closestPoint } from '@/lib/geometry/path';
import { t } from '@/lib/i18n';
import type { Vec2 } from '@/lib/geometry/types';

type Drag =
  | { kind: 'pan'; start: Vec2; ox: number; oy: number }
  | { kind: 'move'; start: Vec2; ids: string[]; applied: Vec2 }
  | { kind: 'marquee'; start: Vec2; cur: Vec2 };

export function Canvas2D() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View>({ scale: 1.5, ox: 40, oy: 40, w: 800, h: 600, dpr: 1 });
  const dragRef = useRef<Drag | null>(null);
  const [, force] = useState(0);
  const [hover, setHover] = useState<{ placementId: string; pathId: string } | null>(null);
  const [marquee, setMarquee] = useState<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const project = useProject((p) => p.project);
  const transformPlacements = useProject((p) => p.transformPlacements);
  const ui = useUi();
  const { plan } = usePlan();
  const setCursor = useCursor((c) => c.set);
  const s = t(ui.lang);
  const fittedRef = useRef(false);

  const fit = useCallback(() => {
    const v = viewRef.current;
    const w = project.stock.width, h = project.stock.height;
    const scale = Math.min((v.w - 80) / w, (v.h - 80) / h);
    v.scale = Math.max(0.05, scale);
    v.ox = (v.w - w * v.scale) / 2; v.oy = (v.h - h * v.scale) / 2;
    force((x) => x + 1);
  }, [project.stock.width, project.stock.height]);

  // resize observer
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(r.width * dpr)); canvas.height = Math.max(1, Math.floor(r.height * dpr));
      Object.assign(viewRef.current, { w: r.width, h: r.height, dpr });
      if (!fittedRef.current && r.width > 0) { fittedRef.current = true; fit(); }
      force((x) => x + 1);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit]);

  // draw
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    draw(ctx, viewRef.current, { project, plan, selection: ui.selection, showGrid: ui.showGrid, showMilling: ui.showMilling, showToolpaths: ui.showToolpaths, showRapids: ui.showRapids, zero: zeroPoint(project, allPartsBBox(project)), marquee, dark, hover, tabPlacing: ui.tabPlacing });
  });

  // keyboard: F = fit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.key === 'f' || e.key === 'F') fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit]);

  const screenPt = (e: React.PointerEvent | React.WheelEvent): Vec2 => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onWheel = (e: React.WheelEvent) => {
    const v = viewRef.current;
    const p = screenPt(e);
    const w = toWorld(v, p);
    const factor = Math.exp(-e.deltaY * 0.0015);
    v.scale = Math.min(200, Math.max(0.02, v.scale * factor));
    // keep world point under cursor
    v.ox = p.x - w.x * v.scale;
    v.oy = v.h - p.y - w.y * v.scale;
    force((x) => x + 1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const v = viewRef.current;
    const sp = screenPt(e);
    const wp = toWorld(v, sp);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.altKey && e.shiftKey) || (e.button === 0 && spaceRef.current)) { dragRef.current = { kind: 'pan', start: sp, ox: v.ox, oy: v.oy }; return; }
    if (e.button !== 0) return;
    // bridge placement mode: click on the cutout's tool path adds a bridge, click on a bridge removes it
    if (ui.tabPlacing) {
      const op = project.operations[ui.tabPlacing];
      const paths = plan?.toolPaths[ui.tabPlacing] ?? [];
      if (op?.type === 'cutout' && paths.length) {
        const tool = project.tools[op.toolId];
        const tol = Math.max(8 / v.scale, (tool?.d ?? 6) / 2 + 4 / v.scale);
        const marks = plan?.tabMarks[op.id] ?? [];
        const pts = op.tabs?.points ?? [];
        // remove: nearest existing bridge
        let bi = -1, bd = Infinity;
        marks.forEach((m, i) => { const d = Math.hypot(m.x - wp.x, m.y - wp.y); if (d < bd) { bd = d; bi = i; } });
        if (bi >= 0 && bd <= tol && pts.length) {
          // stored points are local to their placement; find the stored point whose world position is nearest to the mark
          const world = pts.map((pt) => { const pl = project.placements[pt.placementId]; return pl ? apply(pl.transform, pt) : { x: pt.x, y: pt.y }; });
          let si = 0, sd = Infinity;
          world.forEach((w, i) => { const d = Math.hypot(w.x - marks[bi].x, w.y - marks[bi].y); if (d < sd) { sd = d; si = i; } });
          useProject.getState().updateOperation(op.id, { tabs: { ...op.tabs!, mode: 'manual', points: pts.filter((_, i) => i !== si) } } as Partial<typeof op>);
          return;
        }
        // add: nearest point on any tool path of the op
        let best: { pt: Vec2; d: number } | null = null;
        for (const p of paths) { const c = closestPoint(p, wp); if (!best || c.d < best.d) best = { pt: c.pt, d: c.d }; }
        if (best && best.d <= tol) {
          const pl = project.placements[op.targets[0]?.placementId];
          const local = pl ? apply(invert(pl.transform), best.pt) : best.pt;
          useProject.getState().updateOperation(op.id, { tabs: { ...(op.tabs ?? { count: 0, width: 8, height: 3 }), mode: 'manual', points: [...pts, { placementId: pl?.id ?? '', x: local.x, y: local.y }] } } as Partial<typeof op>);
          ui.setDirty(true);
        }
        return;
      }
    }
    const hit = hitTest(project, wp, 6 / v.scale);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (hit) {
      const pl = project.placements[hit.placementId];
      const key = `${hit.placementId}:${hit.pathId}`;
      const wholeObject = e.altKey || e.detail >= 2;
      const inGroupSel = !!pl.groupId && ui.selection.groups.includes(pl.groupId);
      const already = ui.selection.paths.includes(key) || ui.selection.placements.includes(hit.placementId) || inGroupSel;
      if (wholeObject) {
        if (pl.groupId && !additive) ui.select({ groups: [pl.groupId] });
        else ui.select({ placements: [hit.placementId] }, additive);
      } else if (!already || additive) {
        // contour is the primary selection unit
        ui.select({ paths: [key] }, additive);
      }
      // drag moves the placements that own the selected contours
      const cur = useUi.getState().selection;
      const ids = new Set<string>(cur.placements);
      for (const k of cur.paths) ids.add(k.split(':')[0]);
      for (const g of cur.groups) for (const p of Object.values(project.placements)) if (p.groupId === g) ids.add(p.id);
      if (!ids.size) ids.add(hit.placementId);
      dragRef.current = { kind: 'move', start: wp, ids: [...ids], applied: { x: 0, y: 0 } };
    } else {
      if (!additive) ui.clearSelection();
      dragRef.current = { kind: 'marquee', start: wp, cur: wp };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const v = viewRef.current;
    const sp = screenPt(e);
    const wp = toWorld(v, sp);
    setCursor({ x: wp.x, y: wp.y });
    const d = dragRef.current;
    if (!d) {
      const hit = hitTest(project, wp, 6 / v.scale);
      const next = hit ? { placementId: hit.placementId, pathId: hit.pathId } : null;
      if ((next?.placementId !== hover?.placementId) || (next?.pathId !== hover?.pathId)) setHover(next);
      return;
    }
    if (d.kind === 'pan') { v.ox = d.ox + (sp.x - d.start.x); v.oy = d.oy - (sp.y - d.start.y); force((x) => x + 1); }
    else if (d.kind === 'move') {
      let dx = wp.x - d.start.x, dy = wp.y - d.start.y;
      if (ui.snap) { const g = v.scale > 8 ? 1 : v.scale > 2 ? 5 : 10; dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; }
      const ddx = dx - d.applied.x, ddy = dy - d.applied.y;
      if (ddx || ddy) { transformPlacements(d.ids, (m) => compose(translation(ddx, ddy), m)); d.applied = { x: dx, y: dy }; }
    } else if (d.kind === 'marquee') {
      d.cur = wp;
      setMarquee({ minX: Math.min(d.start.x, wp.x), minY: Math.min(d.start.y, wp.y), maxX: Math.max(d.start.x, wp.x), maxY: Math.max(d.start.y, wp.y) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === 'marquee' && marquee) {
      const keys = pathsInRect(project, marquee);
      if (keys.length) ui.select({ paths: keys }, e.shiftKey);
    }
    if (d?.kind === 'move' && (d.applied.x || d.applied.y)) ui.setDirty(true);
    setMarquee(null);
  };

  const spaceRef = useRef(false);
  useEffect(() => {
    const dn = (e: KeyboardEvent) => { if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT') { spaceRef.current = true; } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, []);

  return (
    <div className="cam-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} style={ui.tabPlacing ? { cursor: 'copy' } : undefined} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()} />
      {ui.showMilling && (() => {
        const types = [...new Set(Object.values(project.operations).filter((o) => o.enabled).map((o) => o.type))];
        return types.length ? (
          <div className="cam-legend">
            {types.map((ty) => <span key={ty}><i style={{ background: OP_TYPE_COLORS[ty] }} />{s.opNames[ty]}</span>)}
          </div>
        ) : null;
      })()}
      <div className="cam-canvas-hint">{ui.lang === 'de' ? 'Rad: Zoom · Mitte/Leertaste+Ziehen: Verschieben · Klick: Kontur · Shift: hinzufügen · Alt/Doppelklick: ganzes Objekt · F: Einpassen' : 'Wheel: zoom · middle/space+drag: pan · click: contour · Shift: add · Alt/double-click: whole object · F: fit'}</div>
    </div>
  );
}
