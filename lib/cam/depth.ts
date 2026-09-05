/** Depth passes below Z0 (negative Z values). Full step-downs followed by a remainder pass (Estlcam style). */
export function depthPasses(depth: number, stepDown: number, zTop = 0): number[] {
  const out: number[] = [];
  if (depth <= 0) return [zTop];
  const step = Math.max(0.05, stepDown);
  let z = zTop;
  const bottom = zTop - depth;
  while (z - step > bottom + 1e-9) { z -= step; out.push(round(z)); }
  out.push(round(bottom));
  return out;
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;
