import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { textToPaths, estimateMinStroke } from '@/lib/geometry/text';
import { offsetClosed } from '@/lib/geometry/offset';
import { bbox, signedArea } from '@/lib/geometry/path';
import { nestPaths } from '@/lib/geometry/containment';
import { strokeTextToPaths } from '@/lib/text/strokeFont';
import { newOperation, newTool } from '@/lib/model/defaults';
import { contourMoves } from '@/lib/cam/contour';

const font = opentype.parse(readFileSync('public/fonts/Nunito.ttf').buffer.slice(0) as ArrayBuffer);

describe('text to paths', () => {
  it('produces closed outlines at the requested size with counters nested', () => {
    const paths = textToPaths(font, { text: 'Ab', font: 'nunito', size: 20 });
    expect(paths.length).toBeGreaterThanOrEqual(4); // A outer + hole, b outer + hole
    expect(paths.every((p) => p.closed)).toBe(true);
    const b = paths.map(bbox).reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), minY: Math.min(a.minY, c.minY), maxX: Math.max(a.maxX, c.maxX), maxY: Math.max(a.maxY, c.maxY) }));
    // cap height of a 20 mm font is roughly 14 mm; baseline at 0, ascender up (Y up)
    expect(b.maxY).toBeGreaterThan(10); expect(b.maxY).toBeLessThan(20);
    expect(b.minY).toBeLessThanOrEqual(0.5);
    const nest = nestPaths(paths);
    expect(nest.some((n) => n.depth === 1)).toBe(true); // a counter nested in a letter
    expect(paths.every((p) => signedArea(p) > 0)).toBe(true);
  });
  it('estimates a stroke width that shrinks with font size', () => {
    const big = estimateMinStroke(textToPaths(font, { text: 'l', font: 'nunito', size: 40 }), offsetClosed);
    const small = estimateMinStroke(textToPaths(font, { text: 'l', font: 'nunito', size: 10 }), offsetClosed);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0.3);
    expect(big).toBeLessThan(10);
    // a 20 mm sans-serif has strokes around 1.5–3 mm, not the width of a letter
    const word = estimateMinStroke(textToPaths(font, { text: 'Makerspace', font: 'nunito', size: 20 }), offsetClosed);
    expect(word).toBeGreaterThan(0.5); expect(word).toBeLessThan(4);
  });
});

describe('single-stroke engraving font', () => {
  it('lays out separate open centre lines for letters, digits and punctuation', () => {
    const paths = strokeTextToPaths({ text: 'Ab 2!\nÖz', font: 'single-stroke', size: 20, align: 'center' });
    expect(paths.length).toBeGreaterThan(7);
    expect(paths.every((p) => !p.closed && p.segs.length > 0 && p.segs.every((s) => s.k === 'L'))).toBe(true);
    expect(Math.min(...paths.map((p) => bbox(p).minY))).toBeLessThan(-20);
    expect(strokeTextToPaths({ text: 'A', font: 'single-stroke', size: 40 }).map(bbox)[0].maxY).toBe(28);
  });

  it('runs the tool on an open stroke at the chosen depth', () => {
    const path = strokeTextToPaths({ text: 'I', font: 'single-stroke', size: 20 })[1];
    const tool = newTool({ d: 2 });
    const op = newOperation('engrave', tool.id, tool, 1, 1);
    if (op.type !== 'engrave') throw new Error('Expected engraving');
    op.side = 'on';
    const plan = contourMoves(path, op, { tool, safeZ: 10, clearZ: 0.5, vf: 500, vfPlunge: 100, zTop: 0, thickness: 12 });
    expect(plan.toolPaths).toHaveLength(1);
    expect(plan.toolPaths[0].start).toEqual(path.start);
    expect(plan.toolPaths[0].closed).toBe(false);
    expect(plan.moves.some((m) => m.k === 'line' && m.z === -1)).toBe(true);
  });
});
