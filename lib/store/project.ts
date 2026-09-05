import { create } from 'zustand';
import { temporal } from 'zundo';
import { immer } from 'zustand/middleware/immer';
import type { Group, Operation, Placement, Project, Shape, Stock, Tool, Id, Mat } from '@/lib/model/project';
import { newProject } from '@/lib/model/defaults';
import { newId } from '@/lib/model/ids';

export interface ProjectState {
  project: Project;
  /** Increments on every document change; used for autosave/dirty tracking. */
  rev: number;
  setProject: (p: Project) => void;
  reset: (machineId: string, tools: Tool[]) => void;
  update: (fn: (p: Project) => void) => void;
  // convenience actions
  addShape: (shape: Shape, placement: Placement) => void;
  updatePlacement: (id: Id, patch: Partial<Placement>) => void;
  transformPlacements: (ids: Id[], fn: (m: Mat, pl: Placement) => Mat) => void;
  removePlacements: (ids: Id[]) => void;
  setStock: (patch: Partial<Stock>) => void;
  addOperation: (op: Operation) => void;
  updateOperation: (id: Id, patch: Partial<Operation>) => void;
  removeOperations: (ids: Id[]) => void;
  /** Move operation `id` so it runs before `beforeId` (or last when undefined); optionally retarget its tool. */
  moveOperation: (id: Id, beforeId: Id | undefined, toolId?: Id) => void;
  groupPlacements: (ids: Id[], name?: string) => Id;
  ungroup: (groupId: Id) => void;
  updateGroup: (id: Id, patch: Partial<Group>) => void;
  ensureTool: (tool: Tool) => void;
}

export const useProject = create<ProjectState>()(
  temporal(
    immer((set) => ({
      project: newProject('', []),
      rev: 0,
      setProject: (p) => set((s) => { s.project = p; s.rev++; }),
      reset: (machineId, tools) => set((s) => { s.project = newProject(machineId, tools); s.rev++; }),
      update: (fn) => set((s) => { fn(s.project); s.project.modified = new Date().toISOString(); s.rev++; }),
      addShape: (shape, placement) => set((s) => { s.project.shapes[shape.id] = shape; s.project.placements[placement.id] = placement; s.rev++; }),
      updatePlacement: (id, patch) => set((s) => { const pl = s.project.placements[id]; if (pl) Object.assign(pl, patch); s.rev++; }),
      transformPlacements: (ids, fn) => set((s) => { for (const id of ids) { const pl = s.project.placements[id]; if (pl && !pl.locked) pl.transform = fn(pl.transform, pl); } s.rev++; }),
      removePlacements: (ids) => set((s) => {
        for (const id of ids) {
          const pl = s.project.placements[id];
          if (!pl) continue;
          delete s.project.placements[id];
          if (!Object.values(s.project.placements).some((p) => p.shapeId === pl.shapeId)) delete s.project.shapes[pl.shapeId];
          for (const op of Object.values(s.project.operations)) op.targets = op.targets.filter((t) => t.placementId !== id);
        }
        for (const op of Object.values(s.project.operations)) if (!op.targets.length) delete s.project.operations[op.id];
        s.rev++;
      }),
      setStock: (patch) => set((s) => { Object.assign(s.project.stock, patch); s.rev++; }),
      addOperation: (op) => set((s) => { s.project.operations[op.id] = op; s.rev++; }),
      updateOperation: (id, patch) => set((s) => { const op = s.project.operations[id]; if (op) Object.assign(op, patch); s.rev++; }),
      removeOperations: (ids) => set((s) => { for (const id of ids) delete s.project.operations[id]; s.rev++; }),
      moveOperation: (id, beforeId, toolId) => set((s) => {
        const list = Object.values(s.project.operations).sort((a, b) => a.order - b.order).filter((o) => o.id !== id);
        const moving = s.project.operations[id];
        if (!moving) return;
        const idx = beforeId ? list.findIndex((o) => o.id === beforeId) : -1;
        if (idx < 0) list.push(moving); else list.splice(idx, 0, moving);
        list.forEach((o, i) => { o.order = i + 1; });
        if (toolId) moving.toolId = toolId;
        s.rev++;
      }),
      groupPlacements: (ids, name) => {
        const id = newId('g');
        set((s) => {
          s.project.groups[id] = { id, name: name ?? `Group ${Object.keys(s.project.groups).length + 1}`, zOffset: 0 };
          for (const pid of ids) { const pl = s.project.placements[pid]; if (pl) pl.groupId = id; }
          s.rev++;
        });
        return id;
      },
      ungroup: (groupId) => set((s) => { for (const pl of Object.values(s.project.placements)) if (pl.groupId === groupId) delete pl.groupId; delete s.project.groups[groupId]; s.rev++; }),
      updateGroup: (id, patch) => set((s) => { const g = s.project.groups[id]; if (g) Object.assign(g, patch); s.rev++; }),
      ensureTool: (tool) => set((s) => { if (!s.project.tools[tool.id]) s.project.tools[tool.id] = tool; }),
    })),
    { limit: 100, partialize: (s) => ({ project: s.project }) as unknown as ProjectState, equality: (a, b) => a.project === b.project },
  ),
);

export const useTemporal = () => useProject.temporal;
