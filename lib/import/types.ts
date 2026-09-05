import type { Path } from '@/lib/geometry/types';

export interface ImportedDrawing {
  /** Paths in millimetres, Y up. */
  paths: Path[];
  layers: string[];
  /** Whether the file declared its unit. If false the caller may ask the user. */
  unitKnown: boolean;
  unitName: string;
  warnings: string[];
}
