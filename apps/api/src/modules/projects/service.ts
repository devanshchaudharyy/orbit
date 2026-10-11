import { ProjectRepository, type ProjectScope } from './repository.js';
import type {
  ProjectInput,
  ProjectUpdate,
  TaskInput,
  TaskUpdate,
  ProjectFilter,
  TaskFilter,
  LabelInput,
  TaskMove,
} from '@orbit/contracts';

export class ProjectService {
  constructor(readonly repository: ProjectRepository) {}
  ready = () => this.repository.ready();
  list = (actor: string, scope: ProjectScope, input: ProjectFilter) =>
    this.repository.list(actor, scope, input);
  create = (actor: string, scope: ProjectScope, input: ProjectInput) =>
    this.repository.create(actor, scope, input);
  get = (actor: string, scope: ProjectScope, id: string) => this.repository.get(actor, scope, id);
  update = (actor: string, scope: ProjectScope, id: string, input: ProjectUpdate) =>
    this.repository.update(actor, scope, id, input);
  lifecycle = (
    actor: string,
    scope: ProjectScope,
    id: string,
    version: number,
    archived?: boolean,
  ) => this.repository.lifecycle(actor, scope, id, version, archived);
  people = (actor: string, scope: ProjectScope, id?: string, cursor?: string) =>
    this.repository.people(actor, scope, id, cursor);
  tasks = (actor: string, scope: ProjectScope, id: string, input: TaskFilter) =>
    this.repository.tasks(actor, scope, id, input);
  task = (actor: string, scope: ProjectScope, id: string, task: string) =>
    this.repository.task(actor, scope, id, task);
  moveTask = (actor: string, scope: ProjectScope, id: string, task: string, input: TaskMove) =>
    this.repository.moveTask(actor, scope, id, task, input);
  saveTask = (
    actor: string,
    scope: ProjectScope,
    id: string,
    input: TaskInput | TaskUpdate,
    task?: string,
  ) => this.repository.saveTask(actor, scope, id, input, task);
  deleteTask = (actor: string, scope: ProjectScope, id: string, task: string, version: number) =>
    this.repository.deleteTask(actor, scope, id, task, version);
  label = (actor: string, scope: ProjectScope, id: string, input: LabelInput) =>
    this.repository.label(actor, scope, id, input);
  removeLabel = (actor: string, scope: ProjectScope, id: string, label: string, version: number) =>
    this.repository.removeLabel(actor, scope, id, label, version);
  activity = (actor: string, scope: ProjectScope, id: string, cursor?: string) =>
    this.repository.activity(actor, scope, id, cursor);
}
