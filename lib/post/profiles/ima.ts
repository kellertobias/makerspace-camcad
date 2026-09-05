import type { PostProfile } from '../types';
import { grblMill } from './grbl';

/** Placeholder: the IMA BIMA is programmed through IMAWOP FMC files (see ima-bima-cad-converter). */
export const imaFmc: PostProfile = {
  ...grblMill,
  id: 'ima-fmc', name: 'IMA BIMA (IMAWOP FMC, not yet available)', builtIn: true, exporter: 'ima-fmc', ext: 'fmc',
};
