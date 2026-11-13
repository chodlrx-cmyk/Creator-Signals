# Security policy

Creator Signals is a static website. It has no user accounts, no database and no server-side code.
Tool data (Hook Builder, Content Planner, sample lesson) is stored only in the visitor's own browser.

## Reporting a vulnerability

Please **do not open a public issue**. Email **hello@creatorsignals.blog** with a description and,
if possible, steps to reproduce. You can also use GitHub's private
[security advisory form](https://github.com/chodlrx-cmyk/Creator-Signals/security/advisories/new).

We aim to respond within 7 days.

## Security measures

- Strict Content Security Policy and security headers (`public/_headers`)
- HTTPS only with HSTS
- No third-party scripts, fonts, trackers or cookies
- All user input is rendered with `textContent` (no HTML injection)
- The `*.workers.dev` copy is marked `noindex`; the custom domain is canonical
