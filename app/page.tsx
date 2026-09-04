'use client';

import { useEffect, useMemo, useState } from 'react';
import { VARS, solve, fmt, type Inputs, type VarKey } from '@/lib/solver';

const EMPTY: Inputs = { n: '', vc: '', d: '', z: '', fz: '', vf: '', nMax: '' };
const STORAGE_KEY = 'cnc-milling-calc:v1';

export default function Page() {
  const [inputs, setInputs] = useState<Inputs>(EMPTY);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setInputs({ ...EMPTY, ...JSON.parse(raw) });
    } catch {}
  }, []);
  const sol = useMemo(() => solve(inputs), [inputs]);

  const update = (key: keyof Inputs, value: string) => {
    setInputs((prev) => {
      const next = { ...prev, [key]: value };
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const reset = () => {
    setInputs(EMPTY);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
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
        <h2>Parameters</h2>
        <div className="grid">
          {VARS.map((v) => {
            const s = sol.vars[v.key];
            const isInput = inputs[v.key].trim() !== '';
            const shown = isInput ? inputs[v.key] : s.value !== null ? fmt(s.value) : '';
            return (
              <div className="field" key={v.key}>
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
          field turns it into a given value. Decimal comma or point both work.
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
