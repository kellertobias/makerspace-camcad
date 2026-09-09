import { newId } from './ids';
import type { CuttingData, Machine, Operation, OperationType, Project, Stock, Tool } from './project';
import { SCHEMA_VERSION } from './project';

export const IDENTITY: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

export function defaultStock(): Stock {
  return {
    width: 600, height: 400, thickness: 12, material: 'mdf',
    origin: { mode: 'sheet-corner', corner: 'bl', manual: { x: 0, y: 0 } },
    zZero: 'top', safeZ: 5, clearZ: 0.5,
  };
}

export function defaultCut(d: number): CuttingData {
  return { stepDown: Math.max(0.5, Math.round(d * 5) / 10), stepOverPct: 40, rampAngle: 10, vfPlunge: 300 };
}

export function newTool(partial: Partial<Tool> = {}): Tool {
  const d = partial.d ?? 6;
  return {
    id: partial.id ?? newId('t'),
    kind: partial.kind ?? 'endmill',
    name: partial.name ?? `Ø${d} mm`,
    slot: partial.slot ?? 1,
    d,
    z: partial.z ?? 2,
    cut: { ...defaultCut(d), ...(partial.cut ?? {}) },
    ...partial,
  } as Tool;
}

export function newMachine(partial: Partial<Machine> = {}): Machine {
  return {
    id: partial.id ?? newId('m'),
    kind: 'cnc',
    name: 'Machine',
    postId: 'grbl-mill',
    travel: { x: 600, y: 400, z: 100 },
    nMax: 24000, nMin: 3000,
    feedMax: { xy: 2500, z: 1000 },
    rapid: { xy: 3000, z: 1000 },
    toolChange: 'manual',
    climbAllowed: false,
    ...partial,
  };
}

export function newProject(machineId: string, tools: Tool[]): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('p'),
    name: 'Untitled',
    created: now,
    modified: now,
    machineId,
    stock: defaultStock(),
    shapes: {}, placements: {}, groups: {}, operations: {},
    tools: Object.fromEntries(tools.map((t) => [t.id, t])),
  };
}

/** Create an operation of the given type with sensible defaults for the tool. */
export function newOperation(type: OperationType, toolId: string, tool: Tool | undefined, depth: number, order: number, climb = false): Operation {
  const base = {
    id: newId('o'), name: '', toolId, targets: [], enabled: true, order, depth,
    entry: { kind: 'ramp', angle: tool?.cut.rampAngle ?? 10 } as Operation['entry'],
    climb, zOffset: 0,
  };
  const none = { kind: 'none' } as const;
  switch (type) {
    case 'contour': return { ...base, type, side: 'outside', overcut: none };
    case 'cutout': return { ...base, type, side: 'outside', overcut: none, tabs: { count: 4, width: 8, height: 3 } };
    case 'pocket': return { ...base, type, side: 'inside', outsideWidth: 1, outsideWidthUnit: 'tool', strategy: 'offset', rasterAngle: 0, islands: 'auto', overcut: none };
    case 'surface-3d': return { ...base, type, depthExpression: 'startDepth + 4 * (1 + Math.sin(distance / 4)) / 2', sampleStep: 1, rasterAngle: 0, stepOverPct: tool?.cut.stepOverPct ?? 40, finishAllowance: 0.5, entry: { kind: 'plunge' } };
    case 'engrave': return { ...base, type, side: 'on', depth: Math.min(depth, 1) };
    case 'drill': return { ...base, type, mode: 'plunge', entry: { kind: 'plunge' } };
    case 'saw': return { ...base, type, side: 'on', entry: { kind: 'plunge' } };
    case 'thread': return { ...base, type, pitch: 1.25, majorD: 8, internal: true, passes: 1, entry: { kind: 'plunge' } };
    case 'laser-cut': return { ...base, type, power: tool?.cut.power ?? 100, speed: tool?.cut.vf ?? 600, passes: tool?.cut.passes ?? 1, kerfSide: 'outside', depth: 0, entry: { kind: 'plunge' } };
    case 'laser-engrave': return { ...base, type, power: 30, speed: 3000, mode: 'vector', hatchPitch: 0.2, hatchAngle: 0, passes: 1, outline: true, depth: 0, entry: { kind: 'plunge' } };
  }
}
