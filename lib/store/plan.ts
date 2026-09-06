import { useMemo } from 'react';
import { useProject } from './project';
import { useLibrary } from './library';
import { planProject, type PlanResult } from '@/lib/cam/plan';
import { exportProgram, type ExportResult } from '@/lib/post';
import { APP_VERSION } from '@/lib/version';
import type { Machine } from '@/lib/model/project';

export interface PlanBundle { plan: PlanResult | null; gcode: ExportResult | null; machine: Machine | null; error: string | null }

/** Plans the current project synchronously (memoised on the project revision). */
export function usePlan(): PlanBundle {
  const project = useProject((s) => s.project);
  const machines = useLibrary((s) => s.machines);
  const profiles = useLibrary((s) => s.profiles);
  const activeMachineId = useLibrary((s) => s.activeMachineId);
  return useMemo(() => {
    const machine = machines.find((m) => m.id === project.machineId) ?? machines.find((m) => m.id === activeMachineId) ?? machines[0] ?? null;
    if (!machine) return { plan: null, gcode: null, machine: null, error: 'no-machine' };
    try {
      const plan = planProject(project, machine, APP_VERSION);
      const profile = profiles.find((p) => p.id === machine.postId);
      const gcode = profile ? exportProgram(plan.program, profile, project.stock.safeZ, APP_VERSION, { laserMode: machine.laser?.dynamic === false ? 'M3' : 'M4', project, machine }) : null;
      return { plan, gcode, machine, error: profile ? null : 'post-missing' };
    } catch (e) {
      console.error(e);
      return { plan: null, gcode: null, machine, error: (e as Error).message };
    }
  }, [project, machines, profiles, activeMachineId]);
}
