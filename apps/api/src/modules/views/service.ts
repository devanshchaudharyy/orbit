import type { WorkPreferencesInput, SavedFilterInput, SavedFilterUpdate } from '@orbit/contracts';
import type { ProjectScope } from '../projects/repository.js';
import { WorkViewRepository } from './repository.js';
export class WorkViewService {
  constructor(readonly repository: WorkViewRepository) {}
  ready = () => this.repository.ready();
  preferences = (actor: string, scope: ProjectScope, project: string) =>
    this.repository.preferences(actor, scope, project);
  savePreferences = (
    actor: string,
    scope: ProjectScope,
    project: string,
    input: WorkPreferencesInput,
  ) => this.repository.savePreferences(actor, scope, project, input);
  filters = (actor: string, scope: ProjectScope, project: string) =>
    this.repository.filters(actor, scope, project);
  saveFilter = (
    actor: string,
    scope: ProjectScope,
    project: string,
    input: SavedFilterInput | SavedFilterUpdate,
    id?: string,
  ) => this.repository.saveFilter(actor, scope, project, input, id);
  deleteFilter = (
    actor: string,
    scope: ProjectScope,
    project: string,
    id: string,
    version: number,
  ) => this.repository.deleteFilter(actor, scope, project, id, version);
}
