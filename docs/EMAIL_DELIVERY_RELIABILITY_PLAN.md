# Altuvera Safaris — durable email delivery architecture

Status: staged migration plan, 2026-11-01

## Safety constraint

`chryslucky2@gmail.com` is a personal test-only inbox. Never use it for customer mail, production alerts, DMARC reports, mailing-list destinations, or provider webhook notifications. The existing verified business DMARC-report destination remains the production reporting destination. Use a separate test environment and explicit test recipient allowlist for authentication tests.

## Current architecture (verified in repository)

- `utils/email.js` is the canonical provider policy and branded email path.
- `utils/emailService.js` is a compatibility adapter for legacy positional call sites.
- `utils/emailOutbox.js` stores queued mail in PostgreSQL, encrypts message payloads with AES-256-GCM, applies idempotency keys, retry delays, lease handling, recipient suppression, and conservative `uncertain` status when a duplicate risk exists.
- `routes/resendWebhook.js` records Resend delivery events and suppression signals.
- Provider selection is controlled by `EMAIL_PROVIDER=auto|resend|sendgrid|smtp`; automatic provider fallback is opt-in via `EMAIL_FAILOVER_ENABLED=true`.
- Resend was the observed provider for a recent OTP delivery. This does not prove SendGrid is authenticated, healthy, or safe to use as a fallback.

## Recommendation

Do not replace the working provider solely because an alternative is open source. An open-source MTA provides software control, not automatic inbox placement or IP reputation. The application queue, observability, and delivery policy are the reliability layer; the outbound relay is a swappable transport.

Recommended near-term:
1. Keep Resend as the explicit production provider while measuring real delivery and bounce outcomes.
2. Keep provider failover disabled until each fallback has verified domain authentication, webhooks, suppression sync, rate limits, and known delivery semantics.
3. Keep SendGrid available only as a separately tested candidate; don't infer domain authentication from the presence of an API key.
4. Treat SMTP through a consumer mailbox as emergency/development transport, not a high-volume transactional platform.
5. Use the existing encrypted PostgreSQL outbox as the source of truth; never let a timeout automatically trigger a second provider send unless the first provider definitively rejected the request or idempotency is guaranteed across that provider's retry window.
6. Keep separate traffic classes and idempotency keys for authentication/security, booking lifecycle, customer support, and marketing. Marketing must honor consent/unsubscribe and must not share OTP retry behavior.

## Open-source candidates

### Postal — best candidate for a controlled self-hosted delivery pilot
- Project: https://github.com/postalserver/postal
- Documentation: https://docs.postalserver.io/
- Provides an open-source mail delivery platform, message logs, webhooks, and IP pools.
- Trade-off: Altuvera would own IP reputation, DNS, reverse DNS, feedback loops, abuse prevention, blocklist monitoring, TLS, server patching, and delivery operations. It may be less reliable than a managed relay until those are staffed and measured.
- Decision: pilot in staging on a separate sending subdomain and dedicated IP only if the hosting provider permits outbound mail and supplies static IP plus PTR/rDNS. Do not route production OTPs through it until it beats the current baseline over a sustained test.

### Posta — opt-in staging adapter only (not approved for production)

- Upstream: https://github.com/goposta/posta
- API docs: https://docs.goposta.dev/
- The repository advertises a self-hosted Go API, PostgreSQL/Redis-backed async delivery, webhooks, suppression and campaign features.
- Altuvera now has a guarded adapter in `utils/posta.js`, selected only with explicit `EMAIL_PROVIDER=posta` and both `POSTA_BASE_URL` and `POSTA_API_KEY`. It is deliberately excluded from automatic provider selection.
- The adapter requires HTTPS outside localhost, refuses CC/BCC until the API contract supports them safely, and treats network/5xx delivery outcomes as uncertain because the public API does not document a send-idempotency key. It only marks a 429 response as a safe transient rejection.
- Upstream API docs describe queued IDs but do not document a client-provided idempotency key; do not assume retries are duplicate-safe.
- **License review required:** the GitHub repository's `LICENSE` file declares AGPL-3.0-or-later, while the hosted documentation site says Apache 2.0. This inconsistency must be resolved with the maintainer/legal review before adoption.
- **Decision:** staging adapter only. Do not provision or configure production Posta, change production sender, or publish DNS until license, authentication, webhook signing, suppression, rate limiting, delivery events, and canary performance have all been verified. Current production remains Resend with failover disabled.

### Haraka — SMTP/MTA building block, not a complete replacement by itself
- Project: https://github.com/haraka/Haraka
- Documentation: https://haraka.github.io/
- Extensible Node.js SMTP server with plugin hooks and outbound queueing.
- Trade-off: it is not a full mailbox/store solution; it requires more operational integration and does not provide deliverability reputation for free.
- Decision: not the first choice for this application's initial migration.

### listmonk — newsletter/campaign management, not the core transactional transport
- Project: https://github.com/knadh/listmonk
- Documentation: https://listmonk.app/docs/
- Useful for consent-managed subscriber lists, campaigns, and high-throughput mailing workflows. It still needs an SMTP delivery service.
- Decision: consider only for a separate marketing workflow; don't move OTP, security alerts, or booking emails into a campaign tool.

## Rollout gates (do not skip)

### Gate A — establish a baseline
For each email class, measure at least 100 test/consented deliveries where feasible, including Gmail, Outlook, and a non-Google mailbox. Track provider accepted, delivered, deferred, bounced, complaint, median delivery latency, p95 latency, and duplicate count. Never use a real customer list for provider trials.

### Gate B — authenticate every sender
- Inventory every service that can send as `@altuverasafaris.com`.
- Verify SPF/DKIM alignment and DMARC results from aggregate reports.
- Use a separate subdomain for any self-hosted pilot (for example, a dedicated mail subdomain), not the main authentication sender.
- Keep DMARC at `p=none` until the inventory and reports show all legitimate sources aligned.
- Do not create multiple SPF TXT records at the same hostname.

### Gate C — provider-specific integration
- Implement a common adapter contract: `send(message, { idempotencyKey })`, `verifyConfig()`, `normalizeWebhook(event)`, and `classifyFailure(error)`.
- Normalize provider message IDs and delivery events.
- Verify webhook signatures and replay protection.
- Persist provider event IDs uniquely, process events idempotently, and sync hard bounces/complaints into `email_suppressions`.
- Explicitly classify definitive rejection vs unknown outcome. Unknown outcome becomes `uncertain`, not cross-provider resend.

### Gate D — canary and rollback
- Canary only test recipients or explicitly consented internal testers.
- Keep production on the current provider during the canary.
- Promote only after the candidate meets or beats delivery and latency thresholds, passes SPF/DKIM/DMARC checks, has working signed webhooks and suppression handling, and survives a provider outage test.
- Roll back by setting `EMAIL_PROVIDER=resend` and restarting the service; don't change DNS or delete the old credentials until rollback is verified.

## Immediate operational checklist

- [ ] Confirm production `EMAIL_OUTBOX_ENCRYPTION_KEY` is set to a random base64-encoded 32-byte key in the secret manager (never commit it).
- [ ] Confirm the outbox worker is enabled and its due-job counts are monitored.
- [ ] Verify the production provider by a server-side log/health diagnostic; don't infer it from which keys happen to exist.
- [ ] Verify SendGrid domain authentication in its own console before enabling it as a fallback.
- [ ] Test the Resend webhook signature and bounce/complaint event path using provider test events.
- [ ] Add a non-sending health endpoint/command that reports provider selection, credential presence (boolean only), outbox key readiness, webhook configuration readiness, and worker state without exposing secrets.
- [ ] Run an isolated Postal staging pilot only after outbound port 25, static IP, PTR/rDNS, abuse controls, and DNS authentication are available.

## Decision

Current recommended production setup: canonical app outbox + Resend as explicit primary + failover disabled until verified. Evaluate Postal in staging as the first open-source candidate, but do not promise better inbox placement without measured evidence.
