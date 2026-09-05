import type { Project, Vec2 } from '@/lib/model/project';
import type { BBox } from '@/lib/geometry/types';
import { bboxValid } from '@/lib/geometry/types';

/** Machine zero point in sheet coordinates (sheet origin = bottom-left corner of the stock). */
export function zeroPoint(project: Project, partsBBox: BBox): Vec2 {
  const { stock } = project;
  const o = stock.origin;
  const cornerOf = (b: BBox): Vec2 => {
    switch (o.corner) {
      case 'bl': return { x: b.minX, y: b.minY };
      case 'br': return { x: b.maxX, y: b.minY };
      case 'tl': return { x: b.minX, y: b.maxY };
      case 'tr': return { x: b.maxX, y: b.maxY };
    }
  };
  const sheet: BBox = { minX: 0, minY: 0, maxX: stock.width, maxY: stock.height };
  const parts = bboxValid(partsBBox) ? partsBBox : sheet;
  switch (o.mode) {
    case 'manual': return o.manual;
    case 'sheet-corner': return cornerOf(sheet);
    case 'sheet-center': return { x: stock.width / 2, y: stock.height / 2 };
    case 'parts-bbox-corner': return cornerOf(parts);
    case 'parts-bbox-center': return { x: (parts.minX + parts.maxX) / 2, y: (parts.minY + parts.maxY) / 2 };
  }
}
