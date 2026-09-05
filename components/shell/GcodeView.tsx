'use client';
import { useState } from 'react';
import { usePlan } from '@/lib/store/plan';
import { useUi } from '@/lib/store/ui';
import { t } from '@/lib/i18n';
import { exportGcode } from '@/lib/store/actions';

export function GcodeView() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const { gcode, error } = usePlan();
  const [copied, setCopied] = useState(false);
  const text = gcode?.text ?? '';
  const lines = text ? text.split('\n').length - 1 : 0;
  return (
    <div className="cam-gcode">
      <div className="bar">
        <span>{gcode?.filename ?? ''}</span><span>{s.lines(lines)}</span>
        {error && <span className="dirty">{s.errors[error] ?? error}</span>}
        {gcode?.warnings.map((w, i) => <span key={i} title={w} style={{ color: 'var(--warn-text)' }}>⚠ {w}</span>)}
        <span className="grow" />
        <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }} disabled={!text}>{copied ? s.copied : s.copy}</button>
        <button type="button" className="btn small primary" onClick={exportGcode} disabled={!text}>{s.download}</button>
      </div>
      <pre>{text || s.gcodeEmpty}</pre>
    </div>
  );
}
