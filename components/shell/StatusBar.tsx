'use client';
import { useUi } from '@/lib/store/ui';
import { t } from '@/lib/i18n';
import { usePlan } from '@/lib/store/plan';
import { formatHms } from '@/lib/cam/time';
import { useCursor } from '@/components/canvas2d/cursor';

export function StatusBar() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const sel = useUi((u) => u.selection);
  const fileName = useUi((u) => u.fileName);
  const dirty = useUi((u) => u.dirty);
  const cursor = useCursor((c) => c.pos);
  const { plan, machine } = usePlan();
  const n = sel.placements.length + sel.paths.length + sel.operations.length + sel.groups.length;
  return (
    <div className="cam-status">
      <span>{s.cursor}: X {cursor ? cursor.x.toFixed(2) : '–'} Y {cursor ? cursor.y.toFixed(2) : '–'}</span>
      <span>{s.selected(n)}</span>
      <span>{machine?.name ?? ''}</span>
      <span>{s.estTime} {plan ? formatHms(plan.program.meta.seconds) : '–'}</span>
      <span className="grow" />
      <span className={dirty ? 'dirty' : ''}>{fileName ?? (lang === 'de' ? 'Unbenannt' : 'Untitled')}{dirty ? ` • ${s.unsaved}` : ''}</span>
    </div>
  );
}
