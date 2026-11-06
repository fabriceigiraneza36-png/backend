# Altuvera — Email delivery architecture and migration plan

Last reviewed: 2026-11-01

## Production architecture

All application send paths should use `utils/email.js` as the canonical boundary. Legacy entry points (`utils/emailService.js` and `services/emailservice.js`) are compatibility adapters and must not create their own provider clients or retry loops.

The canonical path is:

1. Render API service receives an email request.
2. `utils/email.js` normalizes the HTML/text payload, selects one provider, and writes an encrypted record to PostgreSQL `email_outbox`.
3. The request attempts delivery immediately after the durable insert.
4. The server outbox worker polls every 2 seconds and processes up to 10 due records per batch.
5. PostgreSQL row updates claim jobs atomically. Multiple instances can share the queue without claiming the same row.
6. Retry-safe errors are rescheduled with exponential backoff and jitter. Ambiguous outcomes are held in `uncertain`, not blindly resent through another provider.

## Provider policy

- The recent production-delivery log identified Resend as the active sender.
- Production is now explicitly pinned to `EMAIL_PROVIDER=resend`.
- Production is explicitly set to `EMAIL_FAILOVER_ENABLED=false`; failover must remain disabled until every fallback has verified authentication and tested delivery semantics.
- Shared policy lives in `utils/emailPolicy.js`: API transports may fail over only on explicit 429 rate-limit rejection; an HTTP 408 is treated as ambiguous. SMTP only on 421/450/451/452/454 temporary rejection. Permanent 4xx, 5xx/unknown outcomes, and network ambiguity do not trigger provider switching.
- The policy is unit-tested by `npm run test:email-policy` and is included in backend CI.
- Resend idempotency keys are used for authentication codes. Booking event mail uses booking-number/status keys.
- Resend supports idempotency keys on the single-email endpoint. The documented retention window is 24 hours; the stale-job recovery logic uses a 23-hour safety window.
- Do not automatically fail over to a different provider after a timeout, connection reset, permanent 4xx, or 5xx response. The remote provider may already have accepted the message and a second provider could create a duplicate. A fallback is eligible only for the narrow transient-rejection codes above, and only if the operator deliberately enables failover.

## Optional Posta staging adapter

- An opt-in adapter lives in `utils/posta.js`.
- It is selected only when `EMAIL_PROVIDER=posta` is explicitly configured with `POSTA_BASE_URL` and `POSTA_API_KEY`; automatic selection intentionally remains Resend, then SendGrid, then approved SMTP.
- Production must remain `EMAIL_PROVIDER=resend` with `EMAIL_FAILOVER_ENABLED=false` during evaluation.
- The adapter uses Posta's documented `POST /api/v1/emails/send` endpoint and accepts the returned queue ID as provider acceptance, not inbox delivery.
- Posta's public send endpoint does not document client idempotency keys or CC/BCC envelope support. The adapter therefore rejects CC/BCC explicitly and treats network/5xx outcomes as uncertain. Do not retry those through another provider.
- The adapter has isolated unit tests (`npm run test:posta-adapter`) but has not been connected to a Posta instance or tested against live DNS/sending infrastructure.
- The upstream repository declares AGPL-3.0-or-later in its `LICENSE`, while its hosted documentation describes Apache 2.0. Resolve this licensing discrepancy before any deployment or distribution.
- No Posta server has been provisioned and no Posta environment variables have been added to Render.

## Encrypted outbox

The `email_outbox` table stores the message body encrypted using AES-256-GCM. The encryption key must be base64 encoding of exactly 32 random bytes.

Required production secret:
- `EMAIL_OUTBOX_ENCRYPTION_KEY` (base64 encoding of exactly 32 random bytes; do not rotate without preserving the existing key for queued ciphertext)

Operational settings:
- `EMAIL_PROVIDER=resend`
- `EMAIL_FAILOVER_ENABLED=false`
- `EMAIL_OUTBOX_POLL_MS=5000` (default; lower bound 1000 ms)
- `EMAIL_CAMPAIGN_POLL_MS=5000` (default; lower bound 1000 ms)

Operator diagnostics:
- `npm run check:email` checks provider/key/webhook readiness without sending a message or printing secret values.
- `npm run test:email-policy` runs provider failover-policy tests.

Never print, log, commit, or put the encryption key into issue descriptions. Do not overwrite an existing key casually: existing queued ciphertext depends on it. Before planned rotation, stop enqueuing, drain or safely re-encrypt queued items with a versioned key ring, back up the database, then rotate and verify.

Outbox states:
- `queued`: stored and waiting for delivery or safe retry.
- `sending`: currently leased by a worker.
- `sent`: accepted by the selected email provider (this is **not** proof it reached the recipient's inbox).
- `failed`: provider definitively rejected the message or a non-retryable error occurred.
- `uncertain`: the provider outcome cannot be proven; the system pauses rather than risking duplicate mail.
- `expired`: message expired before it could be sent.

## Resend delivery webhook setup

The signed receiver is implemented at:

`https://backend-jd8f.onrender.com/api/webhooks/resend`

It is mounted before the global JSON body parser and verifies the original raw request body with the Resend SDK. It accepts the Svix `svix-id`, `svix-timestamp`, and `svix-signature` headers; an invalid signature gets HTTP 400, an unconfigured secret gets HTTP 503, and database processing errors get HTTP 500 so the provider can retry.

To activate it in Resend:

1. Open the Resend Webhooks dashboard and create an HTTPS endpoint using the URL above.
2. Subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`.
3. Copy the endpoint signing secret (`whsec_...`) into the Render backend environment as `RESEND_WEBHOOK_SECRET`. Do not put this secret in GitHub.
4. Send Resend's built-in webhook test event. Confirm the request returns HTTP 200 and that a unique event row appears in `email_provider_events`. Do not send a synthetic customer email to validate the endpoint.

Events are deduplicated by the signed `svix-id`. The event ledger stores a payload hash and metadata, not the full message. Delivery lifecycle state is separate from the outbox's provider-accepted state. Hard bounces, complaints and provider-suppressed addresses are added to `email_suppressions`; every new send and every queued retry checks this list before contacting a provider.

## Current gaps to close before calling the system fully production-hardened

1. Activate the Resend webhook by creating the endpoint and storing its signing secret in Render, then verify one built-in test event. Until this is done the endpoint intentionally responds HTTP 503 rather than accepting unverifiable events.
2. Add an admin view/alerts for queued, failed, expired and uncertain messages, with a safe manual replay path that reuses the same provider idempotency key whenever still within the provider's retention window.
3. Add provider health checks that do not send synthetic email to customers.
4. Add integration tests for concurrent outbox claims, duplicate idempotency keys, worker restarts, provider timeouts, rate limits, and payload-key mismatch.
5. Review the existing campaign sender and any one-off scripts before removing legacy provider dependencies.
6. Run `npm run check:email` against the production environment through the service's controlled shell/operational workflow and confirm the encryption key format without exporting or printing the key.
7. Confirm the current worker has no startup failures and monitor queued, failed and uncertain counts during a normal business cycle.

## Open-source options reviewed

### Postal — preferred self-hosted candidate for a controlled pilot

Postal is a maintained, open-source mail-delivery platform with an HTTP API and SMTP interface, queue/monitoring UI, webhooks, message logs, IP pools and delivery retries. The official release list showed v3.3.7 on 2026-06-03 at the time of review.

Postal is **not** a drop-in way to get better inbox placement for free. Its documentation recommends a dedicated server with at least 4 GB RAM, 2 CPU cores and 25 GB disk, plus Docker. The hosting provider must permit outbound TCP port 25; Postal's documentation warns that new VPS addresses may already be blocklisted. We must operate IP reputation, rDNS/PTR, SPF, DKIM, DMARC, bounce/complaint processing, abuse controls, rate limits, backups and patching.

Pilot design:
- Run Postal on a dedicated host, not inside the existing Render backend process.
- Use a separate sending subdomain such as `mail.altuverasafaris.com` after DNS and deliverability design is approved.
- Start in a staging/test domain with only internal test mailboxes (never route tests to a customer's address).
- Compare Gmail, Outlook and Yahoo acceptance, inbox placement, deferrals, bounce/complaint rates and latency against Resend for at least two weeks.
- Start with low-volume canary traffic only after the pilot meets the same authentication, suppression, observability and rollback requirements.
- Keep Resend available as the rollback route until the self-hosted sender proves stable over multiple sending cycles.

### Posta — watchlist, not production choice yet

Posta documents a modern self-hosted HTTP API, PostgreSQL/Redis-backed jobs, retries, webhooks and suppression features. It is a promising newer project, but it has a shorter operational track record than Postal. Evaluate its release cadence, security process, upgrade and backup procedures, issue response, migration tooling and real inbox placement before relying on it for account-security OTPs.

### What not to mistake for a complete sender

- Nodemailer is a Node.js transport library, not a sending network or a deliverability service.
- Postfix is a mature MTA, but operating it still requires infrastructure, IP reputation, feedback loops and abuse controls.
- A self-hosted open-source server does not automatically outperform a managed transactional ESP.

## Recommendation

Keep Resend as the single production provider now, behind the shared encrypted outbox. It currently has the known authenticated sending path and supports provider-side idempotency. Run Postal as a separate, opt-in pilot before any migration. Do not remove Resend or SendGrid dependencies until the new route demonstrates better real-world deliverability and the application has verified webhook/bounce handling and a tested rollback plan.
