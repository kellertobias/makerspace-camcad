import { t as tCalc, other, type Lang, type Strings as CalcStrings } from './calc';
import { camStrings, type CamStrings } from './cam';

export type { Lang };
export { other };
export type Strings = CalcStrings & CamStrings;

const cache: Partial<Record<Lang, Strings>> = {};
export function t(lang: Lang): Strings {
  return (cache[lang] ??= { ...tCalc(lang), ...(camStrings[lang] as CamStrings) });
}
