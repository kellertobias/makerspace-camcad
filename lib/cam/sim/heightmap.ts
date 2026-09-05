import type { Move } from '@/lib/cam/types';
import { arcSweep } from '@/lib/geometry/arcs';

export type FootprintKind = 'endmill' | 'facemill' | 'ballnose' | 'vbit' | 'drill' | 'saw' | 'laser';

/** Flat list of motion moves with the op index they belong to, ready for simulation. */
export interface SimMove { k: 'rapid' | 'line' | 'arc'; x: number; y: number; z: number; cx?: number; cy?: number; cw?: boolean; op: number; /** feed in mm/min (cutting moves) */ f: number }

export interface SimConfig {
  /** simulated region in sheet coordinates: origin (ox, oy) and size; the region may be smaller than the sheet */
  ox?: number; oy?: number;
  width: number; height: number; thickness: number;
  /** machine zero in sheet coordinates */
  zero: { x: number; y: number };
  zZero: 'top' | 'bottom';
  cell: number;
  /** tool footprint per operation index */
  tools: { kind: FootprintKind; d: number; tipAngle?: number }[];
  moves: SimMove[];
}

/** Choose a cell size so the grid stays below `maxCells` cells. */
export function chooseCell(width: number, height: number, maxCells = 800_000, minCell = 0.2): number {
  return Math.max(minCell, Math.ceil(Math.sqrt((width * height) / maxCells) * 100) / 100);
}

/** Convert the program's moves (machine coordinates) into a flat list with resolved absolute positions. */
export function flattenMoves(tools: { ops: { moves: Move[] }[] }[], startZ: number): SimMove[] {
  const out: SimMove[] = [];
  let x = 0, y = 0, z = startZ, op = 0, f = 1000;
  for (const tp of tools) for (const o of tp.ops) {
    for (const m of o.moves) {
      if (m.k === 'rapid' || m.k === 'line') {
        x = m.x ?? x; y = m.y ?? y; z = m.z ?? z;
        if (m.k === 'line' && m.f) f = m.f;
        out.push({ k: m.k, x, y, z, op, f });
      } else if (m.k === 'arc') {
        x = m.x; y = m.y; z = m.z ?? z;
        if (m.f) f = m.f;
        out.push({ k: 'arc', x, y, z, cx: m.cx, cy: m.cy, cw: m.cw, op, f });
      }
    }
    op++;
  }
  return out;
}

/**
 * Heightmap material simulation. Heights are millimetres above the machine bed (stock bottom); negative values mean
 * the tool cut below the stock.
 * `opMap` records which operation last cut each cell (255 = untouched).
 */
export class Simulator {
  readonly nx: number;
  readonly ny: number;
  readonly heights: Float32Array;
  readonly opMap: Uint8Array;
  /** index of the next move to process */
  cursor = 0;
  /** rows/cols touched since the last takeDirty() */
  private dirty: { i0: number; i1: number; j0: number; j1: number } | null = null;
  private footprints: { r: number; profile: (d: number) => number }[];

  constructor(readonly cfg: SimConfig) {
    this.nx = Math.max(2, Math.ceil(cfg.width / cfg.cell) + 1);
    this.ny = Math.max(2, Math.ceil(cfg.height / cfg.cell) + 1);
    this.heights = new Float32Array(this.nx * this.ny).fill(cfg.thickness);
    this.opMap = new Uint8Array(this.nx * this.ny).fill(255);
    this.footprints = cfg.tools.map((t) => footprint(t));
  }

  /** Height (bed = 0) of the tool tip for a machine Z. */
  private tipHeight(z: number) { return this.cfg.zZero === 'top' ? this.cfg.thickness + z : z; }

  reset() { this.heights.fill(this.cfg.thickness); this.opMap.fill(255); this.cursor = 0; this.dirty = { i0: 0, i1: this.nx - 1, j0: 0, j1: this.ny - 1 }; }

  /** Bounding box of cells changed since the previous call (null = nothing changed). */
  takeDirty() { const d = this.dirty; this.dirty = null; return d; }

  /**
   * Cut the move at `index` only up to fraction `frac` of its length (0..1). Idempotent, so it can be repeated
   * with a growing fraction while the tool advances. Complete moves before `index` must already be processed.
   */
  runPartial(index: number, frac: number) {
    const moves = this.cfg.moves;
    if (index <= 0 || index >= moves.length) return;
    const m = moves[index];
    if (m.k === 'rapid') return;
    const a = moves[index - 1];
    if (frac >= 1) { this.cut(a, m); return; }
    if (frac <= 0) return;
    if (m.k === 'line') {
      this.cut(a, { ...m, x: a.x + (m.x - a.x) * frac, y: a.y + (m.y - a.y) * frac, z: a.z + (m.z - a.z) * frac });
    } else if (m.cx !== undefined && m.cy !== undefined) {
      const r = Math.hypot(a.x - m.cx, a.y - m.cy);
      const sweep = arcSweep({ x: a.x, y: a.y }, { x: m.x, y: m.y }, { x: m.cx, y: m.cy }, !!m.cw) * frac;
      const ang = Math.atan2(a.y - m.cy, a.x - m.cx) + sweep;
      // a partial arc keeps its centre and direction; the end point moves along the circle
      this.cutArc(a, { x: m.cx + r * Math.cos(ang), y: m.cy + r * Math.sin(ang), z: a.z + (m.z - a.z) * frac }, m.cx, m.cy, sweep, m.op);
    }
  }

  private cutArc(a: SimMove, end: { x: number; y: number; z: number }, cx: number, cy: number, sweep: number, op: number) {
    const fp = this.footprints[op];
    if (!fp) return;
    const { cell, zero } = this.cfg;
    const step = Math.max(cell * 0.5, 0.05);
    const r = Math.hypot(a.x - cx, a.y - cy);
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    const n = Math.max(1, Math.ceil((Math.abs(sweep) * r) / step));
    const ox = this.cfg.ox ?? 0, oy = this.cfg.oy ?? 0;
    for (let i = 0; i <= n; i++) { const t = i / n; const ang = a0 + sweep * t; this.stamp(cx + r * Math.cos(ang) + zero.x - ox, cy + r * Math.sin(ang) + zero.y - oy, this.tipHeight(a.z + (end.z - a.z) * t), fp, op); }
  }

  /** Process moves up to (excluding) index `upTo`. Returns the number of moves processed. */
  run(upTo: number): number {
    const moves = this.cfg.moves;
    const end = Math.min(upTo, moves.length);
    let processed = 0;
    for (; this.cursor < end; this.cursor++, processed++) {
      const m = moves[this.cursor];
      const prev = this.cursor > 0 ? moves[this.cursor - 1] : null;
      if (m.k === 'rapid' || !prev) continue;
      this.cut(prev, m);
    }
    return processed;
  }

  private cut(a: SimMove, b: SimMove) {
    const fp = this.footprints[b.op];
    if (!fp) return;
    const { cell, zero } = this.cfg;
    const step = Math.max(cell * 0.5, 0.05);
    const ox = this.cfg.ox ?? 0, oy = this.cfg.oy ?? 0;
    const stamp = (x: number, y: number, z: number) => this.stamp(x + zero.x - ox, y + zero.y - oy, this.tipHeight(z), fp, b.op);
    if (b.k === 'line') {
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      const n = Math.max(1, Math.ceil(len / step));
      for (let i = 0; i <= n; i++) { const t = i / n; stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
    } else if (b.k === 'arc' && b.cx !== undefined && b.cy !== undefined) {
      const r = Math.hypot(a.x - b.cx, a.y - b.cy);
      const sweep = arcSweep({ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.cx, y: b.cy }, !!b.cw);
      const a0 = Math.atan2(a.y - b.cy, a.x - b.cx);
      const n = Math.max(1, Math.ceil((Math.abs(sweep) * r) / step));
      for (let i = 0; i <= n; i++) { const t = i / n; const ang = a0 + sweep * t; stamp(b.cx + r * Math.cos(ang), b.cy + r * Math.sin(ang), a.z + (b.z - a.z) * t); }
    }
  }

  /** Lower all cells under the tool footprint centred at (x,y) with the tip at height h. */
  private stamp(x: number, y: number, h: number, fp: { r: number; profile: (d: number) => number }, op: number) {
    const { cell } = this.cfg;
    if (h >= this.cfg.thickness) return;
    const r = fp.r;
    const i0 = Math.max(0, Math.floor((x - r) / cell)), i1 = Math.min(this.nx - 1, Math.ceil((x + r) / cell));
    const j0 = Math.max(0, Math.floor((y - r) / cell)), j1 = Math.min(this.ny - 1, Math.ceil((y + r) / cell));
    for (let j = j0; j <= j1; j++) {
      const dy = j * cell - y;
      for (let i = i0; i <= i1; i++) {
        const dx = i * cell - x;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const zc = h + fp.profile(d);
        const idx = j * this.nx + i;
        // heights may go below the bed (negative): the viewer shows those cells as cut too deep
        if (zc < this.heights[idx]) { this.heights[idx] = zc; this.opMap[idx] = op; }
      }
    }
    if (!this.dirty) this.dirty = { i0, i1, j0, j1 };
    else { const d = this.dirty; if (i0 < d.i0) d.i0 = i0; if (i1 > d.i1) d.i1 = i1; if (j0 < d.j0) d.j0 = j0; if (j1 > d.j1) d.j1 = j1; }
  }
}

/** Tool tip profile: height of the cutting edge above the tip as a function of the distance from the axis. */
export function footprint(t: { kind: FootprintKind; d: number; tipAngle?: number }): { r: number; profile: (d: number) => number } {
  const r = Math.max(0.05, t.d / 2);
  switch (t.kind) {
    case 'ballnose': return { r, profile: (d) => r - Math.sqrt(Math.max(0, r * r - d * d)) };
    case 'vbit': case 'drill': { const half = ((t.tipAngle ?? 90) / 2) * (Math.PI / 180); const k = 1 / Math.tan(Math.max(0.05, half)); return { r, profile: (d) => d * k }; }
    case 'laser': return { r: Math.max(0.05, t.d / 2), profile: () => 0 };
    default: return { r, profile: () => 0 };
  }
}
