import type { SimMove } from './heightmap';
import { arcSweep } from '@/lib/geometry/arcs';

/** Cumulative time (seconds) at the end of every move, for the playback slider. */
export function buildTimeline(moves: SimMove[], rapid: number, rapidZ: number): Float64Array {
  const t = new Float64Array(moves.length + 1);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    const p = i > 0 ? moves[i - 1] : m;
    let len: number;
    if (m.k === 'arc' && m.cx !== undefined && m.cy !== undefined) {
      const r = Math.hypot(p.x - m.cx, p.y - m.cy);
      len = Math.hypot(Math.abs(arcSweep({ x: p.x, y: p.y }, { x: m.x, y: m.y }, { x: m.cx, y: m.cy }, !!m.cw)) * r, m.z - p.z);
    } else len = Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z);
    const f = m.k === 'rapid' ? (Math.abs(m.z - p.z) > Math.hypot(m.x - p.x, m.y - p.y) ? rapidZ : rapid) : Math.max(1, m.f || 1000);
    t[i + 1] = t[i] + (len / f) * 60;
  }
  return t;
}

/** Tool position at time `time`; returns the move index and the interpolated point. */
export function positionAt(moves: SimMove[], timeline: Float64Array, time: number): { index: number; t: number; x: number; y: number; z: number } {
  if (!moves.length) return { index: 0, t: 1, x: 0, y: 0, z: 0 };
  // binary search for the move containing `time`
  let lo = 0, hi = moves.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (timeline[mid + 1] < time) lo = mid + 1; else hi = mid; }
  const i = lo;
  const m = moves[i];
  const p = i > 0 ? moves[i - 1] : m;
  const dur = timeline[i + 1] - timeline[i];
  const t = dur > 0 ? Math.max(0, Math.min(1, (time - timeline[i]) / dur)) : 1;
  if (m.k === 'arc' && m.cx !== undefined && m.cy !== undefined) {
    const r = Math.hypot(p.x - m.cx, p.y - m.cy);
    const sweep = arcSweep({ x: p.x, y: p.y }, { x: m.x, y: m.y }, { x: m.cx, y: m.cy }, !!m.cw);
    const a = Math.atan2(p.y - m.cy, p.x - m.cx) + sweep * t;
    return { index: i, t, x: m.cx + r * Math.cos(a), y: m.cy + r * Math.sin(a), z: p.z + (m.z - p.z) * t };
  }
  return { index: i, t, x: p.x + (m.x - p.x) * t, y: p.y + (m.y - p.y) * t, z: p.z + (m.z - p.z) * t };
}
