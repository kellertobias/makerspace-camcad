'use client';

import { useEffect, useMemo, useState } from 'react';
import { VARS, solve, fmt, type Inputs, type VarKey } from '@/lib/solver';
import {
  loadSpindles, loadTools, newId, saveSpindles, saveTools, spindleLabel, toolLabel,
  type SpindlePreset, type ToolPreset,
} from '@/lib/presets';
import { Illustration } from './Illustration';
import { PresetBar } from './PresetBar';

const EMPTY: Inputs = { n: '', vc: '', d: '', z: '', fz: '', vf: '', nMax: '' };
const STORAGE_KEY = 'cnc-milling-calc:v1';

interface Persisted {
  inputs: Inputs;
  toolId: string;
  spindleId: string;
}

export default function Page() {
  const [inputs, setInputs] = useState<Inputs>(EMPTY);
  const [tools, setTools] = useState<ToolPreset[]>([]);
  const [spindles, setSpindles] = useState<SpindlePreset[]>([]);
  const [toolId, setToolId] = useState('');
  const [spindleId, setSpindleId] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Restore everything once on the client (after hydration, so the static HTML matches).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persisted> & Partial<Inputs>;
        // Older versions stored the inputs object directly.
        const ins = p.inputs ?? (p as Partial<Inputs>);
        setInputs({ ...EMPTY, ...ins });
        setToolId(p.toolId ?? '');
        setSpindleId(p.spindleId ?? '');
      }
    } catch {}
    setTools(loadTools());
    setSpindles(loadSpindles());
    setLoaded(true);
  }, []);

  // Whatever was entered last stays.
  useEffect(() => {
    if (!loaded) return;
    try {
      const p: Persisted = { inputs, toolId, spindleId };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    } catch {}
  }, [inputs, toolId, spindleId, loaded]);

  const sol = useMemo(() => solve(inputs), [inputs]);
  const flutes = useMemo(() => {
    const z = sol.vars.z.value;
    return z && Number.isFinite(z) ? Math.max(1, Math.min(16, Math.round(z))) : undefined;
  }, [sol]);

  const update = (key: keyof Inputs, value: string) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  const reset = () => {
    setInputs(EMPTY);
    setToolId('');
    setSpindleId('');
  };

  // ---- tool presets -------------------------------------------------------
  const applyTool = (id: string) => {
    setToolId(id);
    const t = tools.find((x) => x.id === id);
    if (!t) return;
    setInputs((prev) => ({
      ...prev,
      d: t.d,
      z: t.z,
      vc: t.vc || prev.vc,
      fz: t.fz || prev.fz,
      // Derived values are recalculated, so drop stale user-typed outputs.
      n: '',
      vf: '',
    }));
  };
  const saveTool = (name: string) => {
    const existing = tools.find((t) => t.name === name);
    const preset: ToolPreset = { id: existing?.id ?? newId(), name, d: inputs.d, z: inputs.z, vc: inputs.vc, fz: inputs.fz };
    const next = existing ? tools.map((t) => (t.id === existing.id ? preset : t)) : [...tools, preset];
    setTools(next);
    saveTools(next);
    setToolId(preset.id);
  };
  const deleteTool = (id: string) => {
    const next = tools.filter((t) => t.id !== id);
    setTools(next);
    saveTools(next);
    if (toolId === id) setToolId('');
  };

  // ---- spindle presets ----------------------------------------------------
  const applySpindle = (id: string) => {
    setSpindleId(id);
    const s = spindles.find((x) => x.id === id);
    if (s) update('nMax', s.nMax);
  };
  const saveSpindle = (name: string) => {
    const existing = spindles.find((s) => s.name === name);
    const preset: SpindlePreset = { id: existing?.id ?? newId(), name, nMax: inputs.nMax };
    const next = existing ? spindles.map((s) => (s.id === existing.id ? preset : s)) : [...spindles, preset];
    setSpindles(next);
    saveSpindles(next);
    setSpindleId(preset.id);
  };
  const deleteSpindle = (id: string) => {
    const next = spindles.filter((s) => s.id !== id);
    setSpindles(next);
    saveSpindles(next);
    if (spindleId === id) setSpindleId('');
  };

  return (
    <main>
      <h1>CNC Milling Calculator</h1>
      <p className="sub">
        Enter the values you know. Every value that can be derived from the rest is filled in automatically.
      </p>

      <section className="card">
        <h2>Formulas</h2>
        <div className="formulas">
          <span>n = (vc · 1000) / (π · d)</span>
          <span>vf = n · z · fz</span>
          <span>n<sub>used</sub> = min(n, n<sub>max</sub>)</span>
        </div>
      </section>

      <section className="card">
        <h2>Spindle</h2>
        <PresetBar
          kind="spindle"
          presets={spindles}
          selectedId={spindleId}
          label={spindleLabel}
          onSelect={applySpindle}
          onSave={saveSpindle}
          onDelete={deleteSpindle}
          canSave={inputs.nMax.trim() !== ''}
        />
        <div className="field">
          <label htmlFor="nMax">
            <span className="sym">n<sub>max</sub></span>
            <span className="name">Maximum spindle speed</span>
            <span className="unit">RPM</span>
          </label>
          <span className="desc">
            Maximale Drehzahl of your milling motor. If the required speed exceeds this, the calculator
            uses the maximum instead and recalculates the feed rate from it.
          </span>
          <input
            id="nMax"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 24000"
            value={inputs.nMax}
            onChange={(e) => update('nMax', e.target.value)}
          />
        </div>
      </section>

      <section className="card">
        <h2>Tool &amp; parameters</h2>
        <PresetBar
          kind="tool"
          presets={tools}
          selectedId={toolId}
          label={toolLabel}
          onSelect={applyTool}
          onSave={saveTool}
          onDelete={deleteTool}
          canSave={inputs.d.trim() !== '' || inputs.z.trim() !== ''}
        />
        <p className="hint" style={{ marginTop: 0 }}>
          A saved tool stores diameter, flutes, and — if entered — cutting speed and feed per tooth.
        </p>
        <div className="grid">
          {VARS.map((v) => {
            const s = sol.vars[v.key];
            const isInput = inputs[v.key].trim() !== '';
            const shown = isInput ? inputs[v.key] : s.value !== null ? fmt(s.value) : '';
            return (
              <div className="field" key={v.key}>
                <div className="ill"><Illustration k={v.key} flutes={flutes} /></div>
                <label htmlFor={v.key}>
                  <span className="sym">{v.symbol}</span>
                  <span className="name">{v.name}</span>
                  <span className="unit">{v.unit}</span>
                </label>
                <span className="desc">{v.description}</span>
                <div className="row">
                  <input
                    id={v.key}
                    type="text"
                    inputMode="decimal"
                    className={!isInput && s.source === 'computed' ? 'computed' : ''}
                    placeholder={isInput ? '' : s.source === 'computed' ? '' : 'enter or leave empty'}
                    value={shown}
                    onChange={(e) => update(v.key as VarKey, e.target.value)}
                    onFocus={(e) => { if (!isInput) e.target.select(); }}
                  />
                  <span className={`badge ${isInput ? 'input' : s.source}`}>
                    {isInput ? 'given' : s.source === 'computed' ? 'calculated' : 'unknown'}
                  </span>
                  {isInput && (
                    <button className="clear" type="button" onClick={() => update(v.key as VarKey, '')} title="Clear">
                      ✕
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {sol.messages.map((m) => (
          <div className="warn" key={m}>{m}</div>
        ))}
        <p className="hint">
          Values entered by you are marked <em>given</em>; blue fields are <em>calculated</em>. Typing into a calculated
          field turns it into a given value. Decimal comma or point both work. Everything you enter is kept in this
          browser until you change it.
        </p>
      </section>

      <section className="card">
        <h2>Result</h2>
        <div className="summary">
          <div className="stat">
            <div className="k">Spindle speed n{sol.capped ? ' (capped)' : ''}</div>
            <div className="v">{fmt(sol.vars.n.value)}<span className="u">RPM</span></div>
          </div>
          <div className="stat">
            <div className="k">Feed rate vf (F)</div>
            <div className="v">{fmt(sol.vars.vf.value)}<span className="u">mm/min</span></div>
          </div>
          <div className="stat">
            <div className="k">Effective cutting speed vc</div>
            <div className="v">{fmt(sol.vcEffective)}<span className="u">m/min</span></div>
          </div>
          {sol.capped && (
            <div className="stat">
              <div className="k">Required n (uncapped)</div>
              <div className="v">{fmt(sol.nUncapped)}<span className="u">RPM</span></div>
            </div>
          )}
        </div>
        <p className="hint">
          <button className="clear" type="button" onClick={reset}>Reset all fields</button>
        </p>
      </section>
    </main>
  );
}
