export type VarKey = 'n' | 'vc' | 'd' | 'z' | 'fz' | 'vf';

export interface VarDef {
  key: VarKey;
  symbol: string;
  name: string;
  unit: string;
  description: string;
}

export const VARS: VarDef[] = [
  {
    key: 'vc',
    symbol: 'vc',
    name: 'Cutting speed',
    unit: 'm/min',
    description:
      'Schnittgeschwindigkeit. Surface speed of the cutting edge relative to the workpiece. Depends on the tool and workpiece material (e.g. aluminium with carbide ≈ 200–500 m/min).',
  },
  {
    key: 'd',
    symbol: 'd',
    name: 'Tool diameter',
    unit: 'mm',
    description: 'Fräserdurchmesser. Cutting diameter of the milling bit.',
  },
  {
    key: 'n',
    symbol: 'n',
    name: 'Spindle speed',
    unit: 'RPM (1/min)',
    description:
      'Drehzahl. Revolutions of the spindle per minute. n = (vc · 1000) / (π · d). Capped at the spindle maximum.',
  },
  {
    key: 'z',
    symbol: 'z',
    name: 'Number of flutes',
    unit: '',
    description: 'Zähnezahl / Schneidenanzahl. Number of cutting edges on the tool.',
  },
  {
    key: 'fz',
    symbol: 'fz',
    name: 'Feed per tooth',
    unit: 'mm/tooth',
    description:
      'Zahnvorschub. Distance the tool advances per cutting edge and revolution — the chip thickness each flute takes.',
  },
  {
    key: 'vf',
    symbol: 'vf',
    name: 'Feed rate',
    unit: 'mm/min',
    description:
      'Vorschubgeschwindigkeit. Linear travel of the tool through the material. vf = n · z · fz. This is the F value for the CNC program.',
  },
];

export type Inputs = Record<VarKey, string> & { nMax: string };

export interface SolvedVar {
  value: number | null;
  source: 'input' | 'computed' | 'missing';
}

export interface Solution {
  vars: Record<VarKey, SolvedVar>;
  /** RPM the geometry asks for before the spindle cap */
  nUncapped: number | null;
  capped: boolean;
  /** Effective cutting speed actually reached after capping n */
  vcEffective: number | null;
  messages: string[];
}

function parse(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function solve(inputs: Inputs): Solution {
  const val: Partial<Record<VarKey, number>> = {};
  const src: Partial<Record<VarKey, 'input' | 'computed'>> = {};
  const messages: string[] = [];

  for (const v of VARS) {
    const p = parse(inputs[v.key]);
    if (p !== null) {
      val[v.key] = p;
      src[v.key] = 'input';
    }
  }
  const nMax = parse(inputs.nMax);

  const set = (k: VarKey, x: number) => {
    if (val[k] === undefined && Number.isFinite(x) && x > 0) {
      val[k] = x;
      src[k] = 'computed';
      return true;
    }
    return false;
  };

  // Iterate the two relations until nothing new can be derived.
  let changed = true;
  while (changed) {
    changed = false;
    const { n, vc, d, z, fz, vf } = val;
    // n = vc*1000 / (pi*d)
    if (vc !== undefined && d !== undefined) changed = set('n', (vc * 1000) / (Math.PI * d)) || changed;
    if (n !== undefined && d !== undefined) changed = set('vc', (n * Math.PI * d) / 1000) || changed;
    if (n !== undefined && vc !== undefined) changed = set('d', (vc * 1000) / (Math.PI * n)) || changed;
    // vf = n*z*fz
    if (n !== undefined && z !== undefined && fz !== undefined) changed = set('vf', n * z * fz) || changed;
    if (vf !== undefined && z !== undefined && fz !== undefined) changed = set('n', vf / (z * fz)) || changed;
    if (vf !== undefined && n !== undefined && fz !== undefined) changed = set('z', vf / (n * fz)) || changed;
    if (vf !== undefined && n !== undefined && z !== undefined) changed = set('fz', vf / (n * z)) || changed;
  }

  // Consistency check when the user over-specified a relation.
  if (val.n !== undefined && val.vc !== undefined && val.d !== undefined && src.n === 'input' && src.vc === 'input' && src.d === 'input') {
    const nFromVc = (val.vc * 1000) / (Math.PI * val.d);
    if (Math.abs(nFromVc - val.n) / val.n > 0.01) {
      messages.push(`n, vc and d are all given but inconsistent: vc and d imply n ≈ ${fmt(nFromVc)} RPM.`);
    }
  }
  if (val.vf !== undefined && val.n !== undefined && val.z !== undefined && val.fz !== undefined && src.vf === 'input' && src.n === 'input' && src.z === 'input' && src.fz === 'input') {
    const vfCalc = val.n * val.z * val.fz;
    if (Math.abs(vfCalc - val.vf) / val.vf > 0.01) {
      messages.push(`vf, n, z and fz are all given but inconsistent: n · z · fz = ${fmt(vfCalc)} mm/min.`);
    }
  }

  // Spindle cap: use the minimum of calculated n and the spindle maximum,
  // then recompute the values that depend on n.
  const nUncapped = val.n ?? null;
  let capped = false;
  if (val.n !== undefined && nMax !== null && val.n > nMax) {
    capped = true;
    val.n = nMax;
    src.n = 'computed';
    if (val.z !== undefined && val.fz !== undefined) {
      val.vf = val.n * val.z * val.fz;
      src.vf = 'computed';
    }
    messages.push(
      `Required spindle speed ${fmt(nUncapped!)} RPM exceeds the spindle maximum of ${fmt(nMax)} RPM. Using ${fmt(nMax)} RPM; feed rate recalculated from the capped speed.`,
    );
  }

  const vcEffective = val.n !== undefined && val.d !== undefined ? (val.n * Math.PI * val.d) / 1000 : null;

  const vars = {} as Record<VarKey, SolvedVar>;
  for (const v of VARS) {
    vars[v.key] = val[v.key] !== undefined ? { value: val[v.key]!, source: src[v.key]! } : { value: null, source: 'missing' };
  }
  return { vars, nUncapped, capped, vcEffective, messages };
}

export function fmt(x: number | null | undefined, digits = 3): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  if (Number.isInteger(x)) return x.toString();
  const abs = Math.abs(x);
  if (abs >= 1000) return x.toFixed(0);
  if (abs >= 100) return x.toFixed(1);
  if (abs >= 10) return x.toFixed(2);
  return x.toFixed(digits);
}
