import type { Machine, Operation, Tool } from '@/lib/model/project';
import type { FeedSet } from './types';

/** Resolve spindle speed and feeds for an operation from the tool's cutting data and the machine limits. */
export function resolveFeeds(op: Operation, tool: Tool, machine: Machine): { feeds: FeedSet; warnings: string[] } {
  const warnings: string[] = [];
  const cut = tool.cut;
  let s = op.feed?.n ?? cut.n ?? (cut.vc && tool.d > 0 ? (cut.vc * 1000) / (Math.PI * tool.d) : machine.nMax);
  if (machine.kind === 'cnc') {
    if (s > machine.nMax) { warnings.push(`Spindle speed ${Math.round(s)} capped to ${machine.nMax}`); s = machine.nMax; }
    if (machine.nMin && s < machine.nMin) { warnings.push(`Spindle speed ${Math.round(s)} below machine minimum ${machine.nMin}`); }
  }
  let vf = op.feed?.vf ?? cut.vf ?? (cut.fz && tool.z ? s * tool.z * cut.fz : machine.feedMax.xy);
  if (vf > machine.feedMax.xy) { warnings.push(`Feed ${Math.round(vf)} capped to ${machine.feedMax.xy}`); vf = machine.feedMax.xy; }
  let vfPlunge = op.feed?.vfPlunge ?? cut.vfPlunge ?? Math.min(vf / 3, machine.feedMax.z);
  if (vfPlunge > machine.feedMax.z) vfPlunge = machine.feedMax.z;
  if (op.type === 'laser-cut' || op.type === 'laser-engrave') { vf = op.speed; vfPlunge = op.speed; s = ((op.power / 100) * (machine.laser?.sMax ?? 1000)); }
  return { feeds: { vf: Math.round(vf), vfPlunge: Math.round(vfPlunge), s: Math.round(s) }, warnings };
}
