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
import { useUi, loadViewPrefs } from '@/lib/store/ui';
import { useLibrary } from '@/lib/store/library';
import { useProject } from '@/lib/store/project';
import { t } from '@/lib/i18n';
import { deleteSelection, duplicateSelection, groupSelection, importFiles, openProject, saveProject, transformSelection } from '@/lib/store/actions';
import { migrateProject } from '@/lib/model/schema';
import { installDebugHook } from '@/lib/store/debug';

const AUTOSAVE_KEY = 'cnc-cam:autosave:v1';

export function AppShell() {
  const ui = useUi();
  const s = t(ui.lang);
  const lib = useLibrary();
  const project = useProject((p) => p.project);
  const rev = useProject((p) => p.rev);

  // boot: language, library, autosaved project
  useEffect(() => {
    try { const l = window.localStorage.getItem('cnc-milling-calc:lang'); if (l === 'de' || l === 'en') useUi.getState().setLang(l); } catch {}
    loadViewPrefs();
    useLibrary.getState().load();
    const libState = useLibrary.getState();
    let restored = false;
    try {
      const raw = window.localStorage.getItem(AUTOSAVE_KEY);
      if (raw) { const p = migrateProject(JSON.parse(raw)); useProject.getState().setProject(p); restored = true; }
    } catch {}
    if (!restored) useProject.getState().reset(libState.activeMachineId, libState.tools);
    useProject.temporal.getState().clear();
    installDebugHook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // autosave (debounced) to localStorage until the IndexedDB cache lands
  useEffect(() => {
    if (!lib.loaded) return;
    const h = setTimeout(() => { try { window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project)); } catch {} }, 800);
    return () => clearTimeout(h);
  }, [project, rev, lib.loaded]);

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
      else if (e.key === 'Escape') { if (useUi.getState().modal) useUi.getState().closeModal(); else useUi.getState().clearSelection(); }
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
      {ui.toast && <div className={`cam-toast ${ui.toast.kind}`}>{ui.toast.text}</div>}
    </div>
  );
}
