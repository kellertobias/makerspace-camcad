import type { Font } from 'opentype.js';
import type { Path, Vec2 } from './types';
import { refitArcs } from './fit';
import { ensureClosed } from './path';
import { cubicPoints, quadPoints } from '@/lib/import/curves';
import { orientCcw } from '@/lib/import/normalize';
import { newId } from '@/lib/model/ids';
import type { TextSpec } from '@/lib/model/project';
import { nestPaths } from './containment';

/**
 * Convert text to closed outline paths (mm, Y up, baseline of the first line at y = 0). Bezier curves are
 * flattened and refitted to arcs where possible. Each glyph contour becomes its own path; counters (holes) are
 * nested contours, which the pocket operation treats as islands automatically.
 */
export function textToPaths(font: Font, spec: TextSpec): Path[] {
  const size = Math.max(0.5, spec.size);
  const lineHeight = (spec.lineHeight ?? 1.2) * size;
  const scale = size / font.unitsPerEm;
  const letterSpacing = spec.letterSpacing ?? 0;
  const lines = spec.text.replace(/\r/g, '').split('\n');
  // Layout glyph by glyph (charToGlyph + kerning) instead of font.getPaths: the latter runs GSUB feature
  // substitution, which opentype.js does not support for every font.
  const layout = (line: string) => {
    const glyphs = [...line].map((ch) => font.charToGlyph(ch));
    const xs: number[] = [];
    let x = 0;
    glyphs.forEach((g, i) => {
      xs.push(x);
      x += (g.advanceWidth ?? 0) * scale + letterSpacing;
      if (i + 1 < glyphs.length) x += font.getKerningValue(g, glyphs[i + 1]) * scale;
    });
    return { glyphs, xs, width: x - (glyphs.length ? letterSpacing : 0) };
  };
  const laid = lines.map(layout);
  const maxW = Math.max(0, ...laid.map((l) => l.width));
  const out: Path[] = [];
  laid.forEach((l, li) => {
    const y = -li * lineHeight;
    const x0 = spec.align === 'center' ? (maxW - l.width) / 2 : spec.align === 'right' ? maxW - l.width : 0;
    l.glyphs.forEach((g, gi) => {
      const gp = g.getPath(x0 + l.xs[gi], 0, size, {}, font);
      let cur: Vec2[] = [];
      const flush = () => { if (cur.length >= 3) out.push(refitArcs(cur, true, 0.01)); cur = []; };
      // glyph paths use the canvas convention (y down) -> flip to Y up and shift by the line offset
      const P = (px: number, py: number): Vec2 => ({ x: px, y: -py + y });
      for (const c of gp.commands) {
        switch (c.type) {
          case 'M': flush(); cur = [P(c.x, c.y)]; break;
          case 'L': cur.push(P(c.x, c.y)); break;
          case 'Q': { const p0 = cur[cur.length - 1]; cur.push(...quadPoints(p0, P(c.x1, c.y1), P(c.x, c.y), 0.01)); break; }
          case 'C': { const p0 = cur[cur.length - 1]; cur.push(...cubicPoints(p0, P(c.x1, c.y1), P(c.x2, c.y2), P(c.x, c.y), 0.01)); break; }
          case 'Z': flush(); break;
        }
      }
      flush();
    });
  });
  return orientCcw(out.map((p) => ensureClosed({ ...p, id: newId('pa'), layer: 'Text' })));
}

/**
 * Approximate smallest stroke width (mm) across the glyphs: for every outer contour (counters excluded) the largest
 * inward offset that still leaves material, doubled; the minimum over all outers is the thinnest stroke.
 */
export function estimateMinStroke(paths: Path[], offsetFn: (paths: Path[], delta: number) => Path[], maxProbe = 20): number {
  const closed = paths.filter((p) => p.closed);
  if (!closed.length) return 0;
  const outers = nestPaths(closed).filter((n) => n.depth % 2 === 0).map((n) => n.path);
  let min = Infinity;
  for (const o of outers) {
    let lo = 0, hi = maxProbe;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (offsetFn([o], -mid).length > 0) lo = mid; else hi = mid;
    }
    min = Math.min(min, lo * 2);
  }
  return Number.isFinite(min) ? min : 0;
}
