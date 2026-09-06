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
];

const SEEDED_KEY = 'cnc-milling-calc:spindles-seeded';
const IMA_REMOVED_KEY = 'cnc-milling-calc:spindles-ima-removed';

/** The IMA BIMA is no longer supported: drop it once from machine lists seeded by earlier versions. */
function dropIma(list: SpindlePreset[]): SpindlePreset[] {
  try {
    if (window.localStorage.getItem(IMA_REMOVED_KEY) === '1') return list;
    const next = list.filter((s) => s.id !== 'default-makerspace-ima-bima-cnc');
    if (next.length !== list.length) write(SPINDLES_KEY, next);
    window.localStorage.setItem(IMA_REMOVED_KEY, '1');
    return next;
  } catch { return list; }
}

/** Add the default machines the first time the app runs. Deleting them afterwards is respected. */
export function seedSpindles(): SpindlePreset[] {
  const list = dropIma(read<SpindlePreset>(SPINDLES_KEY));
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
export const loadSpindles = () => dropIma(read<SpindlePreset>(SPINDLES_KEY));
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
