/**
 * Working session cache so that a browser reload loses nothing: the project, its undo/redo history, the file it
 * belongs to (name + File System Access handle), the unsaved flag, the selection, the 2D camera and the tree state.
 *
 * Primary store is IndexedDB (no practical size limit, handles are structured-cloneable). A compact mirror of the
 * project goes to localStorage synchronously so a save started in `pagehide` cannot be cut short; on boot the newer
 * of the two wins, and the history/handle are taken from IndexedDB whenever it describes the same project.
 */
import type { Project } from '@/lib/model/project';
import type { Selection } from '@/lib/store/ui';
import { db } from './db';
import { getCurrentHandle } from './fs';

export interface Camera { scale: number; ox: number; oy: number }

export interface SessionRecord {
  project: Project;
  /** undo / redo stacks (most recent last / first), capped */
  past: Project[];
  future: Project[];
  dirty: boolean;
  fileName: string | null;
  handle: FileSystemFileHandle | null;
  selection: Selection | null;
  camera: Camera | null;
  /** expanded objects in the tree */
  expanded: Record<string, boolean>;
  savedAt: number;
}

const KV_KEY = 'session';
const LS_KEY = 'cnc-cam:session:v1';
const LEGACY_LS_KEY = 'cnc-cam:autosave:v1';
const HISTORY_CAP = 50;
const LS_MAX_BYTES = 3_500_000;

type Provider = () => Omit<SessionRecord, 'handle' | 'savedAt'>;
let provider: Provider | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWritten = 0;

/** The app registers how to assemble the record; the module then owns debouncing and flushing. */
export function registerSessionProvider(p: Provider) { provider = p; }

/** Persist soon (debounced); call on every change worth keeping. */
export function scheduleSessionSave(delay = 400) {
  if (!provider) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void flushSession(); }, delay);
}

/** Persist now. Safe to call from pagehide: the localStorage mirror is written synchronously. */
export function flushSession(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!provider) return Promise.resolve();
  const base = provider();
  const rec: SessionRecord = { ...base, past: base.past.slice(-HISTORY_CAP), future: base.future.slice(0, HISTORY_CAP), handle: getCurrentHandle(), savedAt: Date.now() };
  lastWritten = rec.savedAt;
  // synchronous mirror (without history and handle) — skipped when too large for localStorage
  try {
    const mirror = JSON.stringify({ project: rec.project, dirty: rec.dirty, fileName: rec.fileName, selection: rec.selection, camera: rec.camera, expanded: rec.expanded, savedAt: rec.savedAt });
    if (mirror.length <= LS_MAX_BYTES) window.localStorage.setItem(LS_KEY, mirror);
    window.localStorage.removeItem(LEGACY_LS_KEY);
  } catch {}
  return db().then((d) => d.put('kv', rec, KV_KEY)).then(() => undefined).catch(() => undefined);
}

export const lastSessionWrite = () => lastWritten;

/** Restore the newest cached session, if any. */
export async function loadSession(): Promise<Partial<SessionRecord> | null> {
  let idb: SessionRecord | null = null;
  try { idb = ((await (await db()).get('kv', KV_KEY)) as SessionRecord | undefined) ?? null; } catch {}
  let ls: Partial<SessionRecord> | null = null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) ls = JSON.parse(raw) as Partial<SessionRecord>;
    else {
      // first run after the upgrade: the old autosave held only the project
      const legacy = window.localStorage.getItem(LEGACY_LS_KEY);
      if (legacy) ls = { project: JSON.parse(legacy) as Project, savedAt: 0 };
    }
  } catch {}
  if (!idb && !ls) return null;
  if (idb && (!ls || (idb.savedAt ?? 0) >= (ls.savedAt ?? 0))) return idb;
  // the mirror is newer (a save was cut short); keep history and handle from IndexedDB when they belong to the same project
  const same = idb && ls?.project && idb.project?.id === ls.project.id;
  return { ...ls, past: same ? idb!.past : [], future: same ? idb!.future : [], handle: same ? idb!.handle : null };
}

/** Forget the cached session (new project / explicit reset). */
export async function clearSession() {
  try { window.localStorage.removeItem(LS_KEY); window.localStorage.removeItem(LEGACY_LS_KEY); } catch {}
  try { await (await db()).delete('kv', KV_KEY); } catch {}
}
