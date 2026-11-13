# Creator Signals — creatorsignals.blog

[![Site checks](https://github.com/chodlrx-cmyk/Creator-Signals/actions/workflows/ci.yml/badge.svg)](https://github.com/chodlrx-cmyk/Creator-Signals/actions/workflows/ci.yml)

Website of **Creator Signals** — an independent learning platform for beginner TikTok creators.
*Learn → Create → Test → Analyze → Improve.*

Static HTML/CSS/JS, no framework and no build step. Hosted on **Cloudflare Workers** (static assets), deployed by Workers Builds.

## Structure

```
public/                          ← everything that is published
  index.html                     Home
  academy/                       Programs + curriculum
  academy/launchpad/day-8-hooks/ Free sample lesson
  tools/                         Hook Builder + Engagement Calculator
  tools/content-planner/         30-Day Content Planner
  blog/  privacy/  terms/  404.html
  assets/{css,js,img,fonts}
  _headers                       Security headers, CSP, caching (Cloudflare)
  robots.txt  sitemap.xml  site.webmanifest  .well-known/security.txt
scripts/                         Quality checks (used by CI)
wrangler.jsonc                   Cloudflare Workers config (assets = ./public, custom 404)
.github/                         CI workflow + Dependabot
```

## Local development

```bash
npm install          # once
npm run dev          # local Cloudflare runtime incl. _headers → http://localhost:8787
npm run check        # HTML validation + JS syntax + internal link check
```

## Deployment

Cloudflare **Workers Builds** is connected to this repo (Worker name: `creator-signals`).
Every push to `main` runs `npx wrangler deploy` and goes live automatically; the GitHub commit gets a
"Workers Builds" check showing the result. Pull requests get a preview version.

Cloudflare build settings: Build command **empty** · Deploy command **`npx wrangler deploy`** · Root directory **`/`**.
`npm run deploy:dry` validates the config locally without deploying.

## Working on the site

1. Create a branch, make your change, open a pull request.
2. The **Site checks** workflow must pass; check the Cloudflare preview link.
3. Merge into `main` → live within a minute.

Notes:
- Header and footer are repeated on every page — update all pages when the menu changes.
- The CSP in `public/_headers` only allows resources from this domain. Adding analytics, embeds or a
  newsletter provider means adding its domain there.
- Prices are shown as *planned launch price* — never show crossed-out "was" prices for products
  that were never sold at that price.
- Never put personal data in the HTML or JS.

## Language & region

- Creator Signals is an **international** learning platform. All copy is written in **British English**
  (analyse, optimise, programme, colour). CSS class names and code stay as they are.
- The method is always written as **Learn → Create → Test → Analyse → Improve**.
- TikTok features are verified with a **UK account** (primary test region). Every page footer carries
  the line *"Built for creators worldwide · TikTok features checked with a UK account"*.
- Prices are not converted to a currency until the payment platform is set up.

## Before public launch

- [ ] Create `hello@creatorsignals.blog` (Cloudflare Email Routing) — used on Privacy, Terms, security.txt
- [ ] Add operator details to Privacy & Terms and have them reviewed
- [ ] Newsletter provider (double opt-in) → set `NEWSLETTER_ENDPOINT` in `public/assets/js/main.js`,
      add its origin to `connect-src` in `public/_headers`, update the privacy policy
- [ ] Payments later via a merchant of record (EU VAT) + purchase terms incl. right of withdrawal
- [ ] Submit `sitemap.xml` in Google Search Console

---
© Creator Signals. All rights reserved. Not affiliated with TikTok.
Fonts: Plus Jakarta Sans (SIL Open Font License, see `public/assets/fonts/OFL-LICENSE.txt`).
