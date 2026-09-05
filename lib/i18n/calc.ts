import { fmt, type Message } from '../solver';

export type Lang = 'de' | 'en';
export const other = (l: Lang): Lang => (l === 'de' ? 'en' : 'de');

const strings = {
  en: {
    title: 'CNC Milling Calculator',
    sub: 'Enter the values you know. Every value that can be derived from the rest is filled in automatically.',
    formulas: 'Formulas',
    spindle: 'Machine & spindle',
    nMaxName: 'Maximum spindle speed',
    nMaxNameOther: 'Maximale Drehzahl',
    nMaxDesc: 'Maximum RPM of your milling motor. If the required speed exceeds this, the calculator uses the maximum instead and recalculates the feed rate from it.',
    nMinName: 'Minimum spindle speed',
    nMinNameOther: 'Minimale Drehzahl',
    nMinDesc: 'Lowest RPM the spindle can run. Optional; you get a warning when the calculated speed is below it.',
    vfMaxName: 'Maximum milling feed',
    vfMaxNameOther: 'Max. Fräsgeschwindigkeit',
    vfMaxDesc: 'Fastest feed the machine can mill with (XY). Optional; the feed rate is capped at this value.',
    machineInfo: 'Machine data',
    optional: 'optional',
    toolParams: 'Tool & parameters',
    toolHint: 'A saved tool stores diameter, flutes, and — if entered — cutting speed and feed per tooth.',
    given: 'given', calculated: 'calculated', unknown: 'unknown',
    placeholder: 'enter or leave empty',
    legend: 'Values entered by you are marked given; blue fields are calculated. Typing into a calculated field turns it into a given value. Decimal comma or point both work. Everything you enter is kept in this browser until you change it.',
    result: 'Result',
    resN: 'Spindle speed n (S)', capped: '(capped)', resVf: 'Feed rate vf (Fxy)', vfCapped: '(capped)', resVc: 'Effective cutting speed vc', resNReq: 'Required n (uncapped)',
    reset: 'Reset all fields',
    clear: 'Clear',
    // preset bar
    choose: (k: string) => `— choose a saved ${k} —`,
    none: (k: string) => `no saved ${k}s yet`,
    namePh: (k: string) => `${k} name`,
    save: 'Save', cancel: 'Cancel', update: 'Update', saveAs: 'Save as…', del: 'Delete',
    updateTitle: 'Overwrite with the current values',
    confirmDelete: (k: string, n: string) => `Delete ${k} "${n}"?`,
    kindTool: 'tool', kindSpindle: 'spindle',
    savedLabel: (k: string) => `Saved ${k}s`,
    flutesAbbr: 'fl.',
    // illustration captions
    helpLabel: 'Explanation',
    fzWhy: 'Why can\'t fz be calculated?',
    fzWhyText: 'fz only appears in vf = n · z · fz, so it can only be solved when the feed rate vf is known. Diameter and spindle speed alone only determine the cutting speed vc. Feed per tooth is a property of the tool and the workpiece material; manufacturers publish it in their cutting-data tables.',
    fzSuggest: 'Rule of thumb',
    fzSuggestText: 'Estimate for a carbide end mill: fz ≈ d / 150. Harder materials (steel, hard aluminium) go lower, around d / 200; soft materials (wood, soft plastics) tolerate more, around d / 100. Use it as a starting point, not as a calculated value.',
    use: 'Use',
    vcHelp: 'Typical cutting speeds',
    vcHelpText: 'Reference values for carbide tools (m/min): wood / MDF 300–600, aluminium 200–500, brass 150–300, plastics 200–400, mild steel 80–150, stainless steel 40–80. HSS tools roughly one third of these. Check the tool manufacturer\'s data for your exact tool.',
    capVc: 'speed at the cutting edge', capFz: 'advance per tooth = chip thickness', capVf: 'tool travel through the material', capN: 'n rev/min',
    msg: (m: Message): string => {
      switch (m.kind) {
        case 'inconsistent-n': return `n, vc and d are all given but inconsistent: vc and d imply n ≈ ${fmt(m.nFromVc)} RPM.`;
        case 'inconsistent-vf': return `vf, n, z and fz are all given but inconsistent: n · z · fz = ${fmt(m.vfCalc)} mm/min.`;
        case 'capped': return `Required spindle speed ${fmt(m.nUncapped)} RPM exceeds the spindle maximum of ${fmt(m.nMax)} RPM. Using ${fmt(m.nMax)} RPM; feed rate recalculated from the capped speed.`;
        case 'below-min': return `Spindle speed ${fmt(m.n)} RPM is below the machine minimum of ${fmt(m.nMin)} RPM. Use a larger cutting speed or a smaller tool, or run at ${fmt(m.nMin)} RPM and accept a higher vc.`;
        case 'vf-capped': return `Feed rate ${fmt(m.vfUncapped)} mm/min exceeds the machine maximum of ${fmt(m.vfMax)} mm/min. Using ${fmt(m.vfMax)} mm/min; the effective feed per tooth is lower than entered.`;
      }
    },
  },
  de: {
    title: 'CNC-Fräsrechner',
    sub: 'Gib die bekannten Werte ein. Alles, was sich daraus ableiten lässt, wird automatisch berechnet.',
    formulas: 'Formeln',
    spindle: 'Maschine & Spindel',
    nMaxName: 'Maximale Drehzahl',
    nMaxNameOther: 'Maximum spindle speed',
    nMaxDesc: 'Höchstdrehzahl deines Fräsmotors. Liegt die benötigte Drehzahl darüber, rechnet der Rechner mit dem Maximum und passt den Vorschub entsprechend an.',
    nMinName: 'Minimale Drehzahl',
    nMinNameOther: 'Minimum spindle speed',
    nMinDesc: 'Niedrigste Drehzahl, mit der die Spindel laufen kann. Optional; bei Unterschreitung erscheint eine Warnung.',
    vfMaxName: 'Max. Fräsgeschwindigkeit',
    vfMaxNameOther: 'Maximum milling feed',
    vfMaxDesc: 'Schnellster Vorschub, mit dem die Maschine fräsen kann (XY). Optional; der Vorschub wird darauf begrenzt.',
    machineInfo: 'Maschinendaten',
    optional: 'optional',
    toolParams: 'Werkzeug & Parameter',
    toolHint: 'Ein gespeichertes Werkzeug enthält Durchmesser, Zähnezahl und – falls eingegeben – Schnittgeschwindigkeit und Zahnvorschub.',
    given: 'gegeben', calculated: 'berechnet', unknown: 'unbekannt',
    placeholder: 'eingeben oder leer lassen',
    legend: 'Von dir eingegebene Werte sind als gegeben markiert, blaue Felder sind berechnet. Tippst du in ein berechnetes Feld, wird es zu einem gegebenen Wert. Dezimalkomma und -punkt funktionieren beide. Alle Eingaben bleiben in diesem Browser gespeichert.',
    result: 'Ergebnis',
    resN: 'Drehzahl n (S)', capped: '(begrenzt)', resVf: 'Vorschub vf (Fxy)', vfCapped: '(begrenzt)', resVc: 'Effektive Schnittgeschwindigkeit vc', resNReq: 'Benötigte n (unbegrenzt)',
    reset: 'Alle Felder zurücksetzen',
    clear: 'Leeren',
    choose: (k: string) => `— gespeichertes ${k === 'Werkzeug' ? 'Werkzeug' : 'Spindel'} wählen —`.replace('gespeichertes Spindel', 'gespeicherte Spindel'),
    none: (k: string) => (k === 'Werkzeug' ? 'noch keine Werkzeuge gespeichert' : 'noch keine Spindeln gespeichert'),
    namePh: (k: string) => `Name (${k})`,
    save: 'Speichern', cancel: 'Abbrechen', update: 'Aktualisieren', saveAs: 'Speichern als…', del: 'Löschen',
    updateTitle: 'Mit den aktuellen Werten überschreiben',
    confirmDelete: (k: string, n: string) => `${k} „${n}“ löschen?`,
    kindTool: 'Werkzeug', kindSpindle: 'Spindel',
    savedLabel: (k: string) => (k === 'Werkzeug' ? 'Gespeicherte Werkzeuge' : 'Gespeicherte Spindeln'),
    flutesAbbr: 'Schn.',
    helpLabel: 'Erklärung',
    fzWhy: 'Warum lässt sich fz nicht berechnen?',
    fzWhyText: 'fz kommt nur in vf = n · z · fz vor und lässt sich daher nur bestimmen, wenn der Vorschub vf bekannt ist. Durchmesser und Drehzahl allein legen nur die Schnittgeschwindigkeit vc fest. Der Zahnvorschub ist eine Eigenschaft von Werkzeug und Werkstückmaterial; Hersteller geben ihn in ihren Schnittdatentabellen an.',
    fzSuggest: 'Faustregel',
    fzSuggestText: 'Schätzwert für einen Hartmetall-Schaftfräser: fz ≈ d / 150. Harte Materialien (Stahl, hartes Aluminium) eher d / 200, weiche Materialien (Holz, weiche Kunststoffe) eher d / 100. Als Startwert gedacht, nicht als berechneter Wert.',
    use: 'Übernehmen',
    vcHelp: 'Typische Schnittgeschwindigkeiten',
    vcHelpText: 'Richtwerte für Hartmetallwerkzeuge (m/min): Holz / MDF 300–600, Aluminium 200–500, Messing 150–300, Kunststoffe 200–400, Baustahl 80–150, Edelstahl 40–80. HSS-Werkzeuge etwa ein Drittel davon. Für das konkrete Werkzeug die Herstellerangaben prüfen.',
    capVc: 'Geschwindigkeit an der Schneide', capFz: 'Weg pro Zahn = Spandicke', capVf: 'Werkzeugweg durchs Material', capN: 'n U/min',
    msg: (m: Message): string => {
      switch (m.kind) {
        case 'inconsistent-n': return `n, vc und d sind alle gegeben, passen aber nicht zusammen: aus vc und d folgt n ≈ ${fmt(m.nFromVc)} U/min.`;
        case 'inconsistent-vf': return `vf, n, z und fz sind alle gegeben, passen aber nicht zusammen: n · z · fz = ${fmt(m.vfCalc)} mm/min.`;
        case 'capped': return `Die benötigte Drehzahl ${fmt(m.nUncapped)} U/min überschreitet das Spindelmaximum von ${fmt(m.nMax)} U/min. Es wird mit ${fmt(m.nMax)} U/min gerechnet; der Vorschub wurde entsprechend neu berechnet.`;
        case 'below-min': return `Die Drehzahl ${fmt(m.n)} U/min liegt unter dem Maschinenminimum von ${fmt(m.nMin)} U/min. Höhere Schnittgeschwindigkeit oder kleineres Werkzeug wählen, oder mit ${fmt(m.nMin)} U/min fahren und eine höhere vc in Kauf nehmen.`;
        case 'vf-capped': return `Der Vorschub ${fmt(m.vfUncapped)} mm/min überschreitet das Maschinenmaximum von ${fmt(m.vfMax)} mm/min. Es wird mit ${fmt(m.vfMax)} mm/min gerechnet; der effektive Zahnvorschub ist dann kleiner als eingegeben.`;
      }
    },
  },
};

export type Strings = (typeof strings)['en'];
export const t = (lang: Lang): Strings => strings[lang] as Strings;
