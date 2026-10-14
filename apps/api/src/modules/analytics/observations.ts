import { Types, type ClientSession, type Connection } from 'mongoose';
import { observationModel } from './models.js';
export async function observeSprint(
  connection: Connection,
  scope: { organizationId: string; workspaceId: string },
  projectId: string,
  source: string,
  session: ClientSession,
  sprintId?: string,
  force = false,
) {
  const db = connection.db!;
  const parents = {
    organizationId: new Types.ObjectId(scope.organizationId),
    workspaceId: new Types.ObjectId(scope.workspaceId),
    projectId: new Types.ObjectId(projectId),
  };
  const sprint = await db
    .collection('project_sprints')
    .findOne(
      { ...parents, ...(sprintId ? { _id: new Types.ObjectId(sprintId) } : { status: 'active' }) },
      { session },
    );
  if (!sprint) return;
  const [totals] = await db
    .collection('tasks')
    .aggregate<{
      total: number;
      done: number;
      remaining: number;
      remainingHours: number;
      unestimated: number;
    }>(
      [
        { $match: { ...parents, deletedAt: null } },
        {
          $lookup: {
            from: 'task_plans',
            let: { task: '$_id' },
            pipeline: [
              {
                $match: { ...parents, sprintId: sprint._id, $expr: { $eq: ['$taskId', '$$task'] } },
              },
            ],
            as: 'plan',
          },
        },
        { $match: { 'plan.0': { $exists: true } } },
        { $set: { plan: { $arrayElemAt: ['$plan', 0] } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
            remaining: { $sum: { $cond: [{ $ne: ['$status', 'done'] }, 1, 0] } },
            remainingHours: {
              $sum: {
                $cond: [{ $ne: ['$status', 'done'] }, { $ifNull: ['$plan.estimateHours', 0] }, 0],
              },
            },
            unestimated: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$status', 'done'] },
                      { $eq: [{ $ifNull: ['$plan.estimateHours', null] }, null] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ],
      { session, maxTimeMS: 3000 },
    )
    .toArray();
  const values = {
    total: totals?.total ?? 0,
    done: totals?.done ?? 0,
    remaining: totals?.remaining ?? 0,
    remainingHours: Math.round((totals?.remainingHours ?? 0) * 100) / 100,
    unestimated: totals?.unestimated ?? 0,
  };
  const model = observationModel(connection),
    previous = await model
      .findOne({ ...parents, sprintId: sprint._id })
      .sort({ observedAt: -1, _id: -1 })
      .session(session)
      .lean();
  if (
    !force &&
    previous &&
    Object.entries(values).every(([key, value]) => previous[key as keyof typeof values] === value)
  )
    return;
  await model.create(
    [{ ...parents, sprintId: sprint._id, source, observedAt: new Date(), ...values }],
    { session },
  );
}
