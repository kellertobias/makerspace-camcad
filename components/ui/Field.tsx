'use client';
import { useState, type ReactNode } from 'react';

export function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="cam-field">
      <span className="cam-label">{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="cam-field">
      <span className="cam-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function CheckField({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="cam-field cam-check" style={disabled ? { opacity: 0.55 } : undefined}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="cam-label">{label}</span>
    </label>
  );
}

const OPEN_KEY = 'cnc-cam:sections';
let openState: Record<string, boolean> | null = null;
function loadOpen(): Record<string, boolean> {
  if (openState) return openState;
  try { openState = JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>; } catch { openState = {}; }
  return openState!;
}
function saveOpen(id: string, open: boolean) {
  const st = loadOpen(); st[id] = open;
  try { window.localStorage.setItem(OPEN_KEY, JSON.stringify(st)); } catch {}
}

/**
 * Collapsible panel section. `id` identifies the section for remembering its state; `defaultOpen` applies
 * until the user toggles it. Sections without an id are always open.
 */
export function Section({ title, children, actions, id, defaultOpen = true }: { title: string; children: ReactNode; actions?: ReactNode; id?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => (id ? loadOpen()[id] ?? defaultOpen : true));
  const toggle = () => { if (!id) return; setOpen((o) => { saveOpen(id, !o); return !o; }); };
  return (
    <section className={`cam-section${open ? '' : ' closed'}`} data-section={id}>
      <header>
        <h3 onClick={toggle} style={id ? { cursor: 'pointer' } : undefined}>{id && <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>}{title}</h3>
        {actions}
      </header>
      {open && <div className="cam-section-body">{children}</div>}
    </section>
  );
}
