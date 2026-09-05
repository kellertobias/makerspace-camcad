import { useProject } from './project';
import { useUi } from './ui';
import { useLibrary } from './library';
import { importDrawing } from '@/lib/import';
import type { Operation, OperationType, Path, Placement, Shape, Target, Project } from '@/lib/model/project';
import { newOperation } from '@/lib/model/defaults';
import { newId } from '@/lib/model/ids';
import { bbox as pathBBox, signedArea } from '@/lib/geometry/path';
import { bboxUnion, bboxValid } from '@/lib/geometry/types';
import { about, compose, rotation, scaling, translation, transformPath } from '@/lib/geometry/transform';
import { placementBBox } from '@/lib/cam/instances';
import { openTextFiles, saveText, setCurrentHandle } from '@/lib/persist/fs';
import { migrateProject } from '@/lib/model/schema';
import { planProject } from '@/lib/cam/plan';
import { exportProgram } from '@/lib/post';
import { APP_VERSION } from '@/lib/version';

/** Import DXF/SVG text as one shape (local origin at its bounding-box corner) and place it on the sheet. */
export function importDrawingText(name: string, text: string): { shape: Shape; placement: Placement; warnings: string[] } {
  const d = importDrawing(name, text);
  if (!d.paths.length) throw new Error('No geometry found in file');
  const b = d.paths.map(pathBBox).reduce(bboxUnion);
  const local = translation(-b.minX, -b.minY);
  const paths: Path[] = d.paths.map((p) => ({ ...transformPath(p, local), id: p.id }));
  const shape: Shape = { id: newId('s'), name: name.replace(/\.[^.]+$/, ''), kind: 'outline', paths, source: name };
  const { project } = useProject.getState();
  // place next to existing parts, or at 10/10
  const existing = Object.values(project.placements).map((pl) => placementBBox(project, pl)).filter(bboxValid);
  const x = existing.length ? Math.max(...existing.map((e) => e.maxX)) + 10 : 10;
  const placement: Placement = { id: newId('p'), shapeId: shape.id, name: shape.name, transform: translation(x, 10) };
  const warnings = [...d.warnings];
  if (!d.unitKnown) warnings.push(`Unit not declared (${d.unitName}); coordinates were interpreted as ${d.unitName}.`);
  return { shape, placement, warnings };
}

export async function importFiles() {
  const files = await openTextFiles('.dxf,.svg', true);
  const { addShape } = useProject.getState();
  const ui = useUi.getState();
  const ids: string[] = [];
  for (const f of files) {
    try {
      const r = importDrawingText(f.name, f.text);
      addShape(r.shape, r.placement);
      ids.push(r.placement.id);
      for (const w of r.warnings) ui.notify(`${f.name}: ${w}`);
    } catch (e) { ui.notify(`${f.name}: ${(e as Error).message}`, 'error'); }
  }
  if (ids.length) { ui.select({ placements: ids }); ui.setDirty(true); }
}

export function selectedPlacementIds(): string[] {
  const sel = useUi.getState().selection;
  const ids = new Set(sel.placements);
  for (const key of sel.paths) ids.add(key.split(':')[0]);
  return [...ids];
}

/** Targets for a new operation from the current selection: explicit sub-paths, otherwise all paths of selected placements. */
export function targetsFromSelection(project: Project): Target[] {
  const sel = useUi.getState().selection;
  const pick = useUi.getState().pick;
  const out: Target[] = [];
  if (sel.paths.length) {
    for (const key of sel.paths) { const [placementId, pathId] = key.split(':'); out.push({ placementId, pathId, pick: pick === 'contour' ? 'contour' : pick }); }
  }
  for (const pid of sel.placements) {
    const pl = project.placements[pid];
    if (!pl) continue;
    if (pick === 'shape-center') { out.push({ placementId: pid, pick: 'shape-center' }); continue; }
    const shape = project.shapes[pl.shapeId];
    for (const p of shape?.paths ?? []) if (!out.some((t) => t.placementId === pid && t.pathId === p.id)) out.push({ placementId: pid, pathId: p.id, pick });
  }
  return out;
}

export function addOperationForSelection(type: OperationType, side?: 'outside' | 'inside' | 'on') {
  const ps = useProject.getState();
  const lib = useLibrary.getState();
  const ui = useUi.getState();
  const s = ui.lang;
  const targets = targetsFromSelection(ps.project);
  if (!targets.length) { ui.notify(s === 'de' ? 'Zuerst eine oder mehrere Konturen auswählen.' : 'Select one or more outlines first.', 'error'); return; }
  const tool = lib.tools.find((t) => t.id === lib.activeToolId) ?? lib.tools[0];
  if (!tool) { ui.notify(s === 'de' ? 'Kein Werkzeug vorhanden.' : 'No tool available.', 'error'); return; }
  ps.ensureTool(tool);
  const depth = type === 'engrave' ? 1 : type === 'cutout' ? ps.project.stock.thickness + 1 : ps.project.stock.thickness / 2;
  const order = Object.keys(ps.project.operations).length + 1;
  const machine = lib.machines.find((m) => m.id === ps.project.machineId);
  const op = newOperation(type, tool.id, tool, depth, order, machine?.climbAllowed === true);
  if (side && (op.type === 'contour' || op.type === 'engrave')) op.side = side;
  if (side && op.type === 'cutout' && side !== 'on') op.side = side;
  if (side && op.type === 'pocket') op.side = side;
  const names: Record<OperationType, [string, string]> = { contour: ['Kontur', 'Contour'], cutout: ['Ausschnitt', 'Cutout'], pocket: ['Tasche', 'Pocket'], engrave: ['Gravur', 'Engraving'], drill: ['Bohrung', 'Drilling'], thread: ['Gewinde', 'Thread'], 'laser-cut': ['Laserschnitt', 'Laser cut'], 'laser-engrave': ['Lasergravur', 'Laser engraving'] };
  const firstPl = ps.project.placements[targets[0].placementId];
  op.name = `${names[type][s === 'de' ? 0 : 1]} ${firstPl?.name ?? ''}`.trim();
  op.targets = targets;
  ps.addOperation(op);
  ui.select({ operations: [op.id] });
  ui.setDirty(true);
}

/** Add the currently selected contours to an existing operation (pockets: as cut area or exclusion zone). */
export function addSelectionToOperation(opId: string, role: 'cut' | 'exclude' = 'cut') {
  const ps = useProject.getState();
  const ui = useUi.getState();
  const op = ps.project.operations[opId];
  if (!op) return;
  const fresh = targetsFromSelection(ps.project).filter((t) => !op.targets.some((e) => e.placementId === t.placementId && e.pathId === t.pathId));
  if (!fresh.length) { ui.notify(ui.lang === 'de' ? 'Keine neuen Konturen ausgewählt.' : 'No new contours selected.', 'error'); return; }
  ps.updateOperation(opId, { targets: [...op.targets, ...fresh.map((t) => (role === 'exclude' ? { ...t, role, margin: 0 } : t))] });
  ui.select({ operations: [opId] });
}

export function transformSelection(kind: 'rot90' | 'rot-90' | 'mirrorX' | 'mirrorY') {
  const ids = selectedPlacementIds();
  if (!ids.length) return;
  const { project, transformPlacements } = useProject.getState();
  // pivot: centre of the combined bounding box
  const b = ids.map((id) => placementBBox(project, project.placements[id])).filter(bboxValid).reduce(bboxUnion);
  const pivot = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const m = kind === 'rot90' ? rotation(90) : kind === 'rot-90' ? rotation(-90) : kind === 'mirrorX' ? scaling(-1, 1) : scaling(1, -1);
  const world = about(m, pivot);
  transformPlacements(ids, (t) => compose(world, t));
  useUi.getState().setDirty(true);
}

export function duplicateSelection() {
  const ids = selectedPlacementIds();
  const ps = useProject.getState();
  const created: string[] = [];
  ps.update((p) => {
    for (const id of ids) {
      const pl = p.placements[id];
      if (!pl) continue;
      const b = placementBBox(p, pl);
      const copy: Placement = { ...pl, id: newId('p'), name: pl.name + ' (2)', transform: compose(translation(bboxValid(b) ? b.maxX - b.minX + 10 : 10, 0), pl.transform), groupId: undefined };
      p.placements[copy.id] = copy;
      created.push(copy.id);
    }
  });
  if (created.length) useUi.getState().select({ placements: created });
}

/** Human readable contour label: "Kontur 3 · Gravur · offen". */
export function pathLabel(p: Path, index: number, lang: 'de' | 'en'): string {
  const bits = [lang === 'de' ? `Kontur ${index + 1}` : `Contour ${index + 1}`];
  if (p.layer) bits.push(p.layer);
  bits.push(p.segs.length === 0 ? (lang === 'de' ? 'Punkt' : 'point') : p.closed ? (lang === 'de' ? 'geschlossen' : 'closed') : (lang === 'de' ? 'offen' : 'open'));
  return bits.join(' · ');
}

/** Remove individual contours from their shapes (the shape is shared by placements, so copy it first if needed). */
export function removeContours(keys: string[]) {
  const ps = useProject.getState();
  const byPlacement = new Map<string, Set<string>>();
  for (const k of keys) { const [pid, pathId] = k.split(':'); if (!byPlacement.has(pid)) byPlacement.set(pid, new Set()); byPlacement.get(pid)!.add(pathId); }
  const emptied: string[] = [];
  ps.update((p) => {
    for (const [pid, pathIds] of byPlacement) {
      const pl = p.placements[pid];
      if (!pl) continue;
      let shape = p.shapes[pl.shapeId];
      if (!shape) continue;
      const shared = Object.values(p.placements).some((o) => o.id !== pid && o.shapeId === shape!.id);
      if (shared) { shape = { ...shape, id: newId('s'), paths: shape.paths.map((x) => ({ ...x })) }; p.shapes[shape.id] = shape; pl.shapeId = shape.id; }
      shape.paths = shape.paths.filter((x) => !pathIds.has(x.id));
      for (const op of Object.values(p.operations)) op.targets = op.targets.filter((t) => !(t.placementId === pid && t.pathId && pathIds.has(t.pathId)));
      if (!shape.paths.length) emptied.push(pid);
    }
    for (const op of Object.values(p.operations)) if (!op.targets.length) delete p.operations[op.id];
  });
  if (emptied.length) ps.removePlacements(emptied);
}

export function deleteSelection() {
  const ui = useUi.getState();
  const ps = useProject.getState();
  if (ui.selection.operations.length) ps.removeOperations(ui.selection.operations);
  const whole = new Set(ui.selection.placements);
  for (const g of ui.selection.groups) for (const pl of Object.values(ps.project.placements)) if (pl.groupId === g) whole.add(pl.id);
  const contourKeys = ui.selection.paths.filter((k) => !whole.has(k.split(':')[0]));
  if (contourKeys.length) removeContours(contourKeys);
  if (whole.size) ps.removePlacements([...whole]);
  for (const g of ui.selection.groups) ps.ungroup(g);
  ui.clearSelection();
  ui.setDirty(true);
}

export function groupSelection() {
  const ids = selectedPlacementIds();
  if (ids.length < 2) return;
  const gid = useProject.getState().groupPlacements(ids);
  useUi.getState().select({ groups: [gid] });
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
const PROJECT_TYPES = [{ description: 'CAM project', accept: { 'application/json': ['.cncproj'] } }];

export async function saveProject(as = false) {
  const { project } = useProject.getState();
  const ui = useUi.getState();
  const text = JSON.stringify(project, null, 1);
  const name = await saveText(text, `${project.name || 'project'}.cncproj`, 'application/json', PROJECT_TYPES, !as);
  if (name) { ui.setFile(name); ui.setDirty(false); ui.notify(ui.lang === 'de' ? 'Gespeichert' : 'Saved'); }
}

export async function openProject() {
  const files = await openTextFiles('.cncproj,.json', false);
  if (!files.length) return;
  const ui = useUi.getState();
  try {
    const p = migrateProject(JSON.parse(files[0].text));
    useProject.getState().setProject(p);
    useProject.temporal.getState().clear();
    if (files[0].handle) setCurrentHandle(files[0].handle);
    ui.setFile(files[0].name); ui.setDirty(false); ui.clearSelection();
  } catch (e) { ui.notify((e as Error).message, 'error'); }
}

export function newProjectAction() {
  const lib = useLibrary.getState();
  const ui = useUi.getState();
  const tools = lib.tools;
  useProject.getState().reset(lib.activeMachineId || lib.machines[0]?.id || '', tools);
  useProject.temporal.getState().clear();
  setCurrentHandle(null);
  ui.setFile(null); ui.setDirty(false); ui.clearSelection();
}

export async function exportGcode() {
  const { project } = useProject.getState();
  const lib = useLibrary.getState();
  const ui = useUi.getState();
  const machine = lib.machines.find((m) => m.id === project.machineId) ?? lib.machines.find((m) => m.id === lib.activeMachineId);
  if (!machine) { ui.notify(ui.lang === 'de' ? 'Keine Maschine ausgewählt.' : 'No machine selected.', 'error'); return; }
  const profile = lib.profiles.find((p) => p.id === machine.postId);
  if (!profile) { ui.notify('Post-processor profile not found.', 'error'); return; }
  const { program } = planProject(project, machine, APP_VERSION);
  const res = exportProgram(program, profile, project.stock.safeZ, APP_VERSION);
  if (!res.text) { ui.notify(res.warnings.join(' '), 'error'); return; }
  for (const w of res.warnings) ui.notify(w);
  await saveText(res.text, res.filename, 'text/plain', [{ description: 'G-code', accept: { 'text/plain': [`.${profile.ext || 'nc'}`] } }]);
}

export const orientationName = (p: Path) => (p.closed ? (signedArea(p) > 0 ? 'ccw' : 'cw') : 'open');
export { about, compose, translation };
export type { Operation };
