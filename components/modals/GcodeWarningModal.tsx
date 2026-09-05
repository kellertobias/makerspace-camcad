'use client';
import { Modal } from '@/components/ui/Modal';
import { useUi } from '@/lib/store/ui';
import { t } from '@/lib/i18n';
import { runGcodeExport } from '@/lib/store/actions';

/** Safety disclaimer shown before every G-code export; the export only runs after acknowledgement. */
export function GcodeWarningModal() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const close = useUi((u) => u.closeModal);
  const accept = () => { close(); void runGcodeExport(); };
  return (
    <Modal
      title={`⚠ ${s.gcodeWarnTitle}`}
      onClose={close}
      footer={<><button type="button" className="btn" onClick={close}>{s.cancel}</button><button type="button" className="btn primary" onClick={accept}>{s.gcodeWarnAck}</button></>}
    >
      <div className="warn">
        <p style={{ margin: 0 }}>{s.gcodeWarnLead}</p>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {s.gcodeWarnPoints.map((p) => <li key={p}>{p}</li>)}
        </ul>
      </div>
    </Modal>
  );
}
