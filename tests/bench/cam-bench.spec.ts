import { expect, test, type Locator, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compareGcode, formatGcodeDifferences, type GcodeCompareOptions } from '../../lib/gcode/compare';

type OperationType = 'contour' | 'cutout' | 'pocket' | 'engrave' | 'drill' | 'thread' | 'saw' | 'laser-cut' | 'laser-engrave';
type FieldValue = string | number | boolean | undefined;

interface BenchOperation {
  type: OperationType;
  /** Zero-based path indices, in drawing import order, or every path in the drawing. */
  contours: number[] | 'all';
  settings?: Record<string, unknown>;
}

interface BenchCase {
  name: string;
  drawing: string;
  referenceGcode: string;
  machineId?: string;
  /** Optional complete tool records installed before the UI workflow. */
  tools?: Record<string, unknown>[];
  stock?: { width?: number; height?: number; thickness?: number; safeZ?: number; clearZ?: number };
  placement?: { x?: number; y?: number; rotation?: number; scale?: number; mirrored?: boolean };
  operations: BenchOperation[];
  comparison?: GcodeCompareOptions;
}

interface LoadedCase { path: string; config: BenchCase }

const configuredCase = process.env.CAM_BENCH_CASE;
const casePaths = configuredCase
  ? [resolve(configuredCase)]
  : (() => {
      const directory = resolve('tests/bench/cases');
      return existsSync(directory) ? readdirSync(directory).filter((file) => file.endsWith('.bench.json')).sort().map((file) => resolve(directory, file)) : [];
    })();
const cases: LoadedCase[] = casePaths.map((path) => ({ path, config: JSON.parse(readFileSync(path, 'utf8')) as BenchCase }));

async function openSection(page: Page, id: string): Promise<Locator> {
  const section = page.locator(`[data-section="${id}"]`);
  await expect(section).toBeVisible();
  if (await section.evaluate((element) => element.classList.contains('closed'))) await section.locator('h3').click();
  return section;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldControl(section: Locator, label: string, control: 'input' | 'select'): Locator {
  return section.locator('.cam-label').filter({ hasText: new RegExp(`^${escapeRegex(label)}$`) }).locator('..').locator(control).first();
}

async function setNumber(page: Page, sectionId: string, label: string, value: number | undefined) {
  if (value === undefined) return;
  const section = await openSection(page, sectionId);
  const input = fieldControl(section, label, 'input');
  await input.fill(String(value));
  await input.press('Enter');
}

async function setSelect(page: Page, sectionId: string, label: string, value: string | undefined) {
  if (value === undefined) return;
  const section = await openSection(page, sectionId);
  await fieldControl(section, label, 'select').selectOption(value);
}

async function setCheck(page: Page, sectionId: string, label: string, value: boolean | undefined) {
  if (value === undefined) return;
  const section = await openSection(page, sectionId);
  await fieldControl(section, label, 'input').setChecked(value);
}

async function setText(page: Page, sectionId: string, label: string, value: string | undefined) {
  if (value === undefined) return;
  const section = await openSection(page, sectionId);
  await fieldControl(section, label, 'input').fill(value);
}

const operationButton: Record<OperationType, string> = {
  contour: 'Contour outside', cutout: 'Cutout', pocket: 'Pocket', engrave: 'Engrave', drill: 'Drill',
  thread: 'Thread', saw: 'Saw groove', 'laser-cut': 'Laser cut', 'laser-engrave': 'Laser engrave',
};

function flatSettings(settings: Record<string, unknown> = {}): Record<string, FieldValue> {
  const entry = (settings.entry ?? {}) as Record<string, FieldValue>;
  const feed = (settings.feed ?? {}) as Record<string, FieldValue>;
  const tabs = (settings.tabs ?? {}) as Record<string, FieldValue>;
  return {
    ...settings as Record<string, FieldValue>,
    entryKind: entry.kind, rampAngle: entry.angle,
    vf: feed.vf, vfPlunge: feed.vfPlunge,
    tabMode: tabs.mode, tabCount: tabs.count, tabWidth: tabs.width, tabHeight: tabs.height,
  };
}

const supportedSettings = new Set([
  'name', 'toolId', 'depth', 'stepDown', 'side', 'entry', 'zOffset', 'enabled', 'startT', 'startAngle', 'climb',
  'feed', 'overcut', 'tabs', 'pocketSide', 'strategy', 'rasterAngle', 'stepOverPct', 'outsideWidth',
  'outsideWidthUnit', 'mode', 'peck', 'internal', 'majorD', 'pitch', 'passes', 'power', 'speed', 'kerfSide',
  'engraveMode', 'hatchPitch', 'hatchAngle', 'outline',
]);

function validateSettings(type: OperationType, raw: Record<string, unknown>) {
  const unknown = Object.keys(raw).filter((key) => !supportedSettings.has(key));
  if (unknown.length) throw new Error(`Unsupported ${type} setting(s): ${unknown.join(', ')}`);
  if ((raw.tabs as { mode?: string } | undefined)?.mode === 'manual') {
    throw new Error('The bench currently supports automatic tabs only; manual tab coordinates need a stable UI interaction format.');
  }
}

async function applyOperationSettings(page: Page, type: OperationType, raw: Record<string, unknown> = {}) {
  validateSettings(type, raw);
  const s = flatSettings(raw);
  await setText(page, 'op-main', 'Name', s.name as string | undefined);
  await setSelect(page, 'op-main', 'Tool', s.toolId as string | undefined);
  const laser = type === 'laser-cut' || type === 'laser-engrave';
  if (!laser) {
    await setNumber(page, 'op-main', 'Depth', s.depth as number | undefined);
    await setNumber(page, 'op-main', 'Step-down', s.stepDown as number | undefined);
    await setNumber(page, 'op-main', 'Start depth', s.zOffset as number | undefined);
  }
  if (type === 'contour' || type === 'cutout' || type === 'engrave') await setSelect(page, 'op-main', 'Side', s.side as string | undefined);
  if (!laser && type !== 'saw') {
    await setSelect(page, 'op-main', 'Entry', s.entryKind as string | undefined);
    await setNumber(page, 'op-main', 'Ramp angle', s.rampAngle as number | undefined);
  }
  await setCheck(page, 'op-main', 'Enabled', s.enabled as boolean | undefined);

  await setNumber(page, 'op-start', 'Start position', s.startT as number | undefined);
  await setNumber(page, 'op-start', 'Start angle', s.startAngle as number | undefined);
  await setCheck(page, 'op-start', 'Climb milling', s.climb as boolean | undefined);
  if (!laser) {
    await setNumber(page, 'op-feed', 'Feed', s.vf as number | undefined);
    await setNumber(page, 'op-feed', 'Plunge feed', s.vfPlunge as number | undefined);
  }
  if (type === 'contour' || type === 'cutout' || type === 'pocket') await setSelect(page, 'op-overcut', 'Corner overcut', s.overcut as string | undefined);

  if (type === 'cutout') {
    await setSelect(page, 'op-tabs', 'Placement', s.tabMode as string | undefined);
    await setNumber(page, 'op-tabs', 'Count', s.tabCount as number | undefined);
    await setNumber(page, 'op-tabs', 'Width', s.tabWidth as number | undefined);
    await setNumber(page, 'op-tabs', 'Height', s.tabHeight as number | undefined);
  }

  if (type === 'pocket') {
    await setSelect(page, 'op-pocket', 'Wall pass', (s.pocketSide ?? s.side) as string | undefined);
    await setSelect(page, 'op-pocket', 'Strategy', s.strategy as string | undefined);
    await setNumber(page, 'op-pocket', 'Raster angle', s.rasterAngle as number | undefined);
    await setNumber(page, 'op-pocket', 'Step-over', s.stepOverPct as number | undefined);
    await setSelect(page, 'op-pocket', 'Unit', s.outsideWidthUnit as string | undefined);
    await setNumber(page, 'op-pocket', 'Material removed around the contour', s.outsideWidth as number | undefined);
  }

  if (type === 'drill') {
    await setSelect(page, 'op-drill', 'Type', s.mode as string | undefined);
    await setNumber(page, 'op-drill', 'Peck depth', s.peck as number | undefined);
  }
  if (type === 'thread') {
    await setSelect(page, 'op-thread', 'Thread', s.internal === undefined ? undefined : (s.internal ? 'internal' : 'external'));
    await setNumber(page, 'op-thread', 'Nominal diameter', s.majorD as number | undefined);
    await setNumber(page, 'op-thread', 'Pitch', s.pitch as number | undefined);
    await setNumber(page, 'op-thread', 'Radial passes', s.passes as number | undefined);
  }

  if (laser) {
    await setNumber(page, 'op-laser', 'Power', s.power as number | undefined);
    await setNumber(page, 'op-laser', 'Speed', s.speed as number | undefined);
    await setNumber(page, 'op-laser', 'Passes', s.passes as number | undefined);
    if (type === 'laser-cut') await setSelect(page, 'op-laser', 'Kerf side', s.kerfSide as string | undefined);
    if (type === 'laser-engrave') {
      await setSelect(page, 'op-laser', 'Mode', s.engraveMode as string | undefined);
      await setNumber(page, 'op-laser', 'Line spacing', s.hatchPitch as number | undefined);
      await setNumber(page, 'op-laser', 'Hatch angle', s.hatchAngle as number | undefined);
      await setCheck(page, 'op-laser', 'Also trace the outline', s.outline as boolean | undefined);
    }
  }
}

if (cases.length === 0) {
  test.skip('CAM comparison bench (add a tests/bench/cases/*.bench.json case)', () => {});
}

for (const loaded of cases) {
  test(loaded.config.name, async ({ page }, testInfo) => {
    const config = loaded.config;
    const drawing = resolve(dirname(loaded.path), config.drawing);
    const referencePath = resolve(dirname(loaded.path), config.referenceGcode);

    await page.addInitScript(() => {
      localStorage.clear();
      // Force the app's HTML input/download fallbacks; native picker dialogs cannot be driven by Playwright.
      Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
      Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
    });
    await page.goto('/');
    await page.waitForFunction(() => {
      const cam = (window as unknown as { __cam?: { library: { getState(): { loaded: boolean } } } }).__cam;
      return cam?.library.getState().loaded === true;
    });
    await page.evaluate(({ tools, machineId }) => {
      const cam = (window as unknown as { __cam: any }).__cam;
      for (const tool of tools ?? []) cam.library.getState().upsertTool(tool);
      const library = cam.library.getState();
      const selectedMachine = machineId ?? library.activeMachineId;
      cam.project.getState().reset(selectedMachine, library.tools);
      cam.ui.getState().clearSelection();
      cam.ui.getState().setLang('en');
    }, { tools: config.tools, machineId: config.machineId });

    if (config.machineId) {
      await page.locator('.cam-ribbon-tabs').getByRole('button', { name: 'Machine', exact: true }).click();
      await page.locator('.cam-ribbon').getByLabel('Machine', { exact: true }).selectOption(config.machineId);
    }

    await setNumber(page, 'stock', 'Width', config.stock?.width);
    await setNumber(page, 'stock', 'Height', config.stock?.height);
    await setNumber(page, 'stock', 'Thickness', config.stock?.thickness);
    await setNumber(page, 'stock', 'Safe Z', config.stock?.safeZ);
    await setNumber(page, 'stock', 'Clearance Z', config.stock?.clearZ);

    await page.locator('.cam-ribbon-tabs').getByRole('button', { name: 'File', exact: true }).click();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('.cam-ribbon').getByTitle('Import DXF/SVG', { exact: true }).click();
    await (await chooserPromise).setFiles(drawing);
    const imported = await page.waitForFunction(() => {
      const cam = (window as unknown as { __cam: any }).__cam;
      const project = cam.project.getState().project;
      const placement = Object.values(project.placements)[0] as { id: string; shapeId: string } | undefined;
      return placement ? { placementId: placement.id, pathCount: project.shapes[placement.shapeId].paths.length } : null;
    });
    const { placementId, pathCount } = await imported.jsonValue() as { placementId: string; pathCount: number };

    await setNumber(page, 'placement', 'X', config.placement?.x);
    await setNumber(page, 'placement', 'Y', config.placement?.y);
    await setNumber(page, 'placement', 'Rotation', config.placement?.rotation);
    await setNumber(page, 'placement', 'Scale', config.placement?.scale);
    await setCheck(page, 'placement', 'Mirrored', config.placement?.mirrored);

    for (const operation of config.operations) {
      const indices = operation.contours === 'all' ? Array.from({ length: pathCount }, (_, i) => i) : operation.contours;
      for (const index of indices) expect(index, `Contour index for ${operation.type}`).toBeGreaterThanOrEqual(0);
      for (const index of indices) expect(index, `Drawing only contains ${pathCount} contours`).toBeLessThan(pathCount);
      await page.evaluate(({ placementId, indices }) => {
        const cam = (window as unknown as { __cam: any }).__cam;
        const project = cam.project.getState().project;
        const placement = project.placements[placementId];
        const paths = project.shapes[placement.shapeId].paths;
        cam.ui.getState().select({ paths: indices.map((index: number) => `${placementId}:${paths[index].id}`) });
      }, { placementId, indices });
      await page.locator('.cam-ribbon-tabs').getByRole('button', { name: 'Operations', exact: true }).click();
      await page.locator('.cam-ribbon').getByTitle(operationButton[operation.type], { exact: true }).click();
      await expect(page.locator('[data-section="op-main"]')).toBeVisible();
      await applyOperationSettings(page, operation.type, operation.settings);
    }

    await page.locator('.cam-viewtabs').getByRole('button', { name: 'G-Code', exact: true }).click();
    await expect(page.locator('.cam-gcode')).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.cam-gcode').getByRole('button', { name: 'Download', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'I understand — export', exact: true }).click();
    const download = await downloadPromise;
    const actualPath = await download.path();
    expect(actualPath, 'The generated G-code download did not produce a local file').not.toBeNull();
    const actual = readFileSync(actualPath!, 'utf8');
    const expected = readFileSync(referencePath, 'utf8');
    const comparison = compareGcode(actual, expected, config.comparison);

    await testInfo.attach('generated-gcode', { body: actual, contentType: 'text/plain' });
    expect(comparison.equal, formatGcodeDifferences(comparison)).toBe(true);
  });
}
