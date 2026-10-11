import {
  defaultWorkPreferences,
  type WorkPreferencesInput,
  type WorkPreferences,
  type SavedFilterInput,
  type SavedFilterUpdate,
  type SavedFilter,
} from '@orbit/contracts';
import type { ProjectRepository, ProjectScope } from '../projects/repository.js';
import { AuthError } from '../auth/errors.js';
import { missingTenant } from '../tenants/repository.js';
import { createViewModels, type StoredFilter, type StoredPreferences } from './models.js';
const stale = () =>
  new AuthError(
    409,
    'VERSION_CONFLICT',
    'Your saved view changed in another session. Reload before saving.',
  );
const preferencesDto = (row: StoredPreferences): WorkPreferences => ({
  view: row.view,
  sort: row.sort,
  group: row.group,
  density: row.density,
  weekStart: row.weekStart,
  columns: row.columns,
  showSubtasks: row.showSubtasks,
  version: row.version,
});
const filterDto = (row: StoredFilter): SavedFilter => ({
  id: String(row._id),
  name: row.name,
  criteria: { ...row.criteria, filters: row.criteria.filters ?? {} },
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
export class WorkViewRepository {
  readonly models;
  private indexes: Promise<void> | undefined;
  constructor(readonly projects: ProjectRepository) {
    this.models = createViewModels(projects.tenants.connection);
  }
  async ready() {
    await this.projects.ready();
    this.indexes ??= (async () => {
      await Promise.all(Object.values(this.models).map((model) => model.createCollection()));
      await Promise.all(Object.values(this.models).map((model) => model.createIndexes()));
    })().catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    await this.indexes;
  }
  private scope(actor: string, scope: ProjectScope, projectId: string) {
    return { ...scope, userId: actor, projectId };
  }
  async preferences(actor: string, scope: ProjectScope, projectId: string) {
    await this.projects.access(actor, scope, projectId);
    const row = await this.models.preferences.findOne(this.scope(actor, scope, projectId)).lean();
    return row
      ? preferencesDto(row)
      : { ...defaultWorkPreferences, columns: [...defaultWorkPreferences.columns], version: 0 };
  }
  async savePreferences(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    input: WorkPreferencesInput,
  ) {
    try {
      return await this.projects.tenants.connection.transaction(async (session) => {
        await this.projects.access(actor, scope, projectId, session);
        const filter = this.scope(actor, scope, projectId);
        const current = await this.models.preferences.findOne(filter).session(session).lean();
        if ((current?.version ?? 0) !== input.version) throw stale();
        const values = { ...input, version: input.version + 1 };
        if (!current) {
          const [row] = await this.models.preferences.create([{ ...filter, ...values }], {
            session,
          });
          return preferencesDto(row!.toObject());
        }
        const row = await this.models.preferences
          .findOneAndUpdate(
            { ...filter, version: input.version },
            { $set: values },
            { session, returnDocument: 'after' },
          )
          .lean();
        if (!row) throw stale();
        return preferencesDto(row);
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) throw stale();
      throw error;
    }
  }
  async filters(actor: string, scope: ProjectScope, projectId: string) {
    await this.projects.access(actor, scope, projectId);
    const rows = await this.models.filters
      .find(this.scope(actor, scope, projectId))
      .sort({ createdAt: 1, _id: 1 })
      .limit(20)
      .lean();
    return { filters: rows.map(filterDto) };
  }
  async saveFilter(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    input: SavedFilterInput | SavedFilterUpdate,
    id?: string,
  ) {
    try {
      return await this.projects.tenants.connection.transaction(async (session) => {
        await this.projects.access(actor, scope, projectId, session);
        const ownerScope = this.scope(actor, scope, projectId);
        const nameKey = input.name.toLowerCase();
        const duplicate = await this.models.filters
          .findOne({ ...ownerScope, nameKey, ...(id ? { _id: { $ne: id } } : {}) })
          .session(session)
          .lean();
        if (duplicate)
          throw new AuthError(
            422,
            'FILTER_NAME_USED',
            'Use a different name for this saved filter.',
          );
        if (id && 'version' in input) {
          const current = await this.models.filters
            .findOne({ ...ownerScope, _id: id })
            .session(session)
            .lean();
          if (!current) throw missingTenant();
          if (current.version !== input.version) throw stale();
          const row = await this.models.filters
            .findOneAndUpdate(
              { ...ownerScope, _id: id, version: input.version },
              {
                $set: { name: input.name, nameKey, criteria: input.criteria },
                $inc: { version: 1 },
              },
              { session, returnDocument: 'after' },
            )
            .lean();
          if (!row) throw stale();
          return filterDto(row);
        }
        if ((await this.models.filters.countDocuments(ownerScope).session(session)) >= 20)
          throw new AuthError(
            422,
            'FILTER_LIMIT',
            'You can save up to twenty filters in this project.',
          );
        const [row] = await this.models.filters.create(
          [{ ...ownerScope, name: input.name, nameKey, criteria: input.criteria, version: 1 }],
          { session },
        );
        return filterDto(row!.toObject());
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000)
        throw new AuthError(422, 'FILTER_NAME_USED', 'Use a different name for this saved filter.');
      throw error;
    }
  }
  async deleteFilter(
    actor: string,
    scope: ProjectScope,
    projectId: string,
    id: string,
    version: number,
  ) {
    return this.projects.tenants.connection.transaction(async (session) => {
      await this.projects.access(actor, scope, projectId, session);
      const filter = { ...this.scope(actor, scope, projectId), _id: id };
      const row = await this.models.filters.findOne(filter).session(session).lean();
      if (!row) throw missingTenant();
      if (row.version !== version) throw stale();
      const result = await this.models.filters.deleteOne({ ...filter, version }).session(session);
      if (!result.deletedCount) throw stale();
      return { message: 'Saved filter deleted.' };
    });
  }
}
