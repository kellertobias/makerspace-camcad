'use client';

import { useEffect, useMemo, useState } from 'react';
import { VARS, solve, fmt, type Inputs, type VarKey } from '@/lib/solver';
import {
  loadTools, newId, saveSpindles, seedSpindles, saveTools, spindleLabel, toolLabel,
  type SpindlePreset, type ToolPreset,
} from '@/lib/presets';
import { Illustration } from './Illustration';
import { t, other, type Lang } from '@/lib/i18n';
import { PresetBar } from './PresetBar';
import { Help } from './Help';

const EMPTY: Inputs = { n: '', vc: '', d: '', z: '', fz: '', vf: '', nMax: '', nMin: '', vfMax: '' };
const STORAGE_KEY = 'cnc-milling-calc:v1';
const LANG_KEY = 'cnc-milling-calc:lang';

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
  const [lang, setLang] = useState<Lang>('de');
  const s = t(lang);
  const o = other(lang);

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
    setSpindles(seedSpindles());
    try {
      const l = window.localStorage.getItem(LANG_KEY);
      if (l === 'de' || l === 'en') setLang(l);
    } catch {}
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

  const toggleLang = () => {
    const next = other(lang);
    setLang(next);
    try { window.localStorage.setItem(LANG_KEY, next); } catch {}
  };

  const fzSuggestion = useMemo(() => {
    const d = sol.vars.d.value;
    return inputs.fz.trim() === '' && d ? d / 150 : null;
  }, [sol, inputs.fz]);

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
    const m = spindles.find((x) => x.id === id);
    if (m) setInputs((prev) => ({ ...prev, nMax: m.nMax, nMin: m.nMin ?? '', vfMax: m.vfMax ?? '' }));
  };
  const saveSpindle = (name: string) => {
    const existing = spindles.find((s) => s.name === name);
    const preset: SpindlePreset = {
      id: existing?.id ?? newId(), name, nMax: inputs.nMax, nMin: inputs.nMin, vfMax: inputs.vfMax, info: existing?.info,
    };
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
      <div className="topbar">
        <h1>{s.title}</h1>
        <button
          type="button"
          className={`langbtn${loaded ? '' : ' pending'}`}
          onClick={toggleLang}
          title={lang === 'de' ? 'Switch to English' : 'Auf Deutsch umschalten'}
          aria-label={lang === 'de' ? 'Switch to English' : 'Auf Deutsch umschalten'}
        >
          <span className={lang === 'de' ? 'flag active' : 'flag'}>🇩🇪</span>
          <span className={lang === 'en' ? 'flag active' : 'flag'}>🇬🇧</span>
        </button>
      </div>
      <p className="sub">{s.sub}</p>

      <section className="card">
        <h2>{s.formulas}</h2>
        <div className="formulas">
          <span>n = (vc · 1000) / (π · d)</span>
          <span>vf = n · z · fz</span>
          <span>n<sub>used</sub> = min(n, n<sub>max</sub>)</span>
        </div>
      </section>

      <section className="card">
        <h2>{s.spindle}</h2>
        <PresetBar
          kind={s.kindSpindle}
          presets={spindles}
          selectedId={spindleId}
          label={(p) => spindleLabel(p, lang === 'de' ? 'U/min' : 'RPM')}
          s={s}
          onSelect={applySpindle}
          onSave={saveSpindle}
          onDelete={deleteSpindle}
          canSave={inputs.nMax.trim() !== '' || inputs.nMin.trim() !== '' || inputs.vfMax.trim() !== ''}
        />
        {(() => {
          const m = spindles.find((x) => x.id === spindleId);
          return m?.info ? (
            <p className="machineinfo"><strong>{s.machineInfo}:</strong> {m.info}</p>
          ) : null;
        })()}
        <div className="grid">
          {([
            ['nMax', s.nMaxName, s.nMaxNameOther, s.nMaxDesc, lang === 'de' ? 'U/min' : 'RPM', 'e.g. 24000'],
            ['nMin', s.nMinName, s.nMinNameOther, s.nMinDesc, lang === 'de' ? 'U/min' : 'RPM', s.optional],
            ['vfMax', s.vfMaxName, s.vfMaxNameOther, s.vfMaxDesc, 'mm/min', s.optional],
          ] as const).map(([key, name, name2, desc, unit, ph]) => (
            <div className="field" key={key}>
              <label htmlFor={key}>
                <span className="sym">{key === 'nMax' ? <>n<sub>max</sub></> : key === 'nMin' ? <>n<sub>min</sub></> : <>vf<sub>max</sub></>}</span>
                <span className="name">{name}</span>
                <span className="name2">{name2}</span>
                <span className="unit">{unit}</span>
              </label>
              <span className="desc">{desc}</span>
              <input
                id={key}
                type="text"
                inputMode="decimal"
                placeholder={ph}
                value={inputs[key]}
                onChange={(e) => update(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{s.toolParams}</h2>
        <PresetBar
          kind={s.kindTool}
          presets={tools}
          selectedId={toolId}
          label={(p) => toolLabel(p, s.flutesAbbr)}
          s={s}
          onSelect={applyTool}
          onSave={saveTool}
          onDelete={deleteTool}
          canSave={inputs.d.trim() !== '' || inputs.z.trim() !== ''}
        />
        <p className="hint" style={{ marginTop: 0 }}>
          {s.toolHint}
        </p>
        <div className="grid">
          {VARS.map((v) => {
            const sv = sol.vars[v.key];
            const isInput = inputs[v.key].trim() !== '';
            const shown = isInput ? inputs[v.key] : sv.value !== null ? fmt(sv.value) : '';
            return (
              <div className="field" key={v.key}>
                <div className="ill"><Illustration k={v.key} flutes={flutes} s={s} /></div>
                <label htmlFor={v.key}>
                  <span className="sym">{v.symbol}{v.aliases?.map((a) => <span className="alias" key={a}> = {a}</span>)}</span>
                  <span className="name">{v.name[lang]}</span>
                  <span className="name2">{v.name[o]}</span>
                  <span className="unit">{v.unit === 'RPM (1/min)' && lang === 'de' ? 'U/min' : v.unit}</span>
                  {v.key === 'fz' && <Help label={s.helpLabel}><strong>{s.fzWhy}</strong><br />{s.fzWhyText}</Help>}
                  {v.key === 'vc' && <Help label={s.helpLabel}><strong>{s.vcHelp}</strong><br />{s.vcHelpText}</Help>}
                </label>
                <span className="desc">{v.description[lang]}</span>
                <div className="row">
                  <input
                    id={v.key}
                    type="text"
                    inputMode="decimal"
                    className={!isInput && sv.source === 'computed' ? 'computed' : ''}
                    placeholder={isInput || sv.source === 'computed' ? '' : s.placeholder}
                    value={shown}
                    onChange={(e) => update(v.key as VarKey, e.target.value)}
                    onFocus={(e) => { if (!isInput) e.target.select(); }}
                  />
                  <span className={`badge ${isInput ? 'input' : sv.source}`}>
                    {isInput ? s.given : sv.source === 'computed' ? s.calculated : s.unknown}
                  </span>
                  {isInput && (
                    <button className="clear" type="button" onClick={() => update(v.key as VarKey, '')} title={s.clear}>
                      ✕
                    </button>
                  )}
                </div>
                {v.key === 'fz' && fzSuggestion !== null && (
                  <div className="suggest">
                    <span className="k">{s.fzSuggest}:</span>
                    <span className="v">{fmt(fzSuggestion)} mm</span>
                    <button type="button" className="btn small" onClick={() => update('fz', fmt(fzSuggestion))}>{s.use}</button>
                    <Help label={s.helpLabel}><strong>{s.fzSuggest}</strong><br />{s.fzSuggestText}</Help>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {sol.messages.map((m) => (
          <div className="warn" key={m.kind}>{s.msg(m)}</div>
        ))}
        <p className="hint">{s.legend}</p>
      </section>

      <section className="card">
        <h2>{s.result}</h2>
        <div className="summary">
          <div className="stat">
            <div className="k">{s.resN}{sol.capped ? ` ${s.capped}` : ''}</div>
            <div className="v">{fmt(sol.vars.n.value)}<span className="u">{lang === 'de' ? 'U/min' : 'RPM'}</span></div>
          </div>
          <div className="stat">
            <div className="k">{s.resVf}{sol.vfCapped ? ` ${s.vfCapped}` : ''}</div>
            <div className="v">{fmt(sol.vars.vf.value)}<span className="u">mm/min</span></div>
          </div>
          <div className="stat">
            <div className="k">{s.resVc}</div>
            <div className="v">{fmt(sol.vcEffective)}<span className="u">m/min</span></div>
          </div>
          {sol.capped && (
            <div className="stat">
              <div className="k">{s.resNReq}</div>
              <div className="v">{fmt(sol.nUncapped)}<span className="u">{lang === 'de' ? 'U/min' : 'RPM'}</span></div>
            </div>
          )}
        </div>
        <p className="hint">
          <button className="clear" type="button" onClick={reset}>{s.reset}</button>
        </p>
      </section>
    </main>
  );
}
