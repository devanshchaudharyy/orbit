import { planLimits, type BillingPlan } from '@orbit/contracts';
import { Types, type Connection, type ClientSession } from 'mongoose';
import { billingModels, readyBilling, type BillingAccount } from './models.js';
import { AuthError } from '../auth/errors.js';
export function effectivePlan(
  account:
    | (Pick<BillingAccount, 'plan' | 'status' | 'periodEnd' | 'trialEnd'> & {
        entitlementsHold?: boolean;
      })
    | null,
  now = new Date(),
): BillingPlan {
  if (!account || account.entitlementsHold || !['pro', 'business'].includes(account.plan))
    return 'free';
  const end = account.status === 'trialing' ? account.trialEnd : account.periodEnd;
  return ['active', 'trialing'].includes(account.status) && !!end && end > now
    ? (account.plan as BillingPlan)
    : 'free';
}
export async function billingEntitlements(
  connection: Connection,
  organizationId: string,
  session?: ClientSession,
) {
  const models = billingModels(connection);
  const row = session
    ? await models.accounts
        .findOneAndUpdate(
          { _id: organizationId },
          { $inc: { revision: 1 } },
          { session, returnDocument: 'after' },
        )
        .lean()
    : await models.accounts.findById(organizationId).lean();
  if (session && !row)
    await models.accounts.create([{ _id: new Types.ObjectId(organizationId) }], { session });
  const plan = effectivePlan(row);
  return { plan, limits: planLimits[plan] };
}
export async function requireBillingFeature(
  connection: Connection,
  org: string,
  feature: 'csvExport' | 'scheduledWorkflows',
  session?: ClientSession,
) {
  const entitlements = await billingEntitlements(connection, org, session);
  if (!entitlements.limits[feature])
    throw new AuthError(
      402,
      'PLAN_REQUIRED',
      `${feature === 'csvExport' ? 'CSV exports' : 'Scheduled AI workflows'} require an active Pro or Business plan. Open organization Billing.`,
    );
  if (feature === 'scheduledWorkflows') {
    const count = await connection
      .collection('ai_workflows')
      .countDocuments(
        { organizationId: new Types.ObjectId(org), enabled: true, deletedAt: null },
        session ? { session } : {},
      );
    if (count > entitlements.limits.scheduledWorkflows)
      throw new AuthError(
        402,
        'PLAN_LIMIT_REACHED',
        'Too many schedules are enabled for the current plan. Pause schedules in the organization before running automation.',
      );
  }
  return entitlements;
}
export async function enforceResourceLimit(
  connection: Connection,
  org: string,
  kind: 'workspaces' | 'projects',
  session: ClientSession,
) {
  const current = await billingEntitlements(connection, org, session);
  const count = await connection.collection(kind).countDocuments(
    {
      organizationId: new Types.ObjectId(org),
      ...(kind === 'projects' ? { deletedAt: null } : {}),
    },
    { session },
  );
  if (count >= current.limits[kind])
    throw new AuthError(
      402,
      'PLAN_LIMIT_REACHED',
      `Your ${current.plan} plan allows ${current.limits[kind]} ${kind}. Remove a resource or open organization Billing.`,
    );
}
export { readyBilling };
