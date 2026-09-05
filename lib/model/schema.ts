import { SCHEMA_VERSION, type Project } from './project';

type Migration = (p: Record<string, unknown>) => Record<string, unknown>;

/** Migrations keyed by the version they upgrade FROM. */
const migrations: Record<number, Migration> = {
  // v1 -> v2: zOffset changed from "lift" (positive = up) to start depth (positive = deeper)
  1: (p) => {
    for (const op of Object.values((p.operations ?? {}) as Record<string, Record<string, unknown>>)) if (typeof op.zOffset === 'number') op.zOffset = -op.zOffset;
    for (const g of Object.values((p.groups ?? {}) as Record<string, Record<string, unknown>>)) if (typeof g.zOffset === 'number') g.zOffset = -g.zOffset;
    return p;
  },
};

/** Fill in fields added after a version without bumping the schema (backwards compatible defaults). */
function fillDefaults(p: Record<string, unknown>) {
  const ops = (p.operations ?? {}) as Record<string, Record<string, unknown>>;
  for (const op of Object.values(ops)) {
    if (op.type === 'pocket') { op.side ??= 'inside'; op.outsideWidthUnit ??= 'mm'; delete op.finishPass; }
  }
}

export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Not a project file');
  let p = raw as Record<string, unknown>;
  let v = typeof p.schemaVersion === 'number' ? p.schemaVersion : 0;
  while (v < SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new Error(`No migration from schema version ${v}`);
    p = m(p);
    v++;
    p.schemaVersion = v;
  }
  if (v > SCHEMA_VERSION) throw new Error(`Project was saved with a newer version (schema ${v}).`);
  fillDefaults(p);
  return p as unknown as Project;
}
