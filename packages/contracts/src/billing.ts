import { z } from 'zod';
export const billingPlanSchema = z.enum(['free', 'pro', 'business']);
export const billingIntervalSchema = z.enum(['month', 'year']);
export const billingStatusSchema = z.enum([
  'free',
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);
export const planLimits = {
  free: { workspaces: 3, projects: 10, scheduledWorkflows: 0, csvExport: false },
  pro: { workspaces: 20, projects: 100, scheduledWorkflows: 10, csvExport: true },
  business: { workspaces: 100, projects: 500, scheduledWorkflows: 50, csvExport: true },
} as const;
export type BillingPlan = z.infer<typeof billingPlanSchema>;
export type BillingInterval = z.infer<typeof billingIntervalSchema>;
export const entitlementSchema = z.object({
  plan: billingPlanSchema,
  limits: z.object({
    workspaces: z.int(),
    projects: z.int(),
    scheduledWorkflows: z.int(),
    csvExport: z.boolean(),
  }),
});
export const checkoutInputSchema = z
  .object({
    requestId: z.uuid(),
    quoteId: z.string().regex(/^[a-f0-9]{64}$/),
    plan: z.enum(['pro', 'business']),
    interval: billingIntervalSchema,
    trial: z.boolean(),
    confirmed: z.literal(true),
  })
  .strict();
export const portalInputSchema = z.object({ confirmed: z.literal(true) }).strict();
export const billingInvoiceSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/),
  number: z.string().nullable(),
  status: z.string(),
  currency: z.string(),
  amountDue: z.int(),
  amountPaid: z.int(),
  createdAt: z.iso.datetime(),
  hostedUrl: z.url().nullable(),
});
export const billingHistorySchema = z.object({
  invoices: z.array(billingInvoiceSchema),
  nextCursor: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .nullable(),
});
export const billingDashboardSchema = z.object({
  provider: z.literal('Stripe test mode'),
  configured: z.boolean(),
  providerMessage: z.string().nullable(),
  canManage: z.boolean(),
  plan: billingPlanSchema,
  status: billingStatusSchema,
  subscriptionPlan: billingPlanSchema,
  interval: billingIntervalSchema.nullable(),
  periodEnd: z.iso.datetime().nullable(),
  trialEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  trialUsed: z.boolean(),
  limits: entitlementSchema.shape.limits,
  usage: z.object({ workspaces: z.int(), projects: z.int(), scheduledWorkflows: z.int() }),
  prices: z.array(
    z.object({
      plan: z.enum(['pro', 'business']),
      interval: billingIntervalSchema,
      amount: z.int().min(0),
      currency: z.literal('usd'),
    }),
  ),
  quoteId: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  history: billingHistorySchema,
  syncedAt: z.iso.datetime().nullable(),
  pendingCheckout: z
    .object({
      requestId: z.uuid(),
      quoteId: z.string().regex(/^[a-f0-9]{64}$/),
      plan: z.enum(['pro', 'business']),
      interval: billingIntervalSchema,
      trial: z.boolean(),
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
});
export const billingRedirectSchema = z.object({ url: z.url() });
export type BillingDashboard = z.infer<typeof billingDashboardSchema>;
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
