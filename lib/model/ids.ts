let counter = 0;
export function newId(prefix = ''): string {
  counter = (counter + 1) % 46656;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}${Math.random().toString(36).slice(2, 6)}`;
}
