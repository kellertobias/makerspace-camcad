import type { PostProfile, WordName, WordSpec } from './types';

const WORDS: WordName[] = ['X', 'Y', 'Z', 'I', 'J', 'F', 'S', 'N'];
const yes = (v: string | undefined, def = false) => (v === undefined ? def : v.trim().toUpperCase() === 'Y');

/** Parse an Estlcam post-processor (.pp) file. Multi-line values use `[>>>]` … `[<<<]` markers. */
export function parsePp(text: string, id: string, name?: string): PostProfile {
  const raw: Record<string, string> = {};
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++];
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1);
    if (val.trim() === '' && lines[i]?.trim() === '[>>>]') {
      i++;
      const block: string[] = [];
      while (i < lines.length && lines[i].trim() !== '[<<<]') block.push(lines[i++]);
      i++; // skip [<<<]
      val = block.join('\n');
    }
    raw[key] = val;
  }
  const word = (w: WordName): WordSpec => ({
    name: raw[`Name ${w}`] ?? (w === 'N' ? '' : w),
    format: raw[`Format ${w}`] ?? '',
    order: Number(raw[`Order ${w}`] ?? { X: 2, Y: 3, Z: 4, I: 5, J: 6, F: 7, S: 8, N: 1 }[w]),
    scale: Number(raw[`Scale ${w}`] ?? 1) || 1,
    enable: yes(raw[`Enable ${w}`], w !== 'N'),
    repeat: yes(raw[`Repeat ${w}`], w === 'I' || w === 'J'),
  });
  const words = Object.fromEntries(WORDS.map((w) => [w, word(w)])) as Record<WordName, WordSpec>;
  const delimiterRaw = raw['Delimiter'];
  return {
    id, name: name ?? id, exporter: 'gcode',
    lengthUnit: (raw['Length unit CNC'] ?? 'mm').toLowerCase().startsWith('in') ? 'inch' : 'mm',
    feedUnit: (raw['Feed unit CNC'] ?? 'mm_min') as PostProfile['feedUnit'],
    ext: (raw['File extension'] ?? 'nc').replace(/^\./, ''),
    useArcs: yes(raw['Use arcs'], true),
    ijRelative: yes(raw['I/J relative'], true),
    delimiter: delimiterRaw === undefined || delimiterRaw === '' ? ' ' : delimiterRaw,
    decimal: raw['Decimal point'] === ',' ? ',' : '.',
    commandRepeat: yes(raw['Command repeat'], true),
    cmds: { rapid: raw['Command rapid move'] ?? 'G00', linear: raw['Command linear move'] ?? 'G01', cw: raw['Command clockwise arc'] ?? 'G02', ccw: raw['Command counterclockwise arc'] ?? 'G03' },
    words,
    blocks: {
      programStart: raw['Program start'] ?? '', programEnd: raw['Program end'] ?? '', opStart: raw['Operation start'] ?? '', toolChange: raw['Tool change'] ?? '',
      mistOn: raw['Mist coolant on'] ?? '', mistOff: raw['Mist coolant off'] ?? '', floodOn: raw['Flood coolant on'] ?? '', floodOff: raw['Flood coolant off'] ?? '',
      laserOn: raw['Laser on'] ?? raw['Laser before down'] ?? '', laserOff: raw['Laser off'] ?? raw['Laser after up'] ?? '', dwell: raw['Dwell'] ?? '',
    },
    lineNumbers: { start: Number(raw['Initial value N'] ?? 1) || 1, step: Number(raw['Increment N'] ?? 1) || 1 },
    raw,
  };
}

/** Serialize a profile back to .pp text (Estlcam compatible for the fields we know). */
export function serializePp(p: PostProfile): string {
  const kv: [string, string][] = [];
  const set = (k: string, v: string) => kv.push([k, v]);
  const base: Record<string, string> = { ...(p.raw ?? {}) };
  base['Version'] ??= '12152';
  base['Length unit CNC'] = p.lengthUnit;
  base['Feed unit CNC'] = p.feedUnit;
  base['File extension'] = p.ext;
  base['Use arcs'] = p.useArcs ? 'Y' : 'N';
  base['I/J relative'] = p.ijRelative ? 'Y' : 'N';
  base['Program start'] = p.blocks.programStart; base['Program end'] = p.blocks.programEnd; base['Operation start'] = p.blocks.opStart; base['Tool change'] = p.blocks.toolChange;
  base['Mist coolant on'] = p.blocks.mistOn; base['Mist coolant off'] = p.blocks.mistOff; base['Flood coolant on'] = p.blocks.floodOn; base['Flood coolant off'] = p.blocks.floodOff;
  for (const w of WORDS) { const s = p.words[w]; base[`Name ${w}`] = s.name; base[`Format ${w}`] = s.format; base[`Order ${w}`] = String(s.order); base[`Scale ${w}`] = String(s.scale); base[`Enable ${w}`] = s.enable ? 'Y' : 'N'; base[`Repeat ${w}`] = s.repeat ? 'Y' : 'N'; }
  base['Initial value N'] = String(p.lineNumbers.start);
  base['Command rapid move'] = p.cmds.rapid; base['Command linear move'] = p.cmds.linear; base['Command clockwise arc'] = p.cmds.cw; base['Command counterclockwise arc'] = p.cmds.ccw;
  base['Command repeat'] = p.commandRepeat ? 'Y' : 'N';
  base['Delimiter'] = p.delimiter; base['Decimal point'] = p.decimal;
  for (const [k, v] of Object.entries(base)) set(k, v);
  return kv.map(([k, v]) => (v.includes('\n') ? `${k}=\n[>>>]\n${v}\n[<<<]` : `${k}=${v}`)).join('\n') + '\n';
}
