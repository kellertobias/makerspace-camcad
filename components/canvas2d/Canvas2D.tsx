'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useProject } from '@/lib/store/project';
import { useUi } from '@/lib/store/ui';
import { usePlan } from '@/lib/store/plan';
import { draw, toWorld, type View } from './renderer';
import { hitTest, pathsInRect } from './hit';
import { OP_TYPE_COLORS } from './renderer';
import { useCursor } from './cursor';
import { useSessionUi } from '@/lib/store/session-ui';
import { zeroPoint } from '@/lib/cam/zero';
import { allPartsBBox } from '@/lib/cam/instances';
import { compose, translation, invert, apply } from '@/lib/geometry/transform';
import { closestPoint } from '@/lib/geometry/path';
import { snapPointsOfPath, referencePoints, nearestSnap, type SnapPoint } from '@/lib/geometry/snap';
import { resolveTarget } from '@/lib/cam/plan';
import { worldPaths, instanceTransforms } from '@/lib/cam/instances';
import { pathBBoxFast } from './renderer';
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
  // snapping (point / bridge placement): point under the cursor, candidates of the hovered contour, dwell timer for pinning
  const [snap, setSnap] = useState<SnapPoint | null>(null);
  const [snapHints, setSnapHints] = useState<SnapPoint[]>([]);
  const dwellRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const project = useProject((p) => p.project);
  const transformPlacements = useProject((p) => p.transformPlacements);
  const ui = useUi();
  const { plan } = usePlan();
  const setCursor = useCursor((c) => c.set);
  const s = t(ui.lang);
  const fittedRef = useRef(false);
  const placingMode = !!ui.pointPlacing || !!ui.tabPlacing;
  const refPoints = ui.snapRefs.length === 2 ? referencePoints(ui.snapRefs[0], ui.snapRefs[1]) : [];
  const snapKey = (p: SnapPoint) => `${p.kind}:${p.x.toFixed(3)}:${p.y.toFixed(3)}`;

  /** Nearest snap candidate around a world point: reference-line points plus the points of nearby contours. */
  const findSnap = useCallback((wp: Vec2, tol: number): SnapPoint | null => {
    const cands: SnapPoint[] = [...refPoints];
    for (const pl of Object.values(project.placements)) {
      if (pl.visible === false) continue;
      for (const { path, instance } of worldPaths(project, pl)) {
        const bb = pathBBoxFast(path);
        if (wp.x < bb.minX - tol || wp.x > bb.maxX + tol || wp.y < bb.minY - tol || wp.y > bb.maxY + tol) continue;
        cands.push(...snapPointsOfPath(path, pl.id, instance));
      }
    }
    return nearestSnap(cands, wp, tol);
  }, [project, refPoints]);

  // leaving a placing mode clears the snapping state
  useEffect(() => { if (!placingMode) { setSnap(null); setSnapHints([]); if (dwellRef.current) { clearTimeout(dwellRef.current.timer); dwellRef.current = null; } } }, [placingMode]);

  const fit = useCallback(() => {
    const v = viewRef.current;
    const w = project.stock.width, h = project.stock.height;
    const scale = Math.min((v.w - 80) / w, (v.h - 80) / h);
    v.scale = Math.max(0.05, scale);
    v.ox = (v.w - w * v.scale) / 2; v.oy = (v.h - h * v.scale) / 2;
    force((x) => x + 1);
    useSessionUi.getState().setCamera({ scale: v.scale, ox: v.ox, oy: v.oy });
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
      if (!fittedRef.current && r.width > 0) {
        fittedRef.current = true;
        const cam = useSessionUi.getState().camera;
        if (cam && cam.scale > 0) Object.assign(viewRef.current, cam); else fit();
      }
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
    draw(ctx, viewRef.current, { project, plan, selection: ui.selection, showGrid: ui.showGrid, showMilling: ui.showMilling, showToolpaths: ui.showToolpaths, showRapids: ui.showRapids, zero: zeroPoint(project, allPartsBBox(project)), marquee, dark, hover, tabPlacing: ui.tabPlacing, pointPlacing: ui.pointPlacing, snap, snapRefs: ui.snapRefs, snapHints, refPoints });
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
    rememberCamera();
  };
  const rememberCamera = () => { const v = viewRef.current; useSessionUi.getState().setCamera({ scale: v.scale, ox: v.ox, oy: v.oy }); };

  const onPointerDown = (e: React.PointerEvent) => {
    // commit any field being edited in the side panel before the selection (and thus the panel) changes
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== e.currentTarget && typeof active.blur === 'function') active.blur();
    const v = viewRef.current;
    const sp = screenPt(e);
    const wp = toWorld(v, sp);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && e.altKey && e.shiftKey) || (e.button === 0 && spaceRef.current)) { dragRef.current = { kind: 'pan', start: sp, ox: v.ox, oy: v.oy }; return; }
    if (e.button !== 0) return;
    // point placement mode (drilling / threading): click a snap point to add, click an existing point to remove
    if (ui.pointPlacing) {
      const op = project.operations[ui.pointPlacing];
      if (op && (op.type === 'drill' || op.type === 'thread')) {
        const tol = 10 / v.scale;
        const sp2 = snap ?? findSnap(wp, tol);
        // remove: the existing point under the cursor (on a snap point only when it is that very point, so a
        // neighbouring snap point can still be placed right next to an existing one)
        const probe = sp2 ? { x: sp2.x, y: sp2.y } : wp;
        let ri = -1, rd = Infinity;
        op.targets.forEach((tg, i) => { if (!tg.point) return; for (const w of resolveTarget(project, tg).points) { const d = Math.hypot(w.x - probe.x, w.y - probe.y); if (d < rd) { rd = d; ri = i; } } });
        if (ri >= 0 && rd <= (sp2 ? 0.01 : tol)) {
          useProject.getState().updateOperation(op.id, { targets: op.targets.filter((_, i) => i !== ri) });
          ui.setDirty(true);
          return;
        }
        // add: the snapped point (local to its placement) or a free point on the sheet (grid-snapped)
        let world: Vec2 = sp2 ? { x: sp2.x, y: sp2.y } : wp;
        let placementId = sp2?.placementId ?? '';
        let local = world;
        const pl = placementId ? project.placements[placementId] : undefined;
        if (pl) { const m = instanceTransforms(pl)[sp2?.instance ?? 0] ?? pl.transform; local = apply(invert(m), world); }
        else if (!sp2 && ui.snap) { const g = v.scale > 8 ? 1 : v.scale > 2 ? 5 : 10; world = { x: Math.round(wp.x / g) * g, y: Math.round(wp.y / g) * g }; local = world; placementId = ''; }
        useProject.getState().updateOperation(op.id, { targets: [...op.targets, { placementId, pick: 'point', point: { x: Math.round(local.x * 1000) / 1000, y: Math.round(local.y * 1000) / 1000 } }] });
        ui.setDirty(true);
      }
      return;
    }
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
        // add: nearest point on any tool path of the op; a snapped point (line centre, ⅓, ¼ …) is projected onto the tool path
        const probe = snap ? { x: snap.x, y: snap.y } : wp;
        let best: { pt: Vec2; d: number } | null = null;
        for (const p of paths) { const c = closestPoint(p, probe); if (!best || c.d < best.d) best = { pt: c.pt, d: c.d }; }
        if (snap && best) best = { pt: best.pt, d: Math.min(best.d, Math.hypot(snap.x - wp.x, snap.y - wp.y)) };
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
      if (placingMode) {
        const sp2 = findSnap(wp, 10 / v.scale);
        if ((sp2 ? snapKey(sp2) : '') !== (snap ? snapKey(snap) : '')) setSnap(sp2);
        // candidates of the hovered contour, so the available points are visible
        if (hit) {
          const pl = project.placements[hit.placementId];
          const hints = pl ? worldPaths(project, pl).filter((w) => w.path.id === hit.pathId).flatMap((w) => snapPointsOfPath(w.path, pl.id, w.instance)) : [];
          if (hints.length !== snapHints.length || (hints[0] && snapHints[0] && snapKey(hints[0]) !== snapKey(snapHints[0]))) setSnapHints(hints);
        } else if (snapHints.length) setSnapHints([]);
        // dwell on a snap point pins it as a reference (two references span the helper line)
        const key = sp2 ? snapKey(sp2) : '';
        if (dwellRef.current && dwellRef.current.key !== key) { clearTimeout(dwellRef.current.timer); dwellRef.current = null; }
        if (sp2 && !dwellRef.current && !ui.snapRefs.some((r) => snapKey(r) === key)) {
          const timer = setTimeout(() => {
            dwellRef.current = null;
            const refs = useUi.getState().snapRefs.filter((r) => snapKey(r) !== key);
            useUi.getState().setSnapRefs([...refs.slice(-1), sp2]);
          }, 650);
          dwellRef.current = { key, timer };
        }
      }
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
    if (d?.kind === 'pan') rememberCamera();
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
      <canvas ref={canvasRef} style={ui.tabPlacing ? { cursor: 'copy' } : ui.pointPlacing ? { cursor: 'crosshair' } : undefined} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()} />
      {ui.showMilling && (() => {
        const types = [...new Set(Object.values(project.operations).filter((o) => o.enabled).map((o) => o.type))];
        return types.length ? (
          <div className="cam-legend">
            {types.map((ty) => <span key={ty}><i style={{ background: OP_TYPE_COLORS[ty] }} />{s.opNames[ty]}</span>)}
          </div>
        ) : null;
      })()}
      <div className="cam-canvas-hint">{ui.pointPlacing ? s.placingPoints : ui.tabPlacing ? `${s.placingTabs} ${s.snapHintTabs}` : ui.lang === 'de' ? 'Rad: Zoom · Mitte/Leertaste+Ziehen: Verschieben · Klick: Kontur · Shift: hinzufügen · Alt/Doppelklick: ganzes Objekt · F: Einpassen' : 'Wheel: zoom · middle/space+drag: pan · click: contour · Shift: add · Alt/double-click: whole object · F: fit'}</div>
    </div>
  );
}
