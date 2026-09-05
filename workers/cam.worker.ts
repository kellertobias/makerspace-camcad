/// <reference lib="webworker" />
import { Simulator, type SimConfig } from '@/lib/cam/sim/heightmap';

export type WorkerRequest =
  | { type: 'init'; cfg: SimConfig }
  /** Simulate all moves before `index` completely and move `index` up to fraction `frac`. */
  | { type: 'simulate'; index: number; frac: number };
export type WorkerResponse =
  | { type: 'ready'; nx: number; ny: number; moves: number }
  /** Changed cells as a rectangle i0..i1 × j0..j1 (inclusive), row-major with width i1 - i0 + 1. */
  | { type: 'result'; i0: number; i1: number; j0: number; j1: number; heights: Float32Array; opMap: Uint8Array; done: boolean };

let sim: Simulator | null = null;
let target = { index: 0, frac: 1 };
let lastPartial: { index: number; frac: number } | null = null;
let running = false;

function postDirty(done: boolean) {
  if (!sim) return;
  const d = sim.takeDirty();
  if (!d) { if (done) (self as unknown as Worker).postMessage({ type: 'result', i0: 0, i1: -1, j0: 0, j1: -1, heights: new Float32Array(0), opMap: new Uint8Array(0), done } satisfies WorkerResponse); return; }
  const w = d.i1 - d.i0 + 1, h = d.j1 - d.j0 + 1;
  const heights = new Float32Array(w * h), opMap = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const from = (d.j0 + j) * sim.nx + d.i0;
    heights.set(sim.heights.subarray(from, from + w), j * w);
    opMap.set(sim.opMap.subarray(from, from + w), j * w);
  }
  (self as unknown as Worker).postMessage({ type: 'result', i0: d.i0, i1: d.i1, j0: d.j0, j1: d.j1, heights, opMap, done } satisfies WorkerResponse, [heights.buffer, opMap.buffer]);
}

function pump() {
  if (!sim || running) return;
  running = true;
  const loop = () => {
    if (!sim) { running = false; return; }
    // moved backwards (earlier move, or earlier position inside the same move): start over
    if (sim.cursor > target.index || (lastPartial && lastPartial.index === target.index && target.frac < lastPartial.frac - 1e-6 && sim.cursor === target.index)) sim.reset();
    const t0 = performance.now();
    // complete moves in time-boxed chunks so new targets are picked up quickly
    while (sim.cursor < target.index && performance.now() - t0 < 12) sim.run(Math.min(target.index, sim.cursor + 50));
    const complete = sim.cursor >= target.index;
    if (complete) { sim.runPartial(target.index, target.frac); lastPartial = { ...target }; }
    postDirty(complete);
    if (!complete) setTimeout(loop, 0); else running = false;
  };
  loop();
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    sim = new Simulator(msg.cfg);
    target = { index: msg.cfg.moves.length, frac: 1 };
    (self as unknown as Worker).postMessage({ type: 'ready', nx: sim.nx, ny: sim.ny, moves: msg.cfg.moves.length } satisfies WorkerResponse);
    pump();
  } else if (msg.type === 'simulate') {
    target = { index: Math.max(0, msg.index), frac: msg.frac };
    pump();
  }
};
