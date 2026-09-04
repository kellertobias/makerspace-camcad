export type VarKey = 'n' | 'vc' | 'd' | 'z' | 'fz' | 'vf';

export interface VarDef {
  key: VarKey;
  symbol: string;
  /** Other symbols used for the same quantity, e.g. G-code words. */
  aliases?: string[];
  name: { de: string; en: string };
  unit: string;
  description: { de: string; en: string };
}

export const VARS: VarDef[] = [
  {
    key: 'd',
    symbol: 'd',
    name: { de: 'Fräserdurchmesser', en: 'Tool diameter' },
    unit: 'mm',
    description: {
      en: 'Cutting diameter of the milling bit.',
      de: 'Schneidender Durchmesser des Fräsers.',
    },
  },
  {
    key: 'z',
    symbol: 'z',
    name: { de: 'Zähnezahl', en: 'Number of flutes' },
    unit: '',
    description: {
      en: 'Number of cutting edges (flutes) on the tool.',
      de: 'Anzahl der Schneiden des Fräsers.',
    },
  },
  {
    key: 'vc',
    symbol: 'vc',
    name: { de: 'Schnittgeschwindigkeit', en: 'Cutting speed' },
    unit: 'm/min',
    description: {
      en: 'Surface speed of the cutting edge relative to the workpiece. Depends on tool and workpiece material (e.g. aluminium with carbide ≈ 200–500 m/min).',
      de: 'Geschwindigkeit der Schneide gegenüber dem Werkstück. Abhängig von Werkzeug- und Werkstückmaterial (z. B. Aluminium mit Hartmetall ≈ 200–500 m/min).',
    },
  },
  {
    key: 'fz',
    symbol: 'fz',
    name: { de: 'Zahnvorschub', en: 'Feed per tooth' },
    unit: 'mm/tooth',
    description: {
      en: 'Distance the tool advances per cutting edge and revolution — the chip thickness each flute takes.',
      de: 'Weg, den das Werkzeug pro Schneide und Umdrehung vorrückt – die Spandicke, die jede Schneide abnimmt.',
    },
  },
  {
    key: 'n',
    symbol: 'n',
    aliases: ['S'],
    name: { de: 'Drehzahl', en: 'Spindle speed' },
    unit: 'RPM (1/min)',
    description: {
      en: 'Revolutions of the spindle per minute; the S word in G-code. n = (vc · 1000) / (π · d). Capped at the spindle maximum.',
      de: 'Umdrehungen der Spindel pro Minute; im G-Code das S-Wort. n = (vc · 1000) / (π · d). Begrenzt auf die maximale Spindeldrehzahl.',
    },
  },
  {
    key: 'vf',
    symbol: 'vf',
    aliases: ['Fxy'],
    name: { de: 'Vorschubgeschwindigkeit', en: 'Feed rate' },
    unit: 'mm/min',
    description: {
      en: 'Linear travel of the tool through the material in XY. vf = n · z · fz. This is the F word (Fxy) in the CNC program.',
      de: 'Lineare Bewegung des Werkzeugs durch das Material in XY. vf = n · z · fz. Das ist das F-Wort (Fxy) im CNC-Programm.',
    },
  },
];

export type Inputs = Record<VarKey, string> & { nMax: string; nMin: string; vfMax: string };

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
  vfUncapped: number | null;
  vfCapped: boolean;
  messages: Message[];
}

export type Message =
  | { kind: 'inconsistent-n'; nFromVc: number }
  | { kind: 'inconsistent-vf'; vfCalc: number }
  | { kind: 'capped'; nUncapped: number; nMax: number }
  | { kind: 'below-min'; n: number; nMin: number }
  | { kind: 'vf-capped'; vfUncapped: number; vfMax: number };

function parse(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function solve(inputs: Inputs): Solution {
  const val: Partial<Record<VarKey, number>> = {};
  const src: Partial<Record<VarKey, 'input' | 'computed'>> = {};
  const messages: Message[] = [];

  for (const v of VARS) {
    const p = parse(inputs[v.key]);
    if (p !== null) {
      val[v.key] = p;
      src[v.key] = 'input';
    }
  }
  const nMax = parse(inputs.nMax);
  const nMin = parse(inputs.nMin);
  const vfMax = parse(inputs.vfMax);

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
      messages.push({ kind: 'inconsistent-n', nFromVc });
    }
  }
  if (val.vf !== undefined && val.n !== undefined && val.z !== undefined && val.fz !== undefined && src.vf === 'input' && src.n === 'input' && src.z === 'input' && src.fz === 'input') {
    const vfCalc = val.n * val.z * val.fz;
    if (Math.abs(vfCalc - val.vf) / val.vf > 0.01) {
      messages.push({ kind: 'inconsistent-vf', vfCalc });
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
    messages.push({ kind: 'capped', nUncapped: nUncapped!, nMax });
  }

  if (val.n !== undefined && nMin !== null && val.n < nMin) {
    messages.push({ kind: 'below-min', n: val.n, nMin });
  }

  // Machine feed limit: the machine cannot move faster than vfMax.
  const vfUncapped = val.vf ?? null;
  let vfCapped = false;
  if (val.vf !== undefined && vfMax !== null && val.vf > vfMax) {
    vfCapped = true;
    val.vf = vfMax;
    src.vf = 'computed';
    messages.push({ kind: 'vf-capped', vfUncapped: vfUncapped!, vfMax });
  }

  const vcEffective = val.n !== undefined && val.d !== undefined ? (val.n * Math.PI * val.d) / 1000 : null;

  const vars = {} as Record<VarKey, SolvedVar>;
  for (const v of VARS) {
    vars[v.key] = val[v.key] !== undefined ? { value: val[v.key]!, source: src[v.key]! } : { value: null, source: 'missing' };
  }
  return { vars, nUncapped, capped, vcEffective, vfUncapped, vfCapped, messages };
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
