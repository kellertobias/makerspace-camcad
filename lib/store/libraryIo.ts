import { useLibrary } from './library';
import { useUi } from './ui';
import { saveText, openTextFiles } from '@/lib/persist/fs';
import { bundleFilename, libraryBundle, machineBundle, parseBundle, toolsetBundle, toolsForMachine } from '@/lib/persist/libraryFiles';

const JSON_TYPES = [{ description: 'Makerspace CAM library', accept: { 'application/json': ['.json'] } }];

/** One machine with its toolset (and custom post profile) as a file. */
export async function exportMachineFile(machineId: string) {
  const lib = useLibrary.getState();
  const m = lib.machines.find((x) => x.id === machineId);
  if (!m) return;
  const b = machineBundle(m, lib.tools, lib.profiles);
  await saveText(JSON.stringify(b, null, 1), bundleFilename(b), 'application/json', JSON_TYPES);
}

/** A toolset as a file: the given tools, a machine's toolset, or every tool. */
export async function exportToolsetFile(opts: { machineId?: string; toolIds?: string[] } = {}) {
  const lib = useLibrary.getState();
  const m = opts.machineId ? lib.machines.find((x) => x.id === opts.machineId) : undefined;
  const tools = opts.toolIds ? lib.tools.filter((t) => opts.toolIds!.includes(t.id)) : m ? toolsForMachine(lib.tools, m) : lib.tools;
  const b = toolsetBundle(tools, m ? `${m.name} tools` : 'tools');
  await saveText(JSON.stringify(b, null, 1), bundleFilename(b), 'application/json', JSON_TYPES);
}

/** Everything in the library as one file. */
export async function exportLibraryFile() {
  const lib = useLibrary.getState();
  const b = libraryBundle(lib.machines, lib.tools, lib.profiles);
  await saveText(JSON.stringify(b, null, 1), bundleFilename(b), 'application/json', JSON_TYPES);
}

/** Import machines / toolsets / libraries; tools may be attached to a machine's toolset. Returns the imported ids. */
export async function importLibraryFiles(attachToMachineId?: string): Promise<{ machines: string[]; tools: string[] } | null> {
  const ui = useUi.getState();
  const files = await openTextFiles('.json', true);
  if (!files.length) return null;
  const ids = { machines: [] as string[], tools: [] as string[] };
  let total = { machines: 0, tools: 0, profiles: 0 };
  for (const f of files) {
    try {
      const items = parseBundle(f.text);
      const n = useLibrary.getState().importItems(items, attachToMachineId);
      total = { machines: total.machines + n.machines, tools: total.tools + n.tools, profiles: total.profiles + n.profiles };
      ids.machines.push(...items.machines.map((m) => m.id)); ids.tools.push(...items.tools.map((t) => t.id));
    } catch (e) { ui.notify(`${f.name}: ${(e as Error).message}`, 'error'); }
  }
  const de = ui.lang === 'de';
  ui.notify(de ? `Importiert: ${total.machines} Maschinen, ${total.tools} Werkzeuge, ${total.profiles} Postprozessoren` : `Imported: ${total.machines} machines, ${total.tools} tools, ${total.profiles} post-processors`);
  return ids;
}
