/**
 * IMAWOP 2.6 FMC writer for the IMA BIMA (Quadroform). INI-style sections, ported from the Makerspace
 * ima-bima-cad-converter (estlcam_converter/fmc_writer.py): program head, mill call + lines / arcs, bores, saw grooves,
 * format saw, park position. Coordinates are workpiece coordinates (zero = finished part corner, AXV/AYV inside the
 * raw sheet); Z is the height above the machine bed. Files are cp1252, at most 300 kB and 64 bores each.
 */
import type { Machine, Project } from '@/lib/model/project';
import type { Move, Program } from '@/lib/cam/types';
import { zeroPoint } from '@/lib/cam/zero';
import { allPartsBBox } from '@/lib/cam/instances';
import { formatHms } from '@/lib/cam/time';

export interface FmcFile { name: string; text: string; bytes: Uint8Array }
export interface FmcResult { files: FmcFile[]; warnings: string[] }

const MAX_SIZE_BYTES = 300_000;
const MAX_BORES = 64;
const FEED_RAPID = 10000;
const TNR_GROOVE_SAW = 426;
const EOL = '\n';

const f = (v: number) => { const r = Math.round(v * 10000) / 10000; return Object.is(r, -0) ? '0' : String(r); };
const block = (lines: string[]) => lines.join(EOL) + EOL + EOL;

// --- section templates (names and key order as in the reference writer) ------------------------------------------
const kommentar = (text: string) => block(['[S_KOMTAR]', `BEZB=${text.length ? text : ' '}`]);
const header = () => block(['[VARDEFAU]', 'INH=6.6', 'VAR=@VERSION']) + block(['[VARDEFAU]', 'INH=6', 'VAR=@SUBVERSION']) + block(['[VARDEFAU]', 'INH=0.10000', 'VAR=@MASSTAB']);
const programmkopf = (w: { length: number; width: number; height: number; lengthRaw: number; widthRaw: number; npvX: number; npvY: number }) =>
  block(['[HAUPTPRG]', 'ABSTS=20', 'AFB=1', `AXV=${f(w.npvX)}`, `AYV=${f(w.npvY)}`, 'BEZB=[PROGRAMMKOPF]', 'BSDT=1', `FTB=${f(w.width)}`, `FTD=${f(w.height)}`, `FTL=${f(w.length)}`, 'HOLKA=-1', 'KOM1= ', 'KOM2= ', 'LOESEN=0', `RTB=${f(w.widthRaw)}`, `RTL=${f(w.lengthRaw)}`, 'SPGLWKS=0', 'VERSION=2.6.02', 'ZSCHABLO=0']) +
  block(['[VERGLEIC]', 'AFB=1', 'BEZB=--> PROGRAMMKOPF-PRUEFUNG', 'DLL=IMA', 'FKT=VERGLEICH', 'MELDUNG1=Die Fertigteil-Masse (Laenge/Breite/Dicke) duerfen nicht 0 sein. Bitte gebe die entsprechenden Masse im Programmkopf an.', 'OPERATOR1===', 'VARIABLE=(L==0 | B==0 | D==0)', 'VERGLEICH1=0', 'VKN=(NULL)']) +
  block(['[S_DIN]', 'AFB=(L==0 | B==0 | D==0)', 'BEZB=--> PROGRAMMKOPF-PRUEFUNG', 'ISO1=L0=65 G77 H9995']) + kommentar('');
const parkposition = (position = 2) => block(['[PROGEND2]', 'AFB=1', 'BEZB=[PROGRAMM-ENDE]', `PP=${position}`]) + kommentar('');
const halt = () => block(['[S_HALT]', 'AFB=1', 'BEZB=[HALT]', 'PPX=1400', 'PPY=-200']) + kommentar('');
const nut = (x1: number, y1: number, x2: number, y2: number, t: number, b: number) =>
  block(['[ZY\'SNW_N]', 'ABSTN=10', 'AFB=1', `BEZB=[NUTEN] (${f(x1)}, ${f(y1)} -> ${f(x2)}, ${f(y2)})`, `EPX=${f(x2)}`, `EPY=${f(y2)}`, 'F=10000', 'FAN=6000', 'GEGENL=0', `NB=${f(b)}`, 'S=9000', `SPX=${f(x1)}`, `SPY=${f(y1)}`, `TI=${f(t)}`, `TNR=${TNR_GROOVE_SAW}`, 'TRKOR=1', 'TWKL=0', 'TYPA=0', 'TYPN=1', 'Z=D/2']) + kommentar('');
const formatsaege = () => block(['[FOSAEG25]', 'AFB=1', 'BEZB=[FORMAT-SAEGE]  ', 'F=15000', 'FAN=10000', 'GEGENL=0', 'KD1=0', 'KD2=0', 'KD3=0', 'KD4=0', 'LGEA=100', 'LGEAN=3', 'NAME=FO-SAEG1.FMC', 'S=8000', 'TI=-10', 'TNR=427']) + kommentar('') + halt();
const fraeserInit = (x: number, y: number, z: number, tnr: number, feed: number) =>
  block(['[CAD_F_S]', 'AFB=1', `BEZB=[AUFRUF FRAESER] (WKZ${tnr} X${f(x)} Y${f(y)} Z${f(z)} F${f(feed)})`, 'EBG=0', 'EVS=0', `F=${f(feed)}`, 'FAN=300', 'KD=0', 'LGEAB=AW', 'LGEAN=0', 'SPGLTNR=WZ', `SPX=${f(x)}`, `SPY=${f(y)}`, `SPZ=${f(z)}`, `TNR=${tnr}`, 'TRKOR=0', 'TYPAB=AT', 'TYPAN=0', 'TYPEIN=0']);
const gerade = (x: number, y: number, z: number, feed: number) =>
  block(['[N\'G1-XYZ]', 'AFB=1', `BEZB=Gerade (X${f(x)} Y${f(y)} Z${f(z)} F${f(feed)})`, 'EB=EBG', `EPX=${f(x)}`, `EPY=${f(y)}`, `EPZ=${f(z)}`, `F=${f(feed)}`, 'AGGO=AGGOFFSET']);
const kreisbogen = (cw: boolean, x: number, y: number, z: number, i: number, j: number, feed: number) =>
  block([cw ? '[N\'G2R-XY]' : '[N\'G3R-XY]', 'AFB=1', `BEZB=Kreis ${cw ? 'IUZ' : 'GUZ'} (X${f(x)} Y${f(y)} Z${f(z)} I${f(i)} J${f(j)} F${f(feed)})`, 'EB=EBG', `EPX=${f(x)}`, `EPY=${f(y)}`, `EPZ=${f(z)}`, `F=${f(feed)}`, `MPX=${f(i)}`, `MPY=${f(j)}`, 'R=(NULL)']);
const abfahren = () => block(['[KO\'AB_N2]', 'AFB=1', 'AGGD=AGGDREHBAR', 'AGGFWKL=AGGFWKL', 'AGGO=AGGOFFSET']) + kommentar('');
const bohrung = (d: number, x: number, y: number, t: number, feed: number, s: number, zsm: number) =>
  block(['[VB\'D]', 'AFB=1', `BEZB=[Bohren Durchmesser ${f(d)}] (X${f(x)} Y${f(y)} T${f(t)} F${f(feed)} S${f(s)} TI${f(zsm)})`, `DM=${f(d)}`, `F=${f(feed)}`, `FAN=${f(feed / 2)}`, 'GRP=1', 'LGEAB=4', 'LGEAN=4', 'MRICHT=0', `S=${f(s)}`, 'TASTEIN=-1', `TI=${f(t)}`, `X=${f(x)}`, `Y=${f(y)}`, `ZSM=${f(zsm)}`]) + kommentar('');

// --- cp1252 --------------------------------------------------------------------------------------------------------
const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
export function encodeCp1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    out[n++] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252[c] ?? 0x3f;
  }
  return out.subarray(0, n);
}
/** Text as IMAWOP will read it: every character that has no cp1252 code becomes '?'. */
const clean = (text: string) => Array.from(text, (ch) => { const c = ch.codePointAt(0)!; return c < 0x80 || (c >= 0xa0 && c <= 0xff) || CP1252[c] !== undefined ? ch : '?'; }).join('');

// --- writer ----------------------------------------------------------------------------------------------------------
export function exportFmc(program: Program, project: Project, machine: Machine, version: string): FmcResult {
  const warnings: string[] = [...program.warnings];
  const stock = project.stock;
  const zero = zeroPoint(project, allPartsBBox(project));
  const zFmc = (z: number) => (stock.zZero === 'top' ? stock.thickness + z : z);
  const part = stock.part;
  const workpiece = { length: part?.width ?? stock.width, width: part?.height ?? stock.height, height: stock.thickness, lengthRaw: stock.width, widthRaw: stock.height, npvX: zero.x, npvY: zero.y };
  const base = (project.name || 'program').replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 8) || 'program';
  if ((project.name || '').replace(/[^A-Za-z0-9_-]+/g, '').length > 8) warnings.push(`FMC file name shortened to 8 characters: ${base}.fmc`);

  const files: FmcFile[] = [];
  let text = '';
  let bores = 0;
  let fileNr = 0;
  const size = (s: string) => s.length; // cp1252: one byte per character (unknown characters become '?')
  const fits = (section: string) => size(text) + size(section) <= MAX_SIZE_BYTES && bores <= MAX_BORES - 1;

  const start = (continuation: boolean) => {
    text = header();
    text += kommentar('______________________________________________________');
    text += kommentar(`FMC-Datei erstellt mit Makerspace CAM ${version}`);
    text += kommentar(`Erstellt am: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
    if (!continuation) {
      text += kommentar(`Projekt ${clean(project.name || 'Untitled')}`);
      text += kommentar(`Laufzeit ca. ${formatHms(program.meta.seconds)} Stunden`);
      text += kommentar('Benoetigte Werkzeuge:');
      for (const tp of program.tools) text += kommentar(`${tp.tool.slot}: ${clean(tp.tool.name)}`);
    } else text += kommentar(`Fortsetzung von ${base}.fmc`);
    text += kommentar('______________________________________________________');
    text += kommentar('');
    text += programmkopf(workpiece);
    bores = 0;
  };
  const finish = () => {
    text += parkposition();
    const digits = String(fileNr).length;
    const name = fileNr === 0 ? `${base}.fmc` : `${base.slice(0, 8 - digits)}${String(fileNr).padStart(8 - Math.min(base.length, 8 - digits), '0')}.fmc`;
    files.push({ name, text, bytes: encodeCp1252(text) });
  };
  const newFile = () => { finish(); fileNr++; start(true); };
  const append = (section: string) => {
    if (size(section) > MAX_SIZE_BYTES) warnings.push('One section exceeds the 300 kB IMAWOP limit; the file is written anyway and may not load');
    if (!fits(section)) newFile();
    text += section;
  };

  start(false);
  if (part?.formatSaw) append(formatsaege());

  for (const tp of program.tools) {
    const tool = tp.tool;
    for (const op of tp.ops) {
      const type = project.operations[op.opId]?.type;
      text += kommentar(`Nr. ${op.order} ${clean(op.typeLabel)}: ${clean(op.name)}`);
      warnings.push(...op.warnings.map((w) => `${op.name}: ${w}`));
      if (type === 'laser-cut' || type === 'laser-engrave') { warnings.push(`${op.name}: laser operation skipped, the IMA has no laser`); continue; }
      if (type === 'drill') {
        // plunges become bores: DM = tool diameter, TI = depth below the top, ZSM = peck increment
        let cx = 0, cy = 0, zs: number[] = [], feed = 0;
        const flush = () => {
          if (!zs.length) return;
          const minZ = Math.min(...zs.map(zFmc));
          const sorted = [...new Set(zs.map(zFmc))].sort((a, b) => a - b);
          const steps = sorted.filter((z, i) => i === 0 || z - sorted[i - 1] > 0.21);
          const zsm = steps.length > 1 ? (steps[steps.length - 1] - steps[0]) / (steps.length - 1) : 0;
          bores++;
          append(bohrung(tool.d, cx, cy, stock.thickness - minZ, feed || 300, tp.s, zsm)); // TI = depth below the top
          zs = [];
        };
        for (const m of op.moves) {
          if (m.k === 'rapid' && m.x !== undefined && m.y !== undefined) { flush(); cx = m.x; cy = m.y; }
          else if (m.k === 'line' && m.z !== undefined) { zs.push(m.z); if (m.f) feed = m.f; }
        }
        flush();
        continue;
      }
      if (type === 'saw') {
        // every feed move with XY travel is one groove of the blade width at its depth
        let px: number | null = null, py: number | null = null, pz = 0;
        for (const m of op.moves) {
          if (m.k === 'rapid') { if (m.x !== undefined) px = m.x; if (m.y !== undefined) py = m.y; if (m.z !== undefined) pz = m.z; continue; }
          if (m.k === 'line') {
            const x = m.x ?? px, y = m.y ?? py, z = m.z ?? pz;
            if (m.x !== undefined && px !== null && py !== null && x !== null && y !== null && (Math.abs(x - px) > 1e-9 || Math.abs(y - py) > 1e-9)) append(nut(px, py, x, y, stock.thickness - zFmc(z), tool.d));
            px = x; py = y; pz = z;
          }
        }
        if (tool.slot !== TNR_GROOVE_SAW) warnings.push(`${op.name}: saw grooves always use the IMA groove saw (tool ${TNR_GROOVE_SAW}); tool ${tool.slot} "${tool.name}" only defines the blade width ${tool.d} mm`);
        continue;
      }
      // milling: tool call at the first position, then lines / arcs; contour closed with KO'AB
      if (!((tool.slot >= 603 && tool.slot <= 699) || tool.slot === 4353)) warnings.push(`${op.name}: tool ${tool.slot} "${tool.name}" is not an IMA mill number (603–699); check the tool number`);
      let x = 0, y = 0, z = zFmc(stock.safeZ), feed = 0, started = false, chunk = '';
      const openChunk = () => { chunk = fraeserInit(x, y, z, tool.slot, FEED_RAPID); started = true; };
      const closeChunk = () => { if (!started) return; chunk += abfahren(); if (!fits(chunk)) newFile(); text += chunk; chunk = ''; started = false; };
      for (const m of op.moves) {
        if (m.k === 'rapid') {
          const nx = m.x ?? x, ny = m.y ?? y, nz = m.z !== undefined ? zFmc(m.z) : z;
          // a retract above the stock is a safe place to split an over-long contour into a new file
          if (started && nz >= stock.thickness && size(text) + size(chunk) > MAX_SIZE_BYTES * 0.9) { x = nx; y = ny; z = nz; closeChunk(); continue; }
          x = nx; y = ny; z = nz;
          if (!started) { if (m.x !== undefined || m.y !== undefined) openChunk(); }
          else chunk += gerade(x, y, z, FEED_RAPID);
        } else if (m.k === 'line') {
          x = m.x ?? x; y = m.y ?? y; if (m.z !== undefined) z = zFmc(m.z); if (m.f) feed = m.f;
          if (!started) openChunk(); else chunk += gerade(x, y, z, feed || FEED_RAPID);
        } else if (m.k === 'arc') {
          if (!started) openChunk();
          x = m.x; y = m.y; if (m.z !== undefined) z = zFmc(m.z); if (m.f) feed = m.f;
          chunk += kreisbogen(m.cw, x, y, z, m.cx, m.cy, feed || FEED_RAPID);
        }
      }
      closeChunk();
    }
  }
  finish();
  return { files, warnings };
}
