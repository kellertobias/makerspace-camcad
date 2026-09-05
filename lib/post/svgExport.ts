import type { Path, Project, Vec2 } from '@/lib/model/project';
import type { PlanResult } from '@/lib/cam/plan';
import { segStart } from '@/lib/geometry/path';
import { arcSweep } from '@/lib/geometry/arcs';

const COLORS: Record<string, string> = { 'laser-cut': '#ff0000', cutout: '#ff0000', contour: '#ff0000', 'laser-engrave': '#0000ff', engrave: '#0000ff', pocket: '#00a000', drill: '#000000', thread: '#000000' };
const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** SVG path data in a y-down coordinate system of height `h` (sheet coordinates are y-up). */
export function svgPathD(p: Path, h: number): string {
  const P = (q: Vec2) => `${f(q.x)} ${f(h - q.y)}`;
  let d = `M${P(p.start)}`;
  for (let i = 0; i < p.segs.length; i++) {
    const s = p.segs[i];
    if (s.k === 'L') d += ` L${P(s.to)}`;
    else {
      const from = segStart(p, i);
      const r = Math.hypot(from.x - s.c.x, from.y - s.c.y);
      const sweep = arcSweep(from, s.to, s.c, s.cw);
      // flipping y turns world counter-clockwise into SVG clockwise (sweep-flag 1)
      d += ` A${f(r)} ${f(r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${s.cw ? 0 : 1} ${P(s.to)}`;
    }
  }
  if (p.closed) d += ' Z';
  return d;
}

/**
 * Sheet-sized SVG (mm) with one group per enabled operation holding its tool paths, for laser software that takes
 * vector input directly. Cuts red, engravings blue; power / speed / passes as data attributes.
 */
export function exportSvg(project: Project, plan: PlanResult): string {
  const { width: w, height: h } = project.stock;
  const ops = Object.values(project.operations).filter((o) => o.enabled && plan.toolPaths[o.id]?.length).sort((a, b) => a.order - b.order);
  const groups = ops.map((op) => {
    const attrs = [`id="${op.id}"`, `data-op="${op.type}"`, `data-name="${esc(op.name)}"`];
    if (op.type === 'laser-cut' || op.type === 'laser-engrave') attrs.push(`data-power="${op.power}"`, `data-speed="${op.speed}"`, `data-passes="${op.type === 'laser-cut' ? op.passes : op.passes ?? 1}"`);
    const paths = plan.toolPaths[op.id].map((p) => `    <path d="${svgPathD(p, h)}"/>`).join('\n');
    return `  <g ${attrs.join(' ')} fill="none" stroke="${COLORS[op.type] ?? '#000'}" stroke-width="0.1">\n${paths}\n  </g>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="0 0 ${f(w)} ${f(h)}">\n  <title>${esc(project.name || 'project')}</title>\n${groups.join('\n')}\n</svg>\n`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
