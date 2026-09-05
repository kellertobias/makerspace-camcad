/** Expand `<placeholder>` tokens. Unknown placeholders are left in place. */
export function expand(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/<([a-zA-Z_][a-zA-Z0-9_]*)>/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

export function splitLines(block: string): string[] {
  return block.replace(/\r\n/g, '\n').split('\n');
}
