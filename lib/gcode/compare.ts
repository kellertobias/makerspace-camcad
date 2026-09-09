export interface GcodeCompareOptions {
  /** Ignore leading N words. Useful when the reference post adds line numbers. */
  ignoreLineNumbers?: boolean;
}

export interface NormalizedGcodeLine {
  line: number;
  source: string;
  normalized: string;
}

export interface GcodeDifference {
  index: number;
  actual?: NormalizedGcodeLine;
  expected?: NormalizedGcodeLine;
}

export interface GcodeComparison {
  equal: boolean;
  actual: NormalizedGcodeLine[];
  expected: NormalizedGcodeLine[];
  differences: GcodeDifference[];
}

/** Remove semicolon and parenthesised comments without treating their contents as G-code. */
function stripComments(line: string): string {
  let result = '';
  let depth = 0;
  for (const char of line) {
    if (char === '(') { depth++; continue; }
    if (char === ')' && depth > 0) { depth--; continue; }
    if (char === ';' && depth === 0) break;
    if (depth === 0) result += char;
  }
  return result;
}

function canonicalNumber(raw: string): string {
  let value = raw.replace(',', '.');
  const sign = value.startsWith('-') ? '-' : '';
  if (value[0] === '+' || value[0] === '-') value = value.slice(1);
  let [integer = '0', fraction = ''] = value.split('.');
  integer = integer.replace(/^0+(?=\d)/, '') || '0';
  fraction = fraction.replace(/0+$/, '');
  const zero = /^0+$/.test(integer) && fraction.length === 0;
  return `${zero ? '' : sign}${integer}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Canonicalise formatting only. Command/word order and modal omissions remain significant:
 * this is a regression comparison, not a proof that two arbitrary programs are equivalent.
 */
export function normalizeGcode(text: string, options: GcodeCompareOptions = {}): NormalizedGcodeLine[] {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const result: NormalizedGcodeLine[] = [];
  for (let i = 0; i < source.length; i++) {
    let line = stripComments(source[i]).trim().toUpperCase();
    if (!line) continue;
    if (options.ignoreLineNumbers) line = line.replace(/^N[+-]?\d+(?:[.,]\d+)?\s*/i, '');
    // Whitespace is presentation. Split adjacent words, then canonicalise each word's number.
    line = line.replace(/\s+/g, '').replace(/([A-Z])([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))/g,
      (_match, word: string, number: string) => `${word}${canonicalNumber(number)}`);
    if (line) result.push({ line: i + 1, source: source[i], normalized: line });
  }
  return result;
}

export function compareGcode(actualText: string, expectedText: string, options: GcodeCompareOptions = {}): GcodeComparison {
  const actual = normalizeGcode(actualText, options);
  const expected = normalizeGcode(expectedText, options);
  const differences: GcodeDifference[] = [];
  const count = Math.max(actual.length, expected.length);
  for (let i = 0; i < count; i++) {
    if (actual[i]?.normalized !== expected[i]?.normalized) differences.push({ index: i, actual: actual[i], expected: expected[i] });
  }
  return { equal: differences.length === 0, actual, expected, differences };
}

export function formatGcodeDifferences(comparison: GcodeComparison, limit = 12): string {
  if (comparison.equal) return 'G-code is identical after normalization.';
  const lines = comparison.differences.slice(0, limit).flatMap((difference) => [
    `Block ${difference.index + 1}:`,
    `  expected ${difference.expected ? `line ${difference.expected.line}: ${difference.expected.normalized}` : '<end of file>'}`,
    `  actual   ${difference.actual ? `line ${difference.actual.line}: ${difference.actual.normalized}` : '<end of file>'}`,
  ]);
  if (comparison.differences.length > limit) lines.push(`... ${comparison.differences.length - limit} more difference(s)`);
  return lines.join('\n');
}
