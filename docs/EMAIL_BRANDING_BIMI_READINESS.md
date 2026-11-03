# Altuvera Safaris email branding and BIMI readiness

Last audited: 2026-11-03

## Current verified state

- The sender display name is `Altuvera Safaris` and the authenticated sender address is `info@altuverasafaris.com`.
- The backend's latest observed OTP delivery in Render logs used Resend.
- A Resend DKIM TXT selector exists at `resend._domainkey.altuverasafaris.com`.
- The Resend/SES return-path subdomain has an MX record at `send.altuverasafaris.com` and SPF `v=spf1 include:amazonses.com ~all`.
- The organizational domain has Cloudflare Email Routing SPF: `v=spf1 include:_spf.mx.cloudflare.net ~all`.
- Cloudflare Email Routing's DKIM selector `cf2024-1._domainkey.altuverasafaris.com` is present.
- DMARC monitoring is enabled, not enforcement:
  `v=DMARC1; p=none; rua=mailto:dmarc-reports@altuverasafaris.com; fo=1; adkim=r; aspf=r; pct=100`
- The Cloudflare rule `DMARC aggregate report forwarding` routes `dmarc-reports@altuverasafaris.com` to the already verified Email Routing destination. Do not delete it while DMARC aggregate reports are enabled.
- No BIMI DNS record or mark certificate was present at the last audit.

## Logo assets

Authoritative site asset:
- GitHub: `public/altuvera.png`
- Brand helper: `src/utils/seo.js` uses `/altuvera.png`
- Cloudinary public ID: `altuvera_qzbcvf`
- Canonical public email-header image: `https://www.altuverasafaris.com/altuvera.png` (the direct official asset is now the shared template default).
- Optimized email derivative (optional fallback): `https://res.cloudinary.com/doijjawna/image/upload/c_fit,h_96,w_192/f_png/q_auto/v1784310142/altuvera_qzbcvf.png`

BIMI staging candidate (NOT validated, NOT production-ready):
- `https://res.cloudinary.com/doijjawna/image/upload/v1793563971/altuvera_bimi_vector_candidate.svg`
- Cloudinary asset folder: `brand-assets/bimi-staging`
- Candidate generated with Cloudinary vectorization from the official PNG.
- The file's SVG extension and square dimensions do not prove SVG Tiny PS compliance. Do not publish a BIMI DNS record until the SVG is validated against the current BIMI SVG Tiny PS requirements and the final artwork is approved.

## Requirements before BIMI can go live in Gmail

1. Validate and approve a square, self-contained SVG Tiny PS logo (version 1.2, baseProfile tiny-ps, title, no prohibited elements or external resources, no embedded raster image).
2. Verify SPF and DKIM alignment from every service that sends as `@altuverasafaris.com`. Resend was seen in the recent delivery log; do not assume SendGrid is configured or authenticated based only on code presence.
3. Review DMARC aggregate XML reports delivered to `dmarc-reports@altuverasafaris.com`. Keep `p=none` during this monitoring phase.
4. Confirm certificate eligibility with an approved mark-certificate issuer. A VMC generally requires a qualifying registered mark; a CMC prior-use path requires accepted historical proof that the same mark appeared on the controlled domain at least 12 months before verification. The public GitHub history shows `public/altuvera.png` in the repository from 2026-07-04; that history alone does not satisfy a 12-month prior-use test as of this audit date. Older domain/archive evidence or a qualifying registered trademark may change eligibility.
5. Only after all sender sources are aligned and certificate requirements are met, move DMARC to `p=quarantine` or `p=reject` with `pct=100`, wait for provider-required stability, then publish `default._bimi.altuverasafaris.com` with the final SVG and certificate PEM URL.

## Safety notes

- Do not change the existing root SPF record by simply adding another SPF TXT record. SPF permits only one policy record per hostname; merge authorized senders into the existing record only after verifying the exact provider requirements.
- Do not add guessed SendGrid DKIM CNAMEs or guessed SPF includes.
- Do not publish the current staging SVG as a certified BIMI asset.
- The shared OTP template is structured to improve Gmail recognition: the six-digit OTP leads the subject, appears as the first visible content after the official email header, and is the first line of the plain-text alternative. It is followed by an explicit "Altuvera Safaris verification code" label and expiry/security guidance.
- Gmail's native "Copy code" shortcut remains a Gmail-side heuristic. Google has not published a sender-side guarantee or a tag that forces the shortcut; its appearance cannot be promised, even when an email follows common OTP patterns.
- A logo embedded in the email body does NOT set Gmail's circular sender avatar. That avatar requires supported brand authentication such as BIMI. The current domain is still at DMARC `p=none` with no VMC/CMC, so no BIMI DNS record should be published yet.

