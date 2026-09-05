'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useProject } from '@/lib/store/project';
import { useUi, loadPref, savePref } from '@/lib/store/ui';
import { usePlan } from '@/lib/store/plan';
import { t } from '@/lib/i18n';
import { chooseCell, flattenMoves, type SimConfig, type SimMove } from '@/lib/cam/sim/heightmap';
import { buildTimeline, positionAt } from '@/lib/cam/sim/timeline';
import { zeroPoint } from '@/lib/cam/zero';
import { allPartsBBox } from '@/lib/cam/instances';
import { formatHms } from '@/lib/cam/time';
import { makeSideTexture, makeTexture } from './materials';
import { OP_TYPE_COLORS } from '@/components/canvas2d/renderer';
import type { WorkerRequest, WorkerResponse } from '@/workers/cam.worker';

type Quality = 'fast' | 'normal' | 'fine';
/** cell size in mm per quality; the grid only covers the machined region */
const QUALITY_CELL: Record<Quality, number> = { fast: 0.5, normal: 0.2, fine: 0.1 };
const MAX_CELLS = 6_000_000;

interface Scene {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
  stock: THREE.Mesh | null; sides: THREE.Mesh | null; tool: THREE.Mesh | null; paths: THREE.LineSegments | null; rapids: THREE.LineSegments | null;
  nx: number; ny: number;
  /** render on the next frame */
  dirty: boolean;
}

/** Position-only grid over the machined region; cached because building millions of vertices takes seconds. */
function buildGrid(nx: number, ny: number, cell: number, ox: number, oy: number, z: number): THREE.BufferGeometry {
  const pos = new Float32Array(nx * ny * 3);
  for (let j = 0, k = 0; j < ny; j++) { const y = oy + j * cell; for (let i = 0; i < nx; i++, k += 3) { pos[k] = ox + i * cell; pos[k + 1] = y; pos[k + 2] = z; } }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  for (let j = 0, k = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export default function Preview3D() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const project = useProject((p) => p.project);
  const { plan, machine } = usePlan();
  const [quality, setQuality] = useState<Quality>(() => loadPref<Quality>('3d.quality', 'fine'));
  const [showTool, setShowTool] = useState(() => loadPref('3d.tool', true));
  const [showPaths, setShowPaths] = useState(() => loadPref('3d.paths', false));
  const [progress, setProgress] = useState(1); // 0..1 of total time
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => loadPref('3d.speed', 10));
  useEffect(() => { savePref('3d.quality', quality); savePref('3d.tool', showTool); savePref('3d.paths', showPaths); savePref('3d.speed', speed); }, [quality, showTool, showPaths, speed]);
  const [status, setStatus] = useState<'idle' | 'simulating' | 'done'>('idle');
  /** initial preparation of a new simulation: grid build, then the full material simulation */
  const [loading, setLoading] = useState<{ stage: 'grid' | 'sim'; progress: number } | null>(null);
  const progressRef = useRef(1);
  const framedRef = useRef('');
  const heightsRef = useRef<Float32Array | null>(null);
  const frameRef = useRef<(() => void) | null>(null);
  const gridRef = useRef<{ key: string; geo: THREE.BufferGeometry } | null>(null);

  // --- simulation input -----------------------------------------------------
  const sim = useMemo(() => {
    if (!plan || !machine) return null;
    const stock = project.stock;
    const moves: SimMove[] = flattenMoves(plan.program.tools, stock.safeZ);
    const ops = plan.program.tools.flatMap((tp) => tp.ops.map((o) => ({ op: project.operations[o.opId], tool: tp.tool })));
    const tools = ops.map(({ tool }) => ({ kind: tool.kind, d: tool.d, tipAngle: tool.tipAngle }));
    const opTypes = ops.map(({ op }) => op?.type ?? 'contour');
    const zero = zeroPoint(project, allPartsBBox(project));
    // simulated region = bounding box of the cutting moves (sheet coordinates) + tool radius margin, clamped to the sheet
    const maxR = tools.reduce((m, t) => Math.max(m, t.d / 2), 0) + 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i]; if (m.k === 'rapid') continue;
      const p = moves[i - 1];
      for (const q of [p, m]) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
      if (m.k === 'arc' && m.cx !== undefined && m.cy !== undefined) { const r = Math.hypot(p.x - m.cx, p.y - m.cy); minX = Math.min(minX, m.cx - r); maxX = Math.max(maxX, m.cx + r); minY = Math.min(minY, m.cy - r); maxY = Math.max(maxY, m.cy + r); }
    }
    let ox = 0, oy = 0, rw = stock.width, rh = stock.height;
    if (Number.isFinite(minX)) {
      ox = Math.max(0, Math.floor(minX + zero.x - maxR)); oy = Math.max(0, Math.floor(minY + zero.y - maxR));
      rw = Math.min(stock.width, Math.ceil(maxX + zero.x + maxR)) - ox; rh = Math.min(stock.height, Math.ceil(maxY + zero.y + maxR)) - oy;
      if (rw <= 0 || rh <= 0) { ox = 0; oy = 0; rw = stock.width; rh = stock.height; }
    }
    // requested cell size, coarsened only when the region would exceed the cell budget
    let cell = QUALITY_CELL[quality];
    const needed = chooseCell(rw, rh, MAX_CELLS, cell);
    const coarsened = needed > cell + 1e-9;
    cell = needed;
    const cfg: SimConfig = { ox, oy, width: rw, height: rh, thickness: stock.thickness, zero, zZero: stock.zZero, cell, tools, moves };
    const timeline = buildTimeline(moves, machine.rapid.xy, machine.rapid.z);
    return { cfg, timeline, opTypes, total: timeline[timeline.length - 1] ?? 0, coarsened, sheet: { width: stock.width, height: stock.height } };
  }, [plan, machine, project, quality]);

  // --- three.js scene setup ---------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    wrap.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12; controls.zoomToCursor = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.03; // never look up from below the bed
    controls.minDistance = 5;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-300, -500, 800); scene.add(sun);
    const sun2 = new THREE.DirectionalLight(0xffffff, 0.5); sun2.position.set(600, 400, 300); scene.add(sun2);
    const sc: Scene = { renderer, scene, camera, controls, stock: null, sides: null, tool: null, paths: null, rapids: null, nx: 0, ny: 0, dirty: true };
    sceneRef.current = sc;
    let raf = 0;
    // render only when the camera moved or the scene changed (the heightmap can be millions of triangles)
    const loop = () => { const moved = controls.update(); if (moved || sc.dirty) { sc.dirty = false; renderer.render(scene, camera); } raf = requestAnimationFrame(loop); };
    loop();
    let sized = false;
    const ro = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); sc.dirty = true;
      if (!sized && r.width > 0) { sized = true; frameRef.current?.(); }
    });
    ro.observe(wrap);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); sceneRef.current = null; };
  }, []);

  // --- stock mesh (rebuilt when the sim config changes) ----------------------
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || !sim) return;
    // show the loading screen first; the grid build blocks the main thread, so give the browser a frame to paint
    setLoading({ stage: 'grid', progress: 0 });
    let cancelled = false;
    let w: Worker | null = null;
    const timer = setTimeout(() => { if (!cancelled) w = build(); }, 40);
    const build = (): Worker => {
    const { width, height, thickness, cell } = sim.cfg;
    const ox = sim.cfg.ox ?? 0, oy = sim.cfg.oy ?? 0;
    const sheetW = sim.sheet.width, sheetH = sim.sheet.height;
    const nx = Math.max(2, Math.ceil(width / cell) + 1), ny = Math.max(2, Math.ceil(height / cell) + 1);
    const tex = makeTexture(project.stock.material);
    // Top surface: a static position-only grid; heights, colours and normals come from textures / the GPU.
    const gridKey = `${nx}x${ny}x${cell}x${ox}x${oy}x${thickness}`;
    if (gridRef.current?.key !== gridKey) { gridRef.current?.geo.dispose(); gridRef.current = { key: gridKey, geo: buildGrid(nx, ny, cell, ox, oy, thickness) }; }
    const geo = gridRef.current.geo;
    const H = new Float32Array(nx * ny).fill(thickness);
    const OPM = new Uint8Array(nx * ny).fill(255);
    heightsRef.current = H;
    const mkData = (data: Float32Array | Uint8Array, type: THREE.TextureDataType) => { const t = new THREE.DataTexture(data, nx, ny, THREE.RedFormat, type); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.unpackAlignment = 1; return t; };
    const heightTex = mkData(H, THREE.FloatType); heightTex.needsUpdate = true;
    const opTex = mkData(OPM, THREE.UnsignedByteType); opTex.needsUpdate = true;
    // sources for partial uploads: same arrays, never bound, so copyTextureToTexture takes the CPU data path
    const heightSrc = mkData(H, THREE.FloatType), opSrc = mkData(OPM, THREE.UnsignedByteType);
    // palette: operation index -> colour (255 = untouched)
    const pal = new Uint8Array(256 * 4).fill(255);
    sim.opTypes.forEach((ty, i) => { const c = new THREE.Color(OP_TYPE_COLORS[ty] ?? '#888'); pal[i * 4] = Math.round((0.45 + 0.55 * c.r) * 255); pal[i * 4 + 1] = Math.round((0.45 + 0.55 * c.g) * 255); pal[i * 4 + 2] = Math.round((0.45 + 0.55 * c.b) * 255); pal[i * 4 + 3] = 255; });
    const palTex = new THREE.DataTexture(pal, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType); palTex.magFilter = THREE.NearestFilter; palTex.minFilter = THREE.NearestFilter; palTex.needsUpdate = true;
    const layers = project.stock.material === 'plywood' ? (Math.max(3, Math.round(thickness / 1.6)) | 1) : 0;
    const mat = new THREE.MeshStandardMaterial({ map: tex.texture, color: tex.color, metalness: tex.metalness, roughness: tex.roughness, side: THREE.DoubleSide, flatShading: true });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uHeight: { value: heightTex }, uOp: { value: opTex }, uPalette: { value: palTex },
        uGrid: { value: new THREE.Vector4(ox, oy, nx, ny) }, uCell: { value: cell }, uTile: { value: tex.tileMm },
        uLayer: { value: layers ? thickness / layers : 0 }, uThick: { value: thickness },
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uHeight; uniform vec4 uGrid; uniform float uCell; varying float vZ; varying vec2 vGuv; varying vec2 vWxy;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGuv = ((position.xy - uGrid.xy) / uCell + 0.5) / uGrid.zw;
        transformed.z = max(0.0, texture2D(uHeight, vGuv).r); // the mesh never dips below the bed
        vZ = transformed.z; vWxy = position.xy;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uHeight; uniform sampler2D uOp; uniform sampler2D uPalette; uniform float uTile; uniform float uLayer; uniform float uThick; varying float vZ; varying vec2 vGuv; varying vec2 vWxy;')
        // wood texture tiled in sheet millimetres (no uv attribute on the grid)
        .replace('#include <map_fragment>', `#ifdef USE_MAP
        diffuseColor *= texture2D(map, vWxy / uTile);
        #endif`)
        // cell colour: red = cut below the stock, blue = exactly through, otherwise tinted by the operation that cut it
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float hv = texture2D(uHeight, vGuv).r;
          float opv = texture2D(uOp, vGuv).r;
          vec3 tint = hv < -0.01 ? vec3(1.0, 0.15, 0.15) : (hv <= 0.01 ? vec3(0.2, 0.45, 1.0) : (opv > 0.999 ? vec3(1.0) : texture2D(uPalette, vec2((opv * 255.0 + 0.5) / 256.0, 0.5)).rgb));
          diffuseColor.rgb *= tint;
          if (uLayer > 0.0 && vZ > 0.02) {
            float band = mod(floor((uThick - vZ) / uLayer + 0.001), 2.0); // the top surface is the first (light) layer
            diffuseColor.rgb *= mix(1.0, 0.68, band);
          }
        }`)
        // slightly darker cut walls: the flat-shaded normal is in view space, compare with the world up axis
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          float nz = abs(dot(normal, normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz)));
          diffuseColor.rgb *= mix(0.78, 1.0, clamp(nz, 0.0, 1.0));
        }`);
    };
    const stock = new THREE.Mesh(geo, mat);
    stock.frustumCulled = false;
    // untouched part of the sheet around the region: flat quads at the top surface with the same texture
    const frame: number[] = [], frameUv: number[] = [];
    const quad = (x0: number, y0: number, x1: number, y1: number) => {
      if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) return;
      frame.push(x0, y0, thickness, x1, y0, thickness, x1, y1, thickness, x0, y0, thickness, x1, y1, thickness, x0, y1, thickness);
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) frameUv.push(x / tex.tileMm, y / tex.tileMm);
    };
    const rx1 = ox + (nx - 1) * cell, ry1 = oy + (ny - 1) * cell;
    quad(0, 0, sheetW, oy); quad(0, ry1, sheetW, sheetH); quad(0, oy, ox, ry1); quad(rx1, oy, sheetW, ry1);
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(frame, 3));
    frameGeo.setAttribute('uv', new THREE.Float32BufferAttribute(frameUv, 2));
    frameGeo.computeVertexNormals();
    const frameMesh = new THREE.Mesh(frameGeo, new THREE.MeshStandardMaterial({ map: tex.texture, color: tex.color, metalness: tex.metalness, roughness: tex.roughness }));
    frameMesh.userData.static = true;
    // side walls + bottom as a slightly smaller box
    const sideTex = makeSideTexture(project.stock.material, thickness);
    sideTex.repeat.set(4, 1);
    const box = new THREE.Mesh(new THREE.BoxGeometry(sheetW, sheetH, thickness - 0.02), [
      new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ visible: false }), new THREE.MeshStandardMaterial({ color: 0x777c83, roughness: 0.95 }),
    ]);
    box.position.set(sheetW / 2, sheetH / 2, (thickness - 0.02) / 2);
    // bed
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(sheetW * 1.6, sheetH * 1.6), new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 1 }));
    bed.position.set(sheetW / 2, sheetH / 2, -0.05);
    const grid = new THREE.GridHelper(Math.max(sheetW, sheetH) * 1.6, Math.round(Math.max(sheetW, sheetH) * 1.6 / 50), 0x3a4250, 0x3a4250);
    grid.rotation.x = Math.PI / 2; grid.position.set(sheetW / 2, sheetH / 2, -0.04);
    // tool
    const toolGroup = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 40, 24), new THREE.MeshStandardMaterial({ color: 0x8fb8ff, metalness: 0.6, roughness: 0.3, transparent: true, opacity: 0.9 }));
    toolGroup.rotation.x = Math.PI / 2; toolGroup.visible = showTool;
    // remove previous
    for (const k of ['stock', 'sides', 'tool', 'paths', 'rapids'] as const) { const o = sc[k]; if (o) { sc.scene.remove(o); if (k !== 'stock') o.geometry.dispose(); else { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial; m.dispose(); } } }
    sc.scene.children.filter((c) => c.userData.static).forEach((c) => sc.scene.remove(c));
    bed.userData.static = true; grid.userData.static = true;
    sc.scene.add(bed, grid, frameMesh, box, stock, toolGroup);
    sc.stock = stock; sc.sides = box; sc.tool = toolGroup; sc.nx = nx; sc.ny = ny; sc.dirty = true;
    // toolpath lines
    const cut: number[] = [], rap: number[] = [];
    const z0 = sim.cfg.zero;
    const zH = (z: number) => (sim.cfg.zZero === 'top' ? thickness + z : z);
    for (let i = 1; i < sim.cfg.moves.length; i++) {
      const a = sim.cfg.moves[i - 1], b = sim.cfg.moves[i];
      const arr = b.k === 'rapid' ? rap : cut;
      if (b.k === 'arc' && b.cx !== undefined && b.cy !== undefined) {
        const r = Math.hypot(a.x - b.cx, a.y - b.cy); const a0 = Math.atan2(a.y - b.cy, a.x - b.cx); let a1 = Math.atan2(b.y - b.cy, b.x - b.cx);
        if (b.cw) { while (a1 > a0 - 1e-9) a1 -= 2 * Math.PI; } else { while (a1 < a0 + 1e-9) a1 += 2 * Math.PI; }
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / 2));
        for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n; const p = a0 + (a1 - a0) * t0, q = a0 + (a1 - a0) * t1;
          arr.push(b.cx + r * Math.cos(p) + z0.x, b.cy + r * Math.sin(p) + z0.y, zH(a.z + (b.z - a.z) * t0), b.cx + r * Math.cos(q) + z0.x, b.cy + r * Math.sin(q) + z0.y, zH(a.z + (b.z - a.z) * t1)); }
      } else arr.push(a.x + z0.x, a.y + z0.y, zH(a.z), b.x + z0.x, b.y + z0.y, zH(b.z));
    }
    const mk = (pts: number[], color: number, dashed: boolean) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); const m = dashed ? new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 2 }) : new THREE.LineBasicMaterial({ color }); const l = new THREE.LineSegments(g, m); if (dashed) l.computeLineDistances(); return l; };
    sc.paths = mk(cut, 0x1f6feb, false); sc.rapids = mk(rap, 0xc678dd, true);
    sc.paths.visible = showPaths; sc.rapids.visible = showPaths;
    sc.scene.add(sc.paths, sc.rapids);
    // camera framing on first build and whenever the stock size changes
    const key = `${sheetW}x${sheetH}x${thickness}`;
    if (framedRef.current !== key) {
      framedRef.current = key;
      frameRef.current = () => {
        const target = new THREE.Vector3(sheetW / 2, sheetH / 2, thickness / 2);
        const aspect = sc.camera.aspect || 1;
        const fov = (sc.camera.fov * Math.PI) / 180;
        // fit the diagonal of the sheet into the narrower view dimension
        const diag = Math.hypot(sheetW, sheetH);
        const dist = (Math.max(diag, diag / aspect) / (2 * Math.tan(fov / 2))) * 1.05;
        const dir = new THREE.Vector3(0.25, -1, 0.85).normalize();
        sc.camera.position.copy(target).addScaledVector(dir, dist);
        sc.controls.target.copy(target);
        sc.controls.update();
        sc.dirty = true;
      };
      frameRef.current();
    }
    // start worker
    workerRef.current?.terminate();
    const w = new Worker(new URL('../../workers/cam.worker.ts', import.meta.url));
    workerRef.current = w;
    setStatus('simulating');
    setLoading({ stage: 'sim', progress: 0 });
    let initial = true;
    // Apply a changed rectangle: copy into the CPU arrays, then upload just that region of the two textures.
    const applyRect = (i0: number, i1: number, j0: number, j1: number, h: Float32Array, opMap: Uint8Array) => {
      if (j1 < j0 || i1 < i0) return;
      const wdt = i1 - i0 + 1;
      for (let j = j0; j <= j1; j++) { const from = (j - j0) * wdt, to = j * nx + i0; H.set(h.subarray(from, from + wdt), to); OPM.set(opMap.subarray(from, from + wdt), to); }
      const region = new THREE.Box2(new THREE.Vector2(i0, j0), new THREE.Vector2(i1 + 1, j1 + 1));
      const at = new THREE.Vector2(i0, j0);
      try {
        sc.renderer.copyTextureToTexture(heightSrc, heightTex, region, at);
        sc.renderer.copyTextureToTexture(opSrc, opTex, region, at);
      } catch { heightTex.needsUpdate = true; opTex.needsUpdate = true; }
      sc.dirty = true;
    };
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type !== 'result') return;
      if (msg.j1 >= msg.j0) applyRect(msg.i0, msg.i1, msg.j0, msg.j1, msg.heights, msg.opMap);
      setStatus(msg.done ? 'done' : 'simulating');
      if (initial) { if (msg.done) { initial = false; setLoading(null); } else setLoading({ stage: 'sim', progress: msg.progress }); }
    };
    const init: WorkerRequest = { type: 'init', cfg: sim.cfg };
    w.postMessage(init);
    // honour current progress
    const cur = positionAt(sim.cfg.moves, sim.timeline, progressRef.current * sim.total);
    if (progressRef.current < 1) w.postMessage({ type: 'simulate', index: cur.index, frac: cur.t } as WorkerRequest);
    return w;
    };
    return () => { cancelled = true; clearTimeout(timer); if (w) { w.terminate(); if (workerRef.current === w) workerRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, project.stock.material]);

  // --- progress: tool position + partial simulation -------------------------
  useEffect(() => {
    progressRef.current = progress;
    const sc = sceneRef.current;
    if (!sc || !sim) return;
    const time = progress * sim.total;
    const pos = positionAt(sim.cfg.moves, sim.timeline, time);
    if (sc.tool) {
      const tool = sim.cfg.tools[sim.cfg.moves[pos.index]?.op ?? 0];
      const r = (tool?.d ?? 6) / 2;
      sc.tool.scale.set(r / 3, 1, r / 3);
      const zH = sim.cfg.zZero === 'top' ? sim.cfg.thickness + pos.z : pos.z;
      sc.tool.position.set(pos.x + sim.cfg.zero.x, pos.y + sim.cfg.zero.y, zH + 20);
      sc.tool.visible = showTool && progress < 1;
    }
    sc.dirty = true;
    // the material follows the tool: simulate up to the tool's position inside the current move
    workerRef.current?.postMessage({ type: 'simulate', index: progress >= 1 ? sim.cfg.moves.length : pos.index, frac: progress >= 1 ? 1 : pos.t } as WorkerRequest);
  }, [progress, sim, showTool]);

  useEffect(() => { const sc = sceneRef.current; if (sc?.paths) sc.paths.visible = showPaths; if (sc?.rapids) sc.rapids.visible = showPaths; if (sc) sc.dirty = true; }, [showPaths]);

  // --- playback ---------------------------------------------------------------
  useEffect(() => {
    if (!playing || !sim) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setProgress((p) => { const np = p + (dt * speed) / Math.max(1, sim.total); if (np >= 1) { setPlaying(false); return 1; } return np; });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, sim]);

  const de = lang === 'de';
  return (
    <div className="cam-3d">
      <div className="cam-3d-bar">
        <button type="button" className="btn small" onClick={() => { if (progress >= 1) setProgress(0); setPlaying((p) => !p); }} disabled={!sim || !sim.cfg.moves.length}>{playing ? '❚❚' : '▶'}</button>
        <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} onChange={(e) => { setPlaying(false); setProgress(Number(e.target.value) / 1000); }} aria-label={de ? 'Fortschritt' : 'progress'} />
        <span className="mono">{sim ? `${formatHms(progress * sim.total)} / ${formatHms(sim.total)}` : '–'}</span>
        <select className="cam-inline-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title={de ? 'Geschwindigkeit' : 'speed'}>
          {[1, 5, 10, 25, 50, 100].map((v) => <option key={v} value={v}>{v}×</option>)}
        </select>
        <label className="cam-3d-toggle"><input type="checkbox" checked={showTool} onChange={(e) => setShowTool(e.target.checked)} /> {de ? 'Werkzeug' : 'tool'}</label>
        <label className="cam-3d-toggle"><input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} /> {s.showToolpaths}</label>
        <select className="cam-inline-select" value={quality} onChange={(e) => setQuality(e.target.value as Quality)} title={de ? 'Auflösung' : 'resolution'}>
          <option value="fine">0.1 mm</option><option value="normal">0.2 mm</option><option value="fast">0.5 mm</option>
        </select>
        <span className="grow" />
        <span style={{ color: status === 'simulating' ? 'var(--accent)' : 'var(--muted)' }}>{status === 'simulating' ? (de ? 'Simuliere…' : 'Simulating…') : sim ? `${sim.cfg.moves.length} ${de ? 'Bewegungen' : 'moves'} · ${s.materials[project.stock.material]} · ${sim.cfg.cell} mm${sim.coarsened ? (de ? ' (Bereich zu groß, vergröbert)' : ' (region too large, coarsened)') : ''}` : ''}</span>
      </div>
      <div className="cam-3d-canvas" ref={wrapRef}>
        {loading && (
          <div className="cam-3d-loading" role="status" aria-live="polite">
            <div className="card">
              <div className="spinner" />
              <div>{s.preparing3d}</div>
              <div className="stage">{loading.stage === 'grid' ? s.building3dGrid : s.simulating3d(Math.round(loading.progress * 100))}</div>
              <div className="bar"><i style={{ width: `${loading.stage === 'grid' ? 3 : 5 + loading.progress * 95}%` }} /></div>
            </div>
          </div>
        )}
      </div>
      {!sim?.cfg.moves.length && <div className="cam-canvas-hint" style={{ bottom: 12 }}>{s.gcodeEmpty}</div>}
    </div>
  );
}
