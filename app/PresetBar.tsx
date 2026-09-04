'use client';

import { useState } from 'react';

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
}

export function PresetBar<T extends Preset>({ kind, presets, selectedId, label, onSelect, onSave, onDelete, canSave }: Props<T>) {
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
        aria-label={`Saved ${kind}s`}
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="">{presets.length ? `— choose a saved ${kind} —` : `no saved ${kind}s yet`}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>{label(p)}</option>
        ))}
      </select>
      {naming ? (
        <span className="row">
          <input
            type="text"
            autoFocus
            placeholder={`${kind} name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setNaming(false); }}
          />
          <button type="button" className="btn primary" onClick={commit} disabled={!name.trim()}>Save</button>
          <button type="button" className="btn" onClick={() => setNaming(false)}>Cancel</button>
        </span>
      ) : (
        <span className="row">
          {selected && (
            <button type="button" className="btn" onClick={() => onSave(selected.name)} disabled={!canSave} title="Overwrite with the current values">
              Update
            </button>
          )}
          <button type="button" className="btn" onClick={() => { setName(selected?.name ? '' : ''); setNaming(true); }} disabled={!canSave}>
            Save as…
          </button>
          {selected && (
            <button type="button" className="btn danger" onClick={() => { if (confirm(`Delete ${kind} "${selected.name}"?`)) onDelete(selected.id); }}>
              Delete
            </button>
          )}
        </span>
      )}
    </div>
  );
}
