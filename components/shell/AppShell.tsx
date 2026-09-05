'use client';
import { useEffect } from 'react';
import { Ribbon } from './Ribbon';
import { TreePanel } from './TreePanel';
import { StatusBar } from './StatusBar';
import { GcodeView } from './GcodeView';
import { Canvas2D } from '@/components/canvas2d/Canvas2D';
import dynamic from 'next/dynamic';
const Preview3D = dynamic(() => import('@/components/canvas3d/Preview3D'), { ssr: false, loading: () => <div className="cam-empty" style={{ padding: 24 }}>Loading 3D…</div> });
import { ParamPanel } from '@/components/panels/ParamPanel';
import { OptionsModal } from '@/components/modals/OptionsModal';
import { ArrayModal } from '@/components/modals/ArrayModal';
import { ShortcutsModal } from '@/components/modals/ShortcutsModal';
import { TextModal } from '@/components/modals/TextModal';
import { GcodeWarningModal } from '@/components/modals/GcodeWarningModal';
import { useUi, loadViewPrefs } from '@/lib/store/ui';
import { useLibrary } from '@/lib/store/library';
import { useProject } from '@/lib/store/project';
import { t } from '@/lib/i18n';
import { deleteSelection, duplicateSelection, groupSelection, importFiles, openProject, saveProject, transformSelection } from '@/lib/store/actions';
import { migrateProject } from '@/lib/model/schema';
import type { Project } from '@/lib/model/project';
import { installDebugHook } from '@/lib/store/debug';
import { loadSession, registerSessionProvider, scheduleSessionSave, flushSession } from '@/lib/persist/session';
import { setCurrentHandle } from '@/lib/persist/fs';
import { useSessionUi } from '@/lib/store/session-ui';


export function AppShell() {
  const ui = useUi();
  const s = t(ui.lang);
  const lib = useLibrary();
  const project = useProject((p) => p.project);

  // boot: language, library, then the cached session (project, history, file, selection, camera, tree)
  useEffect(() => {
    try { const l = window.localStorage.getItem('cnc-milling-calc:lang'); if (l === 'de' || l === 'en') useUi.getState().setLang(l); } catch {}
    loadViewPrefs();
    useLibrary.getState().load();
    const libState = useLibrary.getState();
    let cancelled = false;
    (async () => {
      let restored = false;
      try {
        const rec = await loadSession();
        if (cancelled) return;
        if (rec?.project) {
          const p = migrateProject(rec.project);
          useProject.getState().setProject(p);
          useProject.temporal.getState().clear();
          const past = (rec.past ?? []).map((pr) => ({ project: migrateProject(pr) })), future = (rec.future ?? []).map((pr) => ({ project: migrateProject(pr) }));
          if (past.length || future.length) useProject.temporal.setState({ pastStates: past as never, futureStates: future as never });
          const u = useUi.getState();
          u.setFile(rec.fileName ?? null);
          u.setDirty(!!rec.dirty);
          if (rec.handle) setCurrentHandle(rec.handle);
          if (rec.selection) {
            const sel = rec.selection;
            u.select({
              placements: sel.placements.filter((id) => p.placements[id]),
              operations: sel.operations.filter((id) => p.operations[id]),
              groups: sel.groups.filter((id) => p.groups[id]),
              paths: sel.paths.filter((k) => { const [pid, pathId] = k.split(':'); const pl = p.placements[pid]; return pl && p.shapes[pl.shapeId]?.paths.some((x) => x.id === pathId); }),
              stock: sel.stock,
            });
          }
          useSessionUi.setState({ camera: rec.camera ?? null, expanded: rec.expanded ?? {} });
          restored = true;
        }
      } catch {}
      if (!restored) { useProject.getState().reset(libState.activeMachineId, libState.tools); useProject.temporal.getState().clear(); }
      // from here on every change is cached
      registerSessionProvider(() => {
        const ps = useProject.getState(), tm = useProject.temporal.getState(), u = useUi.getState(), su = useSessionUi.getState();
        return { project: ps.project, past: tm.pastStates.map((x) => (x as { project: Project }).project), future: tm.futureStates.map((x) => (x as { project: Project }).project), dirty: u.dirty, fileName: u.fileName, selection: u.selection, camera: su.camera, expanded: su.expanded };
      });
      useSessionUi.setState({ booted: true });
      void flushSession();
    })();
    installDebugHook();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cache on every change (debounced), and flush synchronously when the page goes away
  const booted = useSessionUi((x) => x.booted);
  useEffect(() => {
    if (!booted) return;
    const unsubs = [
      useProject.subscribe((st, prev) => { if (st.project !== prev.project) scheduleSessionSave(); }),
      useProject.temporal.subscribe((st, prev) => { if (st.pastStates !== prev.pastStates || st.futureStates !== prev.futureStates) scheduleSessionSave(); }),
      useUi.subscribe((st, prev) => { if (st.selection !== prev.selection || st.dirty !== prev.dirty || st.fileName !== prev.fileName) scheduleSessionSave(); }),
      useSessionUi.subscribe((st, prev) => { if (st.camera !== prev.camera || st.expanded !== prev.expanded) scheduleSessionSave(); }),
    ];
    const flush = () => {
      // commit a field still being edited, then write
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === 'function') active.blur();
      void flushSession();
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { for (const u of unsubs) u(); window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush); document.removeEventListener('visibilitychange', onVis); };
  }, [booted]);

  // keep the project's machine valid
  useEffect(() => {
    if (!lib.loaded || !lib.machines.length) return;
    if (!lib.machines.some((m) => m.id === project.machineId)) useProject.getState().update((p) => { p.machineId = lib.activeMachineId || lib.machines[0].id; });
  }, [lib.loaded, lib.machines, lib.activeMachineId, project.machineId]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) useProject.temporal.getState().redo(); else useProject.temporal.getState().undo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
      if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openProject(); return; }
      if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); importFiles(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelection(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); return; }
      if (e.key === 'r') transformSelection('rot90'); else if (e.key === 'R') transformSelection('rot-90');
      else if (e.key === 'm') transformSelection('mirrorX'); else if (e.key === 'M') transformSelection('mirrorY');
      else if (e.key === '1') useUi.getState().setView('2d'); else if (e.key === '2') useUi.getState().setView('3d'); else if (e.key === '3') useUi.getState().setView('gcode');
      else if (e.key === 'Escape') {
        const u = useUi.getState();
        if (u.modal) u.closeModal();
        else if (u.snapRefs.length) u.setSnapRefs([]);
        else if (u.pointPlacing || u.tabPlacing) { u.setPointPlacing(null); u.setTabPlacing(null); }
        else u.clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="cam-root">
      <Ribbon />
      <TreePanel />
      <div className="cam-center">
        <div className="cam-viewtabs">
          {(['2d', '3d', 'gcode'] as const).map((v) => <button type="button" key={v} className={ui.view === v ? 'active' : ''} onClick={() => ui.setView(v)}>{v === '2d' ? s.view2d : v === '3d' ? s.view3d : s.viewGcode}</button>)}
          {ui.view === '2d' && (
            <span className="right cam-layers">
              <button type="button" className={ui.showMilling ? 'active' : ''} onClick={() => ui.toggle('showMilling')} title={s.showMilling}>▧ <span>{s.showMilling}</span></button>
              <button type="button" className={ui.showToolpaths ? 'active' : ''} onClick={() => ui.toggle('showToolpaths')} title={s.showToolpaths}>〰 <span>{s.showToolpaths}</span></button>
              <button type="button" className={ui.showRapids ? 'active' : ''} onClick={() => ui.toggle('showRapids')} title={s.showRapids}>⋯ <span>{s.showRapids}</span></button>
            </span>
          )}
        </div>
        {ui.view === '2d' && <Canvas2D />}
        {ui.view === '3d' && <Preview3D />}
        {ui.view === 'gcode' && <GcodeView />}
      </div>
      <ParamPanel />
      <StatusBar />
      {ui.modal === 'options' && <OptionsModal />}
      {ui.modal === 'array' && <ArrayModal />}
      {ui.modal === 'shortcuts' && <ShortcutsModal />}
      {ui.modal === 'text' && <TextModal key={ui.textEditId ?? 'new'} />}
      {ui.modal === 'gcode-warning' && <GcodeWarningModal />}
      {ui.toast && <div className={`cam-toast ${ui.toast.kind}`}>{ui.toast.text}</div>}
    </div>
  );
}
