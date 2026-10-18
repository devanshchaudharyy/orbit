import { Types, type ClientSession } from 'mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { billingHistorySchema, billingStatusSchema, type CheckoutInput } from '@orbit/contracts';
import { MongoTenantRepository } from '../tenants/repository.js';
import { AuthError } from '../auth/errors.js';
import { billingModels, readyBilling } from './models.js';
import { billingEntitlements } from './policy.js';
import type { Snapshot } from './provider.js';
import { recordAudit } from '../administration/models.js';
export const billingError = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
export const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(value, (_key, entry: unknown) =>
            entry && typeof entry === 'object' && !Array.isArray(entry)
              ? Object.fromEntries(
                  Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
                )
              : entry,
          ),
    )
    .digest('hex');
export class BillingRepository {
  readonly models;
  readonly connection;
  constructor(readonly tenants: MongoTenantRepository) {
    this.connection = tenants.connection;
    this.models = billingModels(this.connection);
  }
  async ready() {
    await this.tenants.ready();
    await readyBilling(this.connection);
  }
  async access(actor: string, org: string, owner = false, session?: ClientSession) {
    const result = await this.tenants.organizationAccess(actor, org, session, true);
    if (owner && result.member.role !== 'owner')
      throw billingError(
        403,
        'BILLING_OWNER_REQUIRED',
        'Only an organization owner can open checkout or manage a subscription.',
      );
    return result;
  }
  async account(org: string) {
    return this.models.accounts
      .findOneAndUpdate(
        { _id: org },
        { $setOnInsert: { _id: new Types.ObjectId(org) } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean();
  }
  async summary(actor: string, org: string) {
    await this.tenants.organizationAccess(actor, org);
    return billingEntitlements(this.connection, org);
  }
  async history(actor: string, org: string, cursor?: string) {
    await this.access(actor, org);
    const rows = await this.models.invoices
      .find({ organizationId: org, ...(cursor ? { _id: { $lt: cursor } } : {}) })
      .sort({ _id: -1 })
      .limit(21)
      .lean();
    return billingHistorySchema.parse({
      invoices: rows.slice(0, 20).map((row) => ({
        id: String(row._id),
        number: row.number,
        status: row.status,
        currency: row.currency,
        amountDue: row.amountDue,
        amountPaid: row.amountPaid,
        createdAt: row.issuedAt.toISOString(),
        hostedUrl: row.hostedUrl,
      })),
      nextCursor: rows.length > 20 ? String(rows[19]!._id) : null,
    });
  }
  async dashboard(actor: string, org: string) {
    const { member } = await this.access(actor, org);
    const account = await this.account(org),
      entitlements = await billingEntitlements(this.connection, org);
    const pending =
      member.role === 'owner' &&
      account.pendingKey &&
      account.pendingUntil &&
      account.pendingUntil > new Date()
        ? await this.models.operations
            .findOne({ organizationId: org, requestId: account.pendingKey })
            .lean()
        : null;
    const organizationId = new Types.ObjectId(org);
    return {
      ...entitlements,
      canManage: member.role === 'owner',
      entitlementsHold: account.entitlementsHold,
      pendingCheckout: pending
        ? {
            requestId: pending.requestId,
            quoteId: pending.quoteId,
            plan: pending.plan,
            interval: pending.interval,
            trial: pending.trial,
            expiresAt: pending.expiresAt.toISOString(),
          }
        : null,
      status: account.status,
      subscriptionPlan: account.plan,
      interval: account.interval,
      periodEnd: account.periodEnd?.toISOString() ?? null,
      trialEnd: account.trialEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      trialUsed: account.trialUsed,
      syncedAt: account.syncedAt?.toISOString() ?? null,
      usage: {
        workspaces: await this.connection
          .collection('workspaces')
          .countDocuments({ organizationId }),
        projects: await this.connection
          .collection('projects')
          .countDocuments({ organizationId, deletedAt: null }),
        scheduledWorkflows: await this.connection
          .collection('ai_workflows')
          .countDocuments({ organizationId, enabled: true, deletedAt: null }),
      },
      history: await this.history(actor, org),
    };
  }
  async prepareCheckout(actor: string, org: string, input: CheckoutInput) {
    return this.connection.transaction(async (session) => {
      await this.access(actor, org, true, session);
      const row = await this.models.accounts.findById(org).session(session).lean();
      if (!row)
        throw billingError(503, 'BILLING_RETRY', 'Refresh billing before starting checkout.');
      if (row.subscriptionId && !['canceled', 'incomplete_expired'].includes(row.status))
        throw billingError(
          409,
          'BILLING_SUBSCRIPTION_EXISTS',
          'Manage the existing subscription in the billing portal.',
        );
      const operation = await this.models.operations
          .findOne({ organizationId: org, requestId: input.requestId })
          .session(session)
          .lean(),
        hash = fingerprint(input);
      if (operation) {
        if (operation.fingerprint !== hash)
          throw billingError(
            409,
            'BILLING_REQUEST_CONFLICT',
            'This request was already used for different checkout choices.',
          );
        if (operation.expiresAt <= new Date())
          throw billingError(
            409,
            'BILLING_CHECKOUT_EXPIRED',
            'This checkout request expired. Refresh billing and start again.',
          );
        return operation;
      }
      if (row.syncUntil && row.syncUntil > new Date())
        throw billingError(409, 'BILLING_BUSY', 'Billing is refreshing. Retry shortly.');
      if (row.pendingKey && row.pendingUntil && row.pendingUntil > new Date())
        throw billingError(
          409,
          'BILLING_CHECKOUT_PENDING',
          'Another checkout is pending. Retry its original request or wait for it to expire.',
        );
      if (input.trial && row.trialUsed)
        throw billingError(409, 'BILLING_TRIAL_USED', 'This organization already used its trial.');
      if (
        !row.customerId &&
        row.customerRequestedAt &&
        Date.now() - row.customerRequestedAt.getTime() > 23 * 3600000
      )
        throw billingError(
          409,
          'BILLING_CUSTOMER_RECONCILE',
          'A previous customer request needs manual provider reconciliation before another checkout.',
        );
      const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 31 * 60000);
      await this.models.accounts.updateOne(
        { _id: org },
        {
          $set: {
            pendingKey: input.requestId,
            pendingUntil: expiresAt,
            ...(!row.customerId && !row.customerRequestedAt
              ? { customerRequestedAt: new Date() }
              : {}),
          },
          $inc: { revision: 1 },
        },
        { session },
      );
      const [created] = await this.models.operations.create(
        [
          {
            organizationId: org,
            requestId: input.requestId,
            fingerprint: hash,
            quoteId: input.quoteId,
            plan: input.plan,
            interval: input.interval,
            trial: input.trial,
            expiresAt,
          },
        ],
        { session },
      );
      return created!.toObject();
    });
  }
  async saveCustomer(org: string, id: string) {
    await this.models.accounts.updateOne(
      { _id: org, customerId: null },
      { $set: { customerId: id }, $inc: { revision: 1 } },
    );
    const current = await this.account(org);
    if (current.customerId !== id)
      throw billingError(
        409,
        'BILLING_CUSTOMER_CONFLICT',
        'Billing customer requires reconciliation.',
      );
  }
  async saveCheckout(
    actor: string,
    org: string,
    input: CheckoutInput,
    result: { id: string; url: string; expiresAt: Date },
  ) {
    return this.connection.transaction(async (session) => {
      await this.access(actor, org, true, session);
      await this.models.operations.updateOne(
        { organizationId: org, requestId: input.requestId },
        { $set: { sessionId: result.id, url: result.url, expiresAt: result.expiresAt } },
        { session },
      );
      await recordAudit(this.connection, org, actor, 'billing', 'checkout.confirmed', org, session);
      await this.models.accounts.updateOne(
        { _id: org, pendingKey: input.requestId },
        {
          $set: { pendingUntil: result.expiresAt, ...(input.trial ? { trialUsed: true } : {}) },
          $inc: { revision: 1 },
        },
        { session },
      );
    });
  }
  async lease(org: string) {
    const token = randomUUID();
    const row = await this.models.accounts
      .findOneAndUpdate(
        { _id: org, $or: [{ syncUntil: null }, { syncUntil: { $lte: new Date() } }] },
        {
          $set: { syncLease: token, syncUntil: new Date(Date.now() + 90000) },
          $inc: { revision: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean();
    if (!row)
      throw billingError(503, 'BILLING_BUSY', 'Billing synchronization is busy. Please retry.');
    return { token, row };
  }
  async release(org: string, token: string) {
    await this.models.accounts.updateOne(
      { _id: org, syncLease: token },
      { $set: { syncLease: null, syncUntil: null } },
    );
  }
  async storeSnapshot(
    org: string,
    token: string,
    snapshot: Snapshot,
    event?: { id: string; type: string; hash: string },
  ) {
    billingStatusSchema.parse(snapshot.status);
    await this.connection.transaction(async (session) => {
      const current = await this.models.accounts
        .findOne({ _id: org, syncLease: token, syncUntil: { $gt: new Date() } })
        .session(session)
        .lean();
      if (!current)
        throw billingError(503, 'BILLING_LEASE_EXPIRED', 'Billing refresh expired. Please retry.');
      const { invoices, ...values } = snapshot;
      if (
        current.plan !== snapshot.plan ||
        current.status !== snapshot.status ||
        current.cancelAtPeriodEnd !== snapshot.cancelAtPeriodEnd
      )
        await recordAudit(
          this.connection,
          org,
          null,
          'billing',
          'subscription.synchronized',
          org,
          session,
        );
      await this.models.accounts.updateOne(
        { _id: org, syncLease: token },
        {
          $set: {
            ...values,
            entitlementsHold: false,
            syncedAt: new Date(),
            trialUsed: current.trialUsed || !!snapshot.trialEnd,
            ...(snapshot.subscriptionId &&
            !['canceled', 'incomplete_expired'].includes(snapshot.status)
              ? { pendingKey: null, pendingUntil: null }
              : {}),
          },
          $inc: { revision: 1 },
        },
        { session },
      );
      for (const invoice of invoices)
        await this.models.invoices.updateOne(
          { providerId: invoice.providerId },
          { $set: { organizationId: new Types.ObjectId(org), ...invoice } },
          { upsert: true, session },
        );
      if (event)
        await this.models.events.create(
          [{ eventId: event.id, type: event.type, hash: event.hash, organizationId: org }],
          { session },
        );
    });
  }
}
