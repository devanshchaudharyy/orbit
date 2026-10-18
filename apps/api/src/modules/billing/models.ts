import { Schema, type Connection, type InferSchemaType } from 'mongoose';
const accountSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, required: true },
    customerId: { type: String, default: null },
    customerRequestedAt: { type: Date, default: null },
    subscriptionId: { type: String, default: null },
    plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
    status: { type: String, default: 'free' },
    interval: { type: String, default: null },
    periodEnd: { type: Date, default: null },
    trialEnd: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    trialUsed: { type: Boolean, default: false },
    entitlementsHold: { type: Boolean, default: false },
    revision: { type: Number, default: 0 },
    syncLease: { type: String, default: null },
    syncUntil: { type: Date, default: null },
    syncedAt: { type: Date, default: null },
    pendingKey: { type: String, default: null },
    pendingUntil: { type: Date, default: null },
  },
  { timestamps: true, collection: 'billing_accounts' },
);
accountSchema.index(
  { customerId: 1 },
  { unique: true, partialFilterExpression: { customerId: { $type: 'string' } } },
);
const operationSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    requestId: { type: String, required: true },
    fingerprint: { type: String, required: true },
    quoteId: { type: String, required: true },
    plan: { type: String, required: true },
    interval: { type: String, required: true },
    trial: { type: Boolean, required: true },
    sessionId: { type: String, default: null },
    url: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'billing_operations' },
);
operationSchema.index({ organizationId: 1, requestId: 1 }, { unique: true });
const eventSchema = new Schema(
  {
    eventId: { type: String, required: true },
    hash: { type: String, required: true },
    organizationId: { type: Schema.Types.ObjectId, default: null },
    type: { type: String, required: true },
  },
  { timestamps: true, collection: 'billing_events' },
);
eventSchema.index({ eventId: 1 }, { unique: true });
eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });
const invoiceSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    providerId: { type: String, required: true },
    number: { type: String, default: null },
    status: { type: String, required: true },
    currency: { type: String, required: true },
    amountDue: { type: Number, required: true },
    amountPaid: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    hostedUrl: { type: String, default: null },
  },
  { timestamps: true, collection: 'billing_invoices' },
);
invoiceSchema.index({ providerId: 1 }, { unique: true });
invoiceSchema.index({ organizationId: 1, _id: -1 });
export type BillingAccount = InferSchemaType<typeof accountSchema>;
export function billingModels(connection: Connection) {
  return {
    accounts:
      (connection.models.BillingAccount as unknown as ReturnType<typeof makeAccount>) ??
      makeAccount(),
    operations:
      (connection.models.BillingOperation as unknown as ReturnType<typeof makeOperation>) ??
      makeOperation(),
    events:
      (connection.models.BillingEvent as unknown as ReturnType<typeof makeEvent>) ?? makeEvent(),
    invoices:
      (connection.models.BillingInvoice as unknown as ReturnType<typeof makeInvoice>) ??
      makeInvoice(),
  };
  function makeAccount() {
    return connection.model('BillingAccount', accountSchema);
  }
  function makeOperation() {
    return connection.model('BillingOperation', operationSchema);
  }
  function makeEvent() {
    return connection.model('BillingEvent', eventSchema);
  }
  function makeInvoice() {
    return connection.model('BillingInvoice', invoiceSchema);
  }
}
const readyConnections = new WeakMap<Connection, Promise<void>>();
export async function readyBilling(connection: Connection) {
  let ready = readyConnections.get(connection);
  if (!ready) {
    ready = (async () => {
      const models = billingModels(connection);
      await Promise.all(Object.values(models).map((m) => m.createCollection()));
      await Promise.all(Object.values(models).map((m) => m.createIndexes()));
    })().catch((e: unknown) => {
      readyConnections.delete(connection);
      throw e;
    });
    readyConnections.set(connection, ready);
  }
  await ready;
}
