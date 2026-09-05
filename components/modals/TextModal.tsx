'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { NumberField } from '@/components/ui/NumberField';
import { SelectField, TextField } from '@/components/ui/Field';
import { useUi } from '@/lib/store/ui';
import { useProject } from '@/lib/store/project';
import { useLibrary } from '@/lib/store/library';
import { t } from '@/lib/i18n';
import { toolsForMachine } from '@/lib/persist/libraryFiles';
import { BUILT_IN_FONTS, addUserFont, listUserFonts, loadFont, type FontEntry } from '@/lib/text/fonts';
import { textToPaths, estimateMinStroke } from '@/lib/geometry/text';
import { offsetClosed } from '@/lib/geometry/offset';
import type { Path, Placement, Shape, TextSpec, Operation, OperationType } from '@/lib/model/project';
import { newId } from '@/lib/model/ids';
import { newOperation } from '@/lib/model/defaults';
import { translation } from '@/lib/geometry/transform';
import { tracePath, type View } from '@/components/canvas2d/renderer';
import { bbox } from '@/lib/geometry/path';
import { bboxUnion } from '@/lib/geometry/types';

type TextOp = 'engrave' | 'pocket' | 'contour' | 'none';

export function TextModal() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const close = useUi((u) => u.closeModal);
  const editId = useUi((u) => u.textEditId);
  const notify = useUi((u) => u.notify);
  const project = useProject((p) => p.project);
  const lib = useLibrary();
  const existing = editId ? project.placements[editId] : undefined;
  const existingShape = existing ? project.shapes[existing.shapeId] : undefined;
  const existingOp = existing ? Object.values(project.operations).find((o) => o.targets.some((tg) => tg.placementId === existing.id)) : undefined;

  const [spec, setSpec] = useState<TextSpec>(existingShape?.text ?? { text: lang === 'de' ? 'Makerspace' : 'Makerspace', font: 'nunito', size: 20, letterSpacing: 0, align: 'left' });
  const [toolId, setToolId] = useState(existingOp?.toolId ?? lib.activeToolId ?? lib.tools[0]?.id ?? '');
  const [opType, setOpType] = useState<TextOp>(existingOp ? (existingOp.type === 'engrave' || existingOp.type === 'pocket' || existingOp.type === 'contour' ? existingOp.type : 'none') : 'engrave');
  const [fonts, setFonts] = useState<FontEntry[]>(BUILT_IN_FONTS);
  const [paths, setPaths] = useState<Path[]>([]);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tool = lib.tools.find((x) => x.id === toolId);

  useEffect(() => { listUserFonts().then((u) => setFonts([...BUILT_IN_FONTS, ...u])); }, []);

  // regenerate outlines (debounced)
  useEffect(() => {
    const h = setTimeout(async () => {
      try { const font = await loadFont(spec.font); setPaths(textToPaths(font, spec)); setError(null); }
      catch (e) { setError((e as Error).message); setPaths([]); }
    }, 150);
    return () => clearTimeout(h);
  }, [spec]);

  const minStroke = useMemo(() => (paths.length ? estimateMinStroke(paths, offsetClosed, Math.max(2, spec.size)) : 0), [paths, spec.size]);
  const toolFits = tool ? (opType === 'pocket' ? tool.d <= minStroke + 1e-6 : opType === 'engrave' ? tool.kind === 'vbit' || tool.d <= minStroke + 1e-6 : true) : true;

  // preview
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!paths.length) return;
    const b = paths.map(bbox).reduce(bboxUnion);
    const pad = 16;
    const scale = Math.min((w - 2 * pad) / Math.max(1e-6, b.maxX - b.minX), (h - 2 * pad) / Math.max(1e-6, b.maxY - b.minY));
    const v: View = { scale, ox: pad - b.minX * scale + ((w - 2 * pad) - (b.maxX - b.minX) * scale) / 2, oy: pad - b.minY * scale + ((h - 2 * pad) - (b.maxY - b.minY) * scale) / 2, w, h, dpr };
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    // tool band
    if (tool && opType !== 'none') {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const d = tool.kind === 'vbit' ? Math.min(tool.d, 1) : tool.d;
      ctx.strokeStyle = toolFits ? 'rgba(118,176,65,0.45)' : 'rgba(210,65,58,0.45)';
      ctx.lineWidth = Math.max(1, d * scale);
      ctx.beginPath(); for (const p of paths) tracePath(ctx, v, p); ctx.stroke();
    }
    ctx.lineWidth = 1.2; ctx.strokeStyle = dark ? '#e8eaee' : '#1c1f24';
    ctx.beginPath(); for (const p of paths) tracePath(ctx, v, p); ctx.stroke();
    // size annotation
    ctx.fillStyle = dark ? '#9aa3b0' : '#5f6672'; ctx.font = '11px system-ui';
    ctx.fillText(`${(b.maxX - b.minX).toFixed(1)} × ${(b.maxY - b.minY).toFixed(1)} mm · ${paths.length} ${s.paths}`, 8, h - 6);
  }, [paths, tool, opType, toolFits, s.paths]);

  const upload = async () => {
    // fonts are binary: use a dedicated file input
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.ttf,.otf,font/ttf,font/otf';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try { const entry = await addUserFont(f.name.replace(/\.[^.]+$/, ''), await f.arrayBuffer()); setFonts((x) => [...x, entry]); setSpec((sp) => ({ ...sp, font: entry.id })); }
      catch (e) { notify((e as Error).message, 'error'); }
    };
    input.click();
  };

  const create = () => {
    if (!paths.length) return;
    const ps = useProject.getState();
    const ui = useUi.getState();
    // shape local origin at the bounding-box corner like imported drawings
    const b = paths.map(bbox).reduce(bboxUnion);
    const local = paths.map((p) => ({ ...p, start: { x: p.start.x - b.minX, y: p.start.y - b.minY }, segs: p.segs.map((sg) => (sg.k === 'L' ? { k: 'L' as const, to: { x: sg.to.x - b.minX, y: sg.to.y - b.minY } } : { k: 'A' as const, to: { x: sg.to.x - b.minX, y: sg.to.y - b.minY }, c: { x: sg.c.x - b.minX, y: sg.c.y - b.minY }, cw: sg.cw })) }));
    let placementId: string;
    if (existing && existingShape) {
      const shape: Shape = { ...existingShape, kind: 'text', text: spec, paths: local, name: spec.text.split('\n')[0] };
      ps.update((p) => { p.shapes[shape.id] = shape; p.placements[existing.id].name = shape.name; });
      placementId = existing.id;
      // retarget operations on this placement to the new paths
      ps.update((p) => { for (const op of Object.values(p.operations)) { const others = op.targets.filter((tg) => tg.placementId !== existing.id); if (others.length !== op.targets.length) op.targets = [...others, ...local.map((pa) => ({ placementId: existing.id, pathId: pa.id, pick: 'contour' as const }))]; } });
    } else {
      const shape: Shape = { id: newId('s'), name: spec.text.split('\n')[0] || 'Text', kind: 'text', text: spec, paths: local };
      const placement: Placement = { id: newId('p'), shapeId: shape.id, name: shape.name, transform: translation(20, 20) };
      ps.addShape(shape, placement);
      placementId = placement.id;
    }
    // machining operation with the chosen tool
    if (opType !== 'none' && tool && !existingOp) {
      ps.ensureTool(tool);
      const type: OperationType = opType;
      const depth = type === 'engrave' ? (tool.kind === 'vbit' ? 1 : 0.5) : type === 'pocket' ? Math.min(3, project.stock.thickness / 2) : project.stock.thickness + 1;
      const op = newOperation(type, tool.id, tool, depth, Object.keys(ps.project.operations).length + 1);
      if (op.type === 'engrave') op.side = 'on';
      if (op.type === 'pocket') op.side = 'inside';
      if (op.type === 'contour') op.side = 'outside';
      op.name = `${s.opNames[type]} ${spec.text.split('\n')[0]}`.trim();
      op.targets = local.map((pa) => ({ placementId, pathId: pa.id, pick: 'contour' }));
      ps.addOperation(op as Operation);
      ui.select({ operations: [op.id] });
    } else if (existingOp && tool && existingOp.toolId !== tool.id) {
      ps.ensureTool(tool); ps.updateOperation(existingOp.id, { toolId: tool.id });
    } else ui.select({ placements: [placementId] });
    ui.setDirty(true);
    close();
  };

  return (
    <Modal title={s.textTitle} onClose={close} wide footer={<><button type="button" className="btn" onClick={close}>{s.cancel}</button><button type="button" className="btn primary" onClick={create} disabled={!paths.length || (opType !== 'none' && !tool)}>{existing ? s.textUpdate : s.textCreate}</button></>}>
      <div className="cam-textmodal">
        <div className="fields">
          <label className="cam-field full"><span className="cam-label">{s.textContent}</span><textarea className="cam-textarea" style={{ minHeight: 64 }} value={spec.text} onChange={(e) => setSpec({ ...spec, text: e.target.value })} /></label>
          <SelectField label={s.font} value={spec.font} options={fonts.map((f) => ({ value: f.id, label: f.name }))} onChange={(v) => setSpec({ ...spec, font: v })} />
          <div className="cam-field"><span className="cam-label">&nbsp;</span><button type="button" className="btn small" onClick={upload}>{s.uploadFont}</button></div>
          <NumberField label={s.fontSize} unit="mm" value={spec.size} min={1} onChange={(v) => setSpec({ ...spec, size: v })} />
          <NumberField label={s.letterSpacing} unit="mm" value={spec.letterSpacing ?? 0} onChange={(v) => setSpec({ ...spec, letterSpacing: v })} />
          <SelectField label={s.align} value={spec.align ?? 'left'} options={(['left', 'center', 'right'] as const).map((a) => ({ value: a, label: s.aligns[a] }))} onChange={(v) => setSpec({ ...spec, align: v })} />
          <NumberField label={lang === 'de' ? 'Zeilenhöhe (× Höhe)' : 'Line height (× size)'} value={spec.lineHeight ?? 1.2} min={0.5} onChange={(v) => setSpec({ ...spec, lineHeight: v })} />
          <SelectField label={s.textTool} value={toolId} options={toolsForMachine(lib.tools, lib.machines.find((m) => m.id === project.machineId)).map((tl) => ({ value: tl.id, label: `T${tl.slot} ${tl.name} (Ø${tl.d}${tl.kind === 'vbit' ? `, ${tl.tipAngle ?? 90}°` : ''})` }))} onChange={setToolId} />
          <SelectField label={s.textOp} value={opType} options={(['engrave', 'pocket', 'contour', 'none'] as TextOp[]).map((o) => ({ value: o, label: s.textOps[o] }))} onChange={setOpType} />
          <div className="full hint" style={{ margin: 0 }}>
            {paths.length > 0 && <div>{s.minStroke(minStroke.toFixed(2))}</div>}
            {tool && opType !== 'none' && paths.length > 0 && (toolFits ? <div style={{ color: '#76b041' }}>✓ {s.toolOk}</div> : <div style={{ color: '#d2413a' }}>⚠ {s.toolTooBig(String(tool.d), minStroke.toFixed(2))}</div>)}
            {error && <div style={{ color: '#d2413a' }}>{error}</div>}
          </div>
        </div>
        <div className="preview"><canvas ref={canvasRef} /></div>
      </div>
    </Modal>
  );
}
