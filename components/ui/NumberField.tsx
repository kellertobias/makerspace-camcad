'use client';
import { useEffect, useRef, useState } from 'react';

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
  // latest state for the unmount commit (the field may disappear before its blur event when the selection changes)
  const latest = useRef({ text, value, onChange, min, max });
  latest.current = { text, value, onChange, min, max };
  const parse = (txt: string, cur: number | undefined, lo?: number, hi?: number) => {
    const v = Number(txt.trim().replace(',', '.'));
    if (txt.trim() === '' || !Number.isFinite(v)) return null;
    let c = v;
    if (lo !== undefined) c = Math.max(lo, c);
    if (hi !== undefined) c = Math.min(hi, c);
    return c !== cur ? c : null;
  };
  const commit = () => {
    const c = parse(text, value, min, max);
    if (c === null) { setText(fmt(value)); return; }
    onChange(c);
    setText(fmt(c));
  };
  useEffect(() => () => {
    // unmounting with an uncommitted edit: save it
    const l = latest.current;
    const c = parse(l.text, l.value, l.min, l.max);
    if (c !== null) l.onChange(c);
  }, []);
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
