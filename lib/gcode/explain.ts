import type { Lang } from '@/lib/i18n';
import type { Machine } from '@/lib/model/project';
import type { PostProfile, WordName } from '@/lib/post/types';
import { arcSweep } from '@/lib/geometry/arcs';

/** One parsed word of a block, e.g. `X12.5` => { letter: 'X', value: 12.5 }. */
export interface GWord { letter: string; value: number; text: string }

export type LineKind = 'motion' | 'modal' | 'spindle' | 'tool' | 'coolant' | 'program' | 'comment' | 'empty' | 'unknown';

export interface ExplainedLine {
  /** 1-based line number in the file. */
  i: number;
  text: string;
  kind: LineKind;
  /** One-sentence summary of what the machine does. */
  title: string;
  /** Extra facts: resulting position, feed conversion, distance, duration, … */
  details: string[];
  /** Machine-specific problems (limits, missing state, geometry). */
  warnings: string[];
  /** Position after the line (mm, work coordinates). */
  pos: { x: number; y: number; z: number };
  /** Estimated execution time of this line in seconds. */
  seconds: number;
}

export interface ExplainResult { lines: ExplainedLine[]; seconds: number; warnings: number }

/** Number for display: `d` decimals with trailing zeros trimmed. */
const MM = (v: number, d = 3) => {
  let s = v.toFixed(d);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};

// --- texts -----------------------------------------------------------------
// The explainer is used in both UI languages, so every sentence exists twice.
type Txt = typeof TXT.en;
const TXT = {
  en: {
    rapid: 'Rapid move (no cutting) to', linear: 'Straight cut to', arcCw: 'Clockwise arc to', arcCcw: 'Counter-clockwise arc to',
    stay: 'no movement (already there)', from: 'from', dist: (d: string) => `path length ${d} mm`, at: (f: string) => `at ${f} mm/min`,
    rapidSpeed: (f: string) => `machine rapid ${f} mm/min`, dur: (s: string) => `≈ ${s}`,
    posAfter: (p: string) => `position afterwards ${p}`, plunge: 'plunging move (Z downwards) — uses the plunge feed',
    radius: (r: string) => `radius ${r} mm`, centre: (c: string) => `centre ${c}`, sweep: (a: string) => `sweep ${a}°`,
    ijRel: 'I/J are relative to the arc start point', ijAbs: 'I/J are absolute centre coordinates',
    feedSet: (f: string, u: string) => `Feed set to ${f} ${u}`, spindleSet: (s: string) => `Spindle speed set to ${s} rpm`,
    powerSet: (s: string) => `Laser power set to S${s}`,
    unknown: 'Not interpreted — this code is not known to the explainer', comment: 'Comment — ignored by the controller',
    empty: 'Empty line', noFeed: 'No feed (F) has been set yet — the controller either refuses the line or uses its last value.',
    noSpindle: 'The spindle has not been switched on (M3/M4) — this line would cut with a standing tool.',
    feedOver: (f: string, m: string) => `Feed ${f} mm/min is above the machine maximum of ${m} mm/min — it will be clamped.`,
    rpmOver: (s: string, m: string) => `S${s} is above the machine maximum of ${m} rpm.`,
    rpmUnder: (s: string, m: string) => `S${s} is below the machine minimum of ${m} rpm — the spindle may stall.`,
    powerOver: (s: string, m: string) => `S${s} is above the maximum laser power of ${m}.`,
    travel: (a: string, v: string, m: string) => `${a}${v} is outside the machine travel (${a} 0…${m} mm), assuming the work zero sits at the machine origin.`,
    arcBad: (a: string, b: string) => `The arc end point is ${b} mm off the circle around the given centre (start radius ${a} mm) — most controllers abort with a radius error.`,
    planeNote: 'The active plane is not G17 (XY); the radius shown is computed for the XY plane.',
    noArcs: 'The post-processor for this machine writes arcs as short straight lines — check that the controller really understands G2/G3.',
    zDisabled: 'This machine profile has no Z word — a Z move will not be understood.',
    inchNote: 'Inch mode is active, values are converted to mm for this explanation.',
    manualTc: 'This machine has no tool changer — the program stops and you swap the tool by hand.',
    autoTc: 'The machine changes the tool automatically.',
    compNote: 'Cutter radius compensation is done in the CAM here; most hobby controllers do not support G41/G42.',
    laserSpindle: 'On a laser machine M3/M4 switches the beam on.',
    dwellSec: (s: string) => `Waits ${s} s (P is read as seconds by Estlcam/GRBL; some controllers read milliseconds).`,
    unit: { mm_min: 'mm/min', mm_s: 'mm/s', inch_min: 'inch/min' } as Record<string, string>,
  },
  de: {
    rapid: 'Eilgang (schneidet nicht) nach', linear: 'Gerade Fräsbewegung nach', arcCw: 'Kreisbogen im Uhrzeigersinn nach', arcCcw: 'Kreisbogen gegen den Uhrzeigersinn nach',
    stay: 'keine Bewegung (Position schon erreicht)', from: 'von', dist: (d: string) => `Weglänge ${d} mm`, at: (f: string) => `mit ${f} mm/min`,
    rapidSpeed: (f: string) => `Eilgang der Maschine ${f} mm/min`, dur: (s: string) => `≈ ${s}`,
    posAfter: (p: string) => `Position danach ${p}`, plunge: 'Eintauchbewegung (Z nach unten) — mit Eintauchvorschub',
    radius: (r: string) => `Radius ${r} mm`, centre: (c: string) => `Mittelpunkt ${c}`, sweep: (a: string) => `Bogenwinkel ${a}°`,
    ijRel: 'I/J sind relativ zum Bogenstartpunkt', ijAbs: 'I/J sind absolute Mittelpunktskoordinaten',
    feedSet: (f: string, u: string) => `Vorschub auf ${f} ${u} gesetzt`, spindleSet: (s: string) => `Drehzahl auf ${s} min⁻¹ gesetzt`,
    powerSet: (s: string) => `Laserleistung auf S${s} gesetzt`,
    unknown: 'Nicht interpretiert — dieser Code ist der Erklärung nicht bekannt', comment: 'Kommentar — von der Steuerung ignoriert',
    empty: 'Leerzeile', noFeed: 'Es wurde noch kein Vorschub (F) gesetzt — die Steuerung verweigert die Zeile oder nutzt den letzten Wert.',
    noSpindle: 'Die Spindel wurde nicht eingeschaltet (M3/M4) — hier würde mit stehendem Werkzeug gefräst.',
    feedOver: (f: string, m: string) => `Vorschub ${f} mm/min liegt über dem Maschinenmaximum von ${m} mm/min — er wird begrenzt.`,
    rpmOver: (s: string, m: string) => `S${s} liegt über der Maximaldrehzahl der Maschine (${m} min⁻¹).`,
    rpmUnder: (s: string, m: string) => `S${s} liegt unter der Mindestdrehzahl der Maschine (${m} min⁻¹) — die Spindel kann stehen bleiben.`,
    powerOver: (s: string, m: string) => `S${s} liegt über der maximalen Laserleistung (${m}).`,
    travel: (a: string, v: string, m: string) => `${a}${v} liegt außerhalb des Verfahrwegs (${a} 0…${m} mm), sofern der Werkstücknullpunkt im Maschinennullpunkt liegt.`,
    arcBad: (a: string, b: string) => `Der Bogenendpunkt liegt ${b} mm neben dem Kreis um den angegebenen Mittelpunkt (Startradius ${a} mm) — die meisten Steuerungen brechen mit Radiusfehler ab.`,
    planeNote: 'Die aktive Ebene ist nicht G17 (XY); der Radius wird für die XY-Ebene berechnet.',
    noArcs: 'Der Postprozessor dieser Maschine schreibt Bögen als kurze Geraden — prüfen, ob die Steuerung G2/G3 wirklich versteht.',
    zDisabled: 'Dieses Maschinenprofil kennt kein Z-Wort — eine Z-Bewegung wird nicht verstanden.',
    inchNote: 'Zoll-Modus aktiv, die Werte sind für diese Erklärung in mm umgerechnet.',
    manualTc: 'Diese Maschine hat keinen Werkzeugwechsler — das Programm hält an und du wechselst von Hand.',
    autoTc: 'Die Maschine wechselt das Werkzeug automatisch.',
    compNote: 'Die Fräserradiuskorrektur macht hier das CAM; die meisten Hobby-Steuerungen können G41/G42 nicht.',
    laserSpindle: 'Bei einer Lasermaschine schaltet M3/M4 den Strahl ein.',
    dwellSec: (s: string) => `Wartet ${s} s (P wird von Estlcam/GRBL als Sekunden gelesen, manche Steuerungen als Millisekunden).`,
    unit: { mm_min: 'mm/min', mm_s: 'mm/s', inch_min: 'inch/min' } as Record<string, string>,
  },
};

/** Static descriptions of the non-motion codes, `de` first line / `en` second. */
const CODES: Record<string, { de: string; en: string }> = {
  G17: { de: 'Arbeitsebene XY (Standard beim Fräsen)', en: 'Working plane XY (the normal milling plane)' },
  G18: { de: 'Arbeitsebene XZ', en: 'Working plane XZ' },
  G19: { de: 'Arbeitsebene YZ', en: 'Working plane YZ' },
  G20: { de: 'Alle Maße in Zoll', en: 'All coordinates in inches' },
  G21: { de: 'Alle Maße in Millimeter', en: 'All coordinates in millimetres' },
  G28: { de: 'Fahrt auf die Referenzposition der Maschine', en: 'Move to the machine reference position' },
  G30: { de: 'Fahrt auf die zweite Referenzposition', en: 'Move to the second reference position' },
  G40: { de: 'Fräserradiuskorrektur aus', en: 'Cutter radius compensation off' },
  G41: { de: 'Fräserradiuskorrektur links der Bahn', en: 'Cutter radius compensation, left of the path' },
  G42: { de: 'Fräserradiuskorrektur rechts der Bahn', en: 'Cutter radius compensation, right of the path' },
  G43: { de: 'Werkzeuglängenkorrektur ein', en: 'Tool length offset on' },
  G49: { de: 'Werkzeuglängenkorrektur aus', en: 'Tool length offset off' },
  G53: { de: 'Diese Zeile in Maschinenkoordinaten fahren', en: 'Move this line in machine coordinates' },
  G54: { de: 'Werkstücknullpunkt 1 (G54) aktiv', en: 'Work coordinate system 1 (G54) active' },
  G55: { de: 'Werkstücknullpunkt 2 (G55) aktiv', en: 'Work coordinate system 2 (G55) active' },
  G56: { de: 'Werkstücknullpunkt 3 (G56) aktiv', en: 'Work coordinate system 3 (G56) active' },
  G57: { de: 'Werkstücknullpunkt 4 (G57) aktiv', en: 'Work coordinate system 4 (G57) active' },
  G58: { de: 'Werkstücknullpunkt 5 (G58) aktiv', en: 'Work coordinate system 5 (G58) active' },
  G59: { de: 'Werkstücknullpunkt 6 (G59) aktiv', en: 'Work coordinate system 6 (G59) active' },
  G61: { de: 'Genauhalt: exakte Bahn, hält an jeder Ecke', en: 'Exact path mode: stops at every corner' },
  G64: { de: 'Bahnsteuerbetrieb: Ecken werden verschliffen', en: 'Continuous mode: corners are blended' },
  G80: { de: 'Bohrzyklus beenden', en: 'Cancel the drilling cycle' },
  G81: { de: 'Bohrzyklus: bohren, zurückziehen', en: 'Drilling cycle: drill, retract' },
  G82: { de: 'Bohrzyklus mit Verweilzeit am Grund', en: 'Drilling cycle with a dwell at the bottom' },
  G83: { de: 'Tieflochbohrzyklus (Späne brechen, ausfahren)', en: 'Peck drilling cycle (breaks chips, retracts)' },
  G90: { de: 'Absolutmaße: Koordinaten sind Zielpunkte', en: 'Absolute mode: coordinates are target points' },
  G91: { de: 'Kettenmaße: Koordinaten sind Wegstrecken', en: 'Incremental mode: coordinates are distances' },
  'G90.1': { de: 'I/J sind absolute Mittelpunktskoordinaten', en: 'I/J are absolute arc centre coordinates' },
  'G91.1': { de: 'I/J sind relativ zum Bogenstart', en: 'I/J are relative to the arc start' },
  G92: { de: 'Nullpunktverschiebung: aktuelle Position wird auf die angegebenen Werte gesetzt', en: 'Coordinate offset: the current position is set to the given values' },
  G93: { de: 'Vorschub als inverse Zeit (F = 1/Minuten je Satz)', en: 'Inverse time feed (F = 1/minutes per block)' },
  G94: { de: 'Vorschub in Einheiten pro Minute', en: 'Feed in units per minute' },
  G95: { de: 'Vorschub in Einheiten pro Umdrehung', en: 'Feed in units per revolution' },
  G98: { de: 'Bohrzyklus zieht auf die Ausgangshöhe zurück', en: 'Drilling cycle retracts to the initial height' },
  G99: { de: 'Bohrzyklus zieht auf die R-Ebene zurück', en: 'Drilling cycle retracts to the R plane' },
  M0: { de: 'Programm hält an, bis du am Bedienfeld fortsetzt', en: 'Program pauses until you continue at the control' },
  M1: { de: 'Wahlweiser Halt (nur wenn am Bedienfeld aktiviert)', en: 'Optional stop (only if enabled at the control)' },
  M2: { de: 'Programmende', en: 'End of program' },
  M3: { de: 'Spindel ein, Rechtslauf', en: 'Spindle on, clockwise' },
  M4: { de: 'Spindel ein, Linkslauf', en: 'Spindle on, counter-clockwise' },
  M5: { de: 'Spindel aus', en: 'Spindle off' },
  M6: { de: 'Werkzeugwechsel', en: 'Tool change' },
  M7: { de: 'Sprühnebelkühlung ein', en: 'Mist coolant on' },
  M8: { de: 'Kühlmittel ein', en: 'Flood coolant on' },
  M9: { de: 'Kühlung aus', en: 'Coolant off' },
  M10: { de: 'Kühlmittel/Absaugung ein (Profilbelegung)', en: 'Flood coolant / extraction on (profile specific)' },
  M11: { de: 'Kühlmittel/Absaugung aus (Profilbelegung)', en: 'Flood coolant / extraction off (profile specific)' },
  M30: { de: 'Programmende und Rücksprung zum Anfang', en: 'End of program and rewind' },
  M98: { de: 'Unterprogramm aufrufen', en: 'Call a subprogram' },
  M99: { de: 'Rücksprung aus dem Unterprogramm', en: 'Return from a subprogram' },
};

interface State {
  x: number; y: number; z: number; // mm, work coordinates
  f: number | null;                // mm/min
  s: number | null;
  motion: string;                  // modal motion command
  abs: boolean; inch: boolean; plane: 'G17' | 'G18' | 'G19';
  ijAbs: boolean; feedPerRev: boolean; spindleOn: boolean; tool: number | null;
}

export interface ExplainCtx { profile: PostProfile; machine: Machine; lang: Lang }

/** Split a block into words; `(…)` and `; …` are comments. */
export function parseLine(text: string, decimal: '.' | ',' = '.'): { words: GWord[]; comment: string } {
  let comment = '';
  const code = text
    .replace(/\([^)]*\)/g, (m) => { comment += (comment ? ' ' : '') + m.slice(1, -1); return ' '; })
    .replace(/;(.*)$/, (_m, c: string) => { comment += (comment ? ' ' : '') + c.trim(); return ' '; });
  const words: GWord[] = [];
  const re = /([A-Za-z])\s*([+-]?[\d.,]*\d)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const raw = m[2] ?? '';
    const num = decimal === ',' ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    words.push({ letter: m[1].toUpperCase(), value: raw === '' ? NaN : Number(num), text: m[0].trim() });
  }
  return { words, comment };
}

/** Letter written by the profile for each logical word, so renamed axes are understood too. */
function letterMap(profile: PostProfile): Record<string, { word: WordName; scale: number }> {
  const map: Record<string, { word: WordName; scale: number }> = {};
  for (const w of ['X', 'Y', 'Z', 'I', 'J', 'F', 'S', 'N'] as WordName[]) {
    const spec = profile.words[w];
    if (spec?.enable && spec.name) map[spec.name.toUpperCase()] = { word: w, scale: spec.scale || 1 };
  }
  for (const w of ['X', 'Y', 'Z', 'I', 'J', 'F', 'S', 'N'] as WordName[]) if (!map[w]) map[w] = { word: w, scale: 1 };
  return map;
}

const fmtSeconds = (s: number) => (s < 1 ? `${(s * 1000).toFixed(0)} ms` : s < 90 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} min`);
const pt = (x: number, y: number, z: number) => `X${MM(x)} Y${MM(y)} Z${MM(z)}`;

/** Feed value as written in the file, converted to mm/min for this profile. */
function feedToMmMin(f: number, profile: PostProfile, inch: boolean): number {
  if (profile.feedUnit === 'mm_s') return f * 60;
  if (profile.feedUnit === 'inch_min') return f * 25.4;
  return inch ? f * 25.4 : f;
}

/** Explain a whole G-code file line by line for one machine + post-processor profile. */
export function explainGcode(text: string, ctx: ExplainCtx): ExplainResult {
  const { profile, machine } = ctx;
  const T: Txt = TXT[ctx.lang] ?? TXT.en;
  const map = letterMap(profile);
  const st: State = {
    x: 0, y: 0, z: 0, f: null, s: null, motion: '', abs: true, inch: profile.lengthUnit === 'inch',
    plane: 'G17', ijAbs: !profile.ijRelative, feedPerRev: false, spindleOn: false, tool: null,
  };
  const laser = machine.kind === 'laser';
  const lines: ExplainedLine[] = [];
  let total = 0, warnCount = 0;

  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  rows.forEach((raw, idx) => {
    const line: ExplainedLine = { i: idx + 1, text: raw, kind: 'empty', title: '', details: [], warnings: [], pos: { x: st.x, y: st.y, z: st.z }, seconds: 0 };
    const { words, comment } = parseLine(raw, profile.decimal);
    const codeWords = words.filter((w) => !Number.isNaN(w.value));

    if (!raw.trim()) { line.title = T.empty; lines.push(line); return; }
    if (raw.trim() === '%') { line.kind = 'program'; line.title = ctx.lang === 'de' ? 'Programmbegrenzer (Bandanfang/-ende)' : 'Program delimiter (tape start/end)'; lines.push(line); return; }
    if (!codeWords.length) { line.kind = 'comment'; line.title = T.comment; if (comment) line.details.push(comment); lines.push(line); return; }

    // --- classify the words -------------------------------------------------
    const gs: string[] = [], ms: string[] = [];
    const axis: Partial<Record<WordName, number>> = {};
    let toolNo: number | null = null, pVal: number | null = null, rVal: number | null = null, qVal: number | null = null;
    const unknown: string[] = [];
    for (const w of codeWords) {
      const mapped = map[w.letter];
      if (w.letter === 'G') gs.push(`G${w.value % 1 ? w.value.toFixed(1) : w.value}`);
      else if (w.letter === 'M') ms.push(`M${w.value}`);
      else if (w.letter === 'T') toolNo = w.value;
      else if (w.letter === 'P') pVal = w.value;
      else if (w.letter === 'R') rVal = w.value;
      else if (w.letter === 'Q') qVal = w.value;
      else if (mapped) axis[mapped.word] = w.value / (mapped.scale || 1);
      else unknown.push(w.text);
    }
    const toMm = (v: number) => (st.inch ? v * 25.4 : v);

    for (const g of gs) {
      if (g === 'G20') st.inch = true; else if (g === 'G21') st.inch = false;
      else if (g === 'G90') st.abs = true; else if (g === 'G91') st.abs = false;
      else if (g === 'G90.1') st.ijAbs = true; else if (g === 'G91.1') st.ijAbs = false;
      else if (g === 'G17' || g === 'G18' || g === 'G19') st.plane = g;
      else if (g === 'G93' || g === 'G94') st.feedPerRev = false; else if (g === 'G95') st.feedPerRev = true;
    }

    // --- feed / speed words -------------------------------------------------
    if (axis.F !== undefined) {
      const mmMin = feedToMmMin(axis.F, profile, st.inch);
      st.f = st.feedPerRev ? mmMin * (st.s ?? 0) : mmMin;
      line.details.push(T.feedSet(MM(axis.F, 1), T.unit[profile.feedUnit] ?? 'mm/min') + (Math.abs(mmMin - axis.F) > 1e-6 ? ` = ${MM(mmMin, 1)} mm/min` : ''));
    }
    if (axis.S !== undefined) {
      st.s = axis.S;
      if (laser) {
        line.details.push(T.powerSet(MM(axis.S, 0)));
        if (machine.laser?.sMax && axis.S > machine.laser.sMax) line.warnings.push(T.powerOver(MM(axis.S, 0), MM(machine.laser.sMax, 0)));
      } else {
        line.details.push(T.spindleSet(MM(axis.S, 0)));
        if (axis.S > 0 && machine.nMax && axis.S > machine.nMax) line.warnings.push(T.rpmOver(MM(axis.S, 0), MM(machine.nMax, 0)));
        if (axis.S > 0 && machine.nMin && axis.S < machine.nMin) line.warnings.push(T.rpmUnder(MM(axis.S, 0), MM(machine.nMin, 0)));
      }
    }

    // --- motion -------------------------------------------------------------
    const motionG = gs.find((g) => ['G0', 'G00', 'G1', 'G01', 'G2', 'G02', 'G3', 'G03'].includes(g));
    const canon = motionG ? `G${Number(motionG.slice(1))}` : '';
    if (canon) st.motion = canon;
    const hasAxis = axis.X !== undefined || axis.Y !== undefined || axis.Z !== undefined;
    const moving = hasAxis && (canon || st.motion);
    const cmd = canon || st.motion;

    if (moving) {
      const x0 = st.x, y0 = st.y, z0 = st.z;
      const target = (v: number | undefined, cur: number) => (v === undefined ? cur : st.abs ? toMm(v) : cur + toMm(v));
      const x1 = target(axis.X, x0), y1 = target(axis.Y, y0), z1 = target(axis.Z, z0);
      line.kind = 'motion';
      const arc = cmd === 'G2' || cmd === 'G3';
      let dist = Math.hypot(x1 - x0, y1 - y0, z1 - z0);

      if (arc) {
        const i = axis.I !== undefined ? toMm(axis.I) : 0, j = axis.J !== undefined ? toMm(axis.J) : 0;
        const cx = st.ijAbs ? i : x0 + i, cy = st.ijAbs ? j : y0 + j;
        const r0 = Math.hypot(x0 - cx, y0 - cy), r1 = Math.hypot(x1 - cx, y1 - cy);
        const cw = cmd === 'G2';
        const sweep = arcSweep({ x: x0, y: y0 }, { x: x1, y: y1 }, { x: cx, y: cy }, cw);
        dist = Math.hypot(Math.abs(sweep) * r0, z1 - z0);
        line.title = `${cw ? T.arcCw : T.arcCcw} ${pt(x1, y1, z1)}`;
        line.details.push(T.radius(MM(r0)), T.centre(`X${MM(cx)} Y${MM(cy)}`), T.sweep(MM((Math.abs(sweep) * 180) / Math.PI, 1)), st.ijAbs ? T.ijAbs : T.ijRel);
        if (Math.abs(r1 - r0) > 0.01) line.warnings.push(T.arcBad(MM(r0), MM(Math.abs(r1 - r0))));
        if (st.plane !== 'G17') line.warnings.push(T.planeNote);
        if (!profile.useArcs) line.warnings.push(T.noArcs);
      } else {
        line.title = `${cmd === 'G0' ? T.rapid : T.linear} ${pt(x1, y1, z1)}`;
      }
      line.details.unshift(`${T.from} ${pt(x0, y0, z0)}`);
      line.details.push(T.dist(MM(dist, 2)));

      // speed: rapids run at the machine's rapid rate, cutting moves at the modal feed
      const zOnly = Math.abs(x1 - x0) < 1e-9 && Math.abs(y1 - y0) < 1e-9 && Math.abs(z1 - z0) > 1e-9;
      let speed = 0;
      if (cmd === 'G0') { speed = zOnly ? machine.rapid.z : machine.rapid.xy; if (speed) line.details.push(T.rapidSpeed(MM(speed, 0))); }
      else if (st.f) {
        speed = st.f; line.details.push(T.at(MM(st.f, 0)));
        // the feed only matters where it is used, so compare it against the axis limit of this very move
        const limit = zOnly ? machine.feedMax.z : machine.feedMax.xy;
        if (limit && st.f > limit + 1e-6) line.warnings.push(T.feedOver(MM(st.f, 0), MM(limit, 0)));
      }
      if (speed > 0 && dist > 0) { line.seconds = (dist / speed) * 60; line.details.push(T.dur(fmtSeconds(line.seconds))); total += line.seconds; }
      if (dist < 1e-9) line.details.push(T.stay);
      if (zOnly && z1 < z0 && cmd !== 'G0') line.details.push(T.plunge);

      if (cmd !== 'G0' && st.f === null) line.warnings.push(T.noFeed);
      if (cmd !== 'G0' && !st.spindleOn && !laser) line.warnings.push(T.noSpindle);
      if (axis.Z !== undefined && !profile.words.Z.enable) line.warnings.push(T.zDisabled);
      if (st.inch) line.details.push(T.inchNote);
      const ax: [string, number, number][] = [['X', x1, machine.travel.x], ['Y', y1, machine.travel.y], ['Z', z1, machine.travel.z]];
      for (const [name, v, lim] of ax) if (lim > 0 && (v > lim + 1e-6 || v < -lim - 1e-6)) line.warnings.push(T.travel(name, MM(v), MM(lim, 0)));

      st.x = x1; st.y = y1; st.z = z1;
    }

    // --- non-motion codes ---------------------------------------------------
    const titles: string[] = [];
    for (const g of gs) {
      if (['G0', 'G00', 'G1', 'G01', 'G2', 'G02', 'G3', 'G03'].includes(g)) continue;
      const canonical = g.includes('.') ? g : `G${Number(g.slice(1))}`;
      if (canonical === 'G4') { const sec = pVal ?? 0; titles.push(T.dwellSec(MM(sec, 2))); line.seconds += sec; total += sec; continue; }
      const d = CODES[canonical];
      if (d) titles.push(d[ctx.lang] ?? d.en); else unknown.push(g);
      if (canonical === 'G41' || canonical === 'G42') line.warnings.push(T.compNote);
    }
    for (const m of ms) {
      const canonical = `M${Number(m.slice(1))}`;
      const d = CODES[canonical];
      if (d) titles.push(d[ctx.lang] ?? d.en); else unknown.push(m);
      if (canonical === 'M3' || canonical === 'M4') { st.spindleOn = true; line.kind = 'spindle'; if (laser) line.details.push(T.laserSpindle); }
      if (canonical === 'M5') { st.spindleOn = false; line.kind = 'spindle'; }
      if (canonical === 'M6') { line.kind = 'tool'; line.details.push(machine.toolChange === 'auto' ? T.autoTc : T.manualTc); }
      if (canonical === 'M7' || canonical === 'M8' || canonical === 'M9') line.kind = 'coolant';
      if (canonical === 'M0' || canonical === 'M1' || canonical === 'M2' || canonical === 'M30') line.kind = 'program';
    }
    if (toolNo !== null) {
      st.tool = toolNo;
      titles.push(ctx.lang === 'de' ? `Werkzeug T${toolNo} vorwählen` : `Select tool T${toolNo}`);
      line.kind = line.kind === 'empty' ? 'tool' : line.kind;
    }
    if (rVal !== null) titles.push(ctx.lang === 'de' ? `R-Ebene (Rückzugshöhe) ${MM(toMm(rVal))} mm` : `R plane (retract height) ${MM(toMm(rVal))} mm`);
    if (qVal !== null) titles.push(ctx.lang === 'de' ? `Zustellung je Bohrschritt ${MM(toMm(qVal))} mm` : `Peck depth ${MM(toMm(qVal))} mm`);

    // an F word on a line of its own has no move to compare against, so use the XY limit
    if (axis.F !== undefined && !moving && st.f && machine.feedMax.xy && st.f > machine.feedMax.xy + 1e-6) line.warnings.push(T.feedOver(MM(st.f, 0), MM(machine.feedMax.xy, 0)));

    if (line.title && titles.length) line.details.push(...titles.filter(Boolean));
    else if (titles.length) { line.title = titles.filter(Boolean).join(' · '); if (line.kind === 'empty') line.kind = 'modal'; }
    if (!line.title) {
      if (axis.F !== undefined || axis.S !== undefined) { line.title = line.details.shift() ?? ''; line.kind = 'modal'; }
      else { line.title = T.unknown; line.kind = 'unknown'; }
    }
    if (unknown.length) { line.details.push(`${T.unknown}: ${unknown.join(' ')}`); if (line.kind === 'empty') line.kind = 'unknown'; }
    if (comment) line.details.push(`( ${comment} )`);

    line.pos = { x: st.x, y: st.y, z: st.z };
    warnCount += line.warnings.length;
    lines.push(line);
  });

  return { lines, seconds: total, warnings: warnCount };
}
