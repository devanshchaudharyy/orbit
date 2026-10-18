import { createHash } from 'node:crypto';
import { Types, type PipelineStage } from 'mongoose';
import { z } from 'zod';
import { searchKindSchema, resourceIdSchema, type SearchQuery } from '@orbit/contracts';
import { AuthError } from '../auth/errors.js';
import type { ProjectRepository } from '../projects/repository.js';
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cursorSchema = z
  .object({ kind: searchKindSchema, id: resourceIdSchema, hash: z.string().length(64) })
  .strict();
type Row = {
  _id: Types.ObjectId;
  kind: z.infer<typeof searchKindSchema>;
  title: string;
  context: string;
  organizationId: Types.ObjectId;
  workspaceId: Types.ObjectId | null;
  projectId: Types.ObjectId | null;
  archived: boolean;
  updatedAt: Date;
};
export function searchFingerprint(input: SearchQuery) {
  return createHash('sha256')
    .update(JSON.stringify([input.q, input.kind, input.organizationId ?? null, input.archived]))
    .digest('hex');
}
function cursor(input: SearchQuery) {
  if (!input.cursor) return null;
  try {
    const value = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString()));
    if (value.hash !== searchFingerprint(input)) throw new Error();
    return value;
  } catch {
    throw new AuthError(
      400,
      'SEARCH_CURSOR_INVALID',
      'This cursor belongs to another search. Start from the first page.',
    );
  }
}
function joins(actor: string, kind: Row['kind']): PipelineStage[] {
  const user = new Types.ObjectId(actor),
    expr = (fields: string[]) => ({ $and: fields.map((f) => ({ $eq: [`$${f}`, `$$${f}`] })) });
  const org: PipelineStage[] = [
    {
      $lookup: {
        from: 'organization_memberships',
        let: { organizationId: '$organizationId' },
        pipeline: [{ $match: { userId: user, $expr: expr(['organizationId']) } }],
        as: 'authority',
      },
    },
    { $unwind: '$authority' },
  ];
  org.push(
    {
      $lookup: {
        from: 'organizations',
        localField: 'organizationId',
        foreignField: '_id',
        as: 'organization',
      },
    },
    { $unwind: '$organization' },
  );
  if (kind === 'organization') return org;
  const ws: PipelineStage[] = [
    {
      $lookup: {
        from: 'workspace_memberships',
        let: { organizationId: '$organizationId', workspaceId: '$workspaceId' },
        pipeline: [{ $match: { userId: user, $expr: expr(['organizationId', 'workspaceId']) } }],
        as: 'grant',
      },
    },
    { $unwind: '$grant' },
    {
      $lookup: {
        from: 'workspaces',
        let: { organizationId: '$organizationId', workspaceId: '$workspaceId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$_id', '$$workspaceId'] },
                  { $eq: ['$organizationId', '$$organizationId'] },
                ],
              },
            },
          },
        ],
        as: 'workspace',
      },
    },
    { $unwind: '$workspace' },
  ];
  if (kind === 'workspace') return [...org, ...ws];
  const project: PipelineStage[] = [
    {
      $lookup: {
        from: 'projects',
        let: {
          organizationId: '$organizationId',
          workspaceId: '$workspaceId',
          projectId: '$projectId',
        },
        pipeline: [
          {
            $match: {
              deletedAt: null,
              $expr: {
                $and: [
                  { $eq: ['$_id', '$$projectId'] },
                  { $eq: ['$organizationId', '$$organizationId'] },
                  { $eq: ['$workspaceId', '$$workspaceId'] },
                ],
              },
            },
          },
        ],
        as: 'project',
      },
    },
    { $unwind: '$project' },
    {
      $match: {
        $expr: {
          $or: [
            { $in: ['$authority.role', ['owner', 'admin', 'project-manager']] },
            { $and: [{ $ne: ['$authority.role', 'guest'] }, { $eq: ['$project.ownerId', user] }] },
            { $in: [user, '$project.memberIds'] },
          ],
        },
      },
    },
  ];
  return [...org, ...ws, ...project];
}
const definitions = [
  ['organization', 'organizations', 'name'],
  ['workspace', 'workspaces', 'name'],
  ['project', 'projects', 'name'],
  ['task', 'tasks', 'title'],
  ['document', 'project_documents', 'title'],
  ['file', 'project_files', 'name'],
] as const;
function activeFileParents(): PipelineStage[] {
  return (['taskId', 'documentId'] as const).flatMap((field) => [
    {
      $lookup: {
        from: field === 'taskId' ? 'tasks' : 'project_documents',
        let: {
          parent: `$${field}`,
          organizationId: '$organizationId',
          workspaceId: '$workspaceId',
          projectId: '$projectId',
        },
        pipeline: [
          {
            $match: {
              deletedAt: null,
              $expr: {
                $and: [
                  { $eq: ['$_id', '$$parent'] },
                  ...['organizationId', 'workspaceId', 'projectId'].map((name) => ({
                    $eq: [`$${name}`, `$$${name}`],
                  })),
                ],
              },
            },
          },
        ],
        as: `active_${field}`,
      },
    },
    { $match: { $or: [{ [field]: null }, { [`active_${field}.0`]: { $exists: true } }] } },
  ]);
}
export class GlobalSearch {
  constructor(readonly projects: ProjectRepository) {}
  async run(actor: string, input: SearchQuery) {
    const after = cursor(input),
      hash = searchFingerprint(input);
    if (input.organizationId)
      await this.projects.tenants.organizationAccess(actor, input.organizationId);
    const pipelines = definitions.map(([kind, collection, title]) => {
      const scoped =
        kind === 'organization'
          ? { _id: new Types.ObjectId(input.organizationId) }
          : { organizationId: new Types.ObjectId(input.organizationId) };
      const stages: PipelineStage[] = [
        {
          $match: {
            ...(input.organizationId ? scoped : {}),
            ...(kind === 'file'
              ? { status: 'ready' }
              : ['project', 'task', 'document'].includes(kind)
                ? { deletedAt: null }
                : {}),
            [title]: { $regex: literal(input.q), $options: 'i' },
            ...(input.kind !== 'all' && input.kind !== kind ? { _id: { $exists: false } } : {}),
          },
        },
        {
          $set: {
            kind: { $literal: kind },
            title: `$${title}`,
            organizationId: kind === 'organization' ? '$_id' : '$organizationId',
            workspaceId:
              kind === 'workspace'
                ? '$_id'
                : ['organization'].includes(kind)
                  ? null
                  : '$workspaceId',
            projectId:
              kind === 'project'
                ? '$_id'
                : ['task', 'document', 'file'].includes(kind)
                  ? '$projectId'
                  : null,
          },
        },
        ...joins(actor, kind),
      ];
      if (kind === 'file') stages.push(...activeFileParents());
      if (!['organization', 'workspace'].includes(kind) && input.archived === 'false')
        stages.push({ $match: { 'project.archived': false } });
      stages.push({
        $project: {
          _id: 1,
          kind: 1,
          title: 1,
          organizationId: 1,
          workspaceId: 1,
          projectId: 1,
          updatedAt: 1,
          context: {
            $concat: [
              '$organization.name',
              {
                $cond: [
                  { $ifNull: ['$workspace.name', false] },
                  { $concat: [' / ', '$workspace.name'] },
                  '',
                ],
              },
            ],
          },
          archived: { $ifNull: ['$project.archived', false] },
        },
      });
      return { collection, stages };
    });
    const pipeline: PipelineStage[] = [
      ...pipelines[0]!.stages,
      ...pipelines.slice(1).map(({ collection, stages }) => ({
        $unionWith: {
          coll: collection,
          pipeline: stages as Exclude<PipelineStage, PipelineStage.Out | PipelineStage.Merge>[],
        },
      })),
    ];
    if (after)
      pipeline.push({
        $match: {
          $or: [
            { kind: { $gt: after.kind } },
            { kind: after.kind, _id: { $gt: new Types.ObjectId(after.id) } },
          ],
        },
      });
    pipeline.push({ $sort: { kind: 1, _id: 1 } }, { $limit: 26 });
    const rows = await this.projects.tenants.models.organizations
      .aggregate<Row>(pipeline)
      .option({ maxTimeMS: 3000 });
    // Recheck current authority after the joined read, including role/grant changes during I/O.
    const checked = await Promise.all(
      rows.slice(0, 25).map(async (row) => {
        try {
          const org = String(row.organizationId),
            ws = row.workspaceId ? String(row.workspaceId) : null,
            p = row.projectId ? String(row.projectId) : null;
          if (p) {
            const current = await this.projects.access(
              actor,
              { organizationId: org, workspaceId: ws! },
              p,
            );
            if (input.archived === 'false' && current.project.archived) return null;
          } else if (ws) await this.projects.tenants.workspaceAccess(actor, org, ws);
          else await this.projects.tenants.organizationAccess(actor, org);
          const scope = {
            _id: row._id,
            organizationId: row.organizationId,
            workspaceId: row.workspaceId,
            projectId: row.projectId,
          };
          const connection = this.projects.tenants.connection;
          if (
            ['task', 'document'].includes(row.kind) &&
            !(await connection
              .collection(row.kind === 'task' ? 'tasks' : 'project_documents')
              .findOne({ ...scope, deletedAt: null }, { projection: { _id: 1 }, maxTimeMS: 1000 }))
          )
            return null;
          if (
            row.kind === 'file' &&
            !(
              await connection
                .collection('project_files')
                .aggregate(
                  [
                    { $match: { ...scope, status: 'ready' } },
                    ...activeFileParents(),
                    { $limit: 1 },
                    { $project: { _id: 1 } },
                  ],
                  { maxTimeMS: 1000 },
                )
                .toArray()
            ).length
          )
            return null;
          const base = `/app/organizations/${org}`,
            project = `${base}/workspaces/${ws}/projects/${p}`;
          return {
            id: String(row._id),
            kind: row.kind,
            title: row.title,
            context: row.context,
            organizationId: org,
            workspaceId: ws,
            projectId: p,
            archived: row.archived,
            updatedAt: row.updatedAt.toISOString(),
            href:
              row.kind === 'organization'
                ? base
                : row.kind === 'workspace'
                  ? `${base}/workspaces/${ws}`
                  : row.kind === 'project'
                    ? project
                    : row.kind === 'task'
                      ? `${project}/tasks/${row._id}`
                      : row.kind === 'document'
                        ? `${project}?section=documents&document=${row._id}`
                        : `${project}?section=documents&library=files`,
          };
        } catch (error) {
          if (error instanceof AuthError && [403, 404].includes(error.status)) return null;
          throw error;
        }
      }),
    );
    const last = rows[24];
    return {
      results: checked.filter((x) => x !== null),
      nextCursor:
        rows.length > 25 && last
          ? Buffer.from(JSON.stringify({ kind: last.kind, id: String(last._id), hash })).toString(
              'base64url',
            )
          : null,
    };
  }
}
