import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../apps/api/src/app.js';
import { parseEnvironment } from '../../apps/api/src/config/env.js';
import { createLogger } from '../../apps/api/src/infrastructure/logger.js';
import { MongoAuthRepository } from '../../apps/api/src/modules/auth/repository.js';
import { AuthService } from '../../apps/api/src/modules/auth/service.js';
import { hashPassword } from '../../apps/api/src/modules/auth/crypto.js';
import { MongoTenantRepository } from '../../apps/api/src/modules/tenants/repository.js';
import { TenantService } from '../../apps/api/src/modules/tenants/service.js';
import { ProjectRepository } from '../../apps/api/src/modules/projects/repository.js';
import { ProjectService } from '../../apps/api/src/modules/projects/service.js';
import { BillingRepository } from '../../apps/api/src/modules/billing/repository.js';
import { BillingService } from '../../apps/api/src/modules/billing/service.js';
import { createBillingProvider } from '../../apps/api/src/modules/billing/provider.js';
import { billingModels } from '../../apps/api/src/modules/billing/models.js';
import { AIRepository } from '../../apps/api/src/modules/ai/repository.js';
import { AIService } from '../../apps/api/src/modules/ai/service.js';
import { startStripeFixture, stripeFixtureEnvironment } from '../support/stripe-provider.mjs';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url)),
  mongoose = require('mongoose'),
  request = require('supertest');
const source =
    process.env.ORBIT_AUTH_MONGO_URI ??
    'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true',
  uri = new URL(source);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname));
assert(/^\/orbit_test(?:_[a-z0-9]+)?$/.test(uri.pathname));
uri.pathname = `/orbit_test_billing${randomUUID().replaceAll('-', '')}`;
const connection = await mongoose
    .createConnection(uri.href, { serverSelectionTimeoutMS: 3000 })
    .asPromise(),
  fixture = await startStripeFixture(),
  origin = process.env.ORBIT_AUTH_ORIGIN ?? 'http://127.0.0.1:5174';
const authRepo = new MongoAuthRepository(connection, async () => true),
  tenantRepo = new MongoTenantRepository(connection),
  tenants = new TenantService(tenantRepo),
  projectRepo = new ProjectRepository(tenantRepo),
  projects = new ProjectService(projectRepo),
  repo = new BillingRepository(tenantRepo);
const env = parseEnvironment({
    ...stripeFixtureEnvironment,
    MONGO_URI: uri.href,
    REDIS_URL: 'redis://127.0.0.1:16379',
    APP_ORIGIN: origin,
    NODE_ENV: 'test',
  }),
  provider = createBillingProvider(env, fixture.client),
  billing = new BillingService(repo, provider),
  auth = new AuthService(
    authRepo,
    { available: async () => {}, send: async () => {} },
    {
      APP_ORIGIN: origin,
      NODE_ENV: 'test',
      SESSION_IDLE_MINUTES: 1440,
      SESSION_ABSOLUTE_HOURS: 168,
    },
  );
const app = createApp(
  { check: async () => ({ mongo: true, redis: false }), close: async () => {} },
  createLogger('silent'),
  auth,
  tenants,
  undefined,
  projects,
  undefined,
  undefined,
  undefined,
  billing,
);
const users = Array.from({ length: 5 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId(),
    email: `billing-${randomUUID()}@example.test`,
    name: `Billing fixture ${i}`,
  })),
  ids = users.map((u) => String(u._id)),
  password = `Billing ${randomUUID()}`,
  results: string[] = [],
  orgs: string[] = [];
type Identity = { agent: ReturnType<typeof request.agent>; csrf: string };
async function login(index: number, application = app): Promise<Identity> {
  const agent = request.agent(application),
    session = await agent.get('/api/v1/auth/session').expect(200),
    response = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', session.body.data.csrfToken)
      .send({ email: users[index]!.email, password })
      .expect(200);
  return { agent, csrf: response.body.data.csrfToken };
}
const post = (who: Identity, path: string, data: unknown) =>
  who.agent.post(path).set('Origin', origin).set('X-CSRF-Token', who.csrf).send(data);
async function check(name: string, operation: () => Promise<void>) {
  await operation();
  results.push(name);
  console.log(`PASS ${name}`);
}
let quoteId = '';
const choices = (extra: object = {}) => ({
  quoteId,
  requestId: randomUUID(),
  plan: 'pro',
  interval: 'month',
  trial: false,
  confirmed: true,
  ...extra,
});
async function webhook(
  customer: string,
  type = 'customer.subscription.updated',
  options: object = {},
) {
  const event = fixture.event(customer, type, options);
  return request(app)
    .post('/api/v1/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', event.signature)
    .send(event.body);
}
try {
  await authRepo.ready();
  await repo.ready();
  const passwordHash = await hashPassword(password);
  await authRepo.models.users.insertMany(
    users.map((u, i) => ({
      ...u,
      passwordHash,
      emailVerified: i !== 3,
      onboardingCompleted: i !== 4,
      authRevision: 0,
    })),
  );
  const owner = await login(0),
    admin = await login(1),
    member = await login(2),
    unverified = await login(3),
    incomplete = await login(4);
  const org = (
    await post(owner, '/api/v1/organizations', {
      name: 'Isolated billing verification',
      description: '',
    }).expect(201)
  ).body.data.id;
  orgs.push(org);
  await tenantRepo.models.organizationMemberships.create([
    { organizationId: org, userId: ids[1], role: 'admin' },
    { organizationId: org, userId: ids[2], role: 'member' },
  ]);
  const base = `/api/v1/organizations/${org}/billing`,
    ws = (
      await post(owner, `/api/v1/organizations/${org}/workspaces`, {
        name: 'Billing workspace',
        description: '',
        timezone: 'UTC',
      }).expect(201)
    ).body.data.id,
    scope = { organizationId: org, workspaceId: ws };
  const project = await projectRepo.create(ids[0]!, scope, {
    name: 'Billing verification project',
    description: 'Synthetic integration fixture',
    cover: 'orbit',
    status: 'active',
    priority: 'normal',
    ownerId: ids[0]!,
    memberIds: [],
    template: 'blank',
  });
  await check(
    'free plan and actual usage are returned without seeded subscriptions or invoices',
    async () => {
      const response = await owner.agent.get(base).expect(200);
      quoteId = response.body.data.quoteId;
      assert.equal(response.body.data.plan, 'free');
      assert.equal(response.body.data.usage.workspaces, 1);
      assert.equal(response.body.data.usage.projects, 1);
      assert.equal(response.body.data.history.invoices.length, 0);
      assert.equal(response.body.data.prices.length, 4);
      assert(response.body.meta.requestId);
    },
  );
  await check(
    'billing details require current owner/admin membership and verified complete accounts',
    async () => {
      await member.agent.get(base).expect(403);
      await unverified.agent.get(base).expect(403);
      await incomplete.agent.get(base).expect(403);
      await request(app).get(base).expect(401);
      await owner.agent
        .get(`/api/v1/organizations/${new mongoose.Types.ObjectId()}/billing`)
        .expect(404);
      await admin.agent.get(base).expect(200);
      const limited = await member.agent.get(`${base}/entitlements`).expect(200);
      assert.deepEqual(Object.keys(limited.body.data).sort(), ['limits', 'plan']);
    },
  );
  await check(
    'checkout and portal require the organization owner, Origin, CSRF and explicit strict confirmation',
    async () => {
      await post(admin, `${base}/checkout`, choices()).expect(403);
      await post(member, `${base}/checkout`, choices()).expect(403);
      await owner.agent.post(`${base}/checkout`).send(choices()).expect(403);
      await post(owner, `${base}/checkout`, choices({ confirmed: false })).expect(400);
      await post(owner, `${base}/checkout`, choices({ priceId: 'price_untrusted' })).expect(400);
      await post(owner, `${base}/portal`, {}).expect(400);
      assert.equal(fixture.customers.size, 0);
    },
  );
  await check(
    'unconfigured billing remains readable and never creates a fake checkout',
    async () => {
      const disabled = createApp(
          { check: async () => ({ mongo: true, redis: false }), close: async () => {} },
          createLogger('silent'),
          auth,
          tenants,
        ),
        who = await login(0, disabled);
      const response = await who.agent.get(base).expect(200);
      assert.equal(response.body.data.configured, false);
      await post(who, `${base}/checkout`, choices()).expect(503);
      assert.equal(fixture.customers.size, 0);
    },
  );
  const input = choices({ trial: true });
  await check(
    'checkout rejects a stale displayed price quote before creating provider resources',
    async () => {
      await post(owner, `${base}/checkout`, choices({ quoteId: '0'.repeat(64) })).expect(409);
      assert.equal(fixture.customers.size, 0);
      assert.equal(fixture.sessions.size, 0);
    },
  );
  await check(
    'real Stripe SDK HTTP transport creates quantity-one test checkout with stable server-selected parameters',
    async () => {
      const response = await post(owner, `${base}/checkout`, input).expect(200);
      assert(response.body.data.url.startsWith('https://checkout.stripe.com/'));
      assert.equal(fixture.customers.size, 1);
      assert.equal(fixture.sessions.size, 1);
      const call = fixture.requests.find((r) => r.path === '/v1/checkout/sessions');
      assert(call);
      assert.equal(call.params.get('mode'), 'subscription');
      assert.equal(call.params.get('line_items[0][price]'), 'price_fixtureProMonth');
      assert.equal(call.params.get('line_items[0][quantity]'), '1');
      assert.equal(call.params.get('subscription_data[trial_period_days]'), '14');
      assert.equal(
        call.params.get('success_url'),
        `${origin}/app/organizations/${org}/billing?checkout=returned`,
      );
    },
  );
  const customer = (await repo.account(org)).customerId!;
  await check(
    'exact checkout retries recover the existing session without duplicate customer or subscription intents',
    async () => {
      await post(owner, `${base}/checkout`, input).expect(200);
      assert.equal(fixture.customers.size, 1);
      assert.equal(fixture.sessions.size, 1);
      await post(owner, `${base}/checkout`, { ...input, plan: 'business' }).expect(409);
      await post(owner, `${base}/checkout`, choices()).expect(409);
      const dashboard = (await owner.agent.get(base).expect(200)).body.data;
      assert.equal(dashboard.pendingCheckout.requestId, input.requestId);
      assert.equal(dashboard.trialUsed, true);
      assert.equal(dashboard.plan, 'free');
    },
  );
  await check(
    'raw signed webhooks synchronize canonical provider state instead of trusting the event payload',
    async () => {
      fixture.setSubscription(customer, { status: 'trialing', trial: true });
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      const dashboard = (await owner.agent.get(base).expect(200)).body.data;
      assert.equal(dashboard.plan, 'pro');
      assert.equal(dashboard.status, 'trialing');
      assert.equal(dashboard.history.invoices.length, 1);
      assert.equal(dashboard.pendingCheckout, null);
    },
  );
  await check(
    'processed webhook duplicates acknowledge once without repeating provider retrieval or invoice writes',
    async () => {
      const event = fixture.event(customer),
        send = () =>
          request(app)
            .post('/api/v1/webhooks/stripe')
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', event.signature)
            .send(event.body);
      await send().expect(200);
      const calls = fixture.requests.length;
      await send().expect(200);
      assert.equal(fixture.requests.length, calls);
      assert.equal(await repo.models.invoices.countDocuments({ organizationId: org }), 1);
    },
  );
  await check(
    'invalid signatures, live events and connected-account scope are rejected before state changes',
    async () => {
      await request(app)
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', 'invalid')
        .send('{}')
        .expect(400);
      await webhook(customer, 'customer.subscription.updated', { livemode: true }).then((r) =>
        assert.equal(r.status, 400),
      );
      await webhook(customer, 'customer.subscription.updated', { account: 'acct_foreign' }).then(
        (r) => assert.equal(r.status, 400),
      );
    },
  );
  await check('reused event identities with altered signed payloads are rejected', async () => {
    const id = `evt_fixture${randomUUID()}`;
    await webhook(customer, 'customer.subscription.updated', { id }).then((r) =>
      assert.equal(r.status, 200),
    );
    await webhook(customer, 'invoice.paid', { id }).then((r) => assert.equal(r.status, 400));
  });
  await check(
    'old event payloads cannot undo a newer canonical plan and foreign customers cannot change an organization',
    async () => {
      fixture.setSubscription(customer, { plan: 'business' });
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      await webhook('cus_unknown').then((r) => assert.equal(r.status, 200));
      assert.equal((await repo.dashboard(ids[0]!, org)).plan, 'business');
    },
  );
  await check(
    'active cancel-at-period-end preserves access while canceled and failed-payment states use Free limits',
    async () => {
      fixture.setSubscription(customer, { plan: 'business', cancelAtPeriodEnd: true });
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      assert.equal((await repo.dashboard(ids[0]!, org)).plan, 'business');
      for (const status of ['past_due', 'unpaid', 'paused', 'canceled']) {
        fixture.setSubscription(customer, { status });
        await webhook(customer).then((r) => assert.equal(r.status, 200));
        assert.equal((await repo.dashboard(ids[0]!, org)).plan, 'free');
      }
    },
  );
  await check(
    'expired trials fail closed and do not reset one-time trial eligibility',
    async () => {
      fixture.setSubscription(customer, { status: 'trialing', trial: true, expired: true });
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      const data = await repo.dashboard(ids[0]!, org);
      assert.equal(data.plan, 'free');
      assert.equal(data.trialUsed, true);
    },
  );
  await check(
    'concurrent resource creation serializes plan limits inside actual MongoDB transactions',
    async () => {
      await tenantRepo.createWorkspace(ids[0]!, org, {
        name: 'Second space',
        description: '',
        timezone: 'UTC',
      });
      const calls = await Promise.allSettled([
        tenantRepo.createWorkspace(ids[0]!, org, {
          name: 'Third space',
          description: '',
          timezone: 'UTC',
        }),
        tenantRepo.createWorkspace(ids[0]!, org, {
          name: 'Fourth space',
          description: '',
          timezone: 'UTC',
        }),
      ]);
      assert.equal(calls.filter((r) => r.status === 'fulfilled').length, 1);
      const denied = calls.find((r) => r.status === 'rejected');
      assert(denied?.status === 'rejected');
      assert.equal(denied.reason.code, 'PLAN_LIMIT_REACHED');
      assert.equal(await tenantRepo.models.workspaces.countDocuments({ organizationId: org }), 3);
    },
  );
  await check(
    'upgrades allow additional resources and downgrades retain existing readable/editable data',
    async () => {
      fixture.setSubscription(customer, { plan: 'pro' });
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      await tenantRepo.createWorkspace(ids[0]!, org, {
        name: 'Paid space',
        description: '',
        timezone: 'UTC',
      });
      fixture.setSubscription(customer, { status: 'canceled' });
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      await assert.rejects(
        tenantRepo.createWorkspace(ids[0]!, org, {
          name: 'Over limit',
          description: '',
          timezone: 'UTC',
        }),
        { code: 'PLAN_LIMIT_REACHED' },
      );
      const old = await tenantRepo.getWorkspace(ids[0]!, org, ws);
      await tenantRepo.updateWorkspace(ids[0]!, org, ws, {
        name: 'Retained after downgrade',
        description: '',
        timezone: 'UTC',
        version: old.version,
      });
      assert.equal(await tenantRepo.models.workspaces.countDocuments({ organizationId: org }), 4);
    },
  );
  await check(
    'Free plans deny CSV exports and enabled AI schedules while allowing core dashboards and paused drafts',
    async () => {
      const day = new Date().toISOString().slice(0, 10),
        projectBase = `/api/v1/organizations/${org}/workspaces/${ws}/projects/${project.id}`;
      await owner.agent.get(`${projectBase}/analytics?from=${day}&to=${day}`).expect(200);
      await owner.agent
        .get(`${projectBase}/analytics/export?from=${day}&to=${day}&dataset=tasks`)
        .expect(402);
      const workflow = {
        name: 'Explicit billing fixture',
        mode: 'weekly-report',
        frequency: 'weekly',
        weekday: 1,
        hour: 9,
        enabled: true,
        confirmed: true,
      };
      await post(owner, `${projectBase}/ai/workflows`, workflow).expect(402);
      await post(owner, `${projectBase}/ai/workflows`, { ...workflow, enabled: false }).expect(200);
      fixture.setSubscription(customer, { plan: 'pro' });
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      await owner.agent
        .get(`${projectBase}/analytics/export?from=${day}&to=${day}&dataset=tasks`)
        .expect(200);
      await post(owner, `${projectBase}/ai/workflows`, workflow).expect(200);
    },
  );
  await check('downgrades stop queued AI inference before the model is called', async () => {
    const aiRepo = new AIRepository(projectRepo);
    await aiRepo.ready();
    const workflow = await aiRepo.models.workflows
      .findOne({ organizationId: org, enabled: true })
      .lean();
    assert(workflow);
    const due = new Date(Date.now() - 1000);
    await aiRepo.models.workflows.updateOne({ _id: workflow._id }, { $set: { nextRunAt: due } });
    fixture.setSubscription(customer, { status: 'canceled' });
    await webhook(customer).then((r) => assert.equal(r.status, 200));
    let calls = 0;
    const ai = new AIService(aiRepo, {
      configured: true,
      name: 'Explicit unused billing fixture',
      model: 'fixture',
      generate: async () => {
        calls++;
        throw new Error('Model must not run');
      },
    });
    await ai.executeWorkflow(String(workflow._id), workflow.version, due.toISOString());
    assert.equal(calls, 0);
    assert((await aiRepo.models.workflows.findById(workflow._id).lean())?.lastError);
  });
  await check(
    'busy synchronization returns a retryable error and never marks an unprocessed webhook delivered',
    async () => {
      const { token } = await repo.lease(org),
        event = fixture.event(customer);
      const send = () =>
        request(app)
          .post('/api/v1/webhooks/stripe')
          .set('Content-Type', 'application/json')
          .set('Stripe-Signature', event.signature)
          .send(event.body);
      await send().expect(503);
      assert.equal(
        await repo.models.events.countDocuments({ eventId: JSON.parse(event.body).id }),
        0,
      );
      await repo.release(org, token);
      await send().expect(200);
    },
  );
  await check(
    'provider outage preserves durable entitlements and does not acknowledge an uncommitted event',
    async () => {
      fixture.setFail(true);
      const event = fixture.event(customer);
      await request(app)
        .post('/api/v1/webhooks/stripe')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', event.signature)
        .send(event.body)
        .expect(503);
      assert.equal(
        await repo.models.events.countDocuments({ eventId: JSON.parse(event.body).id }),
        0,
      );
      const dashboard = await owner.agent.get(base).expect(200);
      assert(dashboard.body.data.providerMessage);
      fixture.setFail(false);
    },
  );
  await check(
    'invoice failure rolls back subscription changes and event identity together',
    async () => {
      fixture.setSubscription(customer, { plan: 'business' });
      const original = repo.models.invoices.updateOne;
      repo.models.invoices.updateOne = (() => {
        throw new Error('Explicit invoice rollback fixture');
      }) as typeof original;
      const event = fixture.event(customer),
        send = () =>
          request(app)
            .post('/api/v1/webhooks/stripe')
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', event.signature)
            .send(event.body);
      try {
        await send().expect(503);
      } finally {
        repo.models.invoices.updateOne = original;
      }
      assert.equal((await repo.dashboard(ids[0]!, org)).plan, 'free');
      assert.equal(
        await repo.models.events.countDocuments({ eventId: JSON.parse(event.body).id }),
        0,
      );
      await send().expect(200);
      assert.equal((await repo.dashboard(ids[0]!, org)).plan, 'business');
    },
  );
  await check(
    'owners manage actual hosted portal sessions while administrators cannot open them',
    async () => {
      await post(admin, `${base}/portal`, { confirmed: true }).expect(403);
      const response = await post(owner, `${base}/portal`, { confirmed: true }).expect(200);
      assert(response.body.data.url.startsWith('https://billing.stripe.com/'));
      await post(owner, `${base}/checkout`, choices()).expect(409);
    },
  );
  await check(
    'billing history paginates owned records without exposing provider/customer secrets',
    async () => {
      await repo.models.invoices.insertMany(
        Array.from({ length: 22 }, (_, i) => ({
          organizationId: org,
          providerId: `in_fixture_${randomUUID()}_${i}`,
          number: `FIXTURE-${i}`,
          status: 'paid',
          currency: 'usd',
          amountDue: 100,
          amountPaid: 100,
          issuedAt: new Date(),
          hostedUrl: null,
        })),
      );
      const first = (await owner.agent.get(`${base}/history`).expect(200)).body.data,
        second = (await owner.agent.get(`${base}/history?cursor=${first.nextCursor}`).expect(200))
          .body.data;
      assert.equal(first.invoices.length, 20);
      assert.equal(second.invoices.length, 3);
      assert.equal(new Set([...first.invoices, ...second.invoices].map((i) => i.id)).size, 23);
      assert(!JSON.stringify(first).includes(customer));
      await owner.agent.get(`${base}/history?unknown=1`).expect(400);
    },
  );
  await check(
    'fresh database connections retain the current subscription and private invoice history',
    async () => {
      const fresh = await mongoose.createConnection(uri.href).asPromise();
      try {
        const models = billingModels(fresh);
        assert.equal((await models.accounts.findById(org).lean())?.plan, 'business');
        assert.equal(await models.invoices.countDocuments({ organizationId: org }), 23);
      } finally {
        await fresh.close();
      }
    },
  );
  await check(
    'revoked organization membership denies retained billing data and provider management',
    async () => {
      await tenantRepo.models.organizationMemberships.deleteOne({
        organizationId: org,
        userId: ids[1],
      });
      await admin.agent.get(base).expect(404);
      await post(admin, `${base}/portal`, { confirmed: true }).expect(404);
    },
  );
  await check(
    'unsupported canonical subscription quantities hold paid access until valid reconciliation',
    async () => {
      const current = fixture.snapshots.get(customer)!;
      current.subscription.items.data[0].quantity = 2;
      await webhook(customer).then((r) => assert.equal(r.status, 503));
      assert.equal((await repo.dashboard(ids[0]!, org)).plan, 'free');
      assert.equal((await repo.account(org)).entitlementsHold, true);
      current.subscription.items.data[0].quantity = 1;
      await webhook(customer).then((r) => assert.equal(r.status, 200));
      assert.equal((await repo.dashboard(ids[0]!, org)).plan, 'business');
    },
  );
  const retryOrg = await tenantRepo.createOrganization(ids[0]!, {
    name: 'Isolated retry verification',
    description: '',
  });
  orgs.push(retryOrg.id);
  await repo.account(retryOrg.id);
  await check(
    'concurrent different checkout intents admit one pending request per organization',
    async () => {
      const calls = await Promise.allSettled([
        billing.checkout(ids[0]!, retryOrg.id, choices() as never),
        billing.checkout(ids[0]!, retryOrg.id, choices({ plan: 'business' }) as never),
      ]);
      assert.equal(calls.filter((r) => r.status === 'fulfilled').length, 1);
      const rejected = calls.find((r) => r.status === 'rejected');
      assert(rejected?.status === 'rejected');
      assert.equal(rejected.reason.code, 'BILLING_CHECKOUT_PENDING');
      assert.equal(await repo.models.operations.countDocuments({ organizationId: retryOrg.id }), 1);
    },
  );
  const recoveryOrg = await tenantRepo.createOrganization(ids[0]!, {
    name: 'Lost checkout response verification',
    description: '',
  });
  orgs.push(recoveryOrg.id);
  await repo.account(recoveryOrg.id);
  await check(
    'a lost provider response recovers with the original durable idempotency parameters',
    async () => {
      let lost = true;
      const failing = new BillingService(repo, {
          ...provider,
          checkout: async (...args) => {
            const result = await provider.checkout(...args);
            if (lost) {
              lost = false;
              throw new Error('Explicit lost Stripe HTTP fixture response');
            }
            return result;
          },
        }),
        input = choices();
      await assert.rejects(failing.checkout(ids[0]!, recoveryOrg.id, input as never));
      const before = fixture.sessions.size;
      const recovered = await failing.checkout(ids[0]!, recoveryOrg.id, input as never);
      assert(recovered.url.startsWith('https://checkout.stripe.com/'));
      assert.equal(fixture.sessions.size, before);
      const calls = fixture.requests.filter(
        (r) => r.path === '/v1/checkout/sessions' && String(r.key).includes(recoveryOrg.id),
      );
      assert.equal(calls.length, 2);
      assert.equal(calls[0]!.params.get('expires_at'), calls[1]!.params.get('expires_at'));
    },
  );
  await check(
    'expired checkout requests and old uncertain customer attempts cannot create new provider sessions',
    async () => {
      const operation = await repo.models.operations
        .findOne({ organizationId: recoveryOrg.id })
        .lean();
      assert(operation);
      await repo.models.operations.updateOne(
        { _id: operation._id },
        { $set: { expiresAt: new Date(Date.now() - 1) } },
      );
      await assert.rejects(
        billing.checkout(ids[0]!, recoveryOrg.id, {
          requestId: operation.requestId,
          quoteId: operation.quoteId,
          plan: operation.plan,
          interval: operation.interval,
          trial: operation.trial,
          confirmed: true,
        } as never),
        { code: 'BILLING_CHECKOUT_EXPIRED' },
      );
      await repo.models.accounts.updateOne(
        { _id: recoveryOrg.id },
        {
          $set: {
            customerId: null,
            pendingKey: null,
            pendingUntil: null,
            customerRequestedAt: new Date(Date.now() - 24 * 3600000),
          },
        },
      );
      await assert.rejects(billing.checkout(ids[0]!, recoveryOrg.id, choices() as never), {
        code: 'BILLING_CUSTOMER_RECONCILE',
      });
    },
  );
  await check(
    'Free project ceilings are enforced without deleting or hiding existing projects',
    async () => {
      const ws = await tenantRepo.createWorkspace(ids[0]!, retryOrg.id, {
          name: 'Project limit verification',
          description: '',
          timezone: 'UTC',
        }),
        scope = { organizationId: retryOrg.id, workspaceId: ws.id };
      const input = {
        name: 'Quota fixture',
        description: '',
        cover: 'orbit',
        status: 'active',
        priority: 'normal',
        ownerId: ids[0]!,
        memberIds: [],
        template: 'blank',
      } as const;
      for (let i = 0; i < 10; i++)
        await projectRepo.create(ids[0]!, scope, {
          ...input,
          name: `Quota fixture ${i}`,
          memberIds: [],
        });
      await assert.rejects(projectRepo.create(ids[0]!, scope, { ...input, memberIds: [] }), {
        code: 'PLAN_LIMIT_REACHED',
      });
      assert.equal(
        await projectRepo.models.projects.countDocuments({ organizationId: retryOrg.id }),
        10,
      );
    },
  );
  await check(
    'owner role revocation during portal creation prevents returning its hosted capability URL',
    async () => {
      const restricted = new BillingService(repo, {
        ...provider,
        portal: async (id) => {
          const url = await provider.portal(id);
          await tenantRepo.models.organizationMemberships.updateOne(
            { organizationId: org, userId: ids[0] },
            { $set: { role: 'admin' } },
          );
          return url;
        },
      });
      try {
        await assert.rejects(restricted.portal(ids[0]!, org), { code: 'BILLING_OWNER_REQUIRED' });
      } finally {
        await tenantRepo.models.organizationMemberships.updateOne(
          { organizationId: org, userId: ids[0] },
          { $set: { role: 'owner' } },
        );
      }
    },
  );
  await check(
    'a missed completion webhook cannot allow another checkout after the local pending intent expires',
    async () => {
      const late = await tenantRepo.createOrganization(ids[0]!, {
        name: 'Delayed webhook verification',
        description: '',
      });
      orgs.push(late.id);
      await repo.account(late.id);
      await billing.checkout(ids[0]!, late.id, choices() as never);
      const row = await repo.account(late.id);
      assert(row.customerId);
      fixture.setSubscription(row.customerId, { plan: 'pro' });
      await repo.models.accounts.updateOne(
        { _id: late.id },
        { $set: { pendingUntil: new Date(Date.now() - 1) } },
      );
      await repo.models.operations.updateMany(
        { organizationId: late.id },
        { $set: { expiresAt: new Date(Date.now() - 1) } },
      );
      const sessions = fixture.sessions.size;
      await assert.rejects(billing.checkout(ids[0]!, late.id, choices() as never), {
        code: 'BILLING_SUBSCRIPTION_EXISTS',
      });
      assert.equal(fixture.sessions.size, sessions);
    },
  );
  console.log(
    `Phase 12 billing integration: ${results.length} checks passed (explicit Stripe HTTP fixture; live sandbox not verified).`,
  );
} finally {
  await fixture.close();
  for (const name of [
    'billing_accounts',
    'billing_operations',
    'billing_events',
    'billing_invoices',
    'ai_runs',
    'ai_workflows',
    'ai_usage',
    'projects',
    'tasks',
    'project_events',
    'sprint_burndown_observations',
    'workspace_memberships',
    'organization_memberships',
    'workspaces',
  ])
    await connection
      .collection(name)
      .deleteMany(
        name === 'billing_accounts'
          ? { _id: { $in: orgs.map((id) => new mongoose.Types.ObjectId(id)) } }
          : { organizationId: { $in: orgs.map((id) => new mongoose.Types.ObjectId(id)) } },
      );
  await tenantRepo.models.organizations.deleteMany({ _id: { $in: orgs } });
  await authRepo.models.sessions.deleteMany({ userId: { $in: ids } });
  await authRepo.models.users.deleteMany({ _id: { $in: ids } });
  await connection.close();
}
