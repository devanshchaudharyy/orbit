import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url)),
  Stripe = require('stripe');
export const stripeFixtureEnvironment = {
  BILLING_MODE: 'stripe-test',
  STRIPE_SECRET_KEY: 'sk_test_' + 'fixture'.repeat(8),
  STRIPE_WEBHOOK_SECRET: 'whsec_' + 'fixture'.repeat(8),
  STRIPE_PRO_MONTH_PRICE: 'price_fixtureProMonth',
  STRIPE_PRO_YEAR_PRICE: 'price_fixtureProYear',
  STRIPE_BUSINESS_MONTH_PRICE: 'price_fixtureBusinessMonth',
  STRIPE_BUSINESS_YEAR_PRICE: 'price_fixtureBusinessYear',
  STRIPE_PORTAL_CONFIGURATION: '',
};
export async function startStripeFixture() {
  const customers = new Map(),
    sessions = new Map(),
    snapshots = new Map(),
    idempotency = new Map(),
    requests = [];
  let fail = false;
  const prices = Object.fromEntries(
    [
      ['pro', 'month', 'price_fixtureProMonth', 1900],
      ['pro', 'year', 'price_fixtureProYear', 19000],
      ['business', 'month', 'price_fixtureBusinessMonth', 4900],
      ['business', 'year', 'price_fixtureBusinessYear', 49000],
    ].map(([plan, interval, id, amount]) => [
      id,
      {
        id,
        object: 'price',
        active: true,
        livemode: false,
        currency: 'usd',
        type: 'recurring',
        unit_amount: amount,
        billing_scheme: 'per_unit',
        transform_quantity: null,
        recurring: { interval, interval_count: 1 },
        metadata: { plan },
      },
    ]),
  );
  function event(customer, type = 'customer.subscription.updated', options = {}) {
    const body = JSON.stringify({
      id: options.id ?? `evt_fixture${randomUUID().replaceAll('-', '')}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      type,
      livemode: options.livemode ?? false,
      ...(options.account ? { account: options.account } : {}),
      data: { object: { id: 'sub_fixture', object: 'subscription', customer, status: 'canceled' } },
    });
    return {
      body,
      signature: Stripe.webhooks.generateTestHeaderString({
        payload: body,
        secret: stripeFixtureEnvironment.STRIPE_WEBHOOK_SECRET,
      }),
    };
  }
  function setSubscription(
    customer,
    {
      plan = 'pro',
      interval = 'month',
      status = 'active',
      cancelAtPeriodEnd = false,
      trial = false,
      expired = false,
    } = {},
  ) {
    const price = Object.values(prices).find(
        (row) => row.metadata.plan === plan && row.recurring.interval === interval,
      ),
      now = Math.floor(Date.now() / 1000);
    if (!price) throw new Error('Unknown fixture plan');
    const snapshot = {
      subscription: {
        id: `sub_${customer}`,
        object: 'subscription',
        customer,
        livemode: false,
        status,
        created: now,
        trial_end: trial ? now + (expired ? -1 : 14 * 86400) : null,
        cancel_at_period_end: cancelAtPeriodEnd,
        items: {
          data: [
            {
              id: 'si_fixture',
              quantity: 1,
              price,
              current_period_end: now + (expired ? -1 : 30 * 86400),
            },
          ],
        },
      },
      invoices: [
        {
          id: `in_${customer}`,
          object: 'invoice',
          customer,
          livemode: false,
          number: 'FIXTURE-0001',
          status: 'paid',
          currency: 'usd',
          amount_due: price.unit_amount,
          amount_paid: price.unit_amount,
          created: now,
          hosted_invoice_url: `https://invoice.stripe.com/i/test_fixture${customer}`,
        },
      ],
    };
    snapshots.set(customer, snapshot);
    return snapshot;
  }
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://127.0.0.1'),
      params = new URLSearchParams(raw),
      key = req.headers['idempotency-key'];
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === '/__fixture/control' && req.method === 'POST') {
        const control = JSON.parse(raw);
        if ('fail' in control) fail = control.fail;
        let customer =
          control.customer ??
          [...customers.values()].find((c) => c.metadata.orbitOrganizationId === control.org)?.id;
        if (control.subscription) {
          if (!customer) throw new Error('No fixture customer');
          setSubscription(customer, control.subscription);
          for (const session of sessions.values())
            if (session.customer === customer) session.status = 'complete';
        }
        send(200, {
          customer,
          event: customer ? event(customer, control.type, control.event ?? {}) : null,
          requests: requests.map((r) => ({ path: r.path, method: r.method, key: r.key })),
        });
        return;
      }
      if (fail) {
        send(503, {
          error: { message: 'Explicit Stripe HTTP fixture failure', type: 'api_error' },
        });
        return;
      }
      requests.push({ path: url.pathname, method: req.method, key, params });
      if (key && idempotency.has(key)) {
        send(200, idempotency.get(key));
        return;
      }
      let result;
      if (req.method === 'GET' && url.pathname.startsWith('/v1/prices/'))
        result = prices[url.pathname.split('/').at(-1)];
      else if (req.method === 'POST' && url.pathname === '/v1/customers') {
        result = {
          id: `cus_fixture${randomUUID().replaceAll('-', '')}`,
          object: 'customer',
          livemode: false,
          metadata: { orbitOrganizationId: params.get('metadata[orbitOrganizationId]') },
        };
        customers.set(result.id, result);
      } else if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        result = {
          id: `cs_test_fixture${randomUUID().replaceAll('-', '')}`,
          object: 'checkout.session',
          customer: params.get('customer'),
          livemode: false,
          status: 'open',
          expires_at: Number(params.get('expires_at')),
          url: 'https://checkout.stripe.com/c/pay/cs_test_explicit_fixture',
        };
        sessions.set(result.id, result);
      } else if (req.method === 'GET' && url.pathname.startsWith('/v1/checkout/sessions/'))
        result = sessions.get(url.pathname.split('/').at(-1));
      else if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions')
        result = {
          id: 'bps_fixture',
          object: 'billing_portal.session',
          url: 'https://billing.stripe.com/p/session/test_explicit_fixture',
        };
      else if (req.method === 'GET' && url.pathname === '/v1/subscriptions') {
        const snapshot = snapshots.get(url.searchParams.get('customer'));
        result = { object: 'list', has_more: false, data: snapshot ? [snapshot.subscription] : [] };
      } else if (req.method === 'GET' && url.pathname === '/v1/invoices')
        result = {
          object: 'list',
          has_more: false,
          data: snapshots.get(url.searchParams.get('customer'))?.invoices ?? [],
        };
      if (!result) {
        send(404, {
          error: { message: 'Unknown fixture resource', type: 'invalid_request_error' },
        });
        return;
      }
      if (key) idempotency.set(key, result);
      send(200, result);
    } catch {
      send(400, { error: { message: 'Invalid fixture control', type: 'invalid_request_error' } });
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port,
    url = `http://127.0.0.1:${port}`;
  return {
    url,
    requests,
    customers,
    sessions,
    snapshots,
    setSubscription,
    event,
    setFail(value) {
      fail = value;
    },
    client: new Stripe(stripeFixtureEnvironment.STRIPE_SECRET_KEY, {
      host: '127.0.0.1',
      port,
      protocol: 'http',
      timeout: 1000,
      maxNetworkRetries: 0,
    }),
    close: () => new Promise((done) => server.close(done)),
  };
}
