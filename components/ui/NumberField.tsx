'use client';
import { useEffect, useState } from 'react';

interface Props {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
}

/** Numeric input that accepts comma or point and commits on blur / Enter. */
export function NumberField({ label, value, onChange, unit, min, max, digits = 3, placeholder, disabled, title }: Props) {
  const fmt = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '' : String(Math.round(v * 10 ** digits) / 10 ** digits));
  const [text, setText] = useState(fmt(value));
  useEffect(() => { setText(fmt(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const v = Number(text.trim().replace(',', '.'));
    if (text.trim() === '' || !Number.isFinite(v)) { setText(fmt(value)); return; }
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    if (c !== value) onChange(c);
    setText(fmt(c));
  };
  return (
    <label className="cam-field" title={title}>
      <span className="cam-label">{label}</span>
      <span className="cam-input-wrap">
        <input type="text" inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled}
          onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') setText(fmt(value)); }} />
        {unit && <span className="cam-unit">{unit}</span>}
      </span>
    </label>
  );
}
