import { billingDashboardSchema, type CheckoutInput } from '@orbit/contracts';
import { BillingRepository, billingError, fingerprint } from './repository.js';
import { stripeUrl, type BillingProvider } from './provider.js';
import { AuthError } from '../auth/errors.js';
import { recordAudit } from '../administration/models.js';
export class BillingService {
  constructor(
    readonly repository: BillingRepository,
    readonly provider: BillingProvider,
  ) {}
  ready = () => this.repository.ready();
  async dashboard(actor: string, org: string) {
    const data = await this.repository.dashboard(actor, org);
    let prices: Awaited<ReturnType<BillingProvider['catalog']>> = [],
      providerMessage: string | null = null;
    if (this.provider.configured)
      try {
        prices = await this.provider.catalog();
      } catch {
        providerMessage =
          'Stripe test pricing is temporarily unavailable. Retry before starting checkout.';
      }
    else
      providerMessage =
        'Stripe test billing is not configured. No checkout or payment will be created.';
    await this.repository.access(actor, org);
    if (data.entitlementsHold)
      providerMessage =
        'Paid entitlements are on hold because provider configuration does not match this subscription. Review the test portal and refresh provider status.';
    return billingDashboardSchema.parse({
      ...data,
      provider: 'Stripe test mode',
      configured: this.provider.configured,
      providerMessage,
      prices,
      quoteId: prices.length === 4 ? fingerprint(prices) : null,
    });
  }
  private configured() {
    if (!this.provider.configured)
      throw billingError(
        503,
        'BILLING_NOT_CONFIGURED',
        'Stripe test billing is not configured. No checkout or payment was created.',
      );
  }
  async checkout(actor: string, org: string, input: CheckoutInput) {
    await this.repository.access(actor, org, true);
    this.configured();
    const initial = await this.repository.account(org);
    const prices = await this.provider.catalog();
    if (input.quoteId !== fingerprint(prices))
      throw billingError(
        409,
        'BILLING_PRICE_CHANGED',
        'Test pricing changed since this quote. Refresh billing and review the current amount before starting checkout.',
      );
    // Reconcile existing customers even if a completion webhook was delayed or lost.
    if (initial.customerId) await this.synchronize(org);
    const operation = await this.repository.prepareCheckout(actor, org, input);
    if (operation.url && operation.sessionId) {
      if ((await this.provider.checkoutState(operation.sessionId)) !== 'open')
        throw billingError(
          409,
          'BILLING_CHECKOUT_FINISHED',
          'This checkout is complete or expired. Refresh the provider status.',
        );
      await this.repository.access(actor, org, true);
      return { url: stripeUrl(operation.url, 'checkout') };
    }
    let account = await this.repository.account(org);
    if (!account.customerId) {
      const id = await this.provider.customer(org, `orbit-customer-${org}`);
      await this.repository.saveCustomer(org, id);
      account = await this.repository.account(org);
    }
    await this.repository.access(actor, org, true);
    const result = await this.provider.checkout(
      account.customerId!,
      org,
      input.plan,
      input.interval,
      input.trial,
      `orbit-checkout-${org}-${input.requestId}`,
      operation.expiresAt,
    );
    await this.repository.saveCheckout(actor, org, input, result);
    return { url: stripeUrl(result.url, 'checkout') };
  }
  async portal(actor: string, org: string) {
    await this.repository.access(actor, org, true);
    this.configured();
    const row = await this.repository.account(org);
    if (!row.customerId)
      throw billingError(
        409,
        'BILLING_NO_CUSTOMER',
        'No Stripe customer exists for this organization. Start a test checkout first.',
      );
    const url = await this.provider.portal(row.customerId, org);
    await this.repository.access(actor, org, true);
    await this.repository.connection.transaction(async (session) => {
      await this.repository.access(actor, org, true, session);
      await recordAudit(
        this.repository.connection,
        org,
        actor,
        'billing',
        'portal.created',
        org,
        session,
      );
    });
    return { url: stripeUrl(url, 'portal') };
  }
  async synchronize(org: string, event?: { id: string; type: string; hash: string }) {
    this.configured();
    const { token, row } = await this.repository.lease(org);
    try {
      if (!row.customerId)
        throw billingError(409, 'BILLING_NO_CUSTOMER', 'There is no provider customer to refresh.');
      const snapshot = await this.provider.snapshot(row.customerId);
      await this.repository.storeSnapshot(org, token, snapshot, event);
    } catch (error) {
      if (error instanceof AuthError && error.code === 'BILLING_PROVIDER_MISMATCH')
        await this.repository.models.accounts.updateOne(
          { _id: org, syncLease: token },
          { $set: { entitlementsHold: true }, $inc: { revision: 1 } },
        );
      throw error;
    } finally {
      await this.repository.release(org, token);
    }
  }
  async refresh(actor: string, org: string) {
    await this.repository.access(actor, org);
    await this.synchronize(org);
    await this.repository.access(actor, org);
    return this.dashboard(actor, org);
  }
  async webhook(body: Buffer, signature: string) {
    this.configured();
    let event: ReturnType<BillingProvider['verify']>;
    try {
      event = this.provider.verify(body, signature);
    } catch {
      throw billingError(400, 'BILLING_SIGNATURE_INVALID', 'Invalid payment webhook signature.');
    }
    if (event.livemode || event.account)
      throw billingError(
        400,
        'BILLING_LIVE_EVENT_REJECTED',
        'Only direct-account Stripe test events are accepted.',
      );
    const hash = fingerprint(body.toString('utf8')),
      stored = await this.repository.models.events.findOne({ eventId: event.id }).lean();
    if (stored) {
      if (stored.hash !== hash)
        throw billingError(
          400,
          'BILLING_EVENT_CONFLICT',
          'The event identity was already received with different content.',
        );
      return { received: true };
    }
    const supported = [
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'customer.subscription.trial_will_end',
      'checkout.session.completed',
      'checkout.session.expired',
      'invoice.paid',
      'invoice.payment_failed',
      'invoice.updated',
      'invoice.finalized',
    ];
    if (!supported.includes(event.type) || !event.customer) return { received: true };
    const account = await this.repository.models.accounts
      .findOne({ customerId: event.customer })
      .lean();
    if (!account) return { received: true };
    await this.synchronize(String(account._id), { id: event.id, type: event.type, hash });
    return { received: true };
  }
}
