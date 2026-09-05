'use client';

import { useState } from 'react';
import type { Strings } from '@/lib/i18n';

interface Preset { id: string; name: string }

interface Props<T extends Preset> {
  kind: string;
  presets: T[];
  selectedId: string;
  label: (p: T) => string;
  onSelect: (id: string) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  canSave: boolean;
  s: Strings;
}

export function PresetBar<T extends Preset>({ kind, presets, selectedId, label, onSelect, onSave, onDelete, canSave, s }: Props<T>) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const selected = presets.find((p) => p.id === selectedId);

  const commit = () => {
    const n = name.trim();
    if (!n) return;
    onSave(n);
    setName('');
    setNaming(false);
  };

  return (
    <div className="presets">
      <select
        aria-label={s.savedLabel(kind)}
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">{presets.length ? s.choose(kind) : s.none(kind)}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>{label(p)}</option>
        ))}
      </select>
      {naming ? (
        <span className="row">
          <input
            type="text"
            autoFocus
            placeholder={s.namePh(kind)}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setNaming(false); }}
          />
          <button type="button" className="btn primary" onClick={commit} disabled={!name.trim()}>{s.save}</button>
          <button type="button" className="btn" onClick={() => setNaming(false)}>{s.cancel}</button>
        </span>
      ) : (
        <span className="row">
          {selected && (
            <button type="button" className="btn" onClick={() => onSave(selected.name)} disabled={!canSave} title={s.updateTitle}>
              {s.update}
            </button>
          )}
          <button type="button" className="btn" onClick={() => { setName(''); setNaming(true); }} disabled={!canSave}>
            {s.saveAs}
          </button>
          {selected && (
            <button type="button" className="btn danger" onClick={() => { if (confirm(s.confirmDelete(kind, selected.name))) onDelete(selected.id); }}>
              {s.del}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
