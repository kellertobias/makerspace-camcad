/**
 * A small, deterministic evaluator for JavaScript-style numeric expressions.
 *
 * Surface formulas are stored in project files and evaluated automatically while
 * planning. Deliberately do not use eval / Function here: imported projects must
 * not be able to execute arbitrary JavaScript. The supported subset is enough for
 * profiles (arithmetic, comparisons, ternaries and common Math functions).
 */
export type DepthExpression = (distance: number, startDepth: number) => number;

type Eval = (distance: number, startDepth: number) => number;
type Token = { kind: 'number' | 'name' | 'op' | 'eof'; text: string; value?: number };

const functions: Record<string, (...xs: number[]) => number> = {
  abs: Math.abs, acos: Math.acos, asin: Math.asin, atan: Math.atan, atan2: Math.atan2,
  ceil: Math.ceil, cos: Math.cos, exp: Math.exp, floor: Math.floor, log: Math.log,
  max: Math.max, min: Math.min, pow: Math.pow, round: Math.round, sign: Math.sign,
  sin: Math.sin, sqrt: Math.sqrt, tan: Math.tan,
};
const constants: Record<string, number> = { PI: Math.PI, E: Math.E, 'Math.PI': Math.PI, 'Math.E': Math.E };

function tokenize(source: string): Token[] {
  if (!source.trim()) throw new Error('The surface depth expression is empty');
  if (source.length > 2000) throw new Error('The surface depth expression is too long');
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(i));
    if (number) { out.push({ kind: 'number', text: number[0], value: Number(number[0]) }); i += number[0].length; continue; }
    const name = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?/.exec(source.slice(i));
    if (name) { out.push({ kind: 'name', text: name[0] }); i += name[0].length; continue; }
    const multi = ['**', '>=', '<=', '===', '!==', '==', '!=', '&&', '||'].find((x) => source.startsWith(x, i));
    const op = multi ?? ('+-*/%(),?:<>!'.includes(source[i]) ? source[i] : '');
    if (!op) throw new Error(`Unsupported character "${source[i]}" in surface depth expression`);
    out.push({ kind: 'op', text: op }); i += op.length;
  }
  out.push({ kind: 'eof', text: '' });
  return out;
}

class Parser {
  private at = 0;
  constructor(private readonly tokens: Token[]) {}
  private peek(): Token;
  private peek(text: string): boolean;
  private peek(text?: string): Token | boolean { const t = this.tokens[this.at]; return text === undefined ? t : t.text === text; }
  private take(text?: string) { const t = this.tokens[this.at]; if (text !== undefined && t.text !== text) throw new Error(`Expected "${text}", found "${t.text || 'end of expression'}"`); this.at++; return t; }
  parse(): Eval { const e = this.conditional(); if (this.peek().kind !== 'eof') throw new Error(`Unexpected "${this.peek().text}" in surface depth expression`); return e; }
  private conditional(): Eval {
    const test = this.or();
    if (!this.peek('?')) return test;
    this.take('?'); const yes = this.conditional(); this.take(':'); const no = this.conditional();
    return (d, s) => test(d, s) !== 0 ? yes(d, s) : no(d, s);
  }
  private or(): Eval { let a = this.and(); while (this.peek('||')) { this.take(); const b = this.and(), p = a; a = (d, s) => p(d, s) !== 0 || b(d, s) !== 0 ? 1 : 0; } return a; }
  private and(): Eval { let a = this.compare(); while (this.peek('&&')) { this.take(); const b = this.compare(), p = a; a = (d, s) => p(d, s) !== 0 && b(d, s) !== 0 ? 1 : 0; } return a; }
  private compare(): Eval {
    let a = this.add();
    while (['<', '<=', '>', '>=', '==', '===', '!=', '!=='].includes(this.peek().text)) {
      const op = this.take().text, b = this.add(), p = a;
      a = (d, s) => { const x = p(d, s), y = b(d, s); switch (op) { case '<': return x < y ? 1 : 0; case '<=': return x <= y ? 1 : 0; case '>': return x > y ? 1 : 0; case '>=': return x >= y ? 1 : 0; case '!=': case '!==': return x !== y ? 1 : 0; default: return x === y ? 1 : 0; } };
    }
    return a;
  }
  private add(): Eval { let a = this.multiply(); while (this.peek('+') || this.peek('-')) { const op = this.take().text, b = this.multiply(), p = a; a = op === '+' ? (d, s) => p(d, s) + b(d, s) : (d, s) => p(d, s) - b(d, s); } return a; }
  private multiply(): Eval { let a = this.power(); while (this.peek('*') || this.peek('/') || this.peek('%')) { const op = this.take().text, b = this.power(), p = a; a = op === '*' ? (d, s) => p(d, s) * b(d, s) : op === '/' ? (d, s) => p(d, s) / b(d, s) : (d, s) => p(d, s) % b(d, s); } return a; }
  private power(): Eval { const a = this.unary(); if (!this.peek('**')) return a; this.take(); const b = this.power(); return (d, s) => a(d, s) ** b(d, s); }
  private unary(): Eval { if (this.peek('+')) { this.take(); return this.unary(); } if (this.peek('-')) { this.take(); const a = this.unary(); return (d, s) => -a(d, s); } if (this.peek('!')) { this.take(); const a = this.unary(); return (d, s) => a(d, s) === 0 ? 1 : 0; } return this.primary(); }
  private primary(): Eval {
    if (this.peek('(')) { this.take(); const e = this.conditional(); this.take(')'); return e; }
    const token = this.take();
    if (token.kind === 'number') return () => token.value!;
    if (token.kind !== 'name') throw new Error(`Expected a number, variable or function, found "${token.text || 'end of expression'}"`);
    const name = token.text;
    if (name === 'distance' || name === 'd') return (d) => d;
    if (name === 'startDepth') return (_d, s) => s;
    if (constants[name] !== undefined) return () => constants[name];
    if (!this.peek('(')) throw new Error(`Unknown surface expression name "${name}"`);
    const fnName = name.startsWith('Math.') ? name.slice(5) : name;
    const fn = functions[fnName];
    if (!fn) throw new Error(`Unsupported surface expression function "${name}"`);
    this.take('('); const args: Eval[] = [];
    if (!this.peek(')')) { do { args.push(this.conditional()); if (!this.peek(',')) break; this.take(','); } while (!this.peek(')')); }
    this.take(')');
    return (d, s) => fn(...args.map((a) => a(d, s)));
  }
}

export function compileDepthExpression(source: string): DepthExpression {
  const evaluate = new Parser(tokenize(source)).parse();
  return (distance, startDepth) => {
    const value = evaluate(distance, startDepth);
    if (!Number.isFinite(value)) throw new Error(`Surface depth expression returned ${String(value)} at distance ${distance.toFixed(3)} mm`);
    return value;
  };
}
