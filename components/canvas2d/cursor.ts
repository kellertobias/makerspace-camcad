import { create } from 'zustand';
import type { Vec2 } from '@/lib/geometry/types';
export const useCursor = create<{ pos: Vec2 | null; set: (p: Vec2 | null) => void }>((set) => ({ pos: null, set: (pos) => set({ pos }) }));
