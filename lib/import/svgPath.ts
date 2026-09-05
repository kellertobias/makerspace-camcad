import type { Vec2, Segment, Path } from '@/lib/geometry/types';
import { svgArcCenter, ellipsePoint } from '@/lib/geometry/arcs';
import { cubicPoints, quadPoints } from './curves';
import { newId } from '@/lib/model/ids';

/**
 * Parse an SVG path `d` attribute into paths in SVG user units (Y down). Arcs with rx == ry stay arcs.
 * `cw` in the produced segments refers to Y-down screen orientation; the caller flips Y afterwards which inverts it.
 */
export function parseSvgPath(d: string, tol = 0.01): Path[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const paths: Path[] = [];
  let i = 0;
  let cmd = '';
  let cur: Vec2 = { x: 0, y: 0 };
  let start: Vec2 = { x: 0, y: 0 };
  let lastCtrl: Vec2 | null = null;
  let segs: Segment[] = [];
  let pathStart: Vec2 | null = null;
  const num = () => { const t = tokens[i++]; return parseFloat(t); };
  const flush = (closed: boolean) => {
    if (pathStart && segs.length) paths.push({ id: newId('pa'), start: pathStart, segs, closed });
    segs = []; pathStart = null;
  };
  const begin = (p: Vec2) => { if (!pathStart) pathStart = p; };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; if (cmd === 'Z' || cmd === 'z') { flush(true); cur = start; continue; } }
    const rel = cmd === cmd.toLowerCase();
    const P = (x: number, y: number): Vec2 => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    switch (cmd.toUpperCase()) {
      case 'M': { flush(false); const p = P(num(), num()); cur = p; start = p; pathStart = p; cmd = rel ? 'l' : 'L'; lastCtrl = null; break; }
      case 'L': { begin(cur); const p = P(num(), num()); segs.push({ k: 'L', to: p }); cur = p; lastCtrl = null; break; }
      case 'H': { begin(cur); const x = num(); const p = { x: rel ? cur.x + x : x, y: cur.y }; segs.push({ k: 'L', to: p }); cur = p; lastCtrl = null; break; }
      case 'V': { begin(cur); const y = num(); const p = { x: cur.x, y: rel ? cur.y + y : y }; segs.push({ k: 'L', to: p }); cur = p; lastCtrl = null; break; }
      case 'C': { begin(cur); const c1 = P(num(), num()), c2 = P(num(), num()), p = P(num(), num());
        for (const q of cubicPoints(cur, c1, c2, p, tol)) segs.push({ k: 'L', to: q }); cur = p; lastCtrl = c2; break; }
      case 'S': { begin(cur); const c1: Vec2 = lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur; const c2 = P(num(), num()), p = P(num(), num());
        for (const q of cubicPoints(cur, c1, c2, p, tol)) segs.push({ k: 'L', to: q }); cur = p; lastCtrl = c2; break; }
      case 'Q': { begin(cur); const c1 = P(num(), num()), p = P(num(), num());
        for (const q of quadPoints(cur, c1, p, tol)) segs.push({ k: 'L', to: q }); cur = p; lastCtrl = c1; break; }
      case 'T': { begin(cur); const c1: Vec2 = lastCtrl ? { x: 2 * cur.x - lastCtrl.x, y: 2 * cur.y - lastCtrl.y } : cur; const p = P(num(), num());
        for (const q of quadPoints(cur, c1, p, tol)) segs.push({ k: 'L', to: q }); cur = p; lastCtrl = c1; break; }
      case 'A': { begin(cur); const rx = num(), ry = num(), phi = num(), large = num() !== 0, sweep = num() !== 0; const p = P(num(), num());
        if (Math.abs(rx) < 1e-9 || Math.abs(ry) < 1e-9) { segs.push({ k: 'L', to: p }); }
        else {
          const a = svgArcCenter(cur, rx, ry, phi, large, sweep, p);
          if (Math.abs(a.rx - a.ry) < 1e-6) {
            // circular: sweep flag true = positive angle direction in Y-down = clockwise on screen
            segs.push({ k: 'A', to: p, c: { x: a.cx, y: a.cy }, cw: !sweep });
          } else {
            const n = Math.max(4, Math.ceil((Math.abs(a.dTheta) * Math.max(a.rx, a.ry)) / Math.sqrt(8 * Math.max(a.rx, a.ry) * tol)));
            for (let k = 1; k <= n; k++) segs.push({ k: 'L', to: k === n ? p : ellipsePoint(a.cx, a.cy, a.rx, a.ry, a.phi, a.theta1 + (a.dTheta * k) / n) });
          }
        }
        cur = p; lastCtrl = null; break; }
      default: i++; // skip unknown
    }
  }
  flush(false);
  return paths;
}
