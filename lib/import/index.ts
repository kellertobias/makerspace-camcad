import type { ImportedDrawing } from './types';
import { importDxf } from './dxf';
import { importSvg } from './svg';
import { normalize } from './normalize';

export type { ImportedDrawing };

export function importDrawing(name: string, text: string): ImportedDrawing {
  const ext = name.toLowerCase().split('.').pop();
  let d: ImportedDrawing;
  if (ext === 'dxf') d = importDxf(text);
  else if (ext === 'svg') d = importSvg(text);
  else throw new Error(`Unsupported file type: .${ext}`);
  return { ...d, paths: normalize(d.paths) };
}
