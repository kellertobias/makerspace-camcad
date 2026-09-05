import { create } from 'zustand';
import type { Id } from '@/lib/model/project';
import type { Lang } from '@/lib/i18n';

export type View = '2d' | '3d' | 'gcode';
export type RibbonTab = 'file' | 'layout' | 'ops' | 'machine' | 'view';
export type PickMode = 'contour' | 'shape-center' | 'line-center' | 'point';

export interface Selection { placements: Id[]; operations: Id[]; groups: Id[]; /** selected sub-paths as `${placementId}:${pathId}` */ paths: string[]; /** the stock / sheet entry is selected */ stock?: boolean }
const emptySel = (): Selection => ({ placements: [], operations: [], groups: [], paths: [] });

interface UiState {
  lang: Lang;
  view: View;
  tab: RibbonTab;
  pick: PickMode;
  selection: Selection;
  showGrid: boolean;
  snap: boolean;
  /** 2D layers: milled areas by operation type, tool centre lines, rapid moves */
  showMilling: boolean;
  showToolpaths: boolean;
  showRapids: boolean;
  modal: null | 'options' | 'import' | 'text' | 'array' | 'shortcuts';
  optionsTab: 'machines' | 'tools' | 'posts';
  toast: { text: string; kind: 'info' | 'error' } | null;
  fileName: string | null;
  dirty: boolean;
  /** Operation whose bridges are being placed by clicking in the 2D view. */
  tabPlacing: Id | null;
  setTabPlacing: (id: Id | null) => void;
  setLang: (l: Lang) => void;
  setView: (v: View) => void;
  setTab: (t: RibbonTab) => void;
  setPick: (p: PickMode) => void;
  select: (sel: Partial<Selection>, additive?: boolean) => void;
  clearSelection: () => void;
  toggle: (k: 'showGrid' | 'snap' | 'showMilling' | 'showToolpaths' | 'showRapids') => void;
  openModal: (m: UiState['modal'], optionsTab?: UiState['optionsTab']) => void;
  closeModal: () => void;
  notify: (text: string, kind?: 'info' | 'error') => void;
  setFile: (name: string | null) => void;
  setDirty: (d: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  lang: 'de', view: '2d', tab: 'layout', pick: 'contour', selection: emptySel(),
  showGrid: true, snap: true, showMilling: true, showToolpaths: true, showRapids: false, modal: null, optionsTab: 'tools', toast: null, fileName: null, dirty: false, tabPlacing: null,
  setTabPlacing: (tabPlacing) => set({ tabPlacing }),
  setLang: (lang) => { try { window.localStorage.setItem('cnc-milling-calc:lang', lang); } catch {} set({ lang }); },
  setView: (view) => set({ view }),
  setTab: (tab) => set({ tab }),
  setPick: (pick) => set({ pick }),
  select: (sel, additive) => set((s) => {
    if (!additive) return { selection: { ...emptySel(), ...sel }, tabPlacing: sel.operations?.length ? s.tabPlacing : null };
    const merged: Selection = { ...s.selection, stock: false };
    for (const k of ['placements', 'operations', 'groups', 'paths'] as const) {
      const cur = new Set<string>(merged[k]);
      for (const id of sel[k] ?? []) { if (cur.has(id)) cur.delete(id); else cur.add(id); }
      merged[k] = [...cur];
    }
    return { selection: merged };
  }),
  clearSelection: () => set({ selection: emptySel() }),
  toggle: (k) => set((s) => ({ [k]: !s[k] })),
  openModal: (modal, optionsTab) => set((s) => ({ modal, optionsTab: optionsTab ?? s.optionsTab })),
  closeModal: () => set({ modal: null }),
  notify: (text, kind = 'info') => { set({ toast: { text, kind } }); setTimeout(() => set((s) => (s.toast?.text === text ? { toast: null } : {})), 4000); },
  setFile: (fileName) => set({ fileName }),
  setDirty: (dirty) => set({ dirty }),
}));
