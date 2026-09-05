import type { Id, Tool } from '@/lib/model/project';

/** Machine-independent motion. Coordinates absolute, mm. Missing axes keep their previous value. */
export type Move =
  | { k: 'rapid'; x?: number; y?: number; z?: number; /** emit all given words even if unchanged */ force?: boolean }
  | { k: 'line'; x?: number; y?: number; z?: number; f?: number; s?: number }
  | { k: 'arc'; x: number; y: number; z?: number; cx: number; cy: number; cw: boolean; f?: number; s?: number }
  | { k: 'dwell'; seconds: number }
  | { k: 'spindle'; on: boolean; s?: number; dynamic?: boolean }
  | { k: 'coolant'; mode: 'mist' | 'flood' | 'off' }
  | { k: 'comment'; text: string };

export interface OpToolpath {
  opId: Id;
  order: number;
  /** Operation type label as used in the op-start comment (e.g. "Teil bearbeiten"). */
  typeLabel: string;
  name: string;
  moves: Move[];
  warnings: string[];
}

export interface ToolProgram {
  tool: Tool;
  /** Spindle speed actually used (after machine limits). */
  s: number;
  ops: OpToolpath[];
}

export interface Program {
  tools: ToolProgram[];
  meta: { project: string; seconds: number; version: string };
  warnings: string[];
}

export interface FeedSet { vf: number; vfPlunge: number; s: number }
