# Admin dashboard — creatorsignals.blog/admin

A private dashboard for page views, product clicks, free downloads, confirmed Payhip orders, refunds and net revenue.
**No personal data is stored:** no cookies, no IP addresses, no e-mail addresses, no names.

## How it works

| Part | What it does | Where |
|---|---|---|
| Cookieless measurement | Counts page views, product-button clicks and Starter Kit download clicks. Respects Global Privacy Control / Do Not Track. Kept 25 months | `public/assets/js/main.js` → `POST /api/e` |
| Payhip webhook | Receives signed `paid` and `refunded` events. Each order and each refund is processed once (idempotent). Only order number, product, amount, fees and refund status are stored | `POST /api/payhip/webhook` |
| Admin UI | Overview · Traffic · Products · Orders · Campaigns · Settings; 7D / 30D / 90D / All; CSV export; times in Europe/Amsterdam | `public/admin/`, `public/assets/{js,css}/admin.*` |
| Access control | Cloudflare Access in front, plus a fail-closed check of the Access token in the Worker (signature, audience, issuer, expiry, optional e-mail allow-list) | `src/worker.js` |
| Database | Cloudflare D1 `creator-signals-admin` (schema already applied) | `migrations/0001_admin.sql` |

**What is not measured:**
- Unique visitors: that would need an identifier.
- Checkout starts: these are visible only in Payhip's own analytics.
- Which campaign led to a purchase: Payhip does not pass campaign data.

The dashboard says so where it matters and never fills gaps with estimates.

## One-time setup (owner)

1. **Cloudflare Access** (Zero Trust → Access → Applications → *Self-hosted*):
   - Domains: `creatorsignals.blog/admin` and `creatorsignals.blog/api/admin`.
   - Policy: *Allow* only your own e-mail address, with one-time PIN or your identity provider (2FA).
   - Copy the **team domain** (`<team>.cloudflareaccess.com`) and the **Application Audience (AUD) tag** into `wrangler.jsonc` → `vars.ACCESS_TEAM` / `vars.ACCESS_AUD`.
   - Put your e-mail address in `ADMIN_EMAILS`.
   - Until these are set, `/admin` answers 403 (fail closed).
   - The Worker check also protects the `*.workers.dev` and preview URLs, which Access does not cover.
2. **Payhip secret** — Payhip → Settings → Developer → API key:
   - Store it as a Worker secret with `npx wrangler secret put PAYHIP_API_KEY`, or in the Cloudflare dashboard → Worker → Settings → Variables → *Secret*.
   - Never put it in the repo.
3. **Payhip webhook** — Payhip → Settings → Developer → Webhooks:
   - URL `https://creatorsignals.blog/api/payhip/webhook`.
   - Events: `paid` and `refunded`.
4. **Accelerator product** — once it exists in Payhip, enter its key (the code in `payhip.com/b/XXXXX`) in Admin → Settings.
5. **Check it:** make one test purchase with a 100 % coupon. It shows up as *Test* and is kept out of revenue. Refund it and check that it shows as *Refunded*.

## Tests

`npm run test:worker` runs 57 checks against the real Worker with an in-memory SQLite in place of D1:
- measurement;
- webhook signature and idempotency;
- refunds and test orders;
- Access token checks (forged, expired, wrong audience, not on the allow-list);
- CSRF on changes;
- CSV exports.

It runs in CI and in `npm run check`.
