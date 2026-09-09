'use client';
import { useProject } from '@/lib/store/project';
import { useUi } from '@/lib/store/ui';
import { useLibrary } from '@/lib/store/library';
import { t } from '@/lib/i18n';
import { toolsForMachine } from '@/lib/persist/libraryFiles';
import { NumberField } from '@/components/ui/NumberField';
import { CheckField, SelectField, Section, TextField } from '@/components/ui/Field';
import { build, decompose } from '@/lib/geometry/transform';
import type { Corner, Material, Operation, OriginMode, Side } from '@/lib/model/project';
import { usePlan } from '@/lib/store/plan';
import { selectedPlacementIds, pathLabel, addSelectionToOperation } from '@/lib/store/actions';
import { HlProvider, Hl, DepthDiagram, SideDiagram, PocketDiagram, TabsDiagram, OvercutDiagram, StartDiagram, ZeroDiagram, ArrayDiagram, DrillDiagram, HatchDiagram } from './Diagrams';

export function ParamPanel() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const sel = useUi((u) => u.selection);
  const project = useProject((p) => p.project);
  const opId = sel.stock ? undefined : sel.operations[0];
  const groupId = sel.stock ? undefined : sel.groups[0];
  const plIds = sel.stock ? [] : selectedPlacementIds();
  return (
    <aside className="cam-params">
      <HlProvider>
      {opId && project.operations[opId] && <OperationParams op={project.operations[opId]} />}
      {groupId && project.groups[groupId] && <GroupParams id={groupId} />}
      {sel.paths.length > 0 && <ContourInfo keys={sel.paths} />}
      {plIds.length > 0 && <PlacementParams ids={plIds} />}
      {(sel.stock || (!opId && !groupId && !plIds.length)) && <StockParams />}
      {!sel.stock && !opId && !groupId && !plIds.length && <div className="cam-empty">{s.nothingSelected}</div>}
      </HlProvider>
    </aside>
  );
}

function ContourInfo({ keys }: { keys: string[] }) {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const project = useProject((p) => p.project);
  const select = useUi((u) => u.select);
  const byPl = new Map<string, string[]>();
  for (const k of keys) { const [pid, pathId] = k.split(':'); byPl.set(pid, [...(byPl.get(pid) ?? []), pathId]); }
  return (
    <Section title={lang === 'de' ? `Konturen (${keys.length})` : `Contours (${keys.length})`} id="contours"
      actions={<button type="button" className="btn small" onClick={() => select({ placements: [...byPl.keys()] })}>{lang === 'de' ? 'Ganzes Objekt' : 'Whole object'}</button>}>
      <div className="full" style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {[...byPl.entries()].map(([pid, pathIds]) => {
          const pl = project.placements[pid]; const shape = pl ? project.shapes[pl.shapeId] : undefined;
          return pathIds.slice(0, 12).map((id) => { const idx = shape?.paths.findIndex((x) => x.id === id) ?? -1; const path = shape?.paths[idx]; return path ? <span key={pid + id}>{pl!.name}: {pathLabel(path, idx, lang)}</span> : null; });
        })}
        {keys.length > 12 && <span>…</span>}
      </div>
      <div className="full hint" style={{ margin: 0 }}>{lang === 'de' ? 'Bearbeitungen aus dem Tab „Bearbeitungen“ gelten nur für die ausgewählten Konturen.' : 'Operations from the Operations tab apply only to the selected contours.'}</div>
    </Section>
  );
}

function StockParams() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const stock = useProject((p) => p.project.stock);
  const setStock = useProject((p) => p.setStock);
  const name = useProject((p) => p.project.name);
  const update = useProject((p) => p.update);
  return (
    <>
      <Section title={s.tree} id="project" defaultOpen={false}>
        <div className="full"><TextField label={s.name} value={name} onChange={(v) => update((p) => { p.name = v; })} /></div>
      </Section>
      <Section title={s.stock} id="stock">
        <div className="full"><DepthDiagram depth={stock.thickness / 2} stepDown={stock.thickness / 4} zOffset={0} entry={{ kind: 'plunge' }} thickness={stock.thickness} safeZ={stock.safeZ} clearZ={stock.clearZ} lang={lang} /></div>
        <NumberField label={s.width} unit="mm" value={stock.width} onChange={(v) => setStock({ width: v })} min={1} />
        <NumberField label={s.height} unit="mm" value={stock.height} onChange={(v) => setStock({ height: v })} min={1} />
        <NumberField label={s.thickness} unit="mm" value={stock.thickness} onChange={(v) => setStock({ thickness: v })} min={0.1} />
        <SelectField label={s.material} value={stock.material} options={(Object.keys(s.materials) as Material[]).map((m) => ({ value: m, label: s.materials[m] }))} onChange={(v) => setStock({ material: v })} />
        <Hl k="safeZ"><NumberField label={s.safeZ} unit="mm" value={stock.safeZ} onChange={(v) => setStock({ safeZ: v })} min={0.5} /></Hl>
        <Hl k="clearZ"><NumberField label={s.clearZ} unit="mm" value={stock.clearZ} onChange={(v) => setStock({ clearZ: v })} min={0} /></Hl>
      </Section>
      <Section title={s.originMode} id="origin" defaultOpen={false}>
        <div className="full"><ZeroDiagram mode={stock.origin.mode} corner={stock.origin.corner} zZero={stock.zZero} lang={lang} /></div>
        <Hl k="originMode"><div className="full"><SelectField label={s.originMode} value={stock.origin.mode} options={(Object.keys(s.origin) as OriginMode[]).map((m) => ({ value: m, label: s.origin[m] }))} onChange={(v) => setStock({ origin: { ...stock.origin, mode: v } })} /></div></Hl>
        {(stock.origin.mode === 'sheet-corner' || stock.origin.mode === 'parts-bbox-corner') && (
          <Hl k="corner"><div className="full"><SelectField label={s.corner} value={stock.origin.corner} options={(Object.keys(s.corners) as Corner[]).map((c) => ({ value: c, label: s.corners[c] }))} onChange={(v) => setStock({ origin: { ...stock.origin, corner: v } })} /></div></Hl>
        )}
        {stock.origin.mode === 'manual' && (<>
          <Hl k="originX"><NumberField label="X" unit="mm" value={stock.origin.manual.x} onChange={(v) => setStock({ origin: { ...stock.origin, manual: { ...stock.origin.manual, x: v } } })} /></Hl>
          <Hl k="originY"><NumberField label="Y" unit="mm" value={stock.origin.manual.y} onChange={(v) => setStock({ origin: { ...stock.origin, manual: { ...stock.origin.manual, y: v } } })} /></Hl>
        </>)}
        <Hl k="zZero"><div className="full"><SelectField label={s.zZero} value={stock.zZero} options={[{ value: 'top', label: s.zTop }, { value: 'bottom', label: s.zBottom }]} onChange={(v) => setStock({ zZero: v })} /></div></Hl>
      </Section>
    </>
  );
}

function PlacementParams({ ids }: { ids: string[] }) {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const project = useProject((p) => p.project);
  const updatePlacement = useProject((p) => p.updatePlacement);
  const pl = project.placements[ids[0]];
  if (!pl) return null;
  const shape = project.shapes[pl.shapeId];
  const d = decompose(pl.transform);
  const setT = (patch: Partial<typeof d>) => { const n = { ...d, ...patch }; updatePlacement(pl.id, { transform: build(n.x, n.y, n.rot, n.sx, n.sy) }); };
  const many = ids.length > 1;
  return (
    <>
      <Section title={many ? `${s.placement} (${ids.length})` : s.placement} id="placement">
        {!many && <div className="full"><TextField label={s.name} value={pl.name} onChange={(v) => updatePlacement(pl.id, { name: v })} /></div>}
        <NumberField label={s.posX} unit="mm" value={d.x} onChange={(v) => setT({ x: v })} disabled={many} />
        <NumberField label={s.posY} unit="mm" value={d.y} onChange={(v) => setT({ y: v })} disabled={many} />
        <NumberField label={s.rotation} unit="°" value={d.rot} onChange={(v) => setT({ rot: v })} disabled={many} />
        <NumberField label={s.scale} value={Math.abs(d.sx)} onChange={(v) => setT({ sx: Math.sign(d.sx) * v, sy: v })} min={0.001} disabled={many} />
        <CheckField label={s.mirrored} value={d.sx < 0} onChange={(v) => setT({ sx: Math.abs(d.sx) * (v ? -1 : 1) })} />
        <CheckField label={s.locked} value={!!pl.locked} onChange={(v) => updatePlacement(pl.id, { locked: v })} />
      </Section>
      <Section title={s.array} id="array" defaultOpen={false}>
        <div className="full"><ArrayDiagram nx={pl.array?.nx ?? 1} ny={pl.array?.ny ?? 1} dx={pl.array?.dx ?? 100} dy={pl.array?.dy ?? 100} lang={lang} /></div>
        <Hl k="arrayNx"><NumberField label={s.arrayNx} value={pl.array?.nx ?? 1} min={1} digits={0} onChange={(v) => updatePlacement(pl.id, { array: { nx: Math.round(v), ny: pl.array?.ny ?? 1, dx: pl.array?.dx ?? 100, dy: pl.array?.dy ?? 100 } })} /></Hl>
        <Hl k="arrayNy"><NumberField label={s.arrayNy} value={pl.array?.ny ?? 1} min={1} digits={0} onChange={(v) => updatePlacement(pl.id, { array: { nx: pl.array?.nx ?? 1, ny: Math.round(v), dx: pl.array?.dx ?? 100, dy: pl.array?.dy ?? 100 } })} /></Hl>
        <Hl k="arrayDx"><NumberField label={s.arrayDx} unit="mm" value={pl.array?.dx ?? 100} onChange={(v) => updatePlacement(pl.id, { array: { nx: pl.array?.nx ?? 1, ny: pl.array?.ny ?? 1, dx: v, dy: pl.array?.dy ?? 100 } })} /></Hl>
        <Hl k="arrayDy"><NumberField label={s.arrayDy} unit="mm" value={pl.array?.dy ?? 100} onChange={(v) => updatePlacement(pl.id, { array: { nx: pl.array?.nx ?? 1, ny: pl.array?.ny ?? 1, dx: pl.array?.dx ?? 100, dy: v } })} /></Hl>
      </Section>
      {shape?.kind === 'text' && !many && (
        <Section title={s.textTitle} id="text">
          <div className="full" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>{shape.text?.text}</div>
          <div className="full"><button type="button" className="btn small" onClick={() => useUi.getState().openTextModal(pl.id)}>{s.editText}</button></div>
        </Section>
      )}
      {shape && !many && (
        <Section title={s.paths} id="shape-paths" defaultOpen={false}>
          <div className="full" style={{ fontSize: 12, color: 'var(--muted)' }}>
            {shape.paths.filter((p) => p.closed).length} {s.closedPaths}, {shape.paths.filter((p) => !p.closed).length} {s.openPaths}
            {shape.source ? ` · ${shape.source}` : ''}
          </div>
        </Section>
      )}
    </>
  );
}

function GroupParams({ id }: { id: string }) {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const g = useProject((p) => p.project.groups[id]);
  const updateGroup = useProject((p) => p.updateGroup);
  const ungroup = useProject((p) => p.ungroup);
  if (!g) return null;
  return (
    <Section title={s.group} id="group" actions={<button type="button" className="btn small" onClick={() => ungroup(id)}>{s.ungroup}</button>}>
      <div className="full"><TextField label={s.name} value={g.name} onChange={(v) => updateGroup(id, { name: v })} /></div>
      <NumberField label={s.zOffset} unit="mm" value={g.zOffset} onChange={(v) => updateGroup(id, { zOffset: v })} title={lang === 'de' ? 'Zusätzliche Starttiefe für alle Bearbeitungen der Gruppe (positiv = tiefer)' : 'Additional start depth for all operations of the group (positive = deeper)'} />
    </Section>
  );
}

export function OperationParams({ op }: { op: Operation }) {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const project = useProject((p) => p.project);
  const updateOperation = useProject((p) => p.updateOperation);
  const ensureTool = useProject((p) => p.ensureTool);
  const libTools = useLibrary((l) => l.tools);
  const machines = useLibrary((l) => l.machines);
  const machine = machines.find((m) => m.id === project.machineId);
  const climbAllowed = machine?.climbAllowed === true;
  const { plan } = usePlan();
  const tool = project.tools[op.toolId];
  const patch = (p: Partial<Operation>) => updateOperation(op.id, p);
  const warnings = plan?.program.tools.flatMap((tp) => tp.ops.filter((o) => o.opId === op.id).flatMap((o) => o.warnings)) ?? [];
  const tools = [...toolsForMachine(libTools, machine).filter((t) => !project.tools[t.id]), ...Object.values(project.tools)];
  const sideOpts = (vals: Side[]) => vals.map((v) => ({ value: v, label: s.sides[v] }));
  const through = project.stock.thickness + 1;
  const isLaserOp = op.type === 'laser-cut' || op.type === 'laser-engrave';
  const noEntry = isLaserOp || op.type === 'saw' || op.type === 'surface-3d';
  const removeOperations = useProject((p) => p.removeOperations);
  const clearSelection = useUi((u) => u.clearSelection);
  const tabPlacing = useUi((u) => u.tabPlacing);
  const setTabPlacing = useUi((u) => u.setTabPlacing);
  const pointPlacing = useUi((u) => u.pointPlacing);
  const setPointPlacing = useUi((u) => u.setPointPlacing);
  const tabsOf = (o: Operation) => (o.type === 'cutout' && o.tabs ? o.tabs : { count: 4, width: 8, height: 3 });
  const del = () => { if (confirm(s.confirmDelete(op.name || s.opNames[op.type]))) { removeOperations([op.id]); clearSelection(); } };
  return (
    <>
      <Section title={`${s.operation}: ${s.opNames[op.type]}`} id="op-main" actions={<button type="button" className="btn small danger" onClick={del}>{s.delete}</button>}>
        <div className="full"><TextField label={s.name} value={op.name} onChange={(v) => patch({ name: v })} /></div>
        <div className="full"><SelectField label={s.tool} value={op.toolId} options={tools.map((t) => ({ value: t.id, label: `T${t.slot} ${t.name}` }))} onChange={(v) => { const t = tools.find((x) => x.id === v); if (t) { ensureTool(t); patch({ toolId: v }); } }} /></div>
        {!isLaserOp && <div className="full"><DepthDiagram depth={op.depth} stepDown={op.stepDown ?? tool?.cut.stepDown ?? 1} zOffset={op.zOffset} entry={op.entry} thickness={project.stock.thickness} safeZ={project.stock.safeZ} clearZ={project.stock.clearZ} lang={lang} /></div>}
        {!isLaserOp && <Hl k="depth"><NumberField label={op.type === 'surface-3d' ? s.surfaceDepthSpan : s.depth} unit="mm" value={op.depth} min={0} onChange={(v) => patch({ depth: v })} /></Hl>}
        {!isLaserOp && <Hl k="stepDown"><NumberField label={s.stepDown} unit="mm" value={op.stepDown ?? tool?.cut.stepDown} min={0.05} onChange={(v) => patch({ stepDown: v })} /></Hl>}
        {(op.type === 'cutout') && <div className="full"><button type="button" className="btn small" onClick={() => patch({ depth: through })}>{s.depthThrough}</button></div>}
        {(op.type === 'contour' || op.type === 'engrave' || op.type === 'cutout') && <div className="full"><SideDiagram side={op.side} lang={lang} /></div>}
        {(op.type === 'contour' || op.type === 'engrave') && <Hl k="side"><SelectField label={s.side} value={op.side} options={sideOpts(['outside', 'inside', 'on', 'left', 'right'])} onChange={(v) => patch({ side: v } as Partial<Operation>)} /></Hl>}
        {op.type === 'cutout' && <Hl k="side"><SelectField label={s.side} value={op.side} options={sideOpts(['outside', 'inside'])} onChange={(v) => patch({ side: v } as Partial<Operation>)} /></Hl>}
        {!noEntry && <Hl k="entry"><SelectField label={s.entry} value={op.entry.kind} options={(['plunge', 'ramp', 'helix'] as const).map((k) => ({ value: k, label: s.entries[k] }))} onChange={(v) => patch({ entry: v === 'ramp' ? { kind: 'ramp', angle: op.entry.kind === 'ramp' ? op.entry.angle : tool?.cut.rampAngle ?? 10 } : { kind: v } })} /></Hl>}
        {!noEntry && op.entry.kind === 'ramp' && <Hl k="rampAngle"><NumberField label={s.rampAngle} unit="°" value={op.entry.angle} min={1} max={90} onChange={(v) => patch({ entry: { kind: 'ramp', angle: v } })} title={lang === 'de' ? '90° = kein Rampen, senkrecht eintauchen' : '90° = no ramp, straight plunge'} /></Hl>}
        {!isLaserOp && <Hl k="zOffset"><NumberField label={s.zOffset} unit="mm" value={op.zOffset} min={0} onChange={(v) => patch({ zOffset: v })} title={s.zOffsetHint} /></Hl>}
        <CheckField label={s.enabled} value={op.enabled} onChange={(v) => patch({ enabled: v })} />
        {(op.type === 'drill' || op.type === 'thread') && (<>
          <div className="full" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className={`btn small${pointPlacing === op.id ? ' primary' : ''}`} onClick={() => setPointPlacing(pointPlacing === op.id ? null : op.id)}>{pointPlacing === op.id ? s.stopPlacing : s.placePoints}</button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.pointsPlaced(op.targets.filter((tg) => tg.point).length)}</span>
          </div>
          {pointPlacing === op.id && <div className="full hint" style={{ margin: 0, color: 'var(--accent)' }}>{s.placingPoints}</div>}
        </>)}
      </Section>
      {op.type !== 'surface-3d' && <Section title={lang === 'de' ? 'Start & Richtung' : 'Start & direction'} id="op-start" defaultOpen={false}>
        <div className="full"><StartDiagram startT={op.startT} startAngle={op.startAngle} climb={climbAllowed && op.climb} lang={lang} /></div>
        <Hl k="startT"><NumberField label={s.startT} unit="0–1" value={op.startT} onChange={(v) => patch({ startT: v })} min={0} max={1} placeholder="auto" /></Hl>
        <Hl k="startAngle"><NumberField label={s.startAngle} unit="°" value={op.startAngle} onChange={(v) => patch({ startAngle: v })} placeholder="auto" /></Hl>
        <Hl k="climb"><CheckField label={s.climb} value={climbAllowed && op.climb} onChange={(v) => patch({ climb: v })} disabled={!climbAllowed} /></Hl>
        {!climbAllowed && <div className="full hint" style={{ margin: 0 }}>{s.climbNotAllowed}</div>}
      </Section>}
      {op.type === 'saw' && (
        <Section title={s.saw} id="op-saw" defaultOpen>
          <div className="full"><SideDiagram side={op.side} lang={lang} /></div>
          <SelectField label={s.sawSide} value={op.side} options={sideOpts(['on', 'left', 'right'])} onChange={(v) => patch({ side: v } as Partial<Operation>)} />
          <div className="full hint" style={{ margin: 0 }}>{s.sawHint}{tool ? ` (${lang === 'de' ? 'Blattbreite' : 'blade width'} ${tool.d} mm)` : ''}</div>
        </Section>
      )}
      {op.type === 'laser-cut' && (
        <Section title={s.laserSection} id="op-laser" defaultOpen>
          <div className="full"><SideDiagram side={op.kerfSide} lang={lang} /></div>
          <NumberField label={s.laserPower} unit="%" value={op.power} min={0} max={100} onChange={(v) => patch({ power: v } as Partial<Operation>)} />
          <NumberField label={s.laserSpeed} unit="mm/min" value={op.speed} min={1} onChange={(v) => patch({ speed: v } as Partial<Operation>)} />
          <NumberField label={s.laserPasses} value={op.passes} digits={0} min={1} max={50} onChange={(v) => patch({ passes: Math.round(v) } as Partial<Operation>)} />
          <SelectField label={s.kerfSide} value={op.kerfSide} options={sideOpts(['outside', 'inside', 'on', 'left', 'right'])} onChange={(v) => patch({ kerfSide: v } as Partial<Operation>)} />
          <div className="full hint" style={{ margin: 0 }}>{s.laserHint}</div>
        </Section>
      )}
      {op.type === 'laser-engrave' && (
        <Section title={s.laserSection} id="op-laser" defaultOpen>
          <div className="full"><HatchDiagram mode={op.mode} pitch={op.hatchPitch} angle={op.hatchAngle} outline={op.outline !== false} lang={lang} /></div>
          <NumberField label={s.laserPower} unit="%" value={op.power} min={0} max={100} onChange={(v) => patch({ power: v } as Partial<Operation>)} />
          <NumberField label={s.laserSpeed} unit="mm/min" value={op.speed} min={1} onChange={(v) => patch({ speed: v } as Partial<Operation>)} />
          <NumberField label={s.laserPasses} value={op.passes ?? 1} digits={0} min={1} max={50} onChange={(v) => patch({ passes: Math.round(v) } as Partial<Operation>)} />
          <SelectField label={s.engraveMode} value={op.mode} options={(['vector', 'hatch'] as const).map((m) => ({ value: m, label: s.engraveModes[m] }))} onChange={(v) => patch({ mode: v } as Partial<Operation>)} />
          {op.mode === 'hatch' && <NumberField label={s.hatchPitch} unit="mm" value={op.hatchPitch} min={0.02} onChange={(v) => patch({ hatchPitch: v } as Partial<Operation>)} />}
          {op.mode === 'hatch' && <NumberField label={s.hatchAngle} unit="°" value={op.hatchAngle} onChange={(v) => patch({ hatchAngle: v } as Partial<Operation>)} />}
          {op.mode === 'hatch' && <CheckField label={s.hatchOutline} value={op.outline !== false} onChange={(v) => patch({ outline: v } as Partial<Operation>)} />}
          <div className="full hint" style={{ margin: 0 }}>{s.laserHint}</div>
        </Section>
      )}
      {!isLaserOp && <Section title={lang === 'de' ? 'Vorschub (überschreiben)' : 'Feed overrides'} id="op-feed" defaultOpen={false}>
        <NumberField label={s.feed} unit="mm/min" value={op.feed?.vf} onChange={(v) => patch({ feed: { ...op.feed, vf: v } })} placeholder={String(tool?.cut.vf ?? '')} />
        <NumberField label={s.plungeFeed} unit="mm/min" value={op.feed?.vfPlunge} onChange={(v) => patch({ feed: { ...op.feed, vfPlunge: v } })} placeholder={String(tool?.cut.vfPlunge ?? '')} />
        <div className="full hint" style={{ margin: 0 }}>{lang === 'de' ? 'Leer = Werte des Werkzeugs.' : 'Empty = tool values.'}</div>
      </Section>}
      {(op.type === 'contour' || op.type === 'cutout' || op.type === 'pocket') && (
        <Section title={s.overcut} id="op-overcut" defaultOpen={false}>
          <div className="full"><OvercutDiagram kind={op.overcut.kind} lang={lang} /></div>
          <Hl k="overcut"><div className="full"><SelectField label={s.overcut} value={op.overcut.kind} options={(['none', 'dogbone', 'tbone'] as const).map((k) => ({ value: k, label: s.overcuts[k] }))} onChange={(v) => patch({ overcut: { kind: v } } as Partial<Operation>)} /></div></Hl>
        </Section>
      )}
      {op.type === 'cutout' && (
        <Section title={s.tabs} id="op-tabs" defaultOpen={false}>
          <div className="full"><TabsDiagram count={op.tabs?.mode === 'manual' ? (op.tabs?.points?.length ?? 0) : (op.tabs?.count ?? 0)} width={op.tabs?.width ?? 8} height={op.tabs?.height ?? 3} thickness={project.stock.thickness} lang={lang} /></div>
          <div className="full"><SelectField label={s.tabMode} value={op.tabs?.mode ?? 'auto'} options={(['auto', 'manual'] as const).map((m) => ({ value: m, label: s.tabModes[m] }))} onChange={(v) => { patch({ tabs: { ...tabsOf(op), mode: v } } as Partial<Operation>); if (v !== 'manual') setTabPlacing(null); }} /></div>
          {(op.tabs?.mode ?? 'auto') === 'auto'
            ? <Hl k="tabCount"><NumberField label={s.tabCount} value={op.tabs?.count ?? 0} digits={0} min={0} onChange={(v) => patch({ tabs: { ...tabsOf(op), count: Math.round(v) } } as Partial<Operation>)} /></Hl>
            : <div className="full" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button type="button" className={`btn small${tabPlacing === op.id ? ' primary' : ''}`} onClick={() => setTabPlacing(tabPlacing === op.id ? null : op.id)}>{tabPlacing === op.id ? s.stopPlacing : s.placeTabs}</button>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.tabsPlaced(op.tabs?.points?.length ?? 0)}</span>
              </div>}
          {tabPlacing === op.id && <div className="full hint" style={{ margin: 0, color: 'var(--accent)' }}>{s.placingTabs} {s.snapHintTabs}</div>}
          <Hl k="tabWidth"><NumberField label={s.tabWidth} unit="mm" value={op.tabs?.width ?? 8} min={0.5} onChange={(v) => patch({ tabs: { ...tabsOf(op), width: v } } as Partial<Operation>)} title={lang === 'de' ? 'Breite des stehenbleibenden Materials (Mindestbreite); der Fräser hebt einen Radius davor ab und senkt einen Radius danach wieder ein.' : 'Width of the material left standing (minimum); the cutter lifts one radius before the bridge and lowers one radius after it.'} /></Hl>
          <Hl k="tabHeight"><NumberField label={s.tabHeight} unit="mm" value={op.tabs?.height ?? 3} min={0.1} onChange={(v) => patch({ tabs: { ...tabsOf(op), height: v } } as Partial<Operation>)} /></Hl>
        </Section>
      )}
      {op.type === 'pocket' && (
        <Section title={s.pocket} id="op-pocket" defaultOpen={false}>
          <div className="full"><PocketDiagram side={op.side ?? 'inside'} strategy={op.strategy} stepOverPct={op.stepOverPct ?? tool?.cut.stepOverPct ?? 40} widthTools={op.side === 'outside' && tool ? (op.outsideWidthUnit === 'tool' ? (op.outsideWidth ?? 1) : (op.outsideWidth ?? tool.d) / tool.d) : 1} lang={lang} /></div>
          <Hl k="pocketSide"><div className="full"><SelectField label={s.pocketSide} value={op.side ?? 'inside'} options={(['inside', 'on', 'outside'] as const).map((k) => ({ value: k, label: s.pocketSides[k] }))} onChange={(v) => patch({ side: v } as Partial<Operation>)} /></div></Hl>
          {op.side === 'outside' && (<>
            <Hl k="outsideWidth"><NumberField label={s.outsideWidth} unit={op.outsideWidthUnit === 'tool' ? '× Ø' : 'mm'} value={op.outsideWidth ?? 1} min={op.outsideWidthUnit === 'tool' ? 1 : tool?.d ?? 1} onChange={(v) => patch({ outsideWidth: v } as Partial<Operation>)} title={s.outsideWidthHint} /></Hl>
            <Hl k="outsideWidth"><SelectField label={lang === 'de' ? 'Einheit' : 'Unit'} value={op.outsideWidthUnit ?? 'mm'} options={(['tool', 'mm'] as const).map((u) => ({ value: u, label: s.widthUnits[u] }))} onChange={(u) => { const d = tool?.d ?? 6; const cur = op.outsideWidth ?? 1; const conv = u === 'tool' ? Math.round((cur / d) * 100) / 100 : Math.round(cur * d * 100) / 100; patch({ outsideWidthUnit: u, outsideWidth: (op.outsideWidthUnit ?? 'mm') === u ? cur : conv } as Partial<Operation>); }} /></Hl>
            <div className="full hint" style={{ margin: 0 }}>{s.outsideWidthHint}{tool ? ` (${lang === 'de' ? 'aktuell' : 'currently'} ${Math.round(((op.outsideWidthUnit === 'tool' ? (op.outsideWidth ?? 1) * tool.d : (op.outsideWidth ?? tool.d))) * 100) / 100} mm)` : ''}</div>
          </>)}
          <Hl k="strategy"><SelectField label={s.strategy} value={op.strategy} options={(['offset', 'raster', 'zigzag'] as const).map((k) => ({ value: k, label: s.strategies[k] }))} onChange={(v) => patch({ strategy: v } as Partial<Operation>)} /></Hl>
          {(op.strategy === 'raster' || op.strategy === 'zigzag') && <Hl k="rasterAngle"><NumberField label={s.rasterAngle} unit="°" value={op.rasterAngle} onChange={(v) => patch({ rasterAngle: v } as Partial<Operation>)} /></Hl>}
          <Hl k="stepOver"><NumberField label={s.stepOver} unit="%" value={op.stepOverPct ?? tool?.cut.stepOverPct} min={5} max={100} onChange={(v) => patch({ stepOverPct: v } as Partial<Operation>)} /></Hl>
          <div className="full hint" style={{ margin: 0 }}>{s.pocketHint}</div>
        </Section>
      )}
      {op.type === 'surface-3d' && (
        <Section title={s.surfaceSection} id="op-surface-3d" defaultOpen>
          <label className="cam-field full">
            <span className="cam-label">{s.depthExpression}</span>
            <textarea className="cam-textarea" rows={4} value={op.depthExpression} spellCheck={false} onChange={(e) => patch({ depthExpression: e.target.value } as Partial<Operation>)} />
          </label>
          <div className="full hint" style={{ margin: 0 }}>{s.surfaceFormulaHint}</div>
          <NumberField label={s.sampleStep} unit="mm" value={op.sampleStep} min={0.05} onChange={(v) => patch({ sampleStep: v } as Partial<Operation>)} />
          <NumberField label={s.stepOver} unit="%" value={op.stepOverPct ?? tool?.cut.stepOverPct} min={5} max={90} onChange={(v) => patch({ stepOverPct: v } as Partial<Operation>)} />
          <NumberField label={s.rasterAngle} unit="°" value={op.rasterAngle} onChange={(v) => patch({ rasterAngle: v } as Partial<Operation>)} />
          <NumberField label={s.finishAllowance} unit="mm" value={op.finishAllowance} min={0} onChange={(v) => patch({ finishAllowance: v } as Partial<Operation>)} />
          <div className="full hint" style={{ margin: 0 }}>{s.surfaceFinishHint}</div>
        </Section>
      )}
      {op.type === 'drill' && (
        <Section title={s.drill} id="op-drill" defaultOpen={false}>
          <div className="full"><DrillDiagram mode={op.mode} peck={op.peck ?? 2} depth={op.depth} lang={lang} /></div>
          <Hl k="peck"><SelectField label={s.opType} value={op.mode} options={[{ value: 'plunge', label: s.entries.plunge }, { value: 'peck', label: lang === 'de' ? 'Spanbrechen (Peck)' : 'Peck' }]} onChange={(v) => patch({ mode: v } as Partial<Operation>)} /></Hl>
          {op.mode === 'peck' && <Hl k="peck"><NumberField label={lang === 'de' ? 'Zustellung je Peck' : 'Peck depth'} unit="mm" value={op.peck ?? 2} min={0.1} onChange={(v) => patch({ peck: v } as Partial<Operation>)} /></Hl>}
        </Section>
      )}
      {op.type === 'thread' && (
        <Section title={s.thread} id="op-thread" defaultOpen>
          <SelectField label={s.threadKind} value={op.internal ? 'internal' : 'external'} options={[{ value: 'internal', label: s.threadKinds.internal }, { value: 'external', label: s.threadKinds.external }]} onChange={(v) => patch({ internal: v === 'internal' } as Partial<Operation>)} />
          <NumberField label={s.threadMajor} unit="mm" value={op.majorD} min={0.5} onChange={(v) => patch({ majorD: v } as Partial<Operation>)} />
          <NumberField label={s.threadPitch} unit="mm" value={op.pitch} min={0.05} onChange={(v) => patch({ pitch: v } as Partial<Operation>)} />
          <NumberField label={s.threadPasses} value={op.passes} digits={0} min={1} max={10} onChange={(v) => patch({ passes: Math.round(v) } as Partial<Operation>)} />
          <div className="full hint" style={{ margin: 0 }}>{s.threadHint}</div>
        </Section>
      )}
      <Section title={`${s.targets} (${op.targets.length})`} id="op-targets" defaultOpen={false}>
        <div className="full" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {op.targets.map((tg, i) => {
            const pl = project.placements[tg.placementId]; const shape = pl ? project.shapes[pl.shapeId] : undefined;
            const idx = shape?.paths.findIndex((x) => x.id === tg.pathId) ?? -1; const path = shape?.paths[idx];
            const label = tg.point ? `${pl ? pl.name + ': ' : ''}${s.pointAt(tg.point.x, tg.point.y)}` : `${pl?.name ?? '?'}: ${path ? pathLabel(path, idx, lang) : tg.pick}`;
            const setTg = (patchTg: Partial<typeof tg>) => patch({ targets: op.targets.map((x, j) => (j === i ? { ...x, ...patchTg } : x)) });
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2, borderBottom: '1px dashed var(--border)', paddingBottom: 4 }}>
                <div className="cam-node" style={{ padding: 0, cursor: 'default' }} title={label}>
                  <span className="ico">{tg.role === 'exclude' ? '⛔' : tg.point ? '⌖' : path?.closed ? '○' : '⌇'}</span>
                  <span className="lbl" style={{ fontSize: 12 }}>{label}</span>
                  <button type="button" className="cam-x" style={{ opacity: 1 }} title={lang === 'de' ? 'Aus Bearbeitung entfernen' : 'Remove from operation'}
                    onClick={() => { const targets = op.targets.filter((_, j) => j !== i); if (targets.length) patch({ targets }); else del(); }}>✕</button>
                </div>
                {op.type === 'pocket' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <SelectField label={s.opType} value={tg.role ?? 'cut'} options={[{ value: 'cut', label: s.roleCut }, { value: 'exclude', label: s.roleExclude }]} onChange={(v) => setTg({ role: v, margin: v === 'exclude' ? tg.margin ?? 0 : undefined })} />
                    {tg.role === 'exclude' && <NumberField label={s.margin} unit="mm" value={tg.margin ?? 0} min={0} onChange={(v) => setTg({ margin: v })} />}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn small" onClick={() => addSelectionToOperation(op.id, 'cut')}>{s.addSelection}</button>
            {op.type === 'pocket' && <button type="button" className="btn small" onClick={() => addSelectionToOperation(op.id, 'exclude')}>{s.addSelectionExclude}</button>}
          </div>
        </div>
      </Section>
      {warnings.map((w, i) => <div className="warn" key={i}>{w}</div>)}
    </>
  );
}
