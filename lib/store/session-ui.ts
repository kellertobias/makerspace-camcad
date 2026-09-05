import { create } from 'zustand';
import type { Camera } from '@/lib/persist/session';

/** UI state that is not part of the document but should survive a reload: 2D camera and tree expansion. */
interface SessionUi {
  booted: boolean;
  camera: Camera | null;
  expanded: Record<string, boolean>;
  setCamera: (c: Camera) => void;
  setExpanded: (id: string, open: boolean) => void;
}
export const useSessionUi = create<SessionUi>((set) => ({
  booted: false, camera: null, expanded: {},
  setCamera: (camera) => set({ camera }),
  setExpanded: (id, open) => set((s) => ({ expanded: { ...s.expanded, [id]: open } })),
}));
