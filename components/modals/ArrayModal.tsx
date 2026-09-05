'use client';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { NumberField } from '@/components/ui/NumberField';
import { useUi } from '@/lib/store/ui';
import { useProject } from '@/lib/store/project';
import { t } from '@/lib/i18n';
import { selectedPlacementIds } from '@/lib/store/actions';
import { placementBBox } from '@/lib/cam/instances';

export function ArrayModal() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const close = useUi((u) => u.closeModal);
  const project = useProject((p) => p.project);
  const updatePlacement = useProject((p) => p.updatePlacement);
  const ids = selectedPlacementIds();
  const first = project.placements[ids[0]];
  const b = first ? placementBBox(project, first) : null;
  const [nx, setNx] = useState(first?.array?.nx ?? 2);
  const [ny, setNy] = useState(first?.array?.ny ?? 1);
  const [dx, setDx] = useState(first?.array?.dx ?? (b ? Math.ceil(b.maxX - b.minX + 10) : 100));
  const [dy, setDy] = useState(first?.array?.dy ?? (b ? Math.ceil(b.maxY - b.minY + 10) : 100));
  const apply = () => { for (const id of ids) updatePlacement(id, { array: nx * ny > 1 ? { nx, ny, dx, dy } : undefined }); close(); };
  return (
    <Modal title={s.array} onClose={close} footer={<><button type="button" className="btn" onClick={close}>{s.cancel}</button><button type="button" className="btn primary" onClick={apply}>{s.ok}</button></>}>
      <div className="editor" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <NumberField label={s.arrayNx} value={nx} digits={0} min={1} onChange={(v) => setNx(Math.round(v))} />
        <NumberField label={s.arrayNy} value={ny} digits={0} min={1} onChange={(v) => setNy(Math.round(v))} />
        <NumberField label={s.arrayDx} unit="mm" value={dx} onChange={setDx} />
        <NumberField label={s.arrayDy} unit="mm" value={dy} onChange={setDy} />
      </div>
      <p className="hint">{lang === 'de' ? 'Abstand = Versatz zwischen den Startpunkten benachbarter Kopien.' : 'Spacing = offset between the start points of neighbouring copies.'}</p>
    </Modal>
  );
}
