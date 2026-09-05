import type { Mat } from '@/lib/geometry/types';
import { compose, identity, rotation, scaling, translation } from '@/lib/geometry/transform';

export function parseTransform(s: string | null): Mat {
  if (!s) return identity();
  let m = identity();
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s))) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = identity();
    switch (match[1]) {
      case 'matrix': t = [args[0], args[1], args[2], args[3], args[4], args[5]]; break;
      case 'translate': t = translation(args[0] ?? 0, args[1] ?? 0); break;
      case 'scale': t = scaling(args[0] ?? 1, args[1] ?? args[0] ?? 1); break;
      case 'rotate': {
        const r = rotation(args[0] ?? 0);
        t = args.length >= 3 ? compose(translation(args[1], args[2]), compose(r, translation(-args[1], -args[2]))) : r;
        break;
      }
      case 'skewX': t = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = compose(m, t);
  }
  return m;
}

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

export function parseLength(v: string | null): { value: number; unit: string } | null {
  if (!v) return null;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(v);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: m[2].toLowerCase() };
}
export const unitToMm = (unit: string) => UNIT_MM[unit] ?? null;
