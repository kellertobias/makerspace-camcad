/**
 * JSON bundles for sharing library items between browsers / people:
 *   machine  – one machine with its toolset and a custom post profile if it uses one
 *   toolset  – a list of tools
 *   library  – everything (machines, tools, custom profiles)
 * Importing is lenient: any of the three kinds, or a bare machine / tool array.
 */
import type { Machine, Tool } from '@/lib/model/project';
import type { PostProfile } from '@/lib/post/types';

export const BUNDLE_FORMAT = 'makerspace-cam';
export type BundleKind = 'machine' | 'toolset' | 'library';

export interface Bundle { format: typeof BUNDLE_FORMAT; kind: BundleKind; version: 1; name?: string; exported: string; machines?: Machine[]; tools?: Tool[]; profiles?: PostProfile[] }
export interface ImportedItems { machines: Machine[]; tools: Tool[]; profiles: PostProfile[]; kind: BundleKind | 'unknown' }

const stamp = () => new Date().toISOString();

/** Tools that belong to a machine: its toolset, or every tool when none is defined. */
export function toolsForMachine(tools: Tool[], machine: Machine | undefined): Tool[] {
  if (!machine?.toolIds?.length) return tools;
  const set = new Set(machine.toolIds);
  return tools.filter((t) => set.has(t.id));
}

export function machineBundle(machine: Machine, tools: Tool[], profiles: PostProfile[]): Bundle {
  const profile = profiles.find((p) => p.id === machine.postId && !p.builtIn);
  return { format: BUNDLE_FORMAT, kind: 'machine', version: 1, name: machine.name, exported: stamp(), machines: [machine], tools: toolsForMachine(tools, machine), profiles: profile ? [profile] : [] };
}

export function toolsetBundle(tools: Tool[], name?: string): Bundle {
  return { format: BUNDLE_FORMAT, kind: 'toolset', version: 1, name, exported: stamp(), tools };
}

export function libraryBundle(machines: Machine[], tools: Tool[], profiles: PostProfile[]): Bundle {
  return { format: BUNDLE_FORMAT, kind: 'library', version: 1, exported: stamp(), machines, tools, profiles: profiles.filter((p) => !p.builtIn) };
}

const isMachine = (m: unknown): m is Machine => !!m && typeof m === 'object' && typeof (m as Machine).id === 'string' && typeof (m as Machine).postId === 'string' && !!(m as Machine).travel;
const isTool = (t: unknown): t is Tool => !!t && typeof t === 'object' && typeof (t as Tool).id === 'string' && typeof (t as Tool).d === 'number' && !!(t as Tool).cut;
const isProfile = (p: unknown): p is PostProfile => !!p && typeof p === 'object' && typeof (p as PostProfile).id === 'string' && !!(p as PostProfile).words && !!(p as PostProfile).blocks;

/** Parse a bundle (or a bare machine / tool / array of them). Throws on unusable input. */
export function parseBundle(text: string): ImportedItems {
  const raw = JSON.parse(text) as unknown;
  const out: ImportedItems = { machines: [], tools: [], profiles: [], kind: 'unknown' };
  const collect = (v: unknown) => {
    if (Array.isArray(v)) { for (const x of v) collect(x); return; }
    if (isMachine(v)) out.machines.push(v);
    else if (isTool(v)) out.tools.push(v);
    else if (isProfile(v)) out.profiles.push({ ...v, builtIn: false });
  };
  if (raw && typeof raw === 'object' && (raw as Bundle).format === BUNDLE_FORMAT) {
    const b = raw as Bundle;
    out.kind = b.kind;
    collect(b.machines ?? []); collect(b.tools ?? []); collect(b.profiles ?? []);
  } else collect(raw);
  if (!out.machines.length && !out.tools.length && !out.profiles.length) throw new Error('No machines, tools or post-processor profiles found in this file.');
  // a machine's toolset may only reference tools that exist after the import; unknown ids are dropped by the store
  return out;
}

/** Filename for a bundle. */
export function bundleFilename(b: Bundle): string {
  const base = (b.name ?? b.kind).replace(/[^\w.-]+/g, '_') || b.kind;
  return `${base}.${b.kind === 'machine' ? 'machine' : b.kind === 'toolset' ? 'toolset' : 'library'}.json`;
}
