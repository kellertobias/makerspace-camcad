'use client';
import { Modal } from '@/components/ui/Modal';
import { useUi } from '@/lib/store/ui';
import { t } from '@/lib/i18n';

export function ShortcutsModal() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const close = useUi((u) => u.closeModal);
  const rows: [string, string, string][] = [
    ['⌘/Ctrl+Z', 'Rückgängig', 'Undo'], ['⌘/Ctrl+Shift+Z', 'Wiederholen', 'Redo'], ['⌘/Ctrl+S', 'Speichern', 'Save'], ['⌘/Ctrl+O', 'Öffnen', 'Open'], ['⌘/Ctrl+I', 'DXF/SVG importieren', 'Import DXF/SVG'],
    ['⌘/Ctrl+G', 'Gruppieren', 'Group'], ['⌘/Ctrl+D', 'Duplizieren', 'Duplicate'], ['Entf / ⌫', 'Löschen', 'Delete'], ['R / Shift+R', '90° drehen', 'Rotate 90°'], ['M / Shift+M', 'Spiegeln X / Y', 'Mirror X / Y'],
    ['F', 'Ansicht einpassen', 'Fit view'], ['1 / 2 / 3', '2D / 3D / G-Code', '2D / 3D / G-code'], ['Esc', 'Auswahl aufheben', 'Clear selection'], ['Alt+Klick', 'Einzelne Kontur wählen', 'Select single contour'], ['Shift+Klick', 'Auswahl erweitern', 'Add to selection'],
  ];
  return (
    <Modal title={s.shortcuts} onClose={close}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>{rows.map(([k, de, en]) => <tr key={k}><td style={{ padding: '4px 8px' }}><span className="cam-kbd">{k}</span></td><td style={{ padding: '4px 8px' }}>{lang === 'de' ? de : en}</td></tr>)}</tbody>
      </table>
    </Modal>
  );
}
