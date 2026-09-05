/**
 * Renders the README screenshots from the static export in `out/` with the locally installed Chrome.
 *   npm run build && npm run screenshots
 * Builds a small demo project through the app's debug hook (window.__cam), then captures the 2D layout,
 * the 3D preview, the G-code view and the tool editor into docs/screenshots/.
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 3457;
const OUT = resolve('docs/screenshots');
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });
if (!existsSync(resolve('out/index.html'))) { console.error('out/ missing: run `npm run build` first'); process.exit(1); }

// static server for out/
const server = spawn('npx', ['serve', '-l', String(PORT), 'out'], { stdio: 'ignore' });
const waitPort = async () => { for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 200)); } throw new Error('server did not start'); };
await waitPort();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  // English UI, 0.2 mm preview grid (fast enough for the software renderer)
  await page.evaluateOnNewDocument(() => { localStorage.setItem('cnc-milling-calc:lang', 'en'); localStorage.setItem('cnc-cam:pref:3d.quality', '"normal"'); localStorage.setItem('cnc-cam:view:v1', JSON.stringify({ view: '2d', tab: 'ops', showGrid: true, snap: true, showMilling: true, showToolpaths: true, showRapids: false })); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__cam && window.__cam.library.getState().loaded);
  await page.evaluate(() => window.__cam.ui.getState().setLang('en'));

  // ---- demo project -------------------------------------------------------
  await page.evaluate(async () => {
    const cam = window.__cam;
    const ps = cam.project.getState(), ui = cam.ui.getState();
    ps.setStock({ width: 400, height: 300, thickness: 12, material: 'plywood' });
    const bboxOf = (shape) => { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of shape.paths) { const pts = [p.start, ...p.segs.map((s) => s.to)]; for (const q of pts) a = [Math.min(a[0], q.x), Math.min(a[1], q.y), Math.max(a[2], q.x), Math.max(a[3], q.y)]; } return a; };
    // name plate: outer contour cut out with bridges, inner paths engraved
    const a = await cam.importUrl('samples/namensschild.svg');
    const st1 = cam.project.getState().project;
    const plA = st1.placements[a.placementId], shA = st1.shapes[plA.shapeId];
    const bA = bboxOf(shA);
    cam.project.getState().updatePlacement(plA.id, { name: 'name plate', transform: [1, 0, 0, 1, 30 - bA[0], 160 - bA[1]] });
    const area = (p) => { const pts = [p.start, ...p.segs.map((s) => s.to)]; let s2 = 0; for (let i = 0; i < pts.length; i++) { const q = pts[i], r = pts[(i + 1) % pts.length]; s2 += q.x * r.y - r.x * q.y; } return Math.abs(s2 / 2); };
    const outer = [...shA.paths].filter((p) => p.closed).sort((p, q) => area(q) - area(p))[0];
    ui.select({ paths: shA.paths.filter((p) => p !== outer).map((p) => `${plA.id}:${p.id}`) });
    cam.actions.addOperationForSelection('engrave', 'on');
    let ops = Object.values(cam.project.getState().project.operations);
    cam.project.getState().updateOperation(ops[ops.length - 1].id, { name: 'Engrave lettering', depth: 1 });
    ui.select({ paths: [`${plA.id}:${outer.id}`] });
    cam.actions.addOperationForSelection('cutout', 'outside');
    ops = Object.values(cam.project.getState().project.operations);
    cam.project.getState().updateOperation(ops[ops.length - 1].id, { name: 'Cut out plate', tabs: { count: 4, width: 8, height: 3, mode: 'auto' }, entry: { kind: 'ramp', angle: 10 } });
    // slot plate: pocket with zig-zag, slot cut out, drillings on snap points
    const b = await cam.importUrl('samples/slot-plate.dxf');
    const st2 = cam.project.getState().project;
    const plB = st2.placements[b.placementId], shB = st2.shapes[plB.shapeId];
    const bB = bboxOf(shB);
    cam.project.getState().updatePlacement(plB.id, { name: 'slot plate', transform: [2, 0, 0, 2, 200 - 2 * bB[0], 40 - 2 * bB[1]] });
    const rect = shB.paths.find((p) => p.closed && p.segs.length === 4 && p.segs.every((s) => s.k === 'L'));
    const slot = shB.paths.find((p) => p.closed && p.segs.some((s) => s.k === 'A') && p.segs.length === 4);
    const hole = shB.paths.find((p) => p.closed && p.segs.length === 2);
    ui.select({ paths: [`${plB.id}:${rect.id}`] });
    cam.actions.addOperationForSelection('pocket');
    ops = Object.values(cam.project.getState().project.operations);
    const pocket = ops[ops.length - 1];
    cam.project.getState().updateOperation(pocket.id, { name: 'Pocket (zig-zag)', depth: 6, strategy: 'zigzag', side: 'inside', entry: { kind: 'ramp', angle: 10 } });
    ui.select({ paths: [`${plB.id}:${slot.id}`] });
    cam.actions.addOperationForSelection('cutout', 'inside');
    ops = Object.values(cam.project.getState().project.operations);
    cam.project.getState().updateOperation(ops[ops.length - 1].id, { name: 'Slot', tabs: { count: 0, width: 8, height: 3, mode: 'auto' } });
    ui.clearSelection();
    cam.actions.addPointOperation('drill');
    ops = Object.values(cam.project.getState().project.operations);
    const c = hole.segs[0].c;
    cam.project.getState().updateOperation(ops[ops.length - 1].id, { name: 'Drillings', depth: 13, targets: [{ placementId: plB.id, pick: 'point', point: { x: c.x, y: c.y } }, { placementId: plB.id, pick: 'point', point: { x: (rect.start.x + rect.segs[1].to.x) / 2, y: (rect.start.y + rect.segs[1].to.y) / 2 } }] });
    cam.ui.getState().setPointPlacing(null);
    // show the pocket's parameters and diagrams
    cam.ui.getState().select({ operations: [pocket.id] });
    cam.ui.getState().setTab('ops');
    cam.ui.getState().setView('2d');
  });
  await new Promise((r) => setTimeout(r, 800));
  await page.keyboard.press('f'); // fit the sheet
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: `${OUT}/layout-2d.png` });
  console.log('layout-2d.png');

  // ---- 3D preview ----------------------------------------------------------
  await page.evaluate(() => window.__cam.ui.getState().setView('3d'));
  await page.waitForFunction(() => document.body.innerText.includes('Simulating'), { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !document.body.innerText.includes('Simulating'), { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${OUT}/preview-3d.png` });
  console.log('preview-3d.png');

  // ---- G-code ---------------------------------------------------------------
  await page.evaluate(() => window.__cam.ui.getState().setView('gcode'));
  await new Promise((r) => setTimeout(r, 1200));
  await page.screenshot({ path: `${OUT}/gcode.png` });
  console.log('gcode.png');

  // ---- tool editor ----------------------------------------------------------
  await page.evaluate(() => { window.__cam.ui.getState().setView('2d'); window.__cam.ui.getState().openModal('options', 'tools'); });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${OUT}/tools.png` });
  console.log('tools.png');
} finally {
  await browser.close();
  server.kill();
}
