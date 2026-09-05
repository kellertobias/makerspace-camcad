import { describe, it, expect } from 'vitest';
import { machineBundle, toolsetBundle, libraryBundle, parseBundle, toolsForMachine, bundleFilename } from '@/lib/persist/libraryFiles';
import { newMachine, newTool } from '@/lib/model/defaults';
import { grblMill } from '@/lib/post/profiles/grbl';

const t1 = newTool({ id: 't1', name: 'A', slot: 1, d: 6, cut: { stepDown: 3, stepOverPct: 40 } });
const t2 = newTool({ id: 't2', name: 'B', slot: 2, d: 3, cut: { stepDown: 1, stepOverPct: 40 } });
const custom = { ...grblMill, id: 'pp-custom', name: 'Custom', builtIn: false };

describe('library bundles', () => {
  it('a machine export carries its toolset and a custom post profile, and imports back', () => {
    const m = newMachine({ id: 'm1', name: 'Mill', postId: 'pp-custom', toolIds: ['t2'] });
    const b = machineBundle(m, [t1, t2], [grblMill, custom]);
    expect(b.kind).toBe('machine');
    expect(b.tools?.map((t) => t.id)).toEqual(['t2']);
    expect(b.profiles?.map((p) => p.id)).toEqual(['pp-custom']);
    expect(bundleFilename(b)).toBe('Mill.machine.json');
    const items = parseBundle(JSON.stringify(b));
    expect(items.kind).toBe('machine');
    expect(items.machines[0].id).toBe('m1'); expect(items.tools[0].id).toBe('t2'); expect(items.profiles[0].builtIn).toBe(false);
  });
  it('built-in profiles are not exported with a machine', () => {
    const m = newMachine({ id: 'm1', postId: 'grbl-mill' });
    expect(machineBundle(m, [t1], [grblMill]).profiles).toEqual([]);
  });
  it('toolset and library round-trip', () => {
    const ts = parseBundle(JSON.stringify(toolsetBundle([t1, t2], 'set')));
    expect(ts.kind).toBe('toolset'); expect(ts.tools.length).toBe(2); expect(ts.machines.length).toBe(0);
    const lib = parseBundle(JSON.stringify(libraryBundle([newMachine({ id: 'm1' })], [t1], [grblMill, custom])));
    expect(lib.kind).toBe('library'); expect(lib.machines.length).toBe(1); expect(lib.profiles.map((p) => p.id)).toEqual(['pp-custom']);
  });
  it('accepts bare tools or machines and rejects unrelated JSON', () => {
    expect(parseBundle(JSON.stringify([t1, t2])).tools.length).toBe(2);
    expect(parseBundle(JSON.stringify(newMachine({ id: 'x' }))).machines.length).toBe(1);
    expect(() => parseBundle(JSON.stringify({ hello: 1 }))).toThrow();
  });
  it('toolsForMachine returns the toolset or every tool', () => {
    expect(toolsForMachine([t1, t2], newMachine({ toolIds: ['t2'] })).map((t) => t.id)).toEqual(['t2']);
    expect(toolsForMachine([t1, t2], newMachine({})).length).toBe(2);
    expect(toolsForMachine([t1, t2], undefined).length).toBe(2);
  });
});
