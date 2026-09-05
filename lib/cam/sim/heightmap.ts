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
 *
 * Flat tools (end mill, face mill, saw, laser) sweep a straight move as a capsule: every cell inside is visited once
 * with the exact lowest tip height the tool reaches there (ramps included). Arcs are split into short chords. Profiled
 * tools (ball nose, V-bit, drill) stamp a precomputed kernel at one-cell steps.
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
  private footprints: Footprint[];

  constructor(readonly cfg: SimConfig) {
    this.nx = Math.max(2, Math.ceil(cfg.width / cfg.cell) + 1);
    this.ny = Math.max(2, Math.ceil(cfg.height / cfg.cell) + 1);
    this.heights = new Float32Array(this.nx * this.ny).fill(cfg.thickness);
    this.opMap = new Uint8Array(this.nx * this.ny).fill(255);
    this.footprints = cfg.tools.map((t) => makeFootprint(t, cfg.cell));
  }

  /** Height (bed = 0) of the tool tip for a machine Z. */
  private tipHeight(z: number) { return this.cfg.zZero === 'top' ? this.cfg.thickness + z : z; }

  reset() { this.heights.fill(this.cfg.thickness); this.opMap.fill(255); this.cursor = 0; this.dirty = { i0: 0, i1: this.nx - 1, j0: 0, j1: this.ny - 1 }; }

  /** Bounding box of cells changed since the previous call (null = nothing changed). */
  takeDirty() { const d = this.dirty; this.dirty = null; return d; }

  private touch(i0: number, i1: number, j0: number, j1: number) {
    if (i1 < i0 || j1 < j0) return;
    if (!this.dirty) this.dirty = { i0, i1, j0, j1 };
    else { const d = this.dirty; if (i0 < d.i0) d.i0 = i0; if (i1 > d.i1) d.i1 = i1; if (j0 < d.j0) d.j0 = j0; if (j1 > d.j1) d.j1 = j1; }
  }

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
      this.cutLine(a.x, a.y, a.z, a.x + (m.x - a.x) * frac, a.y + (m.y - a.y) * frac, a.z + (m.z - a.z) * frac, m.op);
    } else if (m.cx !== undefined && m.cy !== undefined) {
      const sweep = arcSweep({ x: a.x, y: a.y }, { x: m.x, y: m.y }, { x: m.cx, y: m.cy }, !!m.cw) * frac;
      this.cutArc(a, m.cx, m.cy, sweep, a.z + (m.z - a.z) * frac, m.op);
    }
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
    if (b.k === 'line') this.cutLine(a.x, a.y, a.z, b.x, b.y, b.z, b.op);
    else if (b.k === 'arc' && b.cx !== undefined && b.cy !== undefined) {
      const sweep = arcSweep({ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.cx, y: b.cy }, !!b.cw);
      this.cutArc(a, b.cx, b.cy, sweep, b.z, b.op);
    }
  }

  /** Arc from `a` around (cx, cy) by `sweep` radians, ending at height zEnd: chords short enough to stay within half a cell. */
  private cutArc(a: SimMove, cx: number, cy: number, sweep: number, zEnd: number, op: number) {
    const r = Math.hypot(a.x - cx, a.y - cy);
    if (r < 1e-9) { this.cutLine(a.x, a.y, a.z, a.x, a.y, zEnd, op); return; }
    const tol = this.cfg.cell * 0.5;
    const maxAng = r > tol ? 2 * Math.acos(Math.max(-1, 1 - tol / r)) : Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(1e-3, maxAng)));
    const a0 = Math.atan2(a.y - cy, a.x - cx);
    let px = a.x, py = a.y, pz = a.z;
    for (let i = 1; i <= n; i++) {
      const t = i / n, ang = a0 + sweep * t;
      const x = cx + r * Math.cos(ang), y = cy + r * Math.sin(ang), z = a.z + (zEnd - a.z) * t;
      this.cutLine(px, py, pz, x, y, z, op);
      px = x; py = y; pz = z;
    }
  }

  /** Straight move in machine coordinates. */
  private cutLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number, op: number) {
    const fp = this.footprints[op];
    if (!fp) return;
    const hA = this.tipHeight(az), hB = this.tipHeight(bz);
    if (hA >= this.cfg.thickness && hB >= this.cfg.thickness) return; // tool above the stock all the way
    const { cell, zero } = this.cfg;
    const ox = this.cfg.ox ?? 0, oy = this.cfg.oy ?? 0;
    // grid coordinates (cells)
    const gax = (ax + zero.x - ox) / cell, gay = (ay + zero.y - oy) / cell, gbx = (bx + zero.x - ox) / cell, gby = (by + zero.y - oy) / cell;
    if (fp.flat) this.capsule(gax, gay, hA, gbx, gby, hB, fp.rc, op);
    else {
      const len = Math.hypot(gbx - gax, gby - gay);
      const n = Math.max(1, Math.ceil(len)); // one-cell steps
      for (let i = 0; i <= n; i++) { const t = i / n; this.stampKernel(gax + (gbx - gax) * t, gay + (gby - gay) * t, hA + (hB - hA) * t, fp, op); }
    }
  }

  /**
   * Flat tool sweeping the segment A->B (grid units, radius rc in cells): every cell within rc of the segment gets the
   * lowest height the tip reaches while the tool covers it. With a descending move that is the farthest point along
   * the segment still within reach, with an ascending one the nearest.
   */
  private capsule(ax: number, ay: number, hA: number, bx: number, by: number, hB: number, rc: number, op: number) {
    const { nx, ny, heights, opMap } = this;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - rc)), j1 = Math.min(ny - 1, Math.ceil(Math.max(ay, by) + rc));
    let ti0 = nx, ti1 = -1;
    const rc2 = rc * rc;
    const descending = hB < hA, flatZ = Math.abs(hB - hA) < 1e-9;
    const thick = this.cfg.thickness;
    const unx = len > 1e-9 ? -dy / len : 0, uny = len > 1e-9 ? dx / len : 0; // unit normal of the segment
    for (let j = j0; j <= j1; j++) {
      const y = j;
      // x-interval of the capsule on this row: union of the two end discs and the band (convex -> one interval)
      let lo = Infinity, hi = -Infinity;
      const da = y - ay, db = y - by;
      if (Math.abs(da) <= rc) { const s = Math.sqrt(rc2 - da * da); lo = Math.min(lo, ax - s); hi = Math.max(hi, ax + s); }
      if (Math.abs(db) <= rc) { const s = Math.sqrt(rc2 - db * db); lo = Math.min(lo, bx - s); hi = Math.max(hi, bx + s); }
      if (len > 1e-9) {
        // band: |perp| <= rc and 0 <= t <= 1, both linear in x
        let bl = -Infinity, bh = Infinity, ok = true;
        const c0 = da * uny; // perp = (x - ax) * unx + da * uny
        if (Math.abs(unx) > 1e-12) { const x1 = ax + (-rc - c0) / unx, x2 = ax + (rc - c0) / unx; bl = Math.max(bl, Math.min(x1, x2)); bh = Math.min(bh, Math.max(x1, x2)); }
        else if (Math.abs(c0) > rc) ok = false;
        const t0 = da * dy; // t * len2 = (x - ax) * dx + da * dy
        if (Math.abs(dx) > 1e-12) { const x1 = ax + (0 - t0) / dx, x2 = ax + (len2 - t0) / dx; bl = Math.max(bl, Math.min(x1, x2)); bh = Math.min(bh, Math.max(x1, x2)); }
        else if (t0 < 0 || t0 > len2) ok = false;
        if (ok && bl <= bh) { lo = Math.min(lo, bl); hi = Math.max(hi, bh); }
      }
      if (lo > hi) continue;
      const i0 = Math.max(0, Math.ceil(lo - 1e-9)), i1 = Math.min(nx - 1, Math.floor(hi + 1e-9));
      if (i1 < i0) continue;
      if (i0 < ti0) ti0 = i0; if (i1 > ti1) ti1 = i1;
      const row = j * nx;
      if (flatZ) {
        if (hA >= thick) continue;
        for (let i = i0; i <= i1; i++) { const idx = row + i; if (hA < heights[idx]) { heights[idx] = hA; opMap[idx] = op; } }
      } else {
        for (let i = i0; i <= i1; i++) {
          const idx = row + i;
          let t: number;
          if (len2 < 1e-18) t = 1;
          else {
            const ex = i - ax;
            const tp = (ex * dx + da * dy) / len2;               // projection parameter
            const perp = ex * unx + da * uny;
            const reach = Math.sqrt(Math.max(0, rc2 - perp * perp)) / len;
            t = descending ? Math.min(1, tp + reach) : Math.max(0, tp - reach);
            if (t < 0) t = 0; else if (t > 1) t = 1;
          }
          const h = hA + (hB - hA) * t;
          if (h < heights[idx]) { heights[idx] = h; opMap[idx] = op; }
        }
      }
    }
    this.touch(ti0, ti1, j0, j1);
  }

  /** Profiled tool: kernel of tip-relative heights, centre snapped to the nearest cell. */
  private stampKernel(gx: number, gy: number, h: number, fp: Footprint, op: number) {
    if (h >= this.cfg.thickness) return;
    const { nx, ny, heights, opMap } = this;
    const ci = Math.round(gx), cj = Math.round(gy), R = fp.rcells, K = 2 * R + 1;
    const i0 = Math.max(0, ci - R), i1 = Math.min(nx - 1, ci + R), j0 = Math.max(0, cj - R), j1 = Math.min(ny - 1, cj + R);
    for (let j = j0; j <= j1; j++) {
      const krow = (j - cj + R) * K, row = j * nx;
      for (let i = i0; i <= i1; i++) {
        const kv = fp.kernel[krow + (i - ci + R)];
        if (kv === Infinity) continue;
        const idx = row + i, zc = h + kv;
        if (zc < heights[idx]) { heights[idx] = zc; opMap[idx] = op; }
      }
    }
    this.touch(i0, i1, j0, j1);
  }
}

interface Footprint { flat: boolean; /** radius in cells */ rc: number; rcells: number; kernel: Float32Array }

/** Footprint in grid units: flat tools use the analytic capsule, others a kernel sampled on the cell grid. */
function makeFootprint(t: { kind: FootprintKind; d: number; tipAngle?: number }, cell: number): Footprint {
  const fp = footprint(t);
  const rc = fp.r / cell;
  const flat = t.kind !== 'ballnose' && t.kind !== 'vbit' && t.kind !== 'drill';
  const R = Math.ceil(rc), K = 2 * R + 1;
  const kernel = new Float32Array(flat ? 0 : K * K);
  if (!flat) {
    for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) {
      const d = Math.hypot(i - R, j - R) * cell;
      kernel[j * K + i] = d > fp.r ? Infinity : fp.profile(d);
    }
  }
  return { flat, rc, rcells: R, kernel };
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
