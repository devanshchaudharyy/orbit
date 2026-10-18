import { describe, it, expect } from 'vitest';
import { checkoutInputSchema, portalInputSchema, planLimits } from '../src/billing.js';
describe('confirmed test billing contracts', () => {
  const input = {
    requestId: crypto.randomUUID(),
    quoteId: 'a'.repeat(64),
    plan: 'pro',
    interval: 'month',
    trial: false,
    confirmed: true,
  };
  it('requires explicit checkout confirmation and a stable request identity', () => {
    expect(checkoutInputSchema.safeParse(input).success).toBe(true);
    expect(checkoutInputSchema.safeParse({ ...input, confirmed: false }).success).toBe(false);
    expect(checkoutInputSchema.safeParse({ ...input, requestId: 'retry' }).success).toBe(false);
  });
  it('never accepts a client price, customer, amount or subscription identifier', () => {
    for (const key of ['priceId', 'amount', 'customerId', 'subscriptionId'])
      expect(checkoutInputSchema.safeParse({ ...input, [key]: 'untrusted' }).success).toBe(false);
  });
  it('accepts only paid plans and supported intervals for checkout', () => {
    expect(checkoutInputSchema.safeParse({ ...input, plan: 'free' }).success).toBe(false);
    expect(checkoutInputSchema.safeParse({ ...input, interval: 'week' }).success).toBe(false);
  });
  it('requires confirmation for the portal and keeps paid capabilities explicit', () => {
    expect(portalInputSchema.safeParse({ confirmed: true }).success).toBe(true);
    expect(portalInputSchema.safeParse({}).success).toBe(false);
    expect(planLimits.free.csvExport).toBe(false);
    expect(planLimits.pro.scheduledWorkflows).toBe(10);
  });
});
