import type { PostProfile } from '../types';
import { grblMill } from './grbl';

/** The IMA BIMA is programmed through IMAWOP 2.6 FMC files; rendered by lib/post/fmc.ts (word settings unused). */
export const imaFmc: PostProfile = {
  ...grblMill,
  id: 'ima-fmc', name: 'IMA BIMA (IMAWOP 2.6 FMC)', builtIn: true, exporter: 'ima-fmc', ext: 'fmc',
};
