import type { Machine } from '@/lib/model/project';
import type { Move, Program } from './types';
import { arcSweep } from '@/lib/geometry/arcs';

/** Rough machining time in seconds: path length / feed, rapids at machine rapid rate, plus tool changes. */
export function estimateSeconds(program: Program, machine: Machine, toolChangeSeconds = 30): number {
  let t = 0;
  let x = 0, y = 0, z = 0, f = machine.feedMax.xy;
  const rapid = Math.max(1, machine.rapid.xy);
  const step = (m: Move) => {
    if (m.k === 'rapid') {
      const nx = m.x ?? x, ny = m.y ?? y, nz = m.z ?? z;
      const dxy = Math.hypot(nx - x, ny - y), dz = Math.abs(nz - z);
      t += dxy / rapid * 60 + dz / Math.max(1, machine.rapid.z) * 60;
      x = nx; y = ny; z = nz;
    } else if (m.k === 'line') {
      if (m.f) f = m.f;
      const nx = m.x ?? x, ny = m.y ?? y, nz = m.z ?? z;
      t += (Math.hypot(nx - x, ny - y, nz - z) / Math.max(1, f)) * 60;
      x = nx; y = ny; z = nz;
    } else if (m.k === 'arc') {
      if (m.f) f = m.f;
      const r = Math.hypot(x - m.cx, y - m.cy);
      const sweep = Math.abs(arcSweep({ x, y }, { x: m.x, y: m.y }, { x: m.cx, y: m.cy }, m.cw));
      const nz = m.z ?? z;
      t += (Math.hypot(sweep * r, nz - z) / Math.max(1, f)) * 60;
      x = m.x; y = m.y; z = nz;
    } else if (m.k === 'dwell') t += m.seconds;
  };
  program.tools.forEach((tp, i) => { if (i > 0) t += toolChangeSeconds; for (const op of tp.ops) for (const m of op.moves) step(m); });
  return t;
}

export function formatHms(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
