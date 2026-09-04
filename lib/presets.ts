export interface ToolPreset {
  id: string;
  name: string;
  d: string;
  z: string;
  vc: string;
  fz: string;
}

export interface SpindlePreset {
  id: string;
  name: string;
  nMax: string;
  nMin?: string;
  vfMax?: string;
  /** Free-text machine facts shown under the preset (not used in calculations). */
  info?: string;
}

/** Machines that are available on first load. Seeded once; the user can edit or delete them. */
export const DEFAULT_SPINDLES: SpindlePreset[] = [
  {
    id: 'default-makerspace-holz-cnc',
    name: 'Makerspace Holz CNC',
    nMax: '24000',
    nMin: '3000',
    vfMax: '2500',
    info: '3 axes · 2.2 kW water-cooled spindle · rapid XY 3000 mm/min, Z 1000 mm/min · milling feed XY 2500 mm/min, Z 1000 mm/min · chip extraction',
  },
  {
    id: 'default-makerspace-ima-bima-cnc',
    name: 'Makerspace IMA BIMA CNC',
    nMax: '18000',
    nMin: '1500',
    vfMax: '55000',
    info: '4 axes · 7.5 kW water-cooled main spindle · travel X 3160 / Y 1380 / Z 440 mm · working area X 2800 / Y 800 (1000 restricted) mm · max workpiece thickness 60 mm, clamp height 80 mm · max tool Ø 150 mm, 5 kg · feed X/Y 55000, Z 25000 mm/min · accel 4500 (X/Y) / 2500 (Z) mm/s² · accuracy ±0.25 mm (usually ±0.1; horizontal ±0.8 since crash 2026-07-05) · vacuum clamping, 130 × 130 mm pods · ~5100 kg · 19 kVA',
  },
];

const SEEDED_KEY = 'cnc-milling-calc:spindles-seeded';

/** Add the default machines the first time the app runs. Deleting them afterwards is respected. */
export function seedSpindles(): SpindlePreset[] {
  const list = read<SpindlePreset>(SPINDLES_KEY);
  let seeded = false;
  try { seeded = window.localStorage.getItem(SEEDED_KEY) === '1'; } catch {}
  if (seeded) return list;
  const next = [...DEFAULT_SPINDLES.filter((d) => !list.some((s) => s.id === d.id)), ...list];
  write(SPINDLES_KEY, next);
  try { window.localStorage.setItem(SEEDED_KEY, '1'); } catch {}
  return next;
}

const TOOLS_KEY = 'cnc-milling-calc:tools';
const SPINDLES_KEY = 'cnc-milling-calc:spindles';

function read<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, list: T[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

export const loadTools = () => read<ToolPreset>(TOOLS_KEY);
export const saveTools = (list: ToolPreset[]) => write(TOOLS_KEY, list);
export const loadSpindles = () => read<SpindlePreset>(SPINDLES_KEY);
export const saveSpindles = (list: SpindlePreset[]) => write(SPINDLES_KEY, list);

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function toolLabel(t: ToolPreset, flutesAbbr = 'fl.'): string {
  const bits = [t.d && `Ø${t.d} mm`, t.z && `${t.z} ${flutesAbbr}`].filter(Boolean).join(', ');
  return bits ? `${t.name} (${bits})` : t.name;
}

export function spindleLabel(s: SpindlePreset, rpm = 'RPM'): string {
  return s.nMax ? `${s.name} (max ${s.nMax} ${rpm})` : s.name;
}
