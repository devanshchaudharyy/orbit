import { describe, it, expect } from 'vitest';
import { effectivePlan } from '../src/modules/billing/policy.js';
import { stripeUrl, createBillingProvider } from '../src/modules/billing/provider.js';
import { parseEnvironment } from '../src/config/env.js';
import { fingerprint } from '../src/modules/billing/repository.js';
const now = new Date('2026-10-16T00:00:00Z'),
  future = new Date('2026-11-16T00:00:00Z'),
  past = new Date('2026-10-15T00:00:00Z');
describe('test-only billing boundaries', () => {
  it('keeps retry fingerprints stable across object key order while detecting changed choices', () => {
    expect(fingerprint({ plan: 'pro', quote: { amount: 1900, currency: 'usd' } })).toBe(
      fingerprint({ quote: { currency: 'usd', amount: 1900 }, plan: 'pro' }),
    );
    expect(fingerprint({ plan: 'pro' })).not.toBe(fingerprint({ plan: 'business' }));
  });
  it('grants paid access only within an active verified period', () => {
    expect(
      effectivePlan({ plan: 'pro', status: 'active', periodEnd: future, trialEnd: null }, now),
    ).toBe('pro');
    for (const status of ['past_due', 'unpaid', 'paused', 'incomplete', 'canceled'])
      expect(
        effectivePlan({ plan: 'business', status, periodEnd: future, trialEnd: null }, now),
      ).toBe('free');
    expect(
      effectivePlan({ plan: 'pro', status: 'active', periodEnd: past, trialEnd: null }, now),
    ).toBe('free');
    expect(effectivePlan(null, now)).toBe('free');
  });
  it('trial access expires even if a later billing period is present', () => {
    expect(
      effectivePlan({ plan: 'pro', status: 'trialing', periodEnd: future, trialEnd: past }, now),
    ).toBe('free');
    expect(
      effectivePlan(
        { plan: 'business', status: 'trialing', periodEnd: null, trialEnd: future },
        now,
      ),
    ).toBe('business');
  });
  it('restricts hosted redirects to exact HTTPS Stripe origins', () => {
    expect(stripeUrl('https://checkout.stripe.com/c/pay/cs_test_demo', 'checkout')).toContain(
      'checkout.stripe.com',
    );
    for (const url of [
      'http://checkout.stripe.com/x',
      'https://checkout.stripe.com.evil.test/x',
      'https://evil.test/x',
      'https://user@checkout.stripe.com/x',
    ])
      expect(() => stripeUrl(url, 'checkout')).toThrow();
  });
  it('rejects live keys even while billing is disabled', () => {
    expect(() =>
      parseEnvironment({
        MONGO_URI: 'mongodb://localhost/test',
        REDIS_URL: 'redis://localhost',
        STRIPE_SECRET_KEY: 'sk_live_do_not_use_live_credentials',
      }),
    ).toThrow('test secret key');
  });
  it('requires complete and distinct price configuration in test mode', () => {
    expect(() =>
      parseEnvironment({
        MONGO_URI: 'mongodb://localhost/test',
        REDIS_URL: 'redis://localhost',
        BILLING_MODE: 'stripe-test',
      }),
    ).toThrow('STRIPE_WEBHOOK_SECRET');
  });
  it('disabled billing does not create a customer or a fake checkout', async () => {
    const env = parseEnvironment({
      MONGO_URI: 'mongodb://localhost/test',
      REDIS_URL: 'redis://localhost',
    });
    const provider = createBillingProvider(env);
    expect(provider.configured).toBe(false);
    await expect(provider.customer('org', 'identity')).rejects.toMatchObject({
      code: 'BILLING_NOT_CONFIGURED',
    });
  });
});
