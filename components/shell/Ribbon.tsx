'use client';
import { useLibrary } from '@/lib/store/library';
import { useProject } from '@/lib/store/project';
import { useUi, type RibbonTab } from '@/lib/store/ui';
import { t } from '@/lib/i18n';
import { addOperationForSelection, addSurfacingOperation, deleteSelection, duplicateSelection, exportGcode, groupSelection, importFiles, newProjectAction, openProject, saveProject, selectedPlacementIds, transformSelection, addPointOperation } from '@/lib/store/actions';
import { placementBBox } from '@/lib/cam/instances';
import { bboxUnion, bboxValid } from '@/lib/geometry/types';
import { compose, translation } from '@/lib/geometry/transform';
import { formatHms } from '@/lib/cam/time';
import { usePlan } from '@/lib/store/plan';

function RBtn({ ico, label, onClick, disabled, active, title }: { ico: string; label: string; onClick: () => void; disabled?: boolean; active?: boolean; title?: string }) {
  return <button type="button" className={`cam-rbtn${active ? ' active' : ''}`} onClick={onClick} disabled={disabled} title={title ?? label}><span className="ico">{ico}</span><span>{label}</span></button>;
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="cam-group"><div className="items">{children}</div><div className="title">{title}</div></div>;
}

export function Ribbon() {
  const lang = useUi((s) => s.lang);
  const s = t(lang);
  const tab = useUi((u) => u.tab);
  const setTab = useUi((u) => u.setTab);
  const ui = useUi();
  const lib = useLibrary();
  const project = useProject((p) => p.project);
  const hasSel = ui.selection.placements.length + ui.selection.paths.length > 0;
  const { plan } = usePlan();
  const tabs: [RibbonTab, string][] = [['file', s.tabFile], ['layout', s.tabLayout], ['ops', s.tabOps], ['machine', s.tabMachine], ['view', s.tabView]];
  const machine = lib.machines.find((m) => m.id === project.machineId) ?? lib.machines.find((m) => m.id === lib.activeMachineId);
  const isLaser = machine?.kind === 'laser';

  const centerOnSheet = () => {
    const ids = selectedPlacementIds();
    if (!ids.length) return;
    const b = ids.map((id) => placementBBox(project, project.placements[id])).filter(bboxValid).reduce(bboxUnion);
    const dx = project.stock.width / 2 - (b.minX + b.maxX) / 2, dy = project.stock.height / 2 - (b.minY + b.maxY) / 2;
    useProject.getState().transformPlacements(ids, (m) => compose(translation(dx, dy), m));
  };

  return (
    <div className="cam-ribbon">
      <div className="cam-ribbon-tabs">
        <span className="brand">{s.appTitle}</span>
        {tabs.map(([k, l]) => <button type="button" key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
        <span className="spacer" />
        <button type="button" onClick={() => ui.openModal('options')} title={s.options}>⚙ {s.options}</button>
        <a href="./calc/" target="_blank" rel="noreferrer" style={{ padding: '5px 12px', color: 'var(--muted)', textDecoration: 'none' }}>{s.calculator} ↗</a>
      </div>
      <div className="cam-ribbon-body">
        {tab === 'file' && (<>
          <Group title={s.tabFile}>
            <RBtn ico="🗋" label={s.newProject} onClick={newProjectAction} />
            <RBtn ico="📂" label={s.open} onClick={openProject} />
            <RBtn ico="💾" label={s.saveFile} onClick={() => saveProject(false)} />
            <RBtn ico="📝" label={s.saveAs} onClick={() => saveProject(true)} />
          </Group>
          <Group title={s.importDrawing}>
            <RBtn ico="⤵" label={s.importDrawing} onClick={importFiles} />
          </Group>
          <Group title={s.exportGcode}>
            <RBtn ico="⚙" label={s.exportGcode} onClick={exportGcode} disabled={!plan || plan.program.tools.length === 0} />
          </Group>
        </>)}
        {tab === 'layout' && (<>
          <Group title={s.placement}>
            <RBtn ico="↻" label={s.rotate90} onClick={() => transformSelection('rot90')} disabled={!hasSel} />
            <RBtn ico="↺" label={s.rotateCcw} onClick={() => transformSelection('rot-90')} disabled={!hasSel} />
            <RBtn ico="⇋" label={s.mirrorX} onClick={() => transformSelection('mirrorX')} disabled={!hasSel} />
            <RBtn ico="⇅" label={s.mirrorY} onClick={() => transformSelection('mirrorY')} disabled={!hasSel} />
            <RBtn ico="⊕" label={s.center} onClick={centerOnSheet} disabled={!hasSel} />
          </Group>
          <Group title={s.objects}>
            <RBtn ico="⧉" label={s.duplicate} onClick={duplicateSelection} disabled={!hasSel} />
            <RBtn ico="▦" label={s.array} onClick={() => ui.openModal('array')} disabled={!hasSel} />
            <RBtn ico="⛶" label={s.group} onClick={groupSelection} disabled={selectedPlacementIds().length < 2} />
            <RBtn ico="T" label={s.addText} onClick={() => ui.openTextModal(null)} />
            <RBtn ico="🗑" label={s.deleteSel} onClick={deleteSelection} disabled={!hasSel && !ui.selection.operations.length && !ui.selection.groups.length} />
          </Group>
          <Group title={s.targets}>
            <RBtn ico="◻" label={s.sides.on.split(' ')[0] === 'auf' ? 'Kontur' : 'Contour'} active={ui.pick === 'contour'} onClick={() => ui.setPick('contour')} />
            <RBtn ico="⊙" label={lang === 'de' ? 'Formmitte' : 'Shape centre'} active={ui.pick === 'shape-center'} onClick={() => ui.setPick('shape-center')} />
            <RBtn ico="⊘" label={lang === 'de' ? 'Linienmitte' : 'Line centre'} active={ui.pick === 'line-center'} onClick={() => ui.setPick('line-center')} />
            <RBtn ico="•" label={lang === 'de' ? 'Punkt' : 'Point'} active={ui.pick === 'point'} onClick={() => ui.setPick('point')} />
          </Group>
        </>)}
        {tab === 'ops' && (<>
          <Group title={s.activeTool}>
            <select className="cam-inline-select" value={lib.activeToolId} onChange={(e) => lib.setActiveTool(e.target.value)} aria-label={s.activeTool}>
              {!lib.tools.length && <option value="">{s.noTool}</option>}
              {lib.tools.map((tl) => <option key={tl.id} value={tl.id}>T{tl.slot} {tl.name}</option>)}
            </select>
            <button type="button" className="btn small" onClick={() => ui.openModal('options', 'tools')}>{s.toolLibrary}…</button>
          </Group>
          {!isLaser && (<>
            <Group title={s.opNames.contour}>
              <RBtn ico="▢" label={s.contourOutside} onClick={() => addOperationForSelection('contour', 'outside')} disabled={!hasSel} />
              <RBtn ico="▣" label={s.contourInside} onClick={() => addOperationForSelection('contour', 'inside')} disabled={!hasSel} />
              <RBtn ico="⌇" label={s.contourOn} onClick={() => addOperationForSelection('contour', 'on')} disabled={!hasSel} />
            </Group>
            <Group title={s.operations}>
              <RBtn ico="✂" label={s.cutout} onClick={() => addOperationForSelection('cutout', 'outside')} disabled={!hasSel} />
              <RBtn ico="▤" label={s.pocket} onClick={() => addOperationForSelection('pocket')} disabled={!hasSel} />
              <RBtn ico="✎" label={s.engrave} onClick={() => addOperationForSelection('engrave', 'on')} disabled={!hasSel} />
              <RBtn ico="⌖" label={s.drill} onClick={() => (hasSel ? addOperationForSelection('drill') : addPointOperation('drill'))} title={s.placePoints} />
              <RBtn ico="⌀" label={s.thread} onClick={() => (hasSel ? addOperationForSelection('thread') : addPointOperation('thread'))} title={s.placePoints} />
              <RBtn ico="▬" label={s.surface} onClick={addSurfacingOperation} title={s.surfaceHint} />
            </Group>
          </>)}
          {isLaser && (
            <Group title={s.operations}>
              <RBtn ico="✂" label={s.laserCut} onClick={() => addOperationForSelection('laser-cut')} disabled={!hasSel} />
              <RBtn ico="✎" label={s.laserEngrave} onClick={() => addOperationForSelection('laser-engrave')} disabled={!hasSel} />
            </Group>
          )}
        </>)}
        {tab === 'machine' && (<>
          <Group title={s.machine}>
            <select className="cam-inline-select" value={project.machineId} onChange={(e) => { useProject.getState().update((p) => { p.machineId = e.target.value; }); lib.setActiveMachine(e.target.value); }} aria-label={s.machine}>
              {lib.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button type="button" className="btn small" onClick={() => ui.openModal('options', 'machines')}>{s.machines}…</button>
          </Group>
          <Group title={s.postProcessor}>
            <span style={{ fontSize: 12 }}>{lib.profiles.find((p) => p.id === machine?.postId)?.name ?? '–'}</span>
            <button type="button" className="btn small" onClick={() => ui.openModal('options', 'posts')}>{s.posts}…</button>
          </Group>
          <Group title={s.estTime}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 14 }}>{plan ? formatHms(plan.program.meta.seconds) : '–'}</span>
            <RBtn ico="⚙" label={s.exportGcode} onClick={exportGcode} disabled={!plan || plan.program.tools.length === 0} />
            <RBtn ico="⌨" label={s.viewGcode} onClick={() => ui.setView('gcode')} />
          </Group>
        </>)}
        {tab === 'view' && (<>
          <Group title={s.tabView}>
            <RBtn ico="▦" label={s.grid} active={ui.showGrid} onClick={() => ui.toggle('showGrid')} />
            <RBtn ico="🧲" label={s.snap} active={ui.snap} onClick={() => ui.toggle('snap')} />
          </Group>
          <Group title={s.layers}>
            <RBtn ico="▧" label={s.showMilling} active={ui.showMilling} onClick={() => ui.toggle('showMilling')} />
            <RBtn ico="〰" label={s.showToolpaths} active={ui.showToolpaths} onClick={() => ui.toggle('showToolpaths')} />
            <RBtn ico="⋯" label={s.showRapids} active={ui.showRapids} onClick={() => ui.toggle('showRapids')} />
          </Group>
          <Group title={s.language}>
            <RBtn ico="🇩🇪" label="Deutsch" active={lang === 'de'} onClick={() => ui.setLang('de')} />
            <RBtn ico="🇬🇧" label="English" active={lang === 'en'} onClick={() => ui.setLang('en')} />
          </Group>
          <Group title={s.shortcuts}>
            <RBtn ico="⌨" label={s.shortcuts} onClick={() => ui.openModal('shortcuts')} />
          </Group>
        </>)}
      </div>
    </div>
  );
}
