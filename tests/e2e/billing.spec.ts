import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { setup, project, audit, database, ObjectId, signIn, api } from './view-support';
const fixtureUrl = process.env.ORBIT_STRIPE_FIXTURE_URL!,
  apiOrigin = process.env.ORBIT_AUTH_API ?? 'http://127.0.0.1:4003';
async function control(input: object) {
  const response = await fetch(`${fixtureUrl}/__fixture/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  expect(response.ok).toBe(true);
  return response.json();
}
async function event(org: string, subscription: object) {
  const result = await control({ org, subscription });
  const response = await fetch(`${apiOrigin}/api/v1/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': result.event.signature },
    body: result.event.body,
  });
  expect(response.status).toBe(200);
}
async function fixture(page: Page) {
  const people = await setup(page),
    path = `/app/organizations/${people.org}/billing`;
  await page.goto(path);
  await expect(
    page.getByRole('heading', { name: 'Room for what’s next.', exact: true }),
  ).toBeVisible();
  return { ...people, path };
}
async function checkout(page: Page, org: string) {
  const current = (await (await page.request.get(`/api/v1/organizations/${org}/billing`)).json())
    .data;
  const result = await api(page, `/${org}/billing/checkout`, {
    requestId: randomUUID(),
    quoteId: current.quoteId,
    plan: 'pro',
    interval: 'month',
    trial: false,
    confirmed: true,
  });
  expect(result.status()).toBe(200);
  return result.json();
}
async function refresh(page: Page) {
  await page.getByRole('button', { name: 'Refresh provider status', exact: true }).click();
  await expect(
    page.getByText('Provider status synchronized. Your current entitlements are shown below.', {
      exact: true,
    }),
  ).toBeVisible();
}
test('real billing page, exact plan confirmation, SDK checkout, signed activation, invoices and cancellation', async ({
  page,
}) => {
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  const people = await fixture(page);
  await expect(page.getByRole('heading', { name: 'Free Free', exact: true })).toBeVisible();
  await audit(page, 'billing-free');
  await page.getByRole('button', { name: 'Yearly', exact: true }).click();
  await expect(
    page
      .locator('.billing-plan')
      .filter({ has: page.getByRole('heading', { name: 'Pro', exact: true }) }),
  ).toContainText('$190.00');
  await page.getByRole('button', { name: 'Monthly', exact: true }).click();
  await page.getByLabel(/Include a 14-day trial/).check();
  await audit(page, 'billing-checkout', 'Choose Pro');
  await page.getByRole('button', { name: 'Choose Pro', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('$19.00');
  await expect(page.getByRole('dialog')).toContainText('14-day trial');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose Pro', exact: true })).toBeFocused();
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Explicit Stripe HTTP fixture redirect</h1>',
    }),
  );
  await page.getByRole('button', { name: 'Choose Pro', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm test checkout', exact: true }).click();
  await expect(page).toHaveURL(/https:\/\/checkout.stripe.com/);
  await page.goto(people.path + '?checkout=returned');
  await expect(page.getByText(/Payment is not confirmed by this page/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Free Free', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Resume pending checkout', exact: true }),
  ).toBeVisible();
  await audit(page, 'billing-return');
  await event(people.org, { plan: 'pro', status: 'trialing', trial: true });
  await refresh(page);
  await expect(page.getByRole('heading', { name: 'Pro Trialing', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('FIXTURE-0001');
  await audit(page, 'billing-trial');
  await audit(page, 'billing-portal', 'Manage subscription');
  await page.route('https://billing.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Explicit test portal redirect fixture</h1>',
    }),
  );
  await page.getByRole('button', { name: 'Manage subscription', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm and open portal', exact: true }).click();
  await expect(page).toHaveURL(/https:\/\/billing.stripe.com/);
  await page.goto(people.path);
  await expect(page.getByRole('heading', { name: 'Pro Trialing', exact: true })).toBeVisible();
  await event(people.org, { plan: 'pro', cancelAtPeriodEnd: true });
  await refresh(page);
  await expect(page.getByText(/Cancellation scheduled for/)).toBeVisible();
  await audit(page, 'billing-cancellation');
  await event(people.org, { status: 'canceled' });
  await refresh(page);
  await expect(page.getByRole('heading', { name: 'Free Canceled', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('private paginated history, administrator view and denied or revoked billing access', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const people = await fixture(page);
  await checkout(page, people.org);
  await event(people.org, { plan: 'business' });
  await refresh(page);
  await database(async (db) => {
    await db.collection('billing_invoices').insertMany(
      Array.from({ length: 22 }, (_, i) => ({
        organizationId: new ObjectId(people.org),
        providerId: `in_browser_${randomUUID()}_${i}`,
        number: `BROWSER-FIXTURE-${i}`,
        status: 'paid',
        currency: 'usd',
        amountDue: 2500,
        amountPaid: 2500,
        issuedAt: new Date(),
        hostedUrl: null,
      })),
    );
    await db
      .collection('organization_memberships')
      .updateOne(
        { organizationId: new ObjectId(people.org), userId: new ObjectId(people.member.id) },
        { $set: { role: 'admin' } },
      );
  });
  await page.reload();
  await expect(page.getByRole('row')).toHaveCount(21);
  await audit(page, 'billing-history');
  await page.getByRole('button', { name: 'Load older invoices', exact: true }).click();
  await expect(page.getByRole('row')).toHaveCount(24);
  const context = await browser.newContext({ baseURL: process.env.ORBIT_AUTH_ORIGIN }),
    admin = await context.newPage();
  try {
    await signIn(admin, people.member.email, people.path);
    await expect(admin.getByText(/You can view billing as an administrator/)).toBeVisible();
    await expect(
      admin.getByRole('button', { name: 'Manage subscription', exact: true }),
    ).toBeDisabled();
    await audit(admin, 'billing-admin');
    await database((db) =>
      db.collection('organization_memberships').deleteOne({
        organizationId: new ObjectId(people.org),
        userId: new ObjectId(people.member.id),
      }),
    );
    await admin.getByRole('button', { name: 'Refresh provider status', exact: true }).click();
    await expect(admin.getByRole('table')).toHaveCount(0);
    await expect(
      admin.getByRole('heading', { name: 'A small interruption.', exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  const guestContext = await browser.newContext({ baseURL: process.env.ORBIT_AUTH_ORIGIN }),
    guest = await guestContext.newPage();
  try {
    await signIn(guest, people.guest.email, people.path);
    await expect(guest.getByRole('table')).toHaveCount(0);
    await expect(
      guest.getByRole('heading', { name: 'A small interruption.', exact: true }),
    ).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
test('provider failure is truthful, explicit retry recovers, direct refresh and reduced motion work', async ({
  page,
}) => {
  const people = await fixture(page);
  await checkout(page, people.org);
  await event(people.org, { plan: 'pro' });
  await refresh(page);
  try {
    await control({ fail: true });
    await page.reload();
    await expect(
      page.getByText(
        'Stripe test pricing is temporarily unavailable. Retry before starting checkout.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pro Active', exact: true })).toBeVisible();
    await audit(page, 'billing-unavailable');
    await page.getByRole('button', { name: 'Refresh provider status', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  } finally {
    await control({ fail: false });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await refresh(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pro Active', exact: true })).toBeVisible();
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
    true,
  );
});
test('Free feature feedback matches server-enforced export and automation restrictions', async ({
  page,
}) => {
  const people = await setup(page),
    path = await project(page);
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByText(/CSV exports require Pro or Business/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV', exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'AI assistance', exact: true }).click();
  await expect(page.getByText(/Scheduled AI workflows require Pro or Business/)).toBeVisible();
  const base = path.replace('/app/organizations', '');
  const response = await api(page, `${base}/ai/workflows`, {
    name: 'Free test schedule',
    mode: 'weekly-report',
    frequency: 'weekly',
    weekday: 1,
    hour: 9,
    enabled: true,
    confirmed: true,
  });
  expect(response.status()).toBe(402);
  await expect(
    page.getByRole('button', { name: 'Create draft workflow', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Generate private draft', exact: true }),
  ).toBeDisabled();
  expect(people.org).toBeTruthy();
});
test('a lost checkout response preserves retry identity and the server offers durable resume after refresh', async ({
  page,
}) => {
  const people = await fixture(page);
  let lost = true;
  await page.route('**/api/v1/organizations/*/billing/checkout', async (route) => {
    if (lost) {
      lost = false;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Choose Pro', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm test checkout', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Resume pending checkout', exact: true }),
  ).toBeVisible();
  await page.route('https://checkout.stripe.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Explicit checkout redirect fixture</h1>',
    }),
  );
  await page.getByRole('button', { name: 'Resume pending checkout', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm test checkout', exact: true }).click();
  await expect(page).toHaveURL(/https:\/\/checkout.stripe.com/);
  const state = await control({ org: people.org });
  expect(
    state.requests.filter(
      (r: { path: string; key?: string }) =>
        r.path === '/v1/checkout/sessions' && r.key?.includes(people.org),
    ),
  ).toHaveLength(1);
});
