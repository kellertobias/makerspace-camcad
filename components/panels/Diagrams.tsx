'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Corner, Entry, Operation, OriginMode, Overcut, Side } from '@/lib/model/project';

/* ------------------------------------------------------------------ highlight plumbing */
const HlCtx = createContext<{ key: string | null; set: (k: string | null) => void }>({ key: null, set: () => {} });
export function HlProvider({ children }: { children: ReactNode }) {
  const [key, set] = useState<string | null>(null);
  return <HlCtx.Provider value={{ key, set }}>{children}</HlCtx.Provider>;
}
/** Wrap a field so focusing/hovering it highlights `k` in the diagrams of the same provider. */
export function Hl({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  const { set } = useContext(HlCtx);
  return <div className={className} style={{ display: 'contents' }} onFocusCapture={() => set(k)} onBlurCapture={() => set(null)} onMouseEnter={() => set(k)} onMouseLeave={() => set(null)}>{children}</div>;
}
export const useHl = () => useContext(HlCtx).key;

/* ------------------------------------------------------------------ helpers */
const S = { fontSize: 9.5, fontFamily: 'system-ui, sans-serif' } as const;
const cls = (hl: string | null, ...keys: string[]) => (hl && keys.includes(hl) ? 'hl' : '');
function Label({ x, y, children, anchor = 'start', k, hl }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; k?: string; hl: string | null }) {
  return <text x={x} y={y} textAnchor={anchor} className={`lbl ${k ? cls(hl, k) : ''}`} style={S}>{children}</text>;
}
function Dim({ x, y0, y1, k, hl }: { x: number; y0: number; y1: number; k: string; hl: string | null }) {
  // vertical dimension line with ticks
  return <g className={`dim ${cls(hl, k)}`}><line x1={x} y1={y0} x2={x} y2={y1} /><line x1={x - 3} y1={y0} x2={x + 3} y2={y0} /><line x1={x - 3} y1={y1} x2={x + 3} y2={y1} /></g>;
}
const Svg = ({ children, vb = '0 0 240 110' }: { children: ReactNode; vb?: string }) => (
  <svg viewBox={vb} className="cam-svg" aria-hidden="true">{children}</svg>
);
const fmt = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 100) / 100));

/* ------------------------------------------------------------------ depth / step-down / z offset / entry */
export function DepthDiagram({ depth, stepDown, zOffset, entry, thickness, safeZ, clearZ, lang }: {
  depth: number; stepDown: number; zOffset: number; entry: Entry; thickness: number; safeZ: number; clearZ: number; lang: 'de' | 'en';
}) {
  const hl = useHl();
  const top = 56, H = 54; // stock top y and thickness in px
  const px = (mm: number) => (mm / Math.max(thickness, 0.1)) * H;
  const z0 = top + px(Math.max(0, zOffset)); // start depth below the surface (already cleared material)
  const bottom = Math.min(top + H + 10, z0 + px(depth));
  const passes: number[] = [];
  const step = Math.max(0.05, stepDown);
  for (let z = step; z < depth - 1e-9 && passes.length < 30; z += step) passes.push(z0 + px(z));
  const firstPass = passes[0] ?? bottom;
  const toolX = 96, toolW = 16;
  const safeY = Math.max(8, top - px(Math.min(safeZ, thickness * 0.8)));
  const clearY = Math.min(top - 6, top - Math.max(4, px(clearZ)));
  const de = lang === 'de';
  const rampEnd = toolX + toolW + 34;
  return (
    <Svg vb="0 0 240 128">
      <rect x={10} y={top} width={220} height={H} className="stock" />
      {zOffset > 1e-9 && <rect x={40} y={top} width={160} height={z0 - top} className="cut" />}
      <rect x={toolX} y={z0} width={toolW} height={Math.max(0, bottom - z0)} className="cut" />
      {passes.map((y, i) => <line key={i} x1={toolX} y1={y} x2={toolX + toolW} y2={y} className={`pass ${cls(hl, 'stepDown')}`} />)}
      <line x1={toolX} y1={bottom} x2={toolX + toolW} y2={bottom} className={`pass ${cls(hl, 'depth')}`} />
      <g className={`tool ${cls(hl, 'entry', 'rampAngle')}`}><rect x={toolX + 3} y={z0 - 46} width={toolW - 6} height={46 + firstPass - z0} rx={1} /></g>
      {/* entry from clearance height to the first pass */}
      {entry.kind === 'ramp' && <polyline points={`${toolX + toolW + 2},${clearY} ${rampEnd},${(clearY + firstPass) / 2} ${toolX + toolW + 2},${firstPass}`} className={`entry ${cls(hl, 'entry', 'rampAngle')}`} />}
      {entry.kind === 'plunge' && <line x1={toolX + toolW + 10} y1={clearY} x2={toolX + toolW + 10} y2={firstPass - 1} className={`entry ${cls(hl, 'entry')}`} markerEnd="url(#arr)" />}
      {entry.kind === 'helix' && <path d={`M${toolX + toolW + 4},${clearY} c 16,3 16,9 0,11 c -8,2 -8,7 0,9 c 16,2 16,7 0,${Math.max(4, firstPass - clearY - 20)}`} className={`entry ${cls(hl, 'entry')}`} />}
      <Label x={toolX + toolW + 4} y={top + H + 13} hl={hl} k="entry">{de ? 'Eintauchen' : 'entry'}: {entry.kind === 'ramp' ? `${de ? 'Rampe' : 'ramp'} ${fmt(entry.angle)}°` : entry.kind === 'helix' ? 'Helix' : de ? 'senkrecht' : 'plunge'}</Label>
      {/* safe / clearance heights */}
      <line x1={10} y1={safeY} x2={230} y2={safeY} className={`dash ${cls(hl, 'safeZ')}`} />
      <Label x={12} y={safeY - 2} hl={hl} k="safeZ">{de ? 'Sicherheitshöhe' : 'safe Z'} {fmt(safeZ)}</Label>
      <line x1={10} y1={clearY} x2={toolX - 4} y2={clearY} className={`dash ${cls(hl, 'clearZ')}`} />
      <Label x={12} y={clearY - 2} hl={hl} k="clearZ">{de ? 'Anfahrhöhe' : 'clearance'} {fmt(clearZ)}</Label>
      {/* Z0 and offset */}
      <Label x={228} y={top - 3} anchor="end" hl={hl}>Z 0 ({de ? 'Oberkante' : 'top'})</Label>
      {Math.abs(zOffset) > 1e-9 && <><Dim x={toolX - 30} y0={top} y1={z0} k="zOffset" hl={hl} /><Label x={12} y={top + H - 4} hl={hl} k="zOffset">{de ? 'Starttiefe' : 'start depth'} {fmt(zOffset)}</Label></>}
      {/* depth and step-down */}
      <Dim x={toolX - 8} y0={z0} y1={bottom} k="depth" hl={hl} />
      <Label x={toolX - 12} y={(z0 + bottom) / 2 + 4} anchor="end" hl={hl} k="depth">{de ? 'Tiefe' : 'depth'} {fmt(depth)}</Label>
      {passes.length > 0 && <><Dim x={rampEnd + 10} y0={z0} y1={passes[0]} k="stepDown" hl={hl} /><Label x={rampEnd + 14} y={(z0 + passes[0]) / 2 + 4} hl={hl} k="stepDown">{de ? 'Zustellung' : 'step-down'} {fmt(stepDown)}</Label></>}
      <Label x={228} y={top + H - 4} anchor="end" hl={hl}>{de ? 'Material' : 'stock'} {fmt(thickness)} mm</Label>
      <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="3" refY="5" orient="auto"><path d="M0,0 L6,0 L3,5 z" fill="currentColor" /></marker></defs>
    </Svg>
  );
}

/* ------------------------------------------------------------------ side (contour) */
export function SideDiagram({ side, lang }: { side: Side; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const closed = side === 'outside' || side === 'inside' || side === 'on';
  const r = 10;
  return (
    <Svg vb="0 0 240 90">
      {closed ? (<>
        <rect x={60} y={20} width={120} height={50} rx={12} className="contour" />
        <rect x={60} y={20} width={120} height={50} rx={12} className="material" />
        {side === 'outside' && <circle cx={120} cy={20 - r} r={r} className={`tool ${cls(hl, 'side')}`} />}
        {side === 'inside' && <circle cx={120} cy={20 + r} r={r} className={`tool ${cls(hl, 'side')}`} />}
        {side === 'on' && <circle cx={120} cy={20} r={r} className={`tool ${cls(hl, 'side')}`} />}
        <Label x={120} y={50} anchor="middle" hl={hl}>{de ? 'Material' : 'material'}</Label>
      </>) : (<>
        <path d="M30,60 C 80,10 160,80 210,30" className="contour" markerEnd="url(#arr2)" />
        {side === 'left' && <circle cx={118} cy={30} r={r} className={`tool ${cls(hl, 'side')}`} />}
        {side === 'right' && <circle cx={126} cy={58} r={r} className={`tool ${cls(hl, 'side')}`} />}
        <Label x={40} y={80} hl={hl}>{de ? 'links/rechts in Laufrichtung' : 'left/right in travel direction'}</Label>
      </>)}
      <Label x={120} y={85} anchor="middle" hl={hl} k="side">{de ? 'Seite' : 'side'}: {side}</Label>
      <defs><marker id="arr2" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="currentColor" /></marker></defs>
    </Svg>
  );
}

/* ------------------------------------------------------------------ pocket */
export function PocketDiagram({ side, strategy, stepOverPct, widthTools = 1, lang }: { side: 'inside' | 'on' | 'outside'; strategy: 'offset' | 'raster'; stepOverPct: number; widthTools?: number; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const so = Math.max(3, Math.min(14, stepOverPct / 8));
  const x = 60, y = 18, w = 100, h = 54, r = 6;
  const wallOff = side === 'inside' ? r : side === 'on' ? 0 : -r;
  const rings: ReactNode[] = [];
  if (side !== 'outside') {
    for (let d = wallOff + so, i = 0; d < Math.min(w, h) / 2 && i < 8; d += so, i++) rings.push(<rect key={i} x={x + d} y={y + d} width={w - 2 * d} height={h - 2 * d} className={`ring ${cls(hl, 'stepOver', 'strategy')}`} />);
  } else {
    // band from the contour out to widthTools tool widths (tool width = 2r in the drawing)
    const outer = -Math.max(2 * r, Math.min(26, widthTools * 2 * r));
    for (let d = wallOff - so, i = 0; d > outer + r && i < 6; d -= so, i++) rings.push(<rect key={i} x={x + d} y={y + d} width={w - 2 * d} height={h - 2 * d} className={`ring ${cls(hl, 'stepOver', 'strategy')}`} />);
    rings.push(<rect key="outer" x={x + outer + r} y={y + outer + r} width={w - 2 * (outer + r)} height={h - 2 * (outer + r)} className={`ring ${cls(hl, 'outsideWidth')}`} />);
  }
  const raster: ReactNode[] = [];
  if (strategy === 'raster' && side !== 'outside') for (let yy = y + wallOff + so; yy < y + h - wallOff; yy += so) raster.push(<line key={yy} x1={x + wallOff + 2} y1={yy} x2={x + w - wallOff - 2} y2={yy} className={`ring ${cls(hl, 'stepOver', 'strategy', 'rasterAngle')}`} />);
  return (
    <Svg vb="0 0 240 90">
      <rect x={x} y={y} width={w} height={h} className="contour" />
      <rect x={x + wallOff} y={y + wallOff} width={w - 2 * wallOff} height={h - 2 * wallOff} className={`wall ${cls(hl, 'pocketSide', 'outsideWidth')}`} />
      {strategy === 'offset' || side === 'outside' ? rings : raster}
      <Label x={x + w + 6} y={y + wallOff + 3} hl={hl} k="pocketSide">{de ? '1. Kontur' : '1. wall'}</Label>
      <Label x={x + w + 6} y={y + h / 2 + 3} hl={hl} k="stepOver">{de ? '2. Fläche' : '2. fill'} {fmt(stepOverPct)} %</Label>
      {side === 'outside' && <Label x={x + w + 6} y={y + h - 4} hl={hl} k="outsideWidth">{de ? 'Abtrag' : 'removed'} {fmt(widthTools)} × Ø</Label>}
    </Svg>
  );
}

/* ------------------------------------------------------------------ tabs */
export function TabsDiagram({ count, width, height, thickness, lang }: { count: number; width: number; height: number; thickness: number; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const top = 30, H = 44;
  const th = Math.min(H, (height / Math.max(thickness, 0.1)) * H);
  const tw = Math.max(6, Math.min(60, width * 2));
  return (
    <Svg vb="0 0 240 90">
      <rect x={10} y={top} width={220} height={H} className="stock" />
      {/* slot along the contour with a bridge left standing */}
      <rect x={20} y={top} width={200} height={H} className="cut" />
      <rect x={120 - tw / 2} y={top + H - th} width={tw} height={th} className={`tab ${cls(hl, 'tabWidth', 'tabHeight', 'tabCount')}`} />
      <Dim x={120 + tw / 2 + 8} y0={top + H - th} y1={top + H} k="tabHeight" hl={hl} />
      <Label x={120 + tw / 2 + 12} y={top + H - th / 2 + 3} hl={hl} k="tabHeight">{de ? 'Höhe' : 'height'} {fmt(height)}</Label>
      <line x1={120 - tw / 2} y1={top + H + 8} x2={120 + tw / 2} y2={top + H + 8} className={`dim ${cls(hl, 'tabWidth')}`} />
      <Label x={120} y={top + H + 16} anchor="middle" hl={hl} k="tabWidth">{de ? 'Breite' : 'width'} {fmt(width)}</Label>
      <Label x={12} y={top - 4} hl={hl} k="tabCount">{count} {de ? 'Stege am Umfang verteilt' : 'bridges around the contour'}</Label>
    </Svg>
  );
}

/* ------------------------------------------------------------------ overcut */
export function OvercutDiagram({ kind, lang }: { kind: Overcut['kind']; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const r = 12;
  return (
    <Svg vb="0 0 240 90">
      {/* inner corner of a pocket: material outside the L */}
      <rect x={40} y={20} width={160} height={60} className="material" />
      <rect x={60} y={40} width={120} height={50} className="cut" />
      <path d="M60,80 L60,40 L180,40 L180,80" className="contour" />
      <circle cx={60 + r} cy={40 + r} r={r} className="tool" />
      {kind === 'dogbone' && <><circle cx={60 + r - 5} cy={40 + r - 5} r={r} className={`tool ${cls(hl, 'overcut')}`} /><line x1={60 + r} y1={40 + r} x2={60 + r - 5} y2={40 + r - 5} className={`entry ${cls(hl, 'overcut')}`} /></>}
      {kind === 'tbone' && <><circle cx={60 + r} cy={40 + r - 7} r={r} className={`tool ${cls(hl, 'overcut')}`} /><line x1={60 + r} y1={40 + r} x2={60 + r} y2={40 + r - 7} className={`entry ${cls(hl, 'overcut')}`} /></>}
      <Label x={120} y={70} anchor="middle" hl={hl} k="overcut">{kind === 'none' ? (de ? 'Ecke bleibt gerundet' : 'corner stays rounded') : kind === 'dogbone' ? (de ? 'Hundeknochen: diagonal' : 'dog-bone: diagonal') : (de ? 'T-Knochen: entlang der Kante' : 'T-bone: along the edge')}</Label>
    </Svg>
  );
}

/* ------------------------------------------------------------------ start / direction */
export function StartDiagram({ startT, startAngle, climb, lang }: { startT?: number; startAngle?: number; climb: boolean; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const cx = 120, cy = 40, rx = 60, ry = 24;
  const a = startAngle !== undefined ? (startAngle * Math.PI) / 180 : startT !== undefined ? startT * 2 * Math.PI : Math.PI * 1.25;
  const sx = cx + rx * Math.cos(a), sy = cy - ry * Math.sin(a);
  return (
    <Svg vb="0 0 240 92">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="contour" />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="material" />
      <circle cx={sx} cy={sy} r={4} className={`start ${cls(hl, 'startT', 'startAngle')}`} />
      <Label x={sx + 6} y={sy - 4} hl={hl} k="startT">{de ? 'Start' : 'start'}{startAngle !== undefined ? ` ${fmt(startAngle)}°` : startT !== undefined ? ` ${fmt(startT)}` : ''}</Label>
      <path d={climb ? `M${cx + rx + 8},${cy + 6} a ${rx + 8} ${ry + 8} 0 0 0 -14,-${ry + 4}` : `M${cx + rx - 6},${cy - ry - 8} a ${rx + 8} ${ry + 8} 0 0 1 14,${ry + 4}`} className={`entry ${cls(hl, 'climb')}`} markerEnd="url(#arr3)" />
      <Label x={cx} y={cy + ry + 14} anchor="middle" hl={hl} k="climb">{climb ? (de ? 'Gleichlauf: außen gegen den Uhrzeigersinn' : 'climb: ccw around the outside') : (de ? 'Gegenlauf: außen im Uhrzeigersinn' : 'conventional: cw around the outside')}</Label>
      <defs><marker id="arr3" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="currentColor" /></marker></defs>
    </Svg>
  );
}

/* ------------------------------------------------------------------ zero point */
export function ZeroDiagram({ mode, corner, zZero, lang }: { mode: OriginMode; corner: Corner; zZero: 'top' | 'bottom'; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const sx = 20, sy = 12, sw = 130, sh = 66;
  const px = 50, py = 30, pw = 60, ph = 34; // parts bbox
  let ox = sx, oy = sy + sh;
  const box = mode.startsWith('parts') ? { x: px, y: py, w: pw, h: ph } : { x: sx, y: sy, w: sw, h: sh };
  if (mode === 'sheet-center' || mode === 'parts-bbox-center') { ox = box.x + box.w / 2; oy = box.y + box.h / 2; }
  else if (mode === 'manual') { ox = sx + 30; oy = sy + sh - 20; }
  else { ox = corner.endsWith('l') ? box.x : box.x + box.w; oy = corner.startsWith('b') ? box.y + box.h : box.y; }
  return (
    <Svg vb="0 0 240 90">
      <rect x={sx} y={sy} width={sw} height={sh} className="stock" />
      <rect x={px} y={py} width={pw} height={ph} rx={4} className="contour" />
      <rect x={px + 8} y={py + 8} width={20} height={18} rx={3} className="contour" />
      <g className={`origin ${cls(hl, 'originMode', 'corner', 'originX', 'originY')}`}><line x1={ox - 8} y1={oy} x2={ox + 8} y2={oy} /><line x1={ox} y1={oy - 8} x2={ox} y2={oy + 8} /><circle cx={ox} cy={oy} r={4} /></g>
      <Label x={ox + 8} y={oy - 6} hl={hl} k="originMode">X0 Y0</Label>
      {/* Z zero side view */}
      <rect x={172} y={44} width={56} height={22} className="stock" />
      <line x1={168} y1={zZero === 'top' ? 44 : 66} x2={232} y2={zZero === 'top' ? 44 : 66} className={`entry ${cls(hl, 'zZero')}`} />
      <Label x={200} y={zZero === 'top' ? 40 : 78} anchor="middle" hl={hl} k="zZero">Z0 = {zZero === 'top' ? (de ? 'Oberkante' : 'top') : (de ? 'Maschinenbett' : 'bed')}</Label>
      <Label x={200} y={20} anchor="middle" hl={hl}>{de ? 'Seitenansicht' : 'side view'}</Label>
    </Svg>
  );
}

/* ------------------------------------------------------------------ array */
export function ArrayDiagram({ nx, ny, dx, dy, lang }: { nx: number; ny: number; dx: number; dy: number; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const cx = Math.min(4, Math.max(1, nx)), cy = Math.min(3, Math.max(1, ny));
  const cw = 34, ch = 18, gx = 46, gy = 26;
  const items: ReactNode[] = [];
  for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) items.push(<rect key={`${i}-${j}`} x={20 + i * gx} y={70 - j * gy - ch} width={cw} height={ch} rx={3} className={i === 0 && j === 0 ? 'contour' : `ring ${cls(hl, 'arrayNx', 'arrayNy')}`} />);
  return (
    <Svg vb="0 0 240 90">
      {items}
      {cx > 1 && <><line x1={20} y1={78} x2={20 + gx} y2={78} className={`dim ${cls(hl, 'arrayDx')}`} /><Label x={20 + gx / 2} y={87} anchor="middle" hl={hl} k="arrayDx">dx {fmt(dx)}</Label></>}
      {cy > 1 && <><line x1={12} y1={70} x2={12} y2={70 - gy} className={`dim ${cls(hl, 'arrayDy')}`} /><Label x={10} y={70 - gy / 2 + 3} anchor="end" hl={hl} k="arrayDy">dy {fmt(dy)}</Label></>}
      <Label x={230} y={14} anchor="end" hl={hl} k="arrayNx">{nx} × {ny} {de ? 'Kopien' : 'copies'}</Label>
    </Svg>
  );
}

/* ------------------------------------------------------------------ drilling */
export function DrillDiagram({ mode, peck, depth, lang }: { mode: 'plunge' | 'peck' | 'helix'; peck?: number; depth: number; lang: 'de' | 'en' }) {
  const hl = useHl();
  const de = lang === 'de';
  const top = 30, H = 50;
  const n = mode === 'peck' && peck ? Math.min(6, Math.ceil(depth / Math.max(peck, 0.01))) : 1;
  const steps: ReactNode[] = [];
  for (let i = 1; i <= n; i++) { const y = top + (H * i) / n; steps.push(<line key={i} x1={112} y1={y} x2={128} y2={y} className={`pass ${cls(hl, 'peck')}`} />); }
  return (
    <Svg vb="0 0 240 90">
      <rect x={10} y={top} width={220} height={H} className="stock" />
      <rect x={112} y={top} width={16} height={H} className="cut" />
      {steps}
      <path d="M120,30 L114,10 L126,10 Z" className="tool" transform="translate(0,-4) scale(1,-1) translate(0,-26)" />
      <rect x={116} y={-2} width={8} height={26} className="tool" />
      <Label x={136} y={top + H / 2 + 3} hl={hl} k="peck">{mode === 'peck' ? `${de ? 'Spanbrechen alle' : 'peck every'} ${fmt(peck)} mm` : mode === 'helix' ? 'Helix' : (de ? 'in einem Zug' : 'single plunge')}</Label>
    </Svg>
  );
}

export type { Operation };
