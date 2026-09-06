'use client';
import { useMemo, useRef, useState } from 'react';
import { usePlan } from '@/lib/store/plan';
import { useUi } from '@/lib/store/ui';
import { useLibrary } from '@/lib/store/library';
import { useProject } from '@/lib/store/project';
import { t } from '@/lib/i18n';
import { exportGcode } from '@/lib/store/actions';
import { explainGcode, type ExplainedLine } from '@/lib/gcode/explain';
import { formatHms } from '@/lib/cam/time';

const ROW = 20;      // px per line; the list is windowed so long programs stay fast
const OVERSCAN = 30;

export function GcodeView() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const { gcode, error } = usePlan();
  const machines = useLibrary((l) => l.machines);
  const profiles = useLibrary((l) => l.profiles);
  const projectMachineId = useProject((p) => p.project.machineId);
  const [source, setSource] = useState<'program' | 'custom'>('program');
  const [custom, setCustom] = useState('');
  const [machineId, setMachineId] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [scroll, setScroll] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const text = source === 'program' ? gcode?.text ?? '' : custom;
  const machine = machines.find((m) => m.id === (machineId ?? projectMachineId)) ?? machines[0] ?? null;
  const profile = machine ? profiles.find((p) => p.id === machine.postId) ?? null : null;

  const isFmc = source === 'program' && gcode?.format === 'fmc';
  const explained = useMemo(
    () => (text && machine && profile && !isFmc ? explainGcode(text, { machine, profile, lang }) : null),
    [text, machine, profile, lang, isFmc],
  );
  const lines = explained?.lines ?? [];
  const selected: ExplainedLine | null = sel !== null ? lines[sel] ?? null : null;

  const height = listRef.current?.clientHeight ?? 600;
  const first = Math.max(0, Math.floor(scroll / ROW) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((scroll + height) / ROW) + OVERSCAN);
  const visible = lines.slice(first, last);

  return (
    <div className="cam-gcode">
      <div className="warn" style={{ margin: '8px 8px 0', fontSize: 12 }} role="note">⚠ {s.gcodeWarnBanner}</div>
      <div className="bar">
        <span className="cam-seg">
          {(['program', 'custom'] as const).map((v) => (
            <button type="button" key={v} className={source === v ? 'active' : ''} onClick={() => { setSource(v); setSel(null); }}>{v === 'program' ? s.srcProgram : s.srcCustom}</button>
          ))}
        </span>
        {source === 'program' && <span>{gcode?.filename ?? ''}</span>}
        {!isFmc && <span>{s.lines(lines.length)}</span>}
        <label className="cam-inline">
          {s.explainFor}
          <select value={machine?.id ?? ''} onChange={(e) => setMachineId(e.target.value)}>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        {explained && explained.seconds > 0 && <span>{s.explainRuntime}: {formatHms(explained.seconds)}</span>}
        {explained && <span style={{ color: explained.warnings ? 'var(--warn-text)' : undefined }}>{explained.warnings ? `⚠ ${s.explainWarnings(explained.warnings)}` : s.explainNoWarnings}</span>}
        {source === 'program' && error && <span className="dirty">{s.errors[error] ?? error}</span>}
        {source === 'program' && gcode?.warnings.map((w, i) => <span key={i} title={w} style={{ color: 'var(--warn-text)' }}>⚠ {w}</span>)}
        <span className="grow" />
        {source === 'custom' && <button type="button" className="btn small" onClick={() => { setCustom(''); setSel(null); }} disabled={!custom}>{s.explainClear}</button>}
        <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }} disabled={!text}>{copied ? s.copied : s.copy}</button>
        {source === 'program' && <button type="button" className="btn small primary" onClick={exportGcode} disabled={!gcode?.text}>{s.download}</button>}
      </div>

      {source === 'custom' && (
        <textarea className="cam-gcode-paste" value={custom} spellCheck={false} placeholder={s.pastePlaceholder} onChange={(e) => { setCustom(e.target.value); setSel(null); }} />
      )}

      {isFmc && (
        <div className="cam-gcode-plain">
          <p className="hint">{s.fmcHint} · {s.fmcFiles(gcode?.files?.length ?? 0)}</p>
          {(gcode?.files ?? []).map((fl) => (
            <details key={fl.name} open={(gcode?.files?.length ?? 0) === 1}>
              <summary>{fl.name} · {fl.bytes.length.toLocaleString()} B</summary>
              <pre>{fl.text}</pre>
            </details>
          ))}
          {!gcode?.files?.length && <div className="cam-empty" style={{ padding: 16 }}>{s.gcodeEmpty}</div>}
        </div>
      )}
      {!isFmc && <div className="cam-gcode-split">
        <div className="cam-gcode-lines" ref={listRef} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
          {!lines.length && <div className="cam-empty" style={{ padding: 16 }}>{source === 'custom' ? s.pasteEmpty : s.gcodeEmpty}</div>}
          <div style={{ height: lines.length * ROW, position: 'relative' }}>
            {visible.map((l) => (
              <div
                key={l.i}
                className={`row ${l.kind}${sel === l.i - 1 ? ' sel' : ''}${l.warnings.length ? ' warned' : ''}`}
                style={{ position: 'absolute', top: (l.i - 1) * ROW, height: ROW, left: 0, right: 0 }}
                onClick={() => setSel(l.i - 1)}
              >
                <span className="ln">{l.i}</span>
                <code>{l.text || ' '}</code>
                <span className="exp">{l.warnings.length > 0 && <b>⚠ </b>}{l.title}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="cam-gcode-detail">
          {!selected && <p className="hint">{s.explainSelect}</p>}
          {selected && (
            <>
              <header><strong>{s.explainLine(selected.i)}</strong> <span className="tag">{s.explainKinds[selected.kind] ?? selected.kind}</span></header>
              <pre>{selected.text || ' '}</pre>
              <p className="title">{selected.title}</p>
              {selected.details.length > 0 && <ul>{selected.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
              {selected.warnings.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
              <dl>
                <dt>{s.explainPos}</dt><dd>X {selected.pos.x.toFixed(2)} · Y {selected.pos.y.toFixed(2)} · Z {selected.pos.z.toFixed(2)} mm</dd>
                {selected.seconds > 0 && <><dt>{s.explainRuntime}</dt><dd>{formatHms(selected.seconds)}</dd></>}
              </dl>
            </>
          )}
          <p className="hint foot">{s.explainDisclaimer}</p>
        </aside>
      </div>}
    </div>
  );
}
