import { create } from 'zustand';
import type { Machine, Tool } from '@/lib/model/project';
import { newMachine, newTool } from '@/lib/model/defaults';
import { DEFAULT_SPINDLES, loadSpindles, loadTools, type SpindlePreset, type ToolPreset } from '@/lib/presets';
import { BUILT_IN_PROFILES, type PostProfile } from '@/lib/post';
import type { ImportedItems } from '@/lib/persist/libraryFiles';

const LIB_KEY = 'cnc-cam:library:v1';

export interface Library { machines: Machine[]; tools: Tool[]; profiles: PostProfile[]; activeMachineId: string; activeToolId: string }

interface LibraryState extends Library {
  loaded: boolean;
  load: () => void;
  upsertMachine: (m: Machine) => void;
  deleteMachine: (id: string) => void;
  upsertTool: (t: Tool) => void;
  deleteTool: (id: string) => void;
  upsertProfile: (p: PostProfile) => void;
  deleteProfile: (id: string) => void;
  setActiveMachine: (id: string) => void;
  setActiveTool: (id: string) => void;
  /** Define the toolset of a machine (undefined = every tool). */
  setMachineTools: (machineId: string, toolIds: string[] | undefined) => void;
  /** Merge imported items (upsert by id). Imported tools can be attached to a machine's toolset. */
  importItems: (items: ImportedItems, attachToMachineId?: string) => { machines: number; tools: number; profiles: number };
}

const num = (s: string | undefined) => { const v = Number((s ?? '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : undefined; };

/** Convert the calculator's spindle presets into machines. */
export function machineFromSpindle(s: SpindlePreset): Machine {
  const isHolz = /holz/i.test(s.name);
  const isIma = /ima/i.test(s.name);
  return newMachine({
    id: `m-${s.id}`, name: s.name, info: s.info,
    postId: isHolz ? 'estlcam-holz' : isIma ? 'ima-fmc' : 'grbl-mill',
    nMax: num(s.nMax) ?? 24000, nMin: num(s.nMin) ?? 0,
    feedMax: { xy: num(s.vfMax) ?? 2500, z: Math.min(1000, num(s.vfMax) ?? 1000) },
    rapid: isIma ? { xy: 55000, z: 25000 } : { xy: 3000, z: 1000 },
    travel: isIma ? { x: 2800, y: 1000, z: 440 } : { x: 600, y: 400, z: 100 },
    toolChange: isIma ? 'auto' : 'manual',
    climbAllowed: false,
  });
}

export function toolFromPreset(t: ToolPreset, slot: number): Tool {
  const d = num(t.d) ?? 6;
  return newTool({ id: `t-${t.id}`, name: t.name, slot, d, z: Math.round(num(t.z) ?? 2), cut: { stepDown: Math.max(0.5, d / 2), stepOverPct: 40, vc: num(t.vc), fz: num(t.fz), vfPlunge: 300, rampAngle: 10 } });
}

/** Generic laser: adjust S max, travel and speeds to the real machine in the options. */
export function defaultLaserMachine(): Machine {
  return newMachine({ id: 'm-laser', kind: 'laser', name: 'Makerspace Laser', postId: 'grbl-laser', travel: { x: 600, y: 400, z: 0 }, nMax: 1000, nMin: 0, feedMax: { xy: 6000, z: 1000 }, rapid: { xy: 6000, z: 1000 }, laser: { sMax: 1000, dynamic: true }, info: 'GRBL laser profile (M4 dynamic power). Set S max, travel and speeds for the real machine.' });
}
export function defaultLaserTool(): Tool {
  return newTool({ id: 't-default-laser', kind: 'laser', name: 'Laser 0.2 mm', slot: 9, d: 0.2, cut: { stepDown: 1, stepOverPct: 100, vf: 600, power: 80, passes: 1 } });
}

function defaultTools(): Tool[] {
  return [
    newTool({ id: 't-default-6', name: 'Spiralnutfräser Ø6 mm', slot: 1, d: 6, z: 2, cut: { stepDown: 3, stepOverPct: 40, n: 24000, vf: 2500, vfPlunge: 300, rampAngle: 10 } }),
    newTool({ id: 't-default-3', name: 'Spiralnutfräser Ø3 mm', slot: 2, d: 3, z: 2, cut: { stepDown: 1.5, stepOverPct: 40, n: 24000, vf: 1200, vfPlunge: 300, rampAngle: 10 } }),
    newTool({ id: 't-default-v60', kind: 'vbit', name: 'V-Fräser 60°', slot: 3, d: 6, z: 1, tipAngle: 60, cut: { stepDown: 1, stepOverPct: 30, n: 24000, vf: 1200, vfPlunge: 300, rampAngle: 10 } }),
    newTool({ id: 't-default-plan', kind: 'facemill', name: 'Planfräser Ø22 mm', slot: 4, d: 22, z: 2, fluteLength: 6, cut: { stepDown: 1, stepOverPct: 70, n: 12000, vf: 2000, vfPlunge: 300, rampAngle: 5 } }),
    defaultLaserTool(),
  ];
}

function seed(): Library {
  const spindles = [...DEFAULT_SPINDLES.filter((d) => !loadSpindles().some((s) => s.id === d.id)), ...loadSpindles()];
  const machines = [...spindles.map(machineFromSpindle), defaultLaserMachine()];
  const presetTools = loadTools().map((t, i) => toolFromPreset(t, i + 10));
  const tools = [...defaultTools(), ...presetTools];
  return { machines, tools, profiles: [], activeMachineId: machines[0]?.id ?? '', activeToolId: tools[0]?.id ?? '' };
}

function persist(state: Library) {
  try {
    const custom = state.profiles.filter((p) => !p.builtIn);
    window.localStorage.setItem(LIB_KEY, JSON.stringify({ ...state, profiles: custom }));
  } catch {}
}

export const useLibrary = create<LibraryState>((set, get) => {
  const save = (patch: Partial<Library>) => {
    const next = { ...get(), ...patch };
    persist({ machines: next.machines, tools: next.tools, profiles: next.profiles, activeMachineId: next.activeMachineId, activeToolId: next.activeToolId });
    set(patch);
  };
  return {
    machines: [], tools: [], profiles: BUILT_IN_PROFILES, activeMachineId: '', activeToolId: '', loaded: false,
    load: () => {
      let lib: Library | null = null;
      try { const raw = window.localStorage.getItem(LIB_KEY); if (raw) lib = JSON.parse(raw) as Library; } catch {}
      if (!lib || !lib.machines?.length) lib = seed();
      const customProfiles = (lib.profiles ?? []).filter((p) => !BUILT_IN_PROFILES.some((b) => b.id === p.id));
      // libraries created before laser support: add the generic laser machine and tool once
      try {
        const FLAG = 'cnc-cam:seeded:laser';
        if (!window.localStorage.getItem(FLAG)) {
          if (!lib.machines.some((m) => m.kind === 'laser')) lib.machines = [...lib.machines, defaultLaserMachine()];
          if (!lib.tools.some((t) => t.kind === 'laser')) lib.tools = [...lib.tools, defaultLaserTool()];
          window.localStorage.setItem(FLAG, '1');
        }
      } catch {}
      set({ ...lib, profiles: [...BUILT_IN_PROFILES, ...customProfiles], loaded: true });
      persist({ ...lib, profiles: customProfiles });
    },
    upsertMachine: (m) => save({ machines: get().machines.some((x) => x.id === m.id) ? get().machines.map((x) => (x.id === m.id ? m : x)) : [...get().machines, m] }),
    deleteMachine: (id) => save({ machines: get().machines.filter((m) => m.id !== id), activeMachineId: get().activeMachineId === id ? '' : get().activeMachineId }),
    upsertTool: (t) => save({ tools: get().tools.some((x) => x.id === t.id) ? get().tools.map((x) => (x.id === t.id ? t : x)) : [...get().tools, t] }),
    deleteTool: (id) => save({ tools: get().tools.filter((t) => t.id !== id), activeToolId: get().activeToolId === id ? '' : get().activeToolId }),
    upsertProfile: (p) => save({ profiles: get().profiles.some((x) => x.id === p.id) ? get().profiles.map((x) => (x.id === p.id ? p : x)) : [...get().profiles, p] }),
    deleteProfile: (id) => save({ profiles: get().profiles.filter((p) => p.id !== id || p.builtIn) }),
    setActiveMachine: (id) => save({ activeMachineId: id }),
    setActiveTool: (id) => save({ activeToolId: id }),
    setMachineTools: (machineId, toolIds) => save({ machines: get().machines.map((m) => (m.id === machineId ? { ...m, toolIds } : m)) }),
    importItems: (items, attachToMachineId) => {
      const upsert = <T extends { id: string }>(list: T[], add: T[]) => { const out = [...list]; for (const a of add) { const i = out.findIndex((x) => x.id === a.id); if (i >= 0) out[i] = a; else out.push(a); } return out; };
      const profiles = upsert(get().profiles, items.profiles.filter((p) => !BUILT_IN_PROFILES.some((b) => b.id === p.id)));
      const tools = upsert(get().tools, items.tools);
      const toolIds = new Set(tools.map((t) => t.id));
      let machines = upsert(get().machines, items.machines.map((m) => ({ ...m, toolIds: m.toolIds?.filter((id) => toolIds.has(id)) })));
      if (attachToMachineId && items.tools.length) {
        machines = machines.map((m) => (m.id === attachToMachineId && m.toolIds ? { ...m, toolIds: [...new Set([...m.toolIds, ...items.tools.map((t) => t.id)])] } : m));
      }
      save({ machines, tools, profiles, activeMachineId: get().activeMachineId || machines[0]?.id || '', activeToolId: get().activeToolId || tools[0]?.id || '' });
      return { machines: items.machines.length, tools: items.tools.length, profiles: items.profiles.length };
    },
  };
});
