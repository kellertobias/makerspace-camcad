import type { PostProfile, ExportResult } from './types';
import type { Program } from '@/lib/cam/types';
import { emitGcode } from './emitter';
import { estlcamHolz } from './profiles/estlcam-holz';
import { grblLaser, grblMill } from './profiles/grbl';

export type { PostProfile, ExportResult };
export { parsePp, serializePp } from './pp';
export { emitGcode };

export const BUILT_IN_PROFILES: PostProfile[] = [estlcamHolz, grblMill, grblLaser];

export function exportProgram(program: Program, profile: PostProfile, safeZ: number, version: string, opts: { laserMode?: 'M3' | 'M4' } = {}): ExportResult {
  return emitGcode(program, profile, safeZ, { version, laserMode: opts.laserMode });
}
export { exportSvg } from './svgExport';
