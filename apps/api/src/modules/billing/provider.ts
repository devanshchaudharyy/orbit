import Stripe from 'stripe';
import type { BillingPlan, BillingInterval } from '@orbit/contracts';
import type { Environment } from '../../config/env.js';
import { AuthError } from '../auth/errors.js';
export type PaidPlan = Exclude<BillingPlan, 'free'>;
export type Price = { plan: PaidPlan; interval: BillingInterval; amount: number; currency: 'usd' };
export type Invoice = {
  providerId: string;
  number: string | null;
  status: string;
  currency: string;
  amountDue: number;
  amountPaid: number;
  issuedAt: Date;
  hostedUrl: string | null;
};
export type Snapshot = {
  subscriptionId: string | null;
  plan: BillingPlan;
  status: string;
  interval: BillingInterval | null;
  periodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  invoices: Invoice[];
};
export interface BillingProvider {
  configured: boolean;
  catalog(): Promise<Price[]>;
  customer(org: string, key: string): Promise<string>;
  checkout(
    customer: string,
    org: string,
    plan: PaidPlan,
    interval: BillingInterval,
    trial: boolean,
    key: string,
    expiresAt: Date,
  ): Promise<{ id: string; url: string; expiresAt: Date }>;
  checkoutState(id: string): Promise<'open' | 'complete' | 'expired'>;
  portal(customer: string, org?: string): Promise<string>;
  snapshot(customer: string): Promise<Snapshot>;
  verify(
    body: Buffer,
    signature: string,
  ): { id: string; type: string; customer: string | null; livemode: boolean; account?: string };
}
export function stripeUrl(value: string, kind: 'checkout' | 'portal' | 'invoice') {
  const url = new URL(value),
    hosts = {
      checkout: ['checkout.stripe.com'],
      portal: ['billing.stripe.com'],
      invoice: ['invoice.stripe.com', 'pay.stripe.com'],
    };
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !hosts[kind].includes(url.hostname)
  )
    throw new Error('Invalid provider redirect');
  return url.href;
}
const identifier = (value: string | { id: string } | null) =>
  typeof value === 'string' ? value : (value?.id ?? null);
const mismatch = () =>
  new AuthError(
    503,
    'BILLING_PROVIDER_MISMATCH',
    'Provider subscription requires reconciliation. Paid entitlements are on hold until a valid synchronization.',
  );
export function createBillingProvider(
  env: Pick<
    Environment,
    | 'BILLING_MODE'
    | 'STRIPE_SECRET_KEY'
    | 'STRIPE_WEBHOOK_SECRET'
    | 'STRIPE_PRO_MONTH_PRICE'
    | 'STRIPE_PRO_YEAR_PRICE'
    | 'STRIPE_BUSINESS_MONTH_PRICE'
    | 'STRIPE_BUSINESS_YEAR_PRICE'
    | 'STRIPE_PORTAL_CONFIGURATION'
    | 'APP_ORIGIN'
  >,
  client?: Stripe,
): BillingProvider {
  const configured = env.BILLING_MODE === 'stripe-test';
  const stripe =
    client ??
    (configured
      ? new Stripe(env.STRIPE_SECRET_KEY, { timeout: 10000, maxNetworkRetries: 1 })
      : null);
  const prices = [
    ['pro', 'month', env.STRIPE_PRO_MONTH_PRICE],
    ['pro', 'year', env.STRIPE_PRO_YEAR_PRICE],
    ['business', 'month', env.STRIPE_BUSINESS_MONTH_PRICE],
    ['business', 'year', env.STRIPE_BUSINESS_YEAR_PRICE],
  ] as const;
  const api = () => {
    if (!configured || !stripe)
      throw new AuthError(
        503,
        'BILLING_NOT_CONFIGURED',
        'Stripe test billing is not configured. Your organization remains on its current plan.',
      );
    return stripe;
  };
  return {
    configured,
    async catalog() {
      return Promise.all(
        prices.map(async ([plan, interval, id]) => {
          const price = await api().prices.retrieve(id);
          if (
            price.livemode ||
            !price.active ||
            price.type !== 'recurring' ||
            price.currency !== 'usd' ||
            price.recurring?.interval !== interval ||
            price.recurring.interval_count !== 1 ||
            price.unit_amount === null ||
            price.billing_scheme !== 'per_unit' ||
            price.transform_quantity
          )
            throw new Error('Unsupported test price');
          return { plan, interval, amount: price.unit_amount, currency: 'usd' as const };
        }),
      );
    },
    async customer(org, key) {
      const customer = await api().customers.create(
        { metadata: { orbitOrganizationId: org } },
        { idempotencyKey: key },
      );
      if (customer.livemode) throw new Error('Live customer rejected');
      return customer.id;
    },
    async checkout(customer, org, plan, interval, trial, key, expiresAt) {
      const price = prices.find((row) => row[0] === plan && row[1] === interval)![2];
      const result = await api().checkout.sessions.create(
        {
          mode: 'subscription',
          customer,
          line_items: [{ price, quantity: 1 }],
          client_reference_id: org,
          metadata: { orbitOrganizationId: org },
          subscription_data: {
            metadata: { orbitOrganizationId: org },
            ...(trial ? { trial_period_days: 14 } : {}),
          },
          payment_method_collection: 'always',
          success_url: `${env.APP_ORIGIN}/app/organizations/${org}/billing?checkout=returned`,
          cancel_url: `${env.APP_ORIGIN}/app/organizations/${org}/billing?checkout=canceled`,
          expires_at: Math.floor(expiresAt.getTime() / 1000),
        },
        { idempotencyKey: key },
      );
      if (result.livemode || !result.url) throw new Error('Invalid test checkout');
      return {
        id: result.id,
        url: stripeUrl(result.url, 'checkout'),
        expiresAt: new Date(result.expires_at * 1000),
      };
    },
    async checkoutState(id) {
      const result = await api().checkout.sessions.retrieve(id);
      if (result.livemode || !['open', 'complete', 'expired'].includes(result.status ?? ''))
        throw new Error('Invalid checkout status');
      return result.status as 'open' | 'complete' | 'expired';
    },
    async portal(customer, org) {
      const result = await api().billingPortal.sessions.create({
        customer,
        return_url: `${env.APP_ORIGIN}${org ? `/app/organizations/${org}/billing` : '/app'}`,
        ...(env.STRIPE_PORTAL_CONFIGURATION
          ? { configuration: env.STRIPE_PORTAL_CONFIGURATION }
          : {}),
      });
      return stripeUrl(result.url, 'portal');
    },
    async snapshot(customer) {
      const subscriptions = await api().subscriptions.list({ customer, status: 'all', limit: 100 });
      if (subscriptions.has_more) throw new Error('Subscription history requires manual review');
      const active = subscriptions.data.filter(
        (s) => !['canceled', 'incomplete_expired'].includes(s.status),
      );
      if (active.length > 1) throw mismatch();
      const subscription = active[0] ?? subscriptions.data.sort((a, b) => b.created - a.created)[0];
      let result: Omit<Snapshot, 'invoices'> = {
        subscriptionId: null,
        plan: 'free',
        status: 'free',
        interval: null,
        periodEnd: null,
        trialEnd: null,
        cancelAtPeriodEnd: false,
      };
      if (subscription) {
        if (
          subscription.livemode ||
          identifier(subscription.customer) !== customer ||
          subscription.items.data.length !== 1
        )
          throw mismatch();
        const item = subscription.items.data[0]!,
          match = prices.find((row) => row[2] === item.price.id);
        if (
          !match ||
          item.quantity !== 1 ||
          item.price.livemode ||
          item.price.currency !== 'usd' ||
          item.price.recurring?.interval !== match[1] ||
          item.price.recurring.interval_count !== 1 ||
          !Number.isFinite(item.current_period_end) ||
          item.current_period_end <= 0
        )
          throw mismatch();
        result = {
          subscriptionId: subscription.id,
          plan: match[0],
          status: subscription.status,
          interval: match[1],
          periodEnd: new Date(item.current_period_end * 1000),
          trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        };
      }
      const invoices = await api().invoices.list({ customer, limit: 100 });
      if (invoices.has_more)
        throw new Error('Invoice history exceeds current synchronization bound');
      return {
        ...result,
        invoices: invoices.data.map((invoice) => {
          if (invoice.livemode || identifier(invoice.customer) !== customer)
            throw new Error('Foreign invoice');
          return {
            providerId: invoice.id,
            number: invoice.number,
            status: invoice.status ?? 'draft',
            currency: invoice.currency,
            amountDue: invoice.amount_due,
            amountPaid: invoice.amount_paid,
            issuedAt: new Date(invoice.created * 1000),
            hostedUrl: invoice.hosted_invoice_url
              ? stripeUrl(invoice.hosted_invoice_url, 'invoice')
              : null,
          };
        }),
      };
    },
    verify(body, signature) {
      const event = api().webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET, 300);
      const object = event.data.object as unknown as { customer?: string | { id: string } | null };
      return {
        id: event.id,
        type: event.type,
        customer: identifier(object.customer ?? null),
        livemode: event.livemode,
        ...(event.account ? { account: event.account } : {}),
      };
    },
  };
}
