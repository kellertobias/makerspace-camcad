import type { PostProfile, ExportResult } from './types';
import type { Program } from '@/lib/cam/types';
import { emitGcode } from './emitter';
import { estlcamHolz } from './profiles/estlcam-holz';
import { grblLaser, grblMill } from './profiles/grbl';
import { imaFmc } from './profiles/ima';
import { exportFmc } from './fmc';
import type { Machine, Project } from '@/lib/model/project';

export type { PostProfile, ExportResult };
export { parsePp, serializePp } from './pp';
export { emitGcode };

export const BUILT_IN_PROFILES: PostProfile[] = [estlcamHolz, grblMill, grblLaser, imaFmc];

export function exportProgram(program: Program, profile: PostProfile, safeZ: number, version: string, opts: { laserMode?: 'M3' | 'M4'; project?: Project; machine?: Machine } = {}): ExportResult {
  if (profile.exporter === 'ima-fmc') {
    if (!opts.project || !opts.machine) return { filename: 'program.fmc', text: '', warnings: ['IMA FMC export needs the project and machine'], format: 'fmc' };
    if (!program.tools.length) return { filename: 'program.fmc', text: '', warnings: [], format: 'fmc', files: [] };
    const r = exportFmc(program, opts.project, opts.machine, version);
    return { filename: r.files[0]?.name ?? 'program.fmc', text: r.files.map((x) => x.text).join(''), warnings: r.warnings, format: 'fmc', files: r.files };
  }
  return { ...emitGcode(program, profile, safeZ, { version, laserMode: opts.laserMode }), format: 'gcode' };
}
export { exportSvg } from './svgExport';
