# Test billing setup and operation

Phase 12 uses Stripe-hosted Checkout and Billing Portal with server-only Stripe SDK 23.0.0, whose pinned API version is `2026-09-30.endive`. Only test secret keys and test events are accepted. Billing defaults to disabled. The user explicitly deferred live sandbox verification; deterministic HTTP fixtures exercise the SDK, API, MongoDB transactions and browser without an account or real charge. They do not verify the Stripe-hosted payment experience.

## Configure a sandbox later

Create a Stripe sandbox in your own account. Create Pro and Business products with flat organization prices: one monthly USD price and one yearly USD price for each product. Use recurring, per-unit prices with interval count one and quantity one; do not use tiered, metered or transformed quantities. ORBIT reads actual amounts from these four prices, rather than trusting browser amounts or illustrative marketing prices. Do not use live mode or real payment details.

Add these variables to ignored root `.env.local`, never to a `VITE_*` variable or a commit:

```dotenv
BILLING_MODE=stripe-test
STRIPE_SECRET_KEY=<your-sandbox-sk_test-key>
STRIPE_WEBHOOK_SECRET=<your-listener-whsec-secret>
STRIPE_PRO_MONTH_PRICE=<monthly-pro-price-id>
STRIPE_PRO_YEAR_PRICE=<yearly-pro-price-id>
STRIPE_BUSINESS_MONTH_PRICE=<monthly-business-price-id>
STRIPE_BUSINESS_YEAR_PRICE=<yearly-business-price-id>
STRIPE_PORTAL_CONFIGURATION=<optional-test-bpc-configuration-id>
```

Use four distinct `price_` IDs. Configure the sandbox customer portal to permit the intended product/price changes, cancellation at period end, resumption and invoice access. An explicit `bpc_` configuration is optional; otherwise Stripe's default test portal configuration applies. ORBIT does not silently provision products, prices or portal settings. Restart the API after changing configuration. `APP_ORIGIN` must match the frontend; the native fixture overrides it to `http://127.0.0.1:5174`.

Install and authenticate the official Stripe CLI yourself when ready. For the native fixture, run:

```powershell
stripe listen --events checkout.session.completed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.trial_will_end,invoice.paid,invoice.payment_failed,invoice.updated,invoice.finalized --forward-to http://127.0.0.1:4001/api/v1/webhooks/stripe
```

For the normal API use port 4000. Copy that listener's signing secret into local configuration and restart the API. No CLI, account, model or system prerequisite is installed automatically.

## Acceptance still pending

Sign in as an organization owner, open **Billing**, review the real test prices, choose a plan and confirm. Use Stripe's documented test payment details in hosted Checkout. The return URL cannot grant a plan. Verify signed delivery, provider synchronization, a real sandbox subscription and invoice, a declined test payment, a trial ending, cancel-at-period-end, resumption and plan changes through the test portal. Check another organization remains unchanged. Do not describe these checks as passed until they are executed.

## Entitlements and permissions

| Capability                                                  | Free | Pro | Business |
| ----------------------------------------------------------- | ---- | --- | -------- |
| Workspaces per organization                                 | 3    | 20  | 100      |
| Projects, including archives                                | 10   | 100 | 500      |
| Enabled scheduled AI workflows                              | 0    | 10  | 50       |
| CSV analytics exports                                       | No   | Yes | Yes      |
| Core tasks, collaboration, documents, dashboards, manual AI | Yes  | Yes | Yes      |

Existing operational bounds and AI usage limits still apply. Current organization owners can open checkout and the portal. Owners/admins can read private billing history and refresh provider state. Other members can read only the limited plan/limit summary. Workspace and project authorization remain independent from billing rights.

Only `active` subscriptions within their verified period, or `trialing` subscriptions before their trial deadline, receive paid access. `past_due`, `unpaid`, `paused`, `incomplete`, `incomplete_expired`, `canceled`, expired periods and missing subscriptions use Free limits. Active cancel-at-period-end retains access through the verified period. Unsupported canonical subscription quantities/prices/customers place paid entitlements on hold until valid reconciliation. Data is retained after a downgrade; reads, edits, archival and removal remain available. Over-limit organizations cannot create additional workspaces/projects. Over-limit enabled workflow counts must be reduced before scheduled execution resumes. No existing work is automatically deleted.

Trials require an explicit checkbox, collect a test payment method and last14 days. Only one trial checkout is created per organization; the reservation remains consumed even if that checkout is abandoned. Retrying that original request remains allowed. No trial is silently enabled.

## Reliability and recovery

Checkout selections have durable UUID/fingerprint identities, a displayed-price quote hash, fixed expiry parameters, server-selected prices and stable Stripe idempotency keys. One pending checkout per organization prevents competing subscription intents. The page offers explicit resume after reload; expired requests cannot be reused. An uncertain customer request older than 23 hours requires manual provider reconciliation before another customer can be created. Never clear pending records or write a plan manually to bypass an error.

Signed raw-body webhooks retrieve canonical current provider subscriptions and invoices. A per-organization90 second lease serializes synchronization; a transaction commits the account, invoices and processed event identity together. A processed duplicate is acknowledged without reapplying; altered duplicate identities are rejected. A provider/database failure returns a retryable error and leaves the event uncommitted. Unknown customers/events do not grant access. Invoice/subscription retrieval is bounded to 100 records; larger histories require an explicit reconciliation extension, rather than silently applying partial results. Raw payloads and card details are not retained.

Current permissions are rechecked after provider calls. Existing plan restrictions are checked on the server, including automation execution and output commit. Paid access reflects the last verified provider state and its expiry, not a continuously polled guarantee. Restore webhook forwarding and use **Refresh provider status** after an outage. Canonical subscription mismatches hold paid access; fix the sandbox catalog/subscription and refresh. Portal settings and tax/proration behavior belong to the configured Stripe test account; review them in the portal before confirming a change.

Run `pnpm test:billing:integration` and `pnpm test:billing:e2e` for isolated deterministic verification. `pnpm test:auth:compose` includes them in full CI. Llama is not needed and remains unloaded. [Phase 12 plan](PHASE12_PLAN.md).

Official references: [Checkout subscriptions](https://docs.stripe.com/payments/checkout/build-subscriptions), [webhook signatures, retries and local forwarding](https://docs.stripe.com/webhooks), [idempotency](https://docs.stripe.com/api/idempotent_requests), [Billing Portal](https://docs.stripe.com/customer-management), [subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview), [sandbox testing](https://docs.stripe.com/testing).
