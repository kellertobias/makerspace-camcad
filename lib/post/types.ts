export type WordName = 'X' | 'Y' | 'Z' | 'I' | 'J' | 'F' | 'S' | 'N';

export interface WordSpec {
  /** Letter written to the file; empty = word disabled. */
  name: string;
  /** Number format: number of decimals, e.g. '0.0000' => 4 fixed decimals, '0' => integer, '0.###' => up to 3 trimmed. */
  format: string;
  order: number;
  scale: number;
  enable: boolean;
  /** Repeat the word even if its value did not change since the last line. */
  repeat: boolean;
}

export interface PostProfile {
  id: string;
  name: string;
  builtIn?: boolean;
  /** Which exporter renders this profile. 'gcode' = template emitter, others are dedicated exporters. */
  exporter: 'gcode' | 'ima-fmc';
  lengthUnit: 'mm' | 'inch';
  feedUnit: 'mm_min' | 'mm_s' | 'inch_min';
  ext: string;
  useArcs: boolean;
  ijRelative: boolean;
  delimiter: string;
  decimal: '.' | ',';
  commandRepeat: boolean;
  cmds: { rapid: string; linear: string; cw: string; ccw: string };
  words: Record<WordName, WordSpec>;
  blocks: {
    programStart: string; programEnd: string; opStart: string; toolChange: string;
    mistOn: string; mistOff: string; floodOn: string; floodOff: string;
    laserOn: string; laserOff: string; dwell: string;
  };
  lineNumbers: { start: number; step: number };
  /** Untouched key/value pairs from an imported .pp so it can be written back. */
  raw?: Record<string, string>;
}

export interface ExportResult { filename: string; text: string; warnings: string[] }
