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

export function toolLabel(t: ToolPreset): string {
  const bits = [t.d && `Ø${t.d} mm`, t.z && `${t.z} fl.`].filter(Boolean).join(', ');
  return bits ? `${t.name} (${bits})` : t.name;
}

export function spindleLabel(s: SpindlePreset): string {
  return s.nMax ? `${s.name} (max ${s.nMax} RPM)` : s.name;
}
