import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { MongoClient, ObjectId } = require('mongoose').mongo;
async function database(uri, operation) {
  const url = new URL(uri);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !/^\/orbit_test(?:_[a-z0-9]+)?$/.test(url.pathname)
  )
    throw new Error('Billing fixtures require an isolated loopback test database');
  const client = new MongoClient(uri);
  try {
    await client.connect();
    return await operation(client.db());
  } finally {
    await client.close();
  }
}
// Explicit paid-state setup for older feature regressions, not provider verification.
export async function seedPaidBillingFixture(uri, org, plan = 'pro') {
  await database(uri, (db) =>
    db.collection('billing_accounts').updateOne(
      { _id: new ObjectId(org) },
      {
        $set: {
          plan,
          status: 'active',
          periodEnd: new Date(Date.now() + 30 * 86400000),
          revision: 0,
          trialUsed: false,
          cancelAtPeriodEnd: false,
          customerId: null,
          subscriptionId: null,
          syncLease: null,
          syncUntil: null,
        },
      },
      { upsert: true },
    ),
  );
}
export async function cleanupBillingFixtures(uri, orgs) {
  if (!orgs.length) return;
  await database(uri, async (db) => {
    const ids = orgs.map((id) => new ObjectId(String(id)));
    await db.collection('billing_accounts').deleteMany({ _id: { $in: ids } });
    await db.collection('organization_integrations').deleteMany({ _id: { $in: ids } });
    for (const name of ['billing_operations', 'billing_invoices', 'billing_events', 'audit_logs'])
      await db.collection(name).deleteMany({ organizationId: { $in: ids } });
  });
}
