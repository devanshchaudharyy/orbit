import type {
  MilestoneInput,
  SprintInput,
  TaskPlanInput,
  CapacityInput,
  PlanningQuery,
} from '@orbit/contracts';
import type { ProjectScope } from '../projects/repository.js';
import { PlanningRepository } from './repository.js';
export class PlanningService {
  constructor(readonly repository: PlanningRepository) {}
  ready = () => this.repository.ready();
  snapshot = (actor: string, scope: ProjectScope, project: string, input: PlanningQuery) =>
    this.repository.snapshot(actor, scope, project, input);
  milestone = (
    actor: string,
    scope: ProjectScope,
    project: string,
    input: MilestoneInput & { version?: number },
    id?: string,
  ) => this.repository.milestone(actor, scope, project, input, id);
  removeMilestone = (
    actor: string,
    scope: ProjectScope,
    project: string,
    id: string,
    version: number,
  ) => this.repository.removeMilestone(actor, scope, project, id, version);
  sprint = (
    actor: string,
    scope: ProjectScope,
    project: string,
    input: SprintInput & { version?: number },
    id?: string,
  ) => this.repository.sprint(actor, scope, project, input, id);
  sprintAction = (
    actor: string,
    scope: ProjectScope,
    project: string,
    id: string,
    version: number,
    action: 'start' | 'complete' | 'delete',
    carryTo: string | null = null,
  ) => this.repository.sprintAction(actor, scope, project, id, version, action, carryTo);
  plan = (
    actor: string,
    scope: ProjectScope,
    project: string,
    task: string,
    input: TaskPlanInput,
  ) => this.repository.plan(actor, scope, project, task, input);
  capacity = (
    actor: string,
    scope: ProjectScope,
    project: string,
    user: string,
    input: CapacityInput,
  ) => this.repository.capacity(actor, scope, project, user, input);
}
