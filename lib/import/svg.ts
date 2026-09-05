import type { Path, Mat } from '@/lib/geometry/types';
import { compose, transformPath, scaling } from '@/lib/geometry/transform';
import { circlePath, polylinePath } from '@/lib/geometry/path';
import { parseSvgPath } from './svgPath';
import { parseLength, parseTransform, unitToMm } from './svgTransform';
import { ellipsePoint } from '@/lib/geometry/arcs';
import type { ImportedDrawing } from './types';
import { newId } from '@/lib/model/ids';

const num = (el: Element, name: string, def = 0) => { const v = el.getAttribute(name); return v === null ? def : parseFloat(v) || 0; };

export function importSvg(text: string): ImportedDrawing {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('Not an SVG document');
  const warnings: string[] = [];

  // user unit -> mm
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
  const w = parseLength(root.getAttribute('width'));
  const h = parseLength(root.getAttribute('height'));
  let userToMm = 25.4 / 96;
  let unitKnown = false;
  let unitName = 'px (96 dpi)';
  if (w && vb.length === 4 && vb[2] > 0) {
    const mmPerUnit = unitToMm(w.unit);
    if (mmPerUnit !== null && w.unit !== '' && w.unit !== 'px') { userToMm = (w.value * mmPerUnit) / vb[2]; unitKnown = true; unitName = w.unit; }
    else if (w.unit === '' || w.unit === 'px') { userToMm = (w.value * (25.4 / 96)) / vb[2]; }
  } else if (w && !vb.length) {
    const mmPerUnit = unitToMm(w.unit);
    if (mmPerUnit !== null && w.unit !== '' && w.unit !== 'px') { userToMm = mmPerUnit; unitKnown = true; unitName = w.unit; }
  }
  void h;

  const paths: Path[] = [];
  const layers = new Set<string>();
  const walk = (el: Element, m: Mat, layer: string | undefined) => {
    if (el.getAttribute('display') === 'none') return;
    const tag = el.nodeName.toLowerCase();
    const local = compose(m, parseTransform(el.getAttribute('transform')));
    const isLayer = tag === 'g' && (el.getAttribute('inkscape:groupmode') === 'layer' || el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'groupmode') === 'layer');
    const myLayer = isLayer ? el.getAttribute('inkscape:label') ?? el.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'label') ?? el.getAttribute('id') ?? layer : layer ?? (el.getAttribute('id') && tag === 'g' ? el.getAttribute('id')! : undefined);
    let local2: Path[] = [];
    switch (tag) {
      case 'path': local2 = parseSvgPath(el.getAttribute('d') ?? ''); break;
      case 'rect': {
        const x = num(el, 'x'), y = num(el, 'y'), rw = num(el, 'width'), rh = num(el, 'height');
        let rx = num(el, 'rx', NaN), ry = num(el, 'ry', NaN);
        if (Number.isNaN(rx) && Number.isNaN(ry)) { rx = 0; ry = 0; } else if (Number.isNaN(rx)) rx = ry; else if (Number.isNaN(ry)) ry = rx;
        rx = Math.min(rx, rw / 2); ry = Math.min(ry, rh / 2);
        if (rx > 0 && Math.abs(rx - ry) < 1e-9) {
          local2 = parseSvgPath(`M${x + rx},${y} H${x + rw - rx} A${rx},${rx} 0 0 1 ${x + rw},${y + ry} V${y + rh - ry} A${rx},${rx} 0 0 1 ${x + rw - rx},${y + rh} H${x + rx} A${rx},${rx} 0 0 1 ${x},${y + rh - ry} V${y + ry} A${rx},${rx} 0 0 1 ${x + rx},${y} Z`);
        } else if (rx > 0) {
          local2 = parseSvgPath(`M${x + rx},${y} H${x + rw - rx} A${rx},${ry} 0 0 1 ${x + rw},${y + ry} V${y + rh - ry} A${rx},${ry} 0 0 1 ${x + rw - rx},${y + rh} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + rh - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`);
        } else local2 = [polylinePath([{ x, y }, { x: x + rw, y }, { x: x + rw, y: y + rh }, { x, y: y + rh }], true)];
        break;
      }
      case 'circle': local2 = [circlePath({ x: num(el, 'cx'), y: num(el, 'cy') }, num(el, 'r'), true)]; break;
      case 'ellipse': {
        const cx = num(el, 'cx'), cy = num(el, 'cy'), rx = num(el, 'rx'), ry = num(el, 'ry');
        if (Math.abs(rx - ry) < 1e-9) local2 = [circlePath({ x: cx, y: cy }, rx, true)];
        else { const pts = []; const n = 64; for (let k = 0; k < n; k++) pts.push(ellipsePoint(cx, cy, rx, ry, 0, (2 * Math.PI * k) / n)); local2 = [polylinePath(pts, true)]; }
        break;
      }
      case 'line': local2 = [polylinePath([{ x: num(el, 'x1'), y: num(el, 'y1') }, { x: num(el, 'x2'), y: num(el, 'y2') }], false)]; break;
      case 'polyline': case 'polygon': {
        const nums = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
        const pts = []; for (let k = 0; k + 1 < nums.length; k += 2) pts.push({ x: nums[k], y: nums[k + 1] });
        if (pts.length >= 2) local2 = [polylinePath(pts, tag === 'polygon')];
        break;
      }
      case 'text': warnings.push('Text elements are ignored; convert text to paths before export.'); break;
      case 'image': warnings.push('Raster images are ignored.'); break;
    }
    for (const p of local2) { const tp = transformPath(p, local); tp.layer = myLayer; tp.id = newId('pa'); paths.push(tp); if (myLayer) layers.add(myLayer); }
    for (const child of Array.from(el.children)) if (!['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'metadata', 'style'].includes(child.nodeName.toLowerCase())) walk(child, local, myLayer);
  };
  // Root viewBox offset: translate by -minX/-minY
  const rootM: Mat = vb.length === 4 ? [1, 0, 0, 1, -vb[0], -vb[1]] : [1, 0, 0, 1, 0, 0];
  walk(root, rootM, undefined);

  // Convert to mm and flip Y (SVG is Y-down). Mirroring flips arc direction inside transformPath.
  const toMm = compose(scaling(userToMm, -userToMm), [1, 0, 0, 1, 0, 0]);
  const out = paths.map((p) => transformPath(p, toMm));
  return { paths: out, layers: [...layers], unitKnown, unitName, warnings };
}
