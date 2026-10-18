import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, ShieldCheck, Sparkles, RefreshCw, Layers3 } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@orbit/ui';
import {
  billingDashboardSchema,
  billingRedirectSchema,
  billingHistorySchema,
  planLimits,
  type BillingPlan,
  type BillingInterval,
  type CheckoutInput,
} from '@orbit/contracts';
import { TenantShell, TenantState } from '../components/TenantShell';
import { StatusNotice } from '../components/AuthLayout';
import { useOrganization, orgPath, validId } from '../lib/tenants';
import { useAuth, authErrorMessage, AuthServiceError } from '../lib/auth';
import '../billing.css';
const title = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(value),
      )
    : 'Not available';
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);
export default function BillingPage() {
  const { organizationId } = useParams(),
    auth = useAuth(),
    organization = useOrganization(organizationId),
    [search] = useSearchParams();
  return (
    <TenantShell title="Billing" organization={organization.data}>
      {!validId(organizationId) ? (
        <TenantState />
      ) : organization.isPending ? (
        <TenantState loading />
      ) : organization.isError ? (
        <TenantState error={organization.error} retry={() => void organization.refetch()} />
      ) : (
        <BillingContent
          key={`${auth.user?.id}-${organizationId}`}
          org={organizationId}
          returnState={search.get('checkout')}
        />
      )}
    </TenantShell>
  );
}
function BillingContent({ org, returnState }: { org: string; returnState: string | null }) {
  const auth = useAuth(),
    client = useQueryClient(),
    [interval, setInterval] = useState<BillingInterval>('month'),
    [trial, setTrial] = useState(false),
    [dialog, setDialog] = useState<CheckoutInput | 'portal' | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [denied, setDenied] = useState<Error | null>(null),
    [notice, setNotice] = useState(''),
    trigger = useRef<HTMLElement | null>(null),
    identity = useRef<{ fingerprint: string; requestId: string } | null>(null),
    [extra, setExtra] = useState<ReturnType<typeof billingHistorySchema.parse>['invoices']>([]),
    [cursor, setCursor] = useState<string | null | undefined>(undefined),
    [historySnapshot, setHistorySnapshot] = useState<string | null>(null),
    [loadingHistory, setLoadingHistory] = useState(false);
  const prefix = `/${org}/billing`,
    query = useQuery({
      queryKey: ['billing', auth.user?.id, org],
      queryFn: () =>
        auth.request(prefix, billingDashboardSchema, 'GET', undefined, 'organizations', 35000),
      retry: 1,
      refetchOnWindowFocus: true,
    }),
    data = query.data;
  function failure(caught: unknown) {
    if (caught instanceof AuthServiceError && [401, 403, 404].includes(caught.status))
      setDenied(caught);
    setError(authErrorMessage(caught));
  }
  const open = (choice: CheckoutInput | 'portal', element: HTMLElement) => {
    trigger.current = element;
    setError('');
    setDialog(choice);
  };
  const requestCheckout = (plan: 'pro' | 'business', element: HTMLElement) => {
    const hash = JSON.stringify({ plan, interval, trial, quoteId: data?.quoteId });
    if (identity.current?.fingerprint !== hash)
      identity.current = { fingerprint: hash, requestId: crypto.randomUUID() };
    open(
      {
        requestId: identity.current.requestId,
        quoteId: data!.quoteId!,
        plan,
        interval,
        trial,
        confirmed: true,
      },
      element,
    );
  };
  async function refresh() {
    setPending(true);
    setError('');
    setNotice('');
    try {
      const updated = await auth.request(
        `${prefix}/refresh`,
        billingDashboardSchema,
        'POST',
        {},
        'organizations',
        60000,
      );
      queryClientUpdate(updated);
      setNotice('Provider status synchronized. Your current entitlements are shown below.');
    } catch (e) {
      failure(e);
    } finally {
      setPending(false);
    }
  }
  function queryClientUpdate(updated: typeof data) {
    if (updated) {
      client.setQueryData(['billing', auth.user?.id, org], updated);
      setExtra([]);
      setCursor(undefined);
    }
  }
  async function confirm() {
    if (!dialog) return;
    setPending(true);
    setError('');
    try {
      const result = await auth.request(
        `${prefix}/${dialog === 'portal' ? 'portal' : 'checkout'}`,
        billingRedirectSchema,
        'POST',
        dialog === 'portal' ? { confirmed: true } : dialog,
        'organizations',
        60000,
      );
      const url = new URL(result.url);
      if (
        url.protocol !== 'https:' ||
        !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)
      )
        throw new Error('Invalid provider destination');
      window.location.assign(url.href);
    } catch (e) {
      failure(e);
      void query.refetch();
      setPending(false);
    }
  }
  if (query.isPending) return <TenantState loading />;
  if (denied) return <TenantState error={denied} />;
  if (query.isError || !data)
    return <TenantState error={query.error} retry={() => void query.refetch()} />;
  const currentHistorySnapshot = JSON.stringify(data.history),
    visibleExtra = historySnapshot === currentHistorySnapshot ? extra : [];
  const active = ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete'].includes(
      data.status,
    ),
    nextCursor =
      historySnapshot !== currentHistorySnapshot || cursor === undefined
        ? data.history.nextCursor
        : cursor;
  return (
    <div className="billing-page">
      <div className="tenant-eyebrow">
        <span />
        ORBIT · ORGANIZATION BILLING
      </div>
      <div className="billing-heading">
        <div>
          <h1>Room for what’s next.</h1>
          <p>A plan for your organization. A clear view of what it includes.</p>
        </div>
        <span className="billing-test">
          <ShieldCheck size={16} /> Test mode · no real charges
        </span>
      </div>
      {returnState === 'returned' ? (
        <StatusNotice tone="info">
          You returned from checkout. Payment is not confirmed by this page. Refresh provider status
          to verify your subscription.
        </StatusNotice>
      ) : returnState === 'canceled' ? (
        <StatusNotice tone="info">
          Checkout was closed. Your plan has not been changed by this return link.
        </StatusNotice>
      ) : null}
      {data.providerMessage ? (
        <StatusNotice tone="info">{data.providerMessage}</StatusNotice>
      ) : null}
      {!data.canManage ? (
        <StatusNotice tone="info">
          You can view billing as an administrator. Only an organization owner can open checkout or
          manage subscriptions.
        </StatusNotice>
      ) : null}
      {error && !dialog ? <StatusNotice>{error}</StatusNotice> : null}
      {notice ? <StatusNotice tone="success">{notice}</StatusNotice> : null}
      <section className="billing-current" aria-labelledby="current-plan-heading">
        <div>
          <span className="tenant-eyebrow">YOUR CURRENT PLAN</span>
          <h2 id="current-plan-heading">
            {title(data.plan)} <span>{title(data.status)}</span>
          </h2>
          <p>
            {data.status === 'trialing'
              ? `Trial ends ${date(data.trialEnd)} (UTC).`
              : data.plan === 'free'
                ? 'Core work, one shared place.'
                : `${title(data.interval ?? 'month')}ly organization subscription.`}
          </p>
          {data.cancelAtPeriodEnd ? (
            <p className="billing-cancellation">
              Cancellation scheduled for {date(data.periodEnd)} (UTC). Access continues only through
              the active paid period.
            </p>
          ) : null}
          {data.subscriptionPlan !== 'free' && data.plan === 'free' ? (
            <p>
              Your {title(data.subscriptionPlan)} subscription is {title(data.status).toLowerCase()}{' '}
              or its verified period ended. Free limits currently apply.
            </p>
          ) : null}
          <small>
            Last provider sync:{' '}
            {data.syncedAt ? date(data.syncedAt) + ' (UTC)' : 'Not yet synchronized'}
          </small>
        </div>
        <div className="billing-actions">
          <Button
            variant="secondary"
            disabled={!data.configured || pending}
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} />
            {pending ? 'Please wait…' : 'Refresh provider status'}
          </Button>
          <Button
            disabled={!data.canManage || !data.configured || pending}
            onClick={(event) => open('portal', event.currentTarget)}
          >
            Manage subscription
            <ArrowUpRight size={15} />
          </Button>
        </div>
      </section>
      <section className="billing-usage" aria-label="Organization usage">
        {(['workspaces', 'projects', 'scheduledWorkflows'] as const).map((kind) => {
          const count = data.usage[kind],
            limit = data.limits[kind],
            label = kind === 'scheduledWorkflows' ? 'Scheduled workflows' : title(kind);
          return (
            <article key={kind}>
              <span>{label}</span>
              <strong>
                {count}
                <small> / {limit}</small>
              </strong>
              <progress
                aria-label={`${label} usage`}
                value={Math.min(count, Math.max(limit, 1))}
                max={Math.max(limit, 1)}
              />
              <p>
                {count > limit
                  ? 'Above the current plan limit. Existing data is retained.'
                  : limit === 0
                    ? 'Available on Pro and Business.'
                    : 'Across this organization.'}
              </p>
            </article>
          );
        })}
      </section>
      <section aria-labelledby="choose-plan-heading">
        <div className="billing-section-heading">
          <div>
            <span className="tenant-eyebrow">A LITTLE MORE SPACE</span>
            <h2 id="choose-plan-heading">Choose your next orbit.</h2>
          </div>
          <div className="billing-period" role="group" aria-label="Billing interval">
            {(['month', 'year'] as const).map((value) => (
              <button
                key={value}
                aria-pressed={interval === value}
                onClick={() => setInterval(value)}
              >
                {value === 'month' ? 'Monthly' : 'Yearly'}
              </button>
            ))}
          </div>
        </div>
        {data.canManage ? (
          <label className="billing-trial">
            <input
              type="checkbox"
              checked={trial}
              disabled={data.trialUsed || pending}
              onChange={(event) => setTrial(event.target.checked)}
            />
            <span>
              Include a 14-day trial on a new paid subscription.{' '}
              {data.trialUsed
                ? 'This organization has already used its trial.'
                : 'Once per organization; a test payment method is required.'}
            </span>
          </label>
        ) : null}
        <div className="billing-plans">
          {(['free', 'pro', 'business'] as const).map((plan: BillingPlan) => {
            const limits = planLimits[plan],
              price = data.prices.find((row) => row.plan === plan && row.interval === interval);
            return (
              <article
                key={plan}
                className={`billing-plan ${plan === 'pro' ? 'billing-featured' : ''}`}
              >
                <div className="billing-plan-icon">
                  {plan === 'business' ? <Layers3 /> : <Sparkles />}
                </div>
                <h3>{title(plan)}</h3>
                <p>
                  {plan === 'free'
                    ? 'A thoughtful place to begin.'
                    : plan === 'pro'
                      ? 'More room for connected work.'
                      : 'Space for your whole organization.'}
                </p>
                <div className="billing-price">
                  {plan === 'free' ? (
                    <strong>$0</strong>
                  ) : price ? (
                    <strong>{money(price.amount, price.currency)}</strong>
                  ) : (
                    <strong>Not configured</strong>
                  )}
                  <span>{plan === 'free' ? 'Always free' : `per organization / ${interval}`}</span>
                </div>
                <ul>
                  <li>
                    <Check size={15} />
                    {limits.workspaces} workspaces
                  </li>
                  <li>
                    <Check size={15} />
                    {limits.projects} projects, including archives
                  </li>
                  <li>
                    <Check size={15} />
                    Tasks, collaboration and documents
                  </li>
                  <li>
                    <Check size={15} />
                    {limits.csvExport ? 'CSV analytics exports' : 'Analytics dashboards'}
                  </li>
                  <li>
                    <Check size={15} />
                    {limits.scheduledWorkflows
                      ? `${limits.scheduledWorkflows} scheduled AI workflows`
                      : 'Manual AI assistance'}
                  </li>
                </ul>
                <Button
                  variant={plan === 'pro' ? 'primary' : 'secondary'}
                  disabled={
                    plan === 'free' || !data.canManage || !data.configured || !price || pending
                  }
                  onClick={(event) => {
                    if (plan === 'free') return;
                    if (active) open('portal', event.currentTarget);
                    else requestCheckout(plan, event.currentTarget);
                  }}
                >
                  {plan === 'free'
                    ? data.plan === 'free'
                      ? 'Current plan'
                      : 'Managed in portal'
                    : data.plan === plan
                      ? 'Manage plan'
                      : active
                        ? 'Change in test portal'
                        : `Choose ${title(plan)}`}
                </Button>
              </article>
            );
          })}
        </div>
        <p className="billing-footnote">
          Prices come from your configured Stripe sandbox. All paid plans use one organization
          subscription, quantity one. Switching plans, cancellation and resumption happen in the
          test portal. Downgrades preserve existing work.
        </p>
      </section>
      {data.pendingCheckout ? (
        <section className="billing-pending">
          <div>
            <h2>A checkout is waiting.</h2>
            <p>
              {title(data.pendingCheckout.plan)} ·{' '}
              {data.pendingCheckout.interval === 'month' ? 'Monthly' : 'Yearly'}
              {data.pendingCheckout.trial ? ' · 14-day trial' : ''}. Expires{' '}
              {date(data.pendingCheckout.expiresAt)} (UTC). Resume the same request to avoid
              duplicate subscriptions.
              {data.pendingCheckout.quoteId !== data.quoteId
                ? ' Pricing changed or is unavailable; refresh pricing and wait for this pending checkout to expire before choosing a new plan.'
                : ''}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={pending || !data.configured || data.pendingCheckout.quoteId !== data.quoteId}
            onClick={(event) => {
              const choice = data.pendingCheckout!;
              open(
                {
                  requestId: choice.requestId,
                  quoteId: choice.quoteId,
                  plan: choice.plan,
                  interval: choice.interval,
                  trial: choice.trial,
                  confirmed: true,
                },
                event.currentTarget,
              );
            }}
          >
            Resume pending checkout
          </Button>
        </section>
      ) : null}
      <section className="billing-history" aria-labelledby="billing-history-heading">
        <div className="billing-section-heading">
          <div>
            <span className="tenant-eyebrow">THE RECORD</span>
            <h2 id="billing-history-heading">Billing history</h2>
          </div>
          <ShieldCheck aria-hidden="true" size={20} />
        </div>
        {data.history.invoices.length + visibleExtra.length === 0 ? (
          <div className="billing-empty">
            <h3>No invoices yet.</h3>
            <p>
              Actual test invoices appear here after provider synchronization. No sample
              transactions are added.
            </p>
          </div>
        ) : (
          <div
            className="billing-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Invoice table, scroll horizontally"
          >
            <table>
              <caption className="sr-only">Private organization invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Date (UTC)</th>
                  <th scope="col">Status</th>
                  <th scope="col">Amount paid</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                {[...data.history.invoices, ...visibleExtra].map((invoice) => (
                  <tr key={invoice.id}>
                    <th scope="row">{invoice.number ?? 'Draft invoice'}</th>
                    <td>{date(invoice.createdAt)}</td>
                    <td>{title(invoice.status)}</td>
                    <td>{money(invoice.amountPaid, invoice.currency)}</td>
                    <td>
                      {invoice.hostedUrl ? (
                        <a
                          href={invoice.hostedUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open invoice ${invoice.number ?? invoice.id} in a new tab`}
                        >
                          Open invoice
                          <ArrowUpRight size={13} />
                        </a>
                      ) : (
                        'Not available'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor ? (
          <Button
            variant="secondary"
            disabled={loadingHistory}
            onClick={async () => {
              setLoadingHistory(true);
              setError('');
              try {
                const history = await auth.request(
                  `${prefix}/history?cursor=${nextCursor}`,
                  billingHistorySchema,
                  'GET',
                  undefined,
                  'organizations',
                );
                setExtra((rows) =>
                  historySnapshot === currentHistorySnapshot
                    ? [...rows, ...history.invoices]
                    : history.invoices,
                );
                setHistorySnapshot(currentHistorySnapshot);
                setCursor(history.nextCursor);
              } catch (e) {
                failure(e);
              } finally {
                setLoadingHistory(false);
              }
            }}
          >
            {loadingHistory ? 'Loading…' : 'Load older invoices'}
          </Button>
        ) : null}
        <p className="billing-footnote">
          Only owners and administrators can see billing details. Card information is handled by
          Stripe.
        </p>
      </section>
      <Link to={orgPath(org)}>Back to organization</Link>
      <Dialog
        open={!!dialog}
        onOpenChange={(value) => {
          if (!value && !pending) setDialog(null);
        }}
      >
        <DialogContent
          className="billing-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogTitle>
            {dialog === 'portal' ? 'Open the test billing portal?' : 'Review your test checkout'}
          </DialogTitle>
          <DialogDescription>
            {dialog === 'portal'
              ? 'Stripe will open in this tab. Manage plan changes, payment details, cancellation and resumption there. Changes affect only your organization’s test subscription.'
              : `You are choosing ${dialog ? title(dialog.plan) : ''} for this organization: ${
                  dialog
                    ? (() => {
                        const price = data.prices.find(
                          (row) => row.plan === dialog.plan && row.interval === dialog.interval,
                        );
                        return price ? money(price.amount, price.currency) : 'Price unavailable';
                      })()
                    : ''
                } per ${dialog?.interval === 'year' ? 'year' : 'month'}. ${dialog?.trial ? 'Includes a one-time 14-day trial, followed by recurring test billing until canceled.' : ''} This is Stripe test mode; use test payment details only.`}
          </DialogDescription>
          {error ? <StatusNotice>{error}</StatusNotice> : null}
          <div className="billing-dialog-actions">
            <Button variant="secondary" disabled={pending} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={() => void confirm()}>
              {pending
                ? 'Opening Stripe…'
                : dialog === 'portal'
                  ? 'Confirm and open portal'
                  : 'Confirm test checkout'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
