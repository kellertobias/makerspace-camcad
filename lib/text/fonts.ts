import { db } from '@/lib/persist/db';
import type { Font } from 'opentype.js';

export interface FontEntry { id: string; name: string; url?: string; builtIn: boolean }

export const BUILT_IN_FONTS: FontEntry[] = [
  { id: 'nunito', name: 'Nunito (Sans)', url: 'fonts/Nunito.ttf', builtIn: true },
  { id: 'oswald', name: 'Oswald (Condensed)', url: 'fonts/Oswald.ttf', builtIn: true },
  { id: 'robotomono', name: 'Roboto Mono', url: 'fonts/RobotoMono.ttf', builtIn: true },
  { id: 'pacifico', name: 'Pacifico (Script)', url: 'fonts/Pacifico-Regular.ttf', builtIn: true },
  { id: 'allertastencil', name: 'Allerta Stencil', url: 'fonts/AllertaStencil-Regular.ttf', builtIn: true },
];

const cache = new Map<string, Promise<Font>>();

export async function listUserFonts(): Promise<FontEntry[]> {
  try { const all = await (await db()).getAll('fonts') as { id: string; name: string }[]; return all.map((f) => ({ id: f.id, name: f.name, builtIn: false })); } catch { return []; }
}

export async function addUserFont(name: string, data: ArrayBuffer): Promise<FontEntry> {
  const id = `user-${name.replace(/[^\w.-]+/g, '_')}-${Date.now().toString(36)}`;
  await (await db()).put('fonts', { id, name, data });
  cache.delete(id);
  return { id, name, builtIn: false };
}

export async function deleteUserFont(id: string) { await (await db()).delete('fonts', id); cache.delete(id); }

/** Load and parse a font (built-in by URL, user font from IndexedDB). Cached. */
export function loadFont(id: string): Promise<Font> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const opentype = await import('opentype.js');
      const entry = BUILT_IN_FONTS.find((f) => f.id === id);
      let buf: ArrayBuffer;
      if (entry?.url) buf = await (await fetch(entry.url)).arrayBuffer();
      else { const rec = await (await db()).get('fonts', id) as { data: ArrayBuffer } | undefined; if (!rec) throw new Error(`Font ${id} not found`); buf = rec.data; }
      return opentype.parse(buf);
    })();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}
