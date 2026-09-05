'use client';
import { useState, type DragEvent } from 'react';
import { useProject } from '@/lib/store/project';
import { useUi } from '@/lib/store/ui';
import { t } from '@/lib/i18n';
import type { Operation } from '@/lib/model/project';
import { pathLabel } from '@/lib/store/actions';

export const OP_ICONS: Record<Operation['type'], string> = { contour: '▢', cutout: '✂', pocket: '▤', engrave: '✎', drill: '⌖', thread: '⌀', 'laser-cut': '✂', 'laser-engrave': '✎' };

export function TreePanel() {
  const lang = useUi((u) => u.lang);
  const s = t(lang);
  const project = useProject((p) => p.project);
  const sel = useUi((u) => u.selection);
  const selectRaw = useUi((u) => u.select);
  const select: typeof selectRaw = (sel, additive) => { const a = document.activeElement as HTMLElement | null; if (a && a.tagName === 'INPUT' && (a as HTMLInputElement).type === 'text') a.blur(); selectRaw(sel, additive); };
  const clearSelection = useUi((u) => u.clearSelection);
  const updateOperation = useProject((p) => p.updateOperation);
  const removeOperations = useProject((p) => p.removeOperations);
  const moveOperation = useProject((p) => p.moveOperation);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<{ id: string; over: string | null; where: 'before' | 'after' | 'tool' } | null>(null);

  const ops = Object.values(project.operations).sort((a, b) => a.order - b.order);
  // consecutive operations with the same tool form one block (= one tool change)
  const blocks: { toolId: string; ops: Operation[] }[] = [];
  for (const op of ops) { const last = blocks[blocks.length - 1]; if (last && last.toolId === op.toolId) last.ops.push(op); else blocks.push({ toolId: op.toolId, ops: [op] }); }

  const assignedPaths = new Set(ops.flatMap((o) => o.targets.map((tg) => `${tg.placementId}:${tg.pathId ?? '*'}`)));
  const placements = Object.values(project.placements);
  const unassigned = placements.filter((p) => {
    if (assignedPaths.has(`${p.id}:*`)) return false;
    const shape = project.shapes[p.shapeId];
    return !shape || shape.paths.some((x) => !assignedPaths.has(`${p.id}:${x.id}`));
  });
  const groups = Object.values(project.groups);

  const deleteOp = (op: Operation) => {
    if (!confirm(s.confirmDelete(op.name || s.opNames[op.type]))) return;
    removeOperations([op.id]);
    if (sel.operations.includes(op.id)) clearSelection();
  };

  // ---- drag & drop ---------------------------------------------------------
  const onDragStart = (e: DragEvent, id: string) => { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; setDrag({ id, over: null, where: 'before' }); };
  const onDragOverOp = (e: DragEvent, op: Operation) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const where = e.clientY - r.top < r.height / 2 ? 'before' : 'after';
    setDrag((d) => (d ? { ...d, over: op.id, where } : d));
  };
  const onDropOp = (e: DragEvent, op: Operation) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || drag?.id;
    if (!id || id === op.id) { setDrag(null); return; }
    const where = drag?.where ?? 'before';
    if (where === 'before') moveOperation(id, op.id);
    else { const next = ops[ops.findIndex((o) => o.id === op.id) + 1]; moveOperation(id, next?.id); }
    setDrag(null);
  };
  const onDropTool = (e: DragEvent, block: { toolId: string; ops: Operation[] }) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || drag?.id;
    if (!id) { setDrag(null); return; }
    // move to the start of this block and adopt its tool
    moveOperation(id, block.ops[0]?.id === id ? block.ops[1]?.id : block.ops[0]?.id, block.toolId);
    setDrag(null);
  };

  const opLine = (op: Operation) => {
    const n = new Set(op.targets.map((tg) => `${tg.placementId}:${tg.pathId ?? ''}`)).size;
    // Z range: start depth (operation + group) down to start + depth, as machine Z below the surface
    const groupDepth = Object.values(project.groups).find((g) => op.targets.some((tg) => project.placements[tg.placementId]?.groupId === g.id))?.zOffset ?? 0;
    const zStart = -(op.zOffset + groupDepth), zEnd = zStart - op.depth;
    const fmtZ = (v: number) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 100) / 100));
    const zLabel = `${fmtZ(zStart)}→${fmtZ(zEnd)}`;
    const dragging = drag?.id === op.id;
    const over = drag?.over === op.id ? drag.where : null;
    return (
      <div key={op.id}
        className={`cam-node depth1 cam-op${sel.operations.includes(op.id) ? ' selected' : ''}${dragging ? ' dragging' : ''}${over === 'before' ? ' drop-before' : over === 'after' ? ' drop-after' : ''}`}
        draggable onDragStart={(e) => onDragStart(e, op.id)} onDragOver={(e) => onDragOverOp(e, op)} onDrop={(e) => onDropOp(e, op)} onDragEnd={() => setDrag(null)}
        onClick={(e) => select({ operations: [op.id] }, e.shiftKey || e.metaKey || e.ctrlKey)} title={`${op.order}. ${s.opNames[op.type]} · Z ${zLabel} mm · ${n} ${s.paths}`}>
        <span className="grip" aria-hidden="true">⋮⋮</span>
        <input type="checkbox" checked={op.enabled} onClick={(e) => e.stopPropagation()} onChange={(e) => updateOperation(op.id, { enabled: e.target.checked })} title={s.enabled} />
        <span className="ico" title={s.opNames[op.type]}>{OP_ICONS[op.type]}</span>
        <span className="lbl">{op.name || s.opNames[op.type]}</span>
        <span className="meta z" title={`Z ${zLabel} mm`}><span className="zp">Z </span>{zLabel}</span>
        <span className="meta">{n} {s.paths}</span>
        <button type="button" className="cam-x" title={s.delete} onClick={(e) => { e.stopPropagation(); deleteOp(op); }}>✕</button>
      </div>
    );
  };

  const plNode = (pid: string, depth: number) => {
    const pl = project.placements[pid];
    if (!pl) return null;
    const shape = project.shapes[pl.shapeId];
    const n = pl.array ? pl.array.nx * pl.array.ny : 1;
    const selected = sel.placements.includes(pid);
    const anyPathSel = sel.paths.some((k) => k.startsWith(pid + ':'));
    const open = expanded[pid] ?? anyPathSel;
    const pathIds = (shape?.paths.map((x) => x.id) ?? []).filter((id) => !assignedPaths.has(`${pid}:${id}`));
    return (
      <div key={pid}>
        <div className={`cam-node depth${depth}${selected ? ' selected' : ''}`} onClick={(e) => select({ placements: [pid] }, e.shiftKey || e.metaKey || e.ctrlKey)}>
          <span className="ico" onClick={(e) => { e.stopPropagation(); setExpanded((x) => ({ ...x, [pid]: !open })); }} style={{ cursor: 'pointer' }}>{pathIds.length ? (open ? '▾' : '▸') : '◇'}</span>
          <span className="lbl">{pl.name}</span>
          <span className="meta">{shape ? `${pathIds.length}/${shape.paths.length} ${s.paths}` : ''}{n > 1 ? ` ${s.instances(n)}` : ''}</span>
        </div>
        {open && pathIds.map((pathId) => {
          const idx = shape!.paths.findIndex((x) => x.id === pathId);
          const path = shape!.paths[idx];
          const key = `${pid}:${pathId}`;
          return (
            <div key={key} className={`cam-node depth${depth + 1}${sel.paths.includes(key) ? ' selected' : ''}`} onClick={(e) => select({ paths: [key] }, e.shiftKey || e.metaKey || e.ctrlKey)} title={pathLabel(path, idx, lang)}>
              <span className="ico">{path.segs.length === 0 ? '•' : path.closed ? '○' : '⌇'}</span><span className="lbl">{pathLabel(path, idx, lang)}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside className="cam-tree">
      <h3>{s.operations}</h3>
      <div className={`cam-node depth0${sel.stock ? ' selected' : ''}`} onClick={() => select({ stock: true })} title={s.stock}>
        <span className="ico">▭</span><span className="lbl">{s.stock}</span><span className="meta">{project.stock.width}×{project.stock.height}×{project.stock.thickness}</span>
      </div>
      {!ops.length && <div className="cam-empty">{placements.length ? s.gcodeEmpty : s.noObjects}</div>}
      {blocks.map((block, bi) => {
        const tool = project.tools[block.toolId];
        return (
          <div key={`${block.toolId}-${bi}`} className={`cam-block${drag?.over === `tool-${bi}` ? ' drop-tool' : ''}`}
            onDragOver={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.cam-toolnode')) { e.preventDefault(); setDrag((d) => (d ? { ...d, over: `tool-${bi}`, where: 'tool' } : d)); } }}
            onDrop={(e) => { if (drag?.where === 'tool') onDropTool(e, block); }}>
            <div className="cam-node depth0 cam-toolnode" title={tool?.name}>
              <span className="ico">🛠</span><span className="lbl">T{tool?.slot ?? '?'} {tool?.name ?? block.toolId}</span><span className="meta">Ø{tool?.d}{bi > 0 ? ` · ${lang === 'de' ? 'Wechsel' : 'change'}` : ''}</span>
            </div>
            {block.ops.map(opLine)}
          </div>
        );
      })}
      {ops.length > 1 && <div className="cam-empty" style={{ fontSize: 11 }}>{lang === 'de' ? 'Reihenfolge per Ziehen ändern; auf ein Werkzeug ziehen wechselt das Werkzeug.' : 'Drag to reorder; drop on a tool to change the tool.'}</div>}
      {groups.length > 0 && <h3>{s.groups}</h3>}
      {groups.map((g) => (
        <div key={g.id}>
          <div className={`cam-node depth0${sel.groups.includes(g.id) ? ' selected' : ''}`} onClick={(e) => select({ groups: [g.id] }, e.shiftKey)}>
            <span className="ico">⛶</span><span className="lbl">{g.name}</span><span className="meta">{g.zOffset ? `+${g.zOffset} mm` : ''}</span>
          </div>
          {placements.filter((p) => p.groupId === g.id).map((p) => plNode(p.id, 1))}
        </div>
      ))}
      <h3>{s.unassigned}</h3>
      {!unassigned.length && <div className="cam-empty">–</div>}
      {unassigned.map((p) => plNode(p.id, 0))}
    </aside>
  );
}
