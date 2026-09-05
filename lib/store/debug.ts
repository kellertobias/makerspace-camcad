import { importDrawingText } from './actions';
import { useProject } from './project';
import { useUi } from './ui';
import { useLibrary } from './library';

/** Developer hook: window.__cam.importUrl('/samples/x.svg') etc. Used by browser verification. */
export function installDebugHook() {
  if (typeof window === 'undefined') return;
  (window as unknown as { __cam: unknown }).__cam = {
    project: useProject, ui: useUi, library: useLibrary,
    importText: (name: string, text: string) => { const r = importDrawingText(name, text); useProject.getState().addShape(r.shape, r.placement); useUi.getState().select({ placements: [r.placement.id] }); return r; },
    importUrl: async (url: string) => { const text = await (await fetch(url)).text(); const r = importDrawingText(url.split('/').pop() ?? 'file.svg', text); useProject.getState().addShape(r.shape, r.placement); useUi.getState().select({ placements: [r.placement.id] }); return { warnings: r.warnings, paths: r.shape.paths.length, placementId: r.placement.id }; },
  };
}
