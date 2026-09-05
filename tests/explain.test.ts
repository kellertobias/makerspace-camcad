import { describe, it, expect } from 'vitest';
import { explainGcode, parseLine } from '@/lib/gcode/explain';
import { estlcamHolz } from '@/lib/post/profiles/estlcam-holz';
import { grblLaser } from '@/lib/post/profiles/grbl';
import { newMachine } from '@/lib/model/defaults';

const machine = newMachine({ id: 'm1', name: 'Holz', postId: 'estlcam-holz', nMax: 24000, nMin: 8000, feedMax: { xy: 2500, z: 1000 }, rapid: { xy: 6000, z: 3000 }, travel: { x: 800, y: 600, z: 120 }, toolChange: 'manual' });
const ctx = { profile: estlcamHolz, machine, lang: 'en' as const };

describe('parseLine', () => {
  it('splits words and comments', () => {
    const r = parseLine('N10 G01 X12.5 Y-3 F2500 (cut)');
    expect(r.words.map((w) => w.letter)).toEqual(['N', 'G', 'X', 'Y', 'F']);
    expect(r.words[2].value).toBe(12.5);
    expect(r.words[3].value).toBe(-3);
    expect(r.comment).toBe('cut');
  });
  it('reads comma decimals when the profile uses them', () => {
    expect(parseLine('X12,5', ',').words[0].value).toBe(12.5);
  });
});

describe('explainGcode', () => {
  it('describes rapids, cuts and arcs with distance and duration', () => {
    const r = explainGcode(['G21 G90', 'M03 S18000', 'G00 X0 Y0 Z5', 'G01 Z-2 F300', 'G01 X100 F2000', 'G02 X110 Y10 I0 J10', 'M05'].join('\n'), ctx);
    expect(r.lines[0].title).toContain('millimetres');
    expect(r.lines[1].title).toContain('Spindle on');
    expect(r.lines[2].title).toContain('Rapid move');
    expect(r.lines[2].details.join(' ')).toContain('3000 mm/min'); // Z-only rapid uses the machine's Z rapid rate
    expect(r.lines[3].details.join(' ')).toContain('plunging');
    const cut = r.lines[4];
    expect(cut.title).toContain('X100');
    expect(cut.details.join(' ')).toContain('path length 100 mm');
    expect(cut.seconds).toBeCloseTo(3, 1); // 100 mm at 2000 mm/min
    expect(r.lines[5].details.join(' ')).toContain('radius 10 mm');
    expect(r.warnings).toBe(0);
  });

  it('flags feed, speed, travel and spindle problems for this machine', () => {
    const r = explainGcode(['M03 S30000', 'G01 X10 F9000', 'G00 X900', 'G01 Y10'].join('\n'), { ...ctx, machine });
    expect(r.lines[0].warnings.join(' ')).toContain('above the machine maximum of 24000');
    expect(r.lines[1].warnings.join(' ')).toContain('above the machine maximum of 2500');
    expect(r.lines[2].warnings.join(' ')).toContain('outside the machine travel');
    const feedOnly = explainGcode(['M3 S18000', 'F9000'].join('\n'), ctx);
    expect(feedOnly.lines[1].warnings.join(' ')).toContain('above the machine maximum of 2500');
    const noSpindle = explainGcode('G01 X10 F500', ctx);
    expect(noSpindle.lines[0].warnings.join(' ')).toContain('not been switched on');
  });

  it('warns when an arc end point is off the circle', () => {
    const r = explainGcode(['M03 S18000', 'G01 F1000', 'G02 X20 Y0 I5 J0'].join('\n'), ctx);
    expect(r.lines[2].warnings.join(' ')).toContain('off the circle');
  });

  it('treats S as laser power on a laser machine', () => {
    const laser = newMachine({ id: 'm2', name: 'Laser', kind: 'laser', postId: 'grbl-laser', laser: { sMax: 1000, dynamic: true } });
    const r = explainGcode('M4 S1200', { profile: grblLaser, machine: laser, lang: 'en' });
    expect(r.lines[0].details.join(' ')).toContain('Laser power');
    expect(r.lines[0].warnings.join(' ')).toContain('maximum laser power');
  });

  it('explains incremental mode and manual tool changes in German too', () => {
    const r = explainGcode(['G91', 'T2 M06', 'G01 X10 F500'].join('\n'), { ...ctx, lang: 'de' });
    expect(r.lines[0].title).toContain('Kettenmaße');
    expect(r.lines[1].details.join(' ')).toContain('keinen Werkzeugwechsler');
    expect(r.lines[2].title).toContain('X10');
  });

  it('handles comments, empty lines and unknown codes', () => {
    const r = explainGcode(['(hello)', '', 'G12345 X1'].join('\n'), ctx);
    expect(r.lines[0].kind).toBe('comment');
    expect(r.lines[1].kind).toBe('empty');
    expect(r.lines[2].details.join(' ')).toContain('Not interpreted');
  });
});
