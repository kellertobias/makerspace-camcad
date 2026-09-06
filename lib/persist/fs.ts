/** File System Access API with download/upload fallbacks. */

type FileHandle = FileSystemFileHandle;
let currentHandle: FileHandle | null = null;

declare global {
  interface Window {
    showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
    showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  }
}

export const hasFsAccess = () => typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

export function setCurrentHandle(h: FileHandle | null) { currentHandle = h; }
export const getCurrentHandle = () => currentHandle;

type PermHandle = FileHandle & { queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>; requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState> };
async function ensureWritable(h: FileHandle): Promise<boolean> {
  const ph = h as PermHandle;
  try {
    if (!ph.queryPermission) return true;
    if ((await ph.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return ph.requestPermission ? (await ph.requestPermission({ mode: 'readwrite' })) === 'granted' : false;
  } catch { return false; }
}

export async function saveText(text: string | Uint8Array, suggestedName: string, mime = 'application/json', types?: { description: string; accept: Record<string, string[]> }[], reuseHandle = false): Promise<string | null> {
  if (hasFsAccess()) {
    try {
      let handle = reuseHandle ? currentHandle : null;
      // a handle restored after a reload needs its permission renewed; when refused, fall back to the picker
      if (handle && !(await ensureWritable(handle))) handle = null;
      if (!handle) handle = await window.showSaveFilePicker!({ suggestedName, types });
      const w = await handle.createWritable();
      await w.write(typeof text === 'string' ? text : new Blob([text as BlobPart]));
      await w.close();
      if (reuseHandle || suggestedName.endsWith('.cncproj')) currentHandle = handle;
      return handle.name;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      throw e;
    }
  }
  const blob = new Blob([text as BlobPart], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return suggestedName;
}

export async function openTextFiles(accept: string, multiple = false): Promise<{ name: string; text: string; handle?: FileHandle }[]> {
  if (hasFsAccess() && window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({ multiple });
      const out = [];
      for (const h of handles) { const f = await h.getFile(); out.push({ name: f.name, text: await f.text(), handle: h }); }
      return out;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return [];
      // fall through to the input element
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))));
    };
    input.click();
  });
}
