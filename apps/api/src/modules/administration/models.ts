import { Schema, Types, type Connection, type Model, type ClientSession } from 'mongoose';
import type { z } from 'zod';
import type { auditCategorySchema } from '@orbit/contracts';
export interface AuditRecord {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId | null;
  category: z.infer<typeof auditCategorySchema>;
  action: string;
  resourceId: Types.ObjectId;
  createdAt: Date;
  expiresAt: Date;
}
export interface Preferences {
  _id: Types.ObjectId;
  mentions: boolean;
  taskComments: boolean;
  version: number;
  deliveryRevision: number;
}
export interface Integration {
  _id: Types.ObjectId;
  calendarEnabled: boolean;
  version: number;
}
export function administrationModels(c: Connection): {
  audit: Model<AuditRecord>;
  preferences: Model<Preferences>;
  integration: Model<Integration>;
} {
  const id = { type: Schema.Types.ObjectId, required: true };
  const options = { autoIndex: false, bufferCommands: false };
  const audit = new Schema<AuditRecord>(
    {
      organizationId: id,
      actorId: { type: Schema.Types.ObjectId, default: null },
      category: String,
      action: String,
      resourceId: id,
      createdAt: Date,
      expiresAt: Date,
    },
    { ...options, collection: 'audit_logs' },
  );
  audit.index({ organizationId: 1, _id: -1 });
  audit.index({ organizationId: 1, category: 1, _id: -1 });
  audit.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  const preferences = new Schema<Preferences>(
    {
      _id: id,
      mentions: { type: Boolean, default: true },
      taskComments: { type: Boolean, default: true },
      version: { type: Number, default: 0 },
      deliveryRevision: { type: Number, default: 0 },
    },
    { ...options, collection: 'notification_preferences' },
  );
  const integration = new Schema<Integration>(
    {
      _id: id,
      calendarEnabled: { type: Boolean, default: false },
      version: { type: Number, default: 0 },
    },
    { ...options, collection: 'organization_integrations' },
  );
  return {
    audit:
      (c.models.AdministrationAudit as Model<AuditRecord> | undefined) ??
      c.model<AuditRecord>('AdministrationAudit', audit),
    preferences:
      (c.models.NotificationPreferences as Model<Preferences> | undefined) ??
      c.model<Preferences>('NotificationPreferences', preferences),
    integration:
      (c.models.OrganizationIntegration as Model<Integration> | undefined) ??
      c.model<Integration>('OrganizationIntegration', integration),
  };
}
const initialized = new WeakMap<Connection, Promise<void>>();
export async function readyAdministration(c: Connection) {
  let p = initialized.get(c);
  if (!p) {
    p = (async () => {
      const models = Object.values(administrationModels(c));
      await Promise.all(models.map((m) => m.createCollection()));
      await Promise.all(models.map((m) => m.createIndexes()));
    })().catch((e) => {
      initialized.delete(c);
      throw e;
    });
    initialized.set(c, p);
  }
  await p;
}
export async function recordAudit(
  c: Connection,
  organizationId: string,
  actorId: string | null,
  category: AuditRecord['category'],
  action: string,
  resourceId: string,
  session: ClientSession,
) {
  await administrationModels(c).audit.create(
    [
      {
        organizationId,
        actorId,
        category,
        action,
        resourceId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 180 * 86400000),
      },
    ],
    { session },
  );
}
export async function notificationPreferences(c: Connection, user: string, session: ClientSession) {
  const model = administrationModels(c).preferences;
  await model.updateOne(
    { _id: user },
    {
      $setOnInsert: { mentions: true, taskComments: true, version: 0 },
      $inc: { deliveryRevision: 1 },
    },
    { upsert: true, session },
  );
  return (await model.findById(user).session(session).lean())!;
}
