'use client';
import { useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { NumberField } from '@/components/ui/NumberField';
import { CheckField, SelectField, TextField } from '@/components/ui/Field';
import { useLibrary } from '@/lib/store/library';
import { useUi } from '@/lib/store/ui';
import { useProject } from '@/lib/store/project';
import { t } from '@/lib/i18n';
import { newMachine, newTool } from '@/lib/model/defaults';
import type { Machine, Tool, ToolKind } from '@/lib/model/project';
import { newId } from '@/lib/model/ids';
import { parsePp, serializePp, type PostProfile } from '@/lib/post';
import { openTextFiles, saveText } from '@/lib/persist/fs';
import { exportLibraryFile, exportMachineFile, exportToolsetFile, importLibraryFiles } from '@/lib/store/libraryIo';
import { solve, fmt } from '@/lib/solver';
import { HlProvider, Hl, ToolDiagram } from '@/components/panels/Diagrams';

export function OptionsModal() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const tab = useUi((u) => u.optionsTab);
  const openModal = useUi((u) => u.openModal);
  const close = useUi((u) => u.closeModal);
  return (
    <Modal title={s.options} onClose={close} wide>
      <div className="cam-tabs">
        {(['tools', 'machines', 'posts'] as const).map((k) => <button type="button" key={k} className={tab === k ? 'active' : ''} onClick={() => openModal('options', k)}>{k === 'tools' ? s.toolLibrary : k === 'machines' ? s.machines : s.posts}</button>)}
      </div>
      {tab === 'tools' && <ToolsTab />}
      {tab === 'machines' && <MachinesTab />}
      {tab === 'posts' && <PostsTab />}
    </Modal>
  );
}

function ToolsTab() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const lib = useLibrary();
  const [id, setId] = useState(lib.activeToolId || lib.tools[0]?.id || '');
  const tool = lib.tools.find((x) => x.id === id);
  const syncProject = useProject((p) => p.update);
  const save = (tl: Tool) => { lib.upsertTool(tl); syncProject((p) => { if (p.tools[tl.id]) p.tools[tl.id] = tl; }); };
  const add = () => { const tl = newTool({ slot: Math.max(0, ...lib.tools.map((x) => x.slot)) + 1, name: lang === 'de' ? 'Neues Werkzeug' : 'New tool' }); lib.upsertTool(tl); setId(tl.id); };
  const dup = () => { if (!tool) return; const tl = { ...tool, id: newId('t'), name: tool.name + ' (2)', slot: Math.max(0, ...lib.tools.map((x) => x.slot)) + 1 }; lib.upsertTool(tl); setId(tl.id); };
  const del = () => { if (tool && confirm(s.confirmDelete(tool.name))) { lib.deleteTool(tool.id); setId(lib.tools.find((x) => x.id !== tool.id)?.id ?? ''); } };
  return (
    <div className="cam-options">
      <div className="list">
        {lib.tools.map((tl) => <button type="button" key={tl.id} className={`item${tl.id === id ? ' active' : ''}`} onClick={() => setId(tl.id)}>T{tl.slot} {tl.name}<span className="meta">{s.toolKinds[tl.kind]} · Ø{tl.d} mm{tl.z ? ` · ${tl.z} ${s.flutesAbbr}` : ''}</span></button>)}
        <button type="button" className="btn" onClick={add} style={{ marginTop: 8 }}>+ {s.addTool}</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          <button type="button" className="btn small" onClick={() => exportToolsetFile()} title={s.exportAllTools}>⤴ {s.exportAllTools}</button>
          <button type="button" className="btn small" onClick={async () => { const r = await importLibraryFiles(lib.activeMachineId || undefined); if (r?.tools.length) setId(r.tools[0]); }} title={s.importHint}>⤵ {s.importTools}</button>
        </div>
      </div>
      {tool ? <ToolEditor tool={tool} onChange={save} onDelete={del} onDuplicate={dup} /> : <div className="cam-empty">–</div>}
    </div>
  );
}

function ToolEditor({ tool, onChange, onDelete, onDuplicate }: { tool: Tool; onChange: (t: Tool) => void; onDelete: () => void; onDuplicate: () => void }) {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const lib = useLibrary();
  const set = (p: Partial<Tool>) => onChange({ ...tool, ...p });
  const cut = (p: Partial<Tool['cut']>) => onChange({ ...tool, cut: { ...tool.cut, ...p } });
  const isLaser = tool.kind === 'laser';
  // cutting-data assistant: n from vc, vf from n·z·fz using the active machine limits
  const machine = lib.machines.find((m) => m.id === lib.activeMachineId);
  const sol = useMemo(() => solve({ n: '', vc: tool.cut.vc?.toString() ?? '', d: String(tool.d), z: String(tool.z ?? ''), fz: tool.cut.fz?.toString() ?? '', vf: '', nMax: String(machine?.nMax ?? ''), nMin: String(machine?.nMin ?? ''), vfMax: String(machine?.feedMax.xy ?? '') }), [tool, machine]);
  return (
    <HlProvider>
    <div className="editor">
      <div className="full"><TextField label={s.name} value={tool.name} onChange={(v) => set({ name: v })} /></div>
      <div className="full"><ToolDiagram kind={tool.kind} d={tool.d} z={tool.z} tipAngle={tool.tipAngle} fluteLength={tool.fluteLength} stepDown={tool.cut.stepDown} stepOverPct={tool.cut.stepOverPct} rampAngle={tool.cut.rampAngle} lang={lang} /></div>
      <SelectField label={s.toolKind} value={tool.kind} options={(Object.keys(s.toolKinds) as ToolKind[]).map((k) => ({ value: k, label: s.toolKinds[k] }))} onChange={(v) => set({ kind: v })} />
      <NumberField label={s.slot} value={tool.slot} digits={0} min={0} onChange={(v) => set({ slot: Math.round(v) })} />
      <Hl k="diameter"><NumberField label={s.diameter} unit="mm" value={tool.d} min={0.01} onChange={(v) => set({ d: v })} /></Hl>
      {!isLaser && <Hl k="flutes"><NumberField label={s.flutes} value={tool.z} digits={0} min={1} onChange={(v) => set({ z: Math.round(v) })} /></Hl>}
      {!isLaser && tool.kind !== 'vbit' && tool.kind !== 'drill' && <Hl k="fluteLength"><NumberField label={s.fluteLength} unit="mm" value={tool.fluteLength} min={0.1} onChange={(v) => set({ fluteLength: v })} placeholder="–" /></Hl>}
      {(tool.kind === 'vbit' || tool.kind === 'drill') && <Hl k="tipAngle"><NumberField label={s.tipAngle} unit="°" value={tool.tipAngle} min={1} max={180} onChange={(v) => set({ tipAngle: v })} /></Hl>}
      {!isLaser && <Hl k="spindleSpeed"><NumberField label={s.spindleSpeed} unit="1/min" value={tool.cut.n} onChange={(v) => cut({ n: v })} /></Hl>}
      <Hl k="feed"><NumberField label={s.feed} unit="mm/min" value={tool.cut.vf} onChange={(v) => cut({ vf: v })} /></Hl>
      {!isLaser && <Hl k="plungeFeed"><NumberField label={s.plungeFeed} unit="mm/min" value={tool.cut.vfPlunge} onChange={(v) => cut({ vfPlunge: v })} /></Hl>}
      {!isLaser && <Hl k="stepDown"><NumberField label={s.stepDown} unit="mm" value={tool.cut.stepDown} min={0.05} onChange={(v) => cut({ stepDown: v })} /></Hl>}
      {!isLaser && <Hl k="stepOverPct"><NumberField label={s.stepOverPct} unit="%" value={tool.cut.stepOverPct} min={5} max={100} onChange={(v) => cut({ stepOverPct: v })} /></Hl>}
      {!isLaser && <Hl k="rampAngle"><NumberField label={s.rampAngle} unit="°" value={tool.cut.rampAngle} min={1} max={90} onChange={(v) => cut({ rampAngle: v })} title={lang === 'de' ? '90° = kein Rampen, senkrecht eintauchen' : '90° = no ramp, straight plunge'} /></Hl>}
      {isLaser && <NumberField label={lang === 'de' ? 'Leistung' : 'Power'} unit="%" value={tool.cut.power} min={0} max={100} onChange={(v) => cut({ power: v })} />}
      {isLaser && <NumberField label={lang === 'de' ? 'Durchgänge' : 'Passes'} value={tool.cut.passes} digits={0} min={1} onChange={(v) => cut({ passes: Math.round(v) })} />}
      {!isLaser && (
        <div className="cam-assist">
          <h4>{s.assistant} — n = vc·1000/(π·d), vf = n·z·fz{machine ? ` · ${machine.name}` : ''}</h4>
          <NumberField label="vc" unit="m/min" value={tool.cut.vc} onChange={(v) => cut({ vc: v })} />
          <NumberField label="fz" unit="mm" value={tool.cut.fz} onChange={(v) => cut({ fz: v })} placeholder={fmt(tool.d / 150)} />
          <div className="out">n = {fmt(sol.vars.n.value)} 1/min{sol.capped ? ' (max)' : ''}<br />vf = {fmt(sol.vars.vf.value)} mm/min{sol.vfCapped ? ' (max)' : ''}</div>
          <button type="button" className="btn small primary" disabled={sol.vars.n.value === null} onClick={() => cut({ n: Math.round(sol.vars.n.value ?? 0), vf: sol.vars.vf.value ? Math.round(sol.vars.vf.value) : tool.cut.vf })}>{s.applyToTool}</button>
        </div>
      )}
      <div className="full" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn" onClick={onDuplicate}>{s.duplicateItem}</button>
        <button type="button" className="btn danger" onClick={onDelete}>{s.delete}</button>
        <span style={{ flex: 1 }} />
        <a href="./calc/" target="_blank" rel="noreferrer" className="btn" style={{ textDecoration: 'none' }}>{s.calculator} ↗</a>
      </div>
    </div>
    </HlProvider>
  );
}

function MachinesTab() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const lib = useLibrary();
  const [id, setId] = useState(lib.activeMachineId || lib.machines[0]?.id || '');
  const m = lib.machines.find((x) => x.id === id);
  const set = (p: Partial<Machine>) => m && lib.upsertMachine({ ...m, ...p });
  const add = () => { const nm = newMachine({ name: lang === 'de' ? 'Neue Maschine' : 'New machine' }); lib.upsertMachine(nm); setId(nm.id); };
  return (
    <div className="cam-options">
      <div className="list">
        {lib.machines.map((x) => <button type="button" key={x.id} className={`item${x.id === id ? ' active' : ''}`} onClick={() => setId(x.id)}>{x.name}<span className="meta">{s.kinds[x.kind]} · {lib.profiles.find((p) => p.id === x.postId)?.name ?? x.postId}</span></button>)}
        <button type="button" className="btn" onClick={add} style={{ marginTop: 8 }}>+ {s.addMachine}</button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          <button type="button" className="btn small" onClick={async () => { const r = await importLibraryFiles(); if (r?.machines.length) setId(r.machines[0]); }} title={s.importHint}>⤵ {s.importBundle}</button>
          <button type="button" className="btn small" onClick={exportLibraryFile}>⤴ {s.exportLibrary}</button>
        </div>
      </div>
      {m ? (
        <div className="editor">
          <div className="full"><TextField label={s.machineName} value={m.name} onChange={(v) => set({ name: v })} /></div>
          <SelectField label={s.machineKind} value={m.kind} options={[{ value: 'cnc', label: s.kinds.cnc }, { value: 'laser', label: s.kinds.laser }]} onChange={(v) => set({ kind: v, laser: v === 'laser' ? m.laser ?? { sMax: 1000, dynamic: true } : undefined })} />
          <SelectField label={s.postProcessor} value={m.postId} options={lib.profiles.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => set({ postId: v })} />
          <NumberField label={s.travelX} unit="mm" value={m.travel.x} onChange={(v) => set({ travel: { ...m.travel, x: v } })} />
          <NumberField label={s.travelY} unit="mm" value={m.travel.y} onChange={(v) => set({ travel: { ...m.travel, y: v } })} />
          <NumberField label={s.travelZ} unit="mm" value={m.travel.z} onChange={(v) => set({ travel: { ...m.travel, z: v } })} />
          {m.kind === 'cnc' && <NumberField label={s.nMax} unit="1/min" value={m.nMax} onChange={(v) => set({ nMax: v })} />}
          {m.kind === 'cnc' && <NumberField label={s.nMin} unit="1/min" value={m.nMin} onChange={(v) => set({ nMin: v })} />}
          <NumberField label={s.feedMaxXy} unit="mm/min" value={m.feedMax.xy} onChange={(v) => set({ feedMax: { ...m.feedMax, xy: v } })} />
          <NumberField label={s.feedMaxZ} unit="mm/min" value={m.feedMax.z} onChange={(v) => set({ feedMax: { ...m.feedMax, z: v } })} />
          <NumberField label={s.rapidXy} unit="mm/min" value={m.rapid.xy} onChange={(v) => set({ rapid: { ...m.rapid, xy: v } })} />
          <NumberField label={s.rapidZ} unit="mm/min" value={m.rapid.z} onChange={(v) => set({ rapid: { ...m.rapid, z: v } })} />
          {m.kind === 'cnc' && <CheckField label={s.climbAllowed} value={m.climbAllowed === true} onChange={(v) => set({ climbAllowed: v })} />}
          <SelectField label={s.toolChange} value={m.toolChange} options={[{ value: 'manual', label: s.toolChanges.manual }, { value: 'auto', label: s.toolChanges.auto }]} onChange={(v) => set({ toolChange: v })} />
          {m.kind === 'laser' && <NumberField label="S max" value={m.laser?.sMax ?? 1000} onChange={(v) => set({ laser: { sMax: v, dynamic: m.laser?.dynamic ?? true } })} />}
          {m.kind === 'laser' && <CheckField label="M4 dynamic power" value={m.laser?.dynamic ?? true} onChange={(v) => set({ laser: { sMax: m.laser?.sMax ?? 1000, dynamic: v } })} />}
          <label className="cam-field full"><span className="cam-label">{s.info}</span><textarea className="cam-textarea" value={m.info ?? ''} onChange={(e) => set({ info: e.target.value })} /></label>
          <div className="full cam-toolset">
            <div className="cam-label" style={{ marginBottom: 4 }}>{s.toolset}</div>
            <label className="cam-toolset-all"><input type="checkbox" checked={!m.toolIds} onChange={(e) => lib.setMachineTools(m.id, e.target.checked ? undefined : lib.tools.map((x) => x.id))} /> {s.toolsetAll}</label>
            {m.toolIds && (
              <div className="cam-toolset-list">
                {lib.tools.map((tl) => {
                  const on = m.toolIds!.includes(tl.id);
                  return <label key={tl.id}><input type="checkbox" checked={on} onChange={(e) => lib.setMachineTools(m.id, e.target.checked ? [...m.toolIds!, tl.id] : m.toolIds!.filter((x) => x !== tl.id))} /> T{tl.slot} {tl.name} <span className="meta">{s.toolKinds[tl.kind]} · Ø{tl.d}</span></label>;
                })}
              </div>
            )}
            <div className="hint" style={{ margin: '4px 0 0' }}>{s.toolsetHint}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn small" onClick={() => exportToolsetFile({ machineId: m.id })}>⤴ {s.exportToolset}</button>
              <button type="button" className="btn small" onClick={() => importLibraryFiles(m.id)} title={s.importHint}>⤵ {s.importTools}</button>
            </div>
          </div>
          <div className="full" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={() => exportMachineFile(m.id)}>⤴ {s.exportMachine}</button>
            <button type="button" className="btn primary" onClick={() => lib.setActiveMachine(m.id)} disabled={lib.activeMachineId === m.id}>{lang === 'de' ? 'Als aktive Maschine' : 'Use as active machine'}</button>
            <button type="button" className="btn danger" onClick={() => { if (confirm(s.confirmDelete(m.name))) { lib.deleteMachine(m.id); setId(lib.machines.find((x) => x.id !== m.id)?.id ?? ''); } }}>{s.delete}</button>
          </div>
        </div>
      ) : <div className="cam-empty">–</div>}
    </div>
  );
}

function PostsTab() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const lib = useLibrary();
  const notify = useUi((u) => u.notify);
  const [id, setId] = useState(lib.profiles[0]?.id ?? '');
  const p = lib.profiles.find((x) => x.id === id);
  const set = (patch: Partial<PostProfile>) => p && !p.builtIn && lib.upsertProfile({ ...p, ...patch });
  const blocks = (k: keyof PostProfile['blocks'], v: string) => p && set({ blocks: { ...p.blocks, [k]: v } });
  const importPp = async () => {
    const files = await openTextFiles('.pp', false);
    if (!files.length) return;
    try {
      const prof = parsePp(files[0].text, newId('pp-'), files[0].name.replace(/\.pp$/i, ''));
      for (const w of ['X', 'Y', 'Z', 'I', 'J'] as const) if (!prof.words[w].format) prof.words[w].format = '0.0000';
      for (const w of ['F', 'S'] as const) if (!prof.words[w].format) prof.words[w].format = '0';
      lib.upsertProfile(prof); setId(prof.id); notify(`${prof.name} ✓`);
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  const dup = () => { if (!p) return; const c = { ...p, id: newId('pp-'), name: p.name + ' (copy)', builtIn: false }; lib.upsertProfile(c); setId(c.id); };
  const ro = !!p?.builtIn;
  return (
    <div className="cam-options">
      <div className="list">
        {lib.profiles.map((x) => <button type="button" key={x.id} className={`item${x.id === id ? ' active' : ''}`} onClick={() => setId(x.id)}>{x.name}<span className="meta">{x.builtIn ? s.builtIn : ''} .{x.ext} · {x.useArcs ? 'G02/G03' : 'G01'}</span></button>)}
        <button type="button" className="btn" onClick={importPp} style={{ marginTop: 8 }}>⤵ {s.importPp}</button>
      </div>
      {p ? (
        <div className="editor">
          <div className="full"><TextField label={s.name} value={p.name} onChange={(v) => set({ name: v })} /></div>
          {ro && <div className="full hint">{lang === 'de' ? 'Vorinstalliertes Profil – zum Bearbeiten duplizieren.' : 'Built-in profile – duplicate to edit.'}</div>}
          <TextField label={lang === 'de' ? 'Dateiendung' : 'File extension'} value={p.ext} onChange={(v) => set({ ext: v })} />
          <SelectField label={lang === 'de' ? 'Bögen' : 'Arcs'} value={p.useArcs ? 'y' : 'n'} options={[{ value: 'y', label: 'G02/G03 (I/J)' }, { value: 'n', label: lang === 'de' ? 'nur Geraden' : 'lines only' }]} onChange={(v) => set({ useArcs: v === 'y' })} />
          <SelectField label="I/J" value={p.ijRelative ? 'rel' : 'abs'} options={[{ value: 'rel', label: lang === 'de' ? 'relativ' : 'relative' }, { value: 'abs', label: 'absolut' }]} onChange={(v) => set({ ijRelative: v === 'rel' })} />
          <SelectField label={lang === 'de' ? 'Befehl wiederholen' : 'Repeat command'} value={p.commandRepeat ? 'y' : 'n'} options={[{ value: 'y', label: 'G01 G01 …' }, { value: 'n', label: 'modal' }]} onChange={(v) => set({ commandRepeat: v === 'y' })} />
          <label className="cam-field full"><span className="cam-label">{lang === 'de' ? 'Programmanfang' : 'Program start'}</span><textarea className="cam-textarea" readOnly={ro} value={p.blocks.programStart} onChange={(e) => blocks('programStart', e.target.value)} /></label>
          <label className="cam-field"><span className="cam-label">{lang === 'de' ? 'Werkzeugwechsel' : 'Tool change'}</span><textarea className="cam-textarea" readOnly={ro} value={p.blocks.toolChange} onChange={(e) => blocks('toolChange', e.target.value)} /></label>
          <label className="cam-field"><span className="cam-label">{lang === 'de' ? 'Programmende' : 'Program end'}</span><textarea className="cam-textarea" readOnly={ro} value={p.blocks.programEnd} onChange={(e) => blocks('programEnd', e.target.value)} /></label>
          <div className="full"><TextField label={lang === 'de' ? 'Bearbeitungsanfang' : 'Operation start'} value={p.blocks.opStart} onChange={(v) => blocks('opStart', v)} /></div>
          <div className="full" style={{ fontSize: 12, color: 'var(--muted)' }}>{'<project> <version> <time> <tools> <t> <n> <s> <d> <order> <op> <name>'}</div>
          <div className="full" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn" onClick={dup}>{s.duplicateItem}</button>
            <button type="button" className="btn" onClick={() => saveText(serializePp(p), `${p.name.replace(/[^\w.-]+/g, '_')}.pp`, 'text/plain')}>{s.exportPp}</button>
            {!ro && <button type="button" className="btn danger" onClick={() => { if (confirm(s.confirmDelete(p.name))) { lib.deleteProfile(p.id); setId(lib.profiles[0]?.id ?? ''); } }}>{s.delete}</button>}
          </div>
        </div>
      ) : <div className="cam-empty">–</div>}
    </div>
  );
}
