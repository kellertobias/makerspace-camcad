import { describe, expect, it } from 'vitest';
import { compareGcode, normalizeGcode } from '@/lib/gcode/compare';

describe('G-code comparison', () => {
  it('ignores comments, blank lines, whitespace, case, BOM, and insignificant numeric zeroes', () => {
    const expected = '\uFEFF(Project from CAM)\r\nG01 X10.0000 Y-0.000 F0250.00 ; move\r\nM03 S24000\r\n';
    const actual = '(our header)\n g1x10 y0 f250 (same move)\nm3 s24000.000\n';
    expect(compareGcode(actual, expected).equal).toBe(true);
  });

  it('does not erase zero-valued coordinates or reorder commands', () => {
    expect(compareGcode('G1 X0 Y2\n', 'G1 Y2\n').equal).toBe(false);
    expect(compareGcode('G1 X1\nG1 X2\n', 'G1 X2\nG1 X1\n').equal).toBe(false);
  });

  it('can ignore line numbers when explicitly configured', () => {
    expect(compareGcode('G1 X1\n', 'N0010 G01 X1.0\n', { ignoreLineNumbers: true }).equal).toBe(true);
    expect(compareGcode('G1 X1\n', 'N0010 G01 X1.0\n').equal).toBe(false);
  });

  it('keeps original line numbers for useful failure output', () => {
    expect(normalizeGcode('(comment)\n\nG01 X1.000\n')[0]).toEqual({ line: 3, source: 'G01 X1.000', normalized: 'G1X1' });
  });
});
