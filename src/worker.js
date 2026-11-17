/**
 * Creator Signals — Worker: static site + cookieless measurement + Payhip webhook + admin API.
 *
 * Routes (the Worker runs first only for /admin* and /api/*; everything else is served as static assets):
 *   POST /api/e                  cookieless website event (view / cta / download). No identifiers stored.
 *   POST /api/payhip/webhook     Payhip "paid" / "refunded" webhook (signature = sha256(API key)).
 *   GET  /admin, /admin/*        admin UI (static) — only with a valid Cloudflare Access token.
 *   /api/admin/*                 admin JSON API — only with a valid Cloudflare Access token.
 *
 * Bindings / settings (wrangler.jsonc + secrets):
 *   DB               D1 database (migrations/)
 *   ASSETS           static assets (public/)
 *   ACCESS_TEAM      Cloudflare Access team domain, e.g. "creatorsignals.cloudflareaccess.com"
 *   ACCESS_AUD       Access application audience (AUD) tag
 *   ADMIN_EMAILS     optional comma-separated allow-list, checked on top of the Access policy
 *   PAYHIP_API_KEY   secret — Payhip Settings → Developer → API key (never in the repo)
 * If ACCESS_TEAM / ACCESS_AUD are missing, the admin area stays closed (fail closed).
 */

const TZ = "Europe/Amsterdam";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const amsDay = (secs) => dayFmt.format(new Date(secs * 1000));
const now = () => Math.floor(Date.now() / 1000);

const JSON_HDRS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...JSON_HDRS, ...extra } });
const text = (t, status = 200, extra = {}) => new Response(t, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/api/e") return await collect(request, env, url, ctx);
      if (p === "/api/payhip/webhook") return await payhipWebhook(request, env);
      if (p === "/admin" || p.startsWith("/admin/") || p.startsWith("/api/admin/")) {
        const who = await requireAccess(request, env);
        if (!who.ok) return denied(p, who.reason);
        if (p.startsWith("/api/admin/")) return await adminApi(request, env, url, who);
        const res = await env.ASSETS.fetch(request);
        const h = new Headers(res.headers);
        h.set("cache-control", "no-store");
        h.set("x-robots-tag", "noindex, nofollow");
        return new Response(res.body, { status: res.status, headers: h });
      }
      if (p.startsWith("/api/")) return json({ error: "not_found" }, 404);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("worker_error", p, err && err.stack ? err.stack : String(err));
      // Cloudflare D1 free plan: the daily row-read limit is shared by every database on the account.
      if (/row read limit|exceeded D1|D1_ERROR.*limit|code 7500/i.test(String(err && err.message))) return json({ error: "db_limit" }, 503);
      return json({ error: "server_error" }, 500);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Cookieless measurement                                              */
/* ------------------------------------------------------------------ */
const BOT_RE = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|httpclient|facebookexternalhit/i;
const KINDS = new Set(["view", "cta", "download"]);
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const TOKEN_RE = /^[a-z0-9._-]{1,60}$/;

export function classifySource(ref, ownHost) {
  if (!ref) return "direct";
  let host;
  try { host = new URL(ref).hostname.toLowerCase(); } catch { return "direct"; }
  host = host.replace(/^www\./, "");
  if (host === ownHost.replace(/^www\./, "")) return "internal";
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  if (/(^|\.)google\./.test(host)) return "google";
  if (/(^|\.)(instagram\.com|l\.instagram\.com)$/.test(host)) return "instagram";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "youtube";
  if (/(^|\.)(facebook\.com|fb\.com)$/.test(host)) return "facebook";
  if (/(^|\.)bing\.com$/.test(host)) return "bing";
  if (/(^|\.)(duckduckgo\.com|ecosia\.org)$/.test(host)) return "search-other";
  if (/(^|\.)payhip\.com$/.test(host)) return "payhip";
  return "other";
}

const clean = (v, re) => (typeof v === "string" && re.test(v.toLowerCase()) ? v.toLowerCase() : null);

export const EVENT_RETENTION_DAYS = 761; // 25 months

async function collect(request, env, url, ctx) {
  if (request.method !== "POST") return text("method not allowed", 405, { allow: "POST" });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return text("forbidden", 403);
  if (BOT_RE.test(request.headers.get("user-agent") || "")) return new Response(null, { status: 204 });
  // The owner's own browser: a Cloudflare Access session cookie on this site means an admin is browsing. Not counted.
  if (/(^|;\s*)CF_Authorization=/.test(request.headers.get("cookie") || "")) return new Response(null, { status: 204 });
  const raw = await request.text();
  if (raw.length > 2048) return text("too large", 413);
  let b;
  try { b = JSON.parse(raw); } catch { return text("bad request", 400); }
  const kind = KINDS.has(b.k) ? b.k : null;
  let path = typeof b.p === "string" ? b.p.split(/[?#]/)[0].slice(0, 200) : null;
  if (!kind || !path || !path.startsWith("/")) return text("bad request", 400);
  const product = kind === "view" ? null : clean(b.pr, SLUG_RE);
  const utm = b.u && typeof b.u === "object" ? b.u : {};
  const source = clean(utm.s, TOKEN_RE) || classifySource(typeof b.r === "string" ? b.r : "", url.host);
  const medium = clean(utm.m, TOKEN_RE);
  const campaign = clean(utm.c, TOKEN_RE);
  const country = (request.cf && typeof request.cf.country === "string" && /^[A-Z]{2}$/.test(request.cf.country)) ? request.cf.country : null;
  const device = /Mobi|Android|iPhone|iPad/i.test(request.headers.get("user-agent") || "") ? "mobile" : "desktop";
  const t = now();
  await env.DB.prepare(
    "INSERT INTO events (ts, day, kind, path, product, source, medium, campaign, country, device) VALUES (?,?,?,?,?,?,?,?,?,?)"
  ).bind(t, amsDay(t), kind, path, product, source, medium, campaign, country, device).run();
  // Retention: website events are kept for 25 months (privacy policy). Pruned occasionally, off the request path.
  if (Math.random() < 0.002 && ctx) ctx.waitUntil(env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(t - EVENT_RETENTION_DAYS * 86400).run());
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/* ------------------------------------------------------------------ */
/* Payhip webhook                                                      */
/* ------------------------------------------------------------------ */
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

async function logWebhook(env, type, txn, status, detail) {
  await env.DB.prepare("INSERT INTO webhook_log (received_at, type, txn_id, status, detail) VALUES (?,?,?,?,?)")
    .bind(now(), type || null, txn || null, status, detail ? String(detail).slice(0, 300) : null).run();
}

async function readPayload(request) {
  const ct = request.headers.get("content-type") || "";
  const raw = await request.text();
  if (raw.length > 65536) throw new Error("payload too large");
  if (ct.includes("application/x-www-form-urlencoded")) {
    const o = Object.fromEntries(new URLSearchParams(raw));
    if (typeof o.items === "string") { try { o.items = JSON.parse(o.items); } catch { /* keep */ } }
    return o;
  }
  return JSON.parse(raw);
}

async function payhipWebhook(request, env) {
  if (request.method !== "POST") return text("method not allowed", 405, { allow: "POST" });
  let b;
  try { b = await readPayload(request); } catch (e) {
    await logWebhook(env, null, null, "bad_payload", e.message);
    return text("bad request", 400);
  }
  const type = typeof b.type === "string" ? b.type : null;
  const id = b.id != null ? String(b.id).slice(0, 80) : null;
  if (!env.PAYHIP_API_KEY) {
    await logWebhook(env, type, id, "not_configured", "PAYHIP_API_KEY secret is not set");
    return text("not configured", 503); // Payhip retries hourly for up to 3 hours
  }
  if (!safeEqual(String(b.signature || ""), await sha256hex(env.PAYHIP_API_KEY))) {
    await logWebhook(env, type, id, "bad_signature", null);
    return text("unauthorized", 401);
  }
  if (!id || !type) { await logWebhook(env, type, id, "bad_payload", "missing id or type"); return text("bad request", 400); }

  const items = Array.isArray(b.items) ? b.items : [];
  // Only non-personal item fields are kept.
  const cleanItems = items.map((i) => ({
    product_key: String(i.product_key || "").slice(0, 40),
    product_name: String(i.product_name || "").slice(0, 120),
    quantity: int(i.quantity) || 1,
    used_coupon: !!i.used_coupon,
    on_sale: !!i.on_sale,
    promoted_by_affiliate: !!i.promoted_by_affiliate,
  }));
  const keys = cleanItems.map((i) => i.product_key).filter(Boolean);

  if (type === "paid") {
    const ts = int(b.date) || now();
    const price = int(b.price);
    if (price == null || !b.currency) { await logWebhook(env, type, id, "bad_payload", "missing price or currency"); return text("bad request", 400); }
    const usedCoupon = cleanItems.some((i) => i.used_coupon);
    let isTest = 0;
    if (price === 0 && usedCoupon && keys.length) {
      const q = `SELECT COUNT(*) AS n FROM products WHERE kind='paid' AND payhip_key IN (${keys.map(() => "?").join(",")})`;
      const r = await env.DB.prepare(q).bind(...keys).first();
      if (r && r.n > 0) isTest = 1; // 100 % coupon on a paid product = test / giveaway, kept out of revenue
    }
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO transactions (id, ts, day, currency, price, payhip_fee, stripe_fee, vat_applied, payment_type,
        product_keys, items_json, used_coupon, is_gift, is_test, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, ts, amsDay(ts), String(b.currency).toUpperCase().slice(0, 3), price, int(b.payhip_fee), int(b.stripe_fee),
      b.vat_applied ? 1 : 0, b.payment_type ? String(b.payment_type).slice(0, 20) : null, keys.join(","),
      JSON.stringify(cleanItems), usedCoupon ? 1 : 0, b.is_gift ? 1 : 0, isTest, now()).run();
    const dup = res.meta && res.meta.changes === 0;
    await logWebhook(env, type, id, dup ? "duplicate" : "ok", null);
    return text("ok");
  }

  if (type === "refunded") {
    const ts = int(b.date_refunded) || now();
    const amount = int(b.amount_refunded);
    if (amount == null) { await logWebhook(env, type, id, "bad_payload", "missing amount_refunded"); return text("bad request", 400); }
    // If the original payment arrived before the dashboard existed, record it from the refund payload.
    const created = int(b.date_created) || ts;
    const price = int(b.price);
    if (price != null && b.currency) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO transactions (id, ts, day, currency, price, payhip_fee, stripe_fee, vat_applied, payment_type,
          product_keys, items_json, used_coupon, is_gift, is_test, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`
      ).bind(id, created, amsDay(created), String(b.currency).toUpperCase().slice(0, 3), price, int(b.payhip_fee), int(b.stripe_fee),
        b.vat_applied ? 1 : 0, b.payment_type ? String(b.payment_type).slice(0, 20) : null, keys.join(","),
        JSON.stringify(cleanItems), cleanItems.some((i) => i.used_coupon) ? 1 : 0, b.is_gift ? 1 : 0, now()).run();
    }
    const res = await env.DB.prepare(
      "INSERT OR IGNORE INTO refunds (transaction_id, ts, day, amount, currency, received_at) VALUES (?,?,?,?,?,?)"
    ).bind(id, ts, amsDay(ts), amount, String(b.currency || "EUR").toUpperCase().slice(0, 3), now()).run();
    const dup = res.meta && res.meta.changes === 0;
    await logWebhook(env, type, id, dup ? "duplicate" : "ok", null);
    return text("ok");
  }

  await logWebhook(env, type, id, "ok", "event type ignored");
  return text("ok");
}

/* ------------------------------------------------------------------ */
/* Cloudflare Access verification (defence in depth, fail closed)      */
/* ------------------------------------------------------------------ */
let certCache = { at: 0, team: null, keys: null };
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function accessKeys(team, force) {
  if (!force && certCache.team === team && certCache.keys && now() - certCache.at < 3600) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("certs " + r.status);
  const j = await r.json();
  certCache = { at: now(), team, keys: j.keys || [] };
  return certCache.keys;
}

export async function verifyAccessJwt(token, env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "no_token" };
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  } catch { return { ok: false, reason: "bad_token" }; }
  if (header.alg !== "RS256") return { ok: false, reason: "bad_alg" };
  let keys = await accessKeys(env.ACCESS_TEAM, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { keys = await accessKeys(env.ACCESS_TEAM, true); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) return { ok: false, reason: "unknown_key" };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!valid) return { ok: false, reason: "bad_signature" };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return { ok: false, reason: "bad_aud" };
  if (payload.iss !== `https://${env.ACCESS_TEAM}`) return { ok: false, reason: "bad_iss" };
  const t = now();
  if (typeof payload.exp !== "number" || payload.exp < t - 30) return { ok: false, reason: "expired" };
  if (typeof payload.nbf === "number" && payload.nbf > t + 30) return { ok: false, reason: "not_yet_valid" };
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  const allow = (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && (!email || !allow.includes(email))) return { ok: false, reason: "not_allowed" };
  return { ok: true, email };
}

async function requireAccess(request, env) {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return { ok: false, reason: "admin_not_configured" };
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, reason: "no_token" };
  try { return await verifyAccessJwt(token, env); } catch (e) { return { ok: false, reason: "verify_error" }; }
}

function denied(path, reason) {
  if (path.startsWith("/api/")) return json({ error: "forbidden", reason }, 403);
  const msg = reason === "admin_not_configured"
    ? "The admin area is not configured yet (Cloudflare Access)."
    : "Access denied. Sign in through Cloudflare Access.";
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Admin — access</title><body style="font-family:system-ui;background:#0B0B0F;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0"><p>${msg}</p></body></html>`,
    { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */
const RANGES = { "7d": 7, "30d": 30, "90d": 90, all: null };
// Product-button clicks. Blog navigation clicks (product "to-starter-kit" etc.) are stored as cta too but are not checkout clicks.
const BTN = "(kind='cta' AND COALESCE(product,'') NOT LIKE 'to-%')";

export function rangeStart(range, todaySecs = now()) {
  const days = RANGES[range] === undefined ? 30 : RANGES[range];
  if (days == null) return "0000-00-00";
  return amsDay(todaySecs - (days - 1) * 86400);
}

const sameOrigin = (request, url) => {
  const o = request.headers.get("origin");
  return o && new URL(o).host === url.host;
};

async function all(env, sql, ...args) { const r = await env.DB.prepare(sql).bind(...args).all(); return r.results || []; }
async function one(env, sql, ...args) { return (await env.DB.prepare(sql).bind(...args).first()) || {}; }

// Revenue per transaction: price minus refunded (refund amount = the largest amount_refunded Payhip reported, capped at the price).
const TX_SQL = `
  SELECT t.*, MIN(t.price, COALESCE(r.refunded, 0)) AS refunded,
         t.price - MIN(t.price, COALESCE(r.refunded, 0)) AS net
  FROM transactions t
  LEFT JOIN (SELECT transaction_id, MAX(amount) AS refunded FROM refunds GROUP BY transaction_id) r ON r.transaction_id = t.id`;

function txStatus(t) {
  if (t.is_test) return "test";
  if (t.refunded > 0 && t.refunded >= t.price) return "refunded";
  if (t.refunded > 0) return "partial";
  if (t.price === 0) return "free";
  return "paid";
}

async function productMap(env) {
  const rows = await all(env, "SELECT slug, name, payhip_key, kind, sort FROM products ORDER BY sort");
  const byKey = {};
  rows.forEach((r) => { if (r.payhip_key) byKey[r.payhip_key] = r; });
  return { rows, byKey };
}

async function adminApi(request, env, url, who) {
  const p = url.pathname.replace(/^\/api\/admin/, "");
  const range = url.searchParams.get("range") || "30d";
  const from = rangeStart(range);

  if (request.method !== "GET") {
    if (!sameOrigin(request, url)) return json({ error: "bad_origin" }, 403);
    let body = {};
    try { body = await request.json(); } catch { return json({ error: "bad_json" }, 400); }
    let m;
    if ((m = p.match(/^\/orders\/([^/]+)\/test$/)) && request.method === "POST") {
      const r = await env.DB.prepare("UPDATE transactions SET is_test=? WHERE id=?").bind(body.is_test ? 1 : 0, decodeURIComponent(m[1])).run();
      return json({ ok: true, changed: r.meta ? r.meta.changes : 0 });
    }
    if ((m = p.match(/^\/products\/([a-z0-9-]+)$/)) && request.method === "PUT") {
      const key = body.payhip_key ? String(body.payhip_key).trim() : null;
      if (key && !/^[A-Za-z0-9]{3,20}$/.test(key)) return json({ error: "bad_key" }, 400);
      const r = await env.DB.prepare("UPDATE products SET payhip_key=? WHERE slug=?").bind(key, m[1]).run();
      return json({ ok: true, changed: r.meta ? r.meta.changes : 0 });
    }
    return json({ error: "not_found" }, 404);
  }

  if (p === "/me") return json({ email: who.email, tz: TZ });

  if (p === "/overview") {
    const ev = await one(env, `SELECT SUM(kind='view') AS views, SUM(${BTN}) AS clicks, SUM(kind='download') AS downloads,
      SUM(kind='cta' AND product IN (SELECT slug FROM products WHERE kind='paid')) AS paid_clicks FROM events WHERE day >= ?`, from);
    const tx = await one(env, `SELECT COUNT(*) AS orders, SUM(price) AS gross, SUM(refunded) AS refunds, SUM(net) AS net, MIN(currency) AS cur, COUNT(DISTINCT currency) AS ncur
      FROM (${TX_SQL} WHERE t.day >= ? AND t.is_test = 0 AND t.price > 0)`, from);
    const free = await one(env, `SELECT COUNT(*) AS n FROM transactions WHERE day >= ? AND is_test = 0 AND price = 0`, from);
    const trend = await all(env, `SELECT day, SUM(kind='view') AS views, SUM(${BTN}) AS clicks, SUM(kind='download') AS downloads FROM events WHERE day >= ? GROUP BY day ORDER BY day`, from);
    const txTrend = await all(env, `SELECT day, COUNT(*) AS orders, SUM(net) AS net FROM (${TX_SQL} WHERE t.day >= ? AND t.is_test = 0 AND t.price > 0) GROUP BY day ORDER BY day`, from);
    const recent = await all(env, `${TX_SQL} ORDER BY t.ts DESC LIMIT 5`);
    const pm = await productMap(env);
    return json({
      range, from,
      kpi: {
        views: ev.views || 0, clicks: ev.clicks || 0,
        downloads: (ev.downloads || 0), free_orders: free.n || 0,
        orders: tx.orders || 0, gross: tx.gross || 0, refunds: tx.refunds || 0, net: tx.net || 0,
        currency: tx.cur || "EUR", mixed_currency: (tx.ncur || 0) > 1,
        conversion: ev.paid_clicks ? (tx.orders || 0) / ev.paid_clicks : null,
      },
      trend, txTrend,
      recent: recent.map((t) => orderRow(t, pm)),
      health: await healthSummary(env),
    });
  }

  if (p === "/traffic") {
    const by = (col) => all(env, `SELECT COALESCE(${col}, '—') AS k, SUM(kind='view') AS views, SUM(${BTN}) AS clicks, SUM(kind='download') AS downloads
      FROM events WHERE day >= ? GROUP BY 1 ORDER BY views DESC, clicks DESC LIMIT 50`, from);
    return json({ range, from,
      daily: await all(env, `SELECT day, SUM(kind='view') AS views, SUM(${BTN}) AS clicks, SUM(kind='download') AS downloads FROM events WHERE day >= ? GROUP BY day ORDER BY day`, from),
      pages: await by("path"), sources: await by("source"), countries: await by("country"), devices: await by("device") });
  }

  if (p === "/products") {
    const pm = await productMap(env);
    const ev = await all(env, `SELECT product, SUM(${BTN}) AS clicks, SUM(kind='download') AS downloads FROM events WHERE day >= ? AND product IS NOT NULL GROUP BY product`, from);
    const txs = await all(env, `${TX_SQL} WHERE t.day >= ? AND t.is_test = 0`, from);
    const out = pm.rows.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, payhip_key: r.payhip_key, clicks: 0, downloads: 0, orders: 0, free_orders: 0, gross: 0, refunds: 0, net: 0 }));
    const bySlug = Object.fromEntries(out.map((o) => [o.slug, o]));
    ev.forEach((e) => { if (bySlug[e.product]) { bySlug[e.product].clicks = e.clicks || 0; bySlug[e.product].downloads = e.downloads || 0; } });
    txs.forEach((t) => {
      const keys = (t.product_keys || "").split(",").filter(Boolean);
      const slug = keys.map((k) => pm.byKey[k] && pm.byKey[k].slug).find(Boolean);
      const o = slug ? bySlug[slug] : null;
      if (!o) return;
      if (t.price === 0) { o.free_orders += 1; return; }
      o.orders += 1; o.gross += t.price; o.refunds += t.refunded; o.net += t.net;
    });
    return json({ range, from, products: out, unmapped: txs.filter((t) => !(t.product_keys || "").split(",").some((k) => pm.byKey[k])).length });
  }

  if (p === "/orders") {
    const size = [10, 20, 50].includes(Number(url.searchParams.get("size"))) ? Number(url.searchParams.get("size")) : 10;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const status = url.searchParams.get("status") || "";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
    const sortCol = { date: "ts", amount: "price", net: "net" }[url.searchParams.get("sort")] || "ts";
    const dir = url.searchParams.get("dir") === "asc" ? "ASC" : "DESC";
    const pm = await productMap(env);
    let rows = (await all(env, `${TX_SQL} WHERE t.day >= ? ORDER BY ${sortCol} ${dir}`, from)).map((t) => orderRow(t, pm));
    if (status) rows = rows.filter((r) => r.status === status);
    if (q) { const ql = q.toLowerCase(); rows = rows.filter((r) => r.id.toLowerCase().includes(ql) || r.products.toLowerCase().includes(ql)); }
    if (url.searchParams.get("format") === "csv") {
      const head = "date_amsterdam,order_id,products,status,currency,amount,refunded,net,payhip_fee,payment_fee\n";
      const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const body = rows.map((r) => [r.day, r.id, r.products, r.status, r.currency, (r.price / 100).toFixed(2), (r.refunded / 100).toFixed(2), (r.net / 100).toFixed(2),
        r.payhip_fee == null ? "" : (r.payhip_fee / 100).toFixed(2), r.stripe_fee == null ? "" : (r.stripe_fee / 100).toFixed(2)].map(esc).join(",")).join("\n");
      return new Response(head + body + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
        "content-disposition": `attachment; filename="creator-signals-orders-${range}.csv"` } });
    }
    const total = rows.length;
    return json({ range, from, page, size, total, pages: Math.max(1, Math.ceil(total / size)), rows: rows.slice((page - 1) * size, page * size) });
  }

  if (p === "/campaigns") {
    return json({ range, from, rows: await all(env, `SELECT source, COALESCE(medium,'—') AS medium, COALESCE(campaign,'—') AS campaign,
      SUM(kind='view') AS views, SUM(${BTN}) AS clicks, SUM(kind='download') AS downloads
      FROM events WHERE day >= ? GROUP BY source, medium, campaign ORDER BY views DESC, clicks DESC LIMIT 200`, from) });
  }

  if (p === "/blog") return blogList(env, url);
  if (p === "/blog/article") return blogArticle(env, url);

  if (p === "/health") {
    return json({ ...(await healthSummary(env)),
      log: await all(env, "SELECT received_at, type, txn_id, status, detail FROM webhook_log ORDER BY id DESC LIMIT 50"),
      products: (await productMap(env)).rows,
      config: { payhip_secret: !!env.PAYHIP_API_KEY, access: !!(env.ACCESS_TEAM && env.ACCESS_AUD), allow_list: !!env.ADMIN_EMAILS } });
  }

  if (p === "/events.csv") {
    const rows = await all(env, `SELECT day, kind, path, COALESCE(product,'') AS product, source, COALESCE(medium,'') AS medium, COALESCE(campaign,'') AS campaign,
      COALESCE(country,'') AS country, device, COUNT(*) AS n FROM events WHERE day >= ? GROUP BY 1,2,3,4,5,6,7,8,9 ORDER BY day`, from);
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    return new Response("day_amsterdam,kind,path,product,source,medium,campaign,country,device,count\n" +
      rows.map((r) => [r.day, r.kind, r.path, r.product, r.source, r.medium, r.campaign, r.country, r.device, r.n].map(esc).join(",")).join("\n") + "\n",
      { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="creator-signals-events-${range}.csv"` } });
  }

  return json({ error: "not_found" }, 404);
}

function orderRow(t, pm) {
  const keys = (t.product_keys || "").split(",").filter(Boolean);
  let names = keys.map((k) => (pm.byKey[k] ? pm.byKey[k].name : null)).filter(Boolean);
  if (!names.length) { try { names = JSON.parse(t.items_json).map((i) => i.product_name).filter(Boolean); } catch { names = []; } }
  return { id: t.id, day: t.day, ts: t.ts, products: names.join(" + ") || "—", currency: t.currency, price: t.price, refunded: t.refunded || 0,
    net: t.net, payhip_fee: t.payhip_fee, stripe_fee: t.stripe_fee, vat_applied: !!t.vat_applied, is_test: !!t.is_test, status: txStatus(t) };
}

async function healthSummary(env) {
  const last = await one(env, "SELECT MAX(received_at) AS t FROM webhook_log WHERE status IN ('ok','duplicate')");
  const fail = await one(env, "SELECT COUNT(*) AS n FROM webhook_log WHERE status NOT IN ('ok','duplicate') AND received_at >= ?", now() - 7 * 86400);
  const lastEv = await one(env, "SELECT MAX(ts) AS t FROM events");
  const unmappedPaid = await one(env, "SELECT COUNT(*) AS n FROM products WHERE kind='paid' AND payhip_key IS NULL");
  return { last_webhook: last.t || null, webhook_failures_7d: fail.n || 0, last_event: lastEv.t || null,
    payhip_secret_set: !!env.PAYHIP_API_KEY, products_without_key: unmappedPaid.n || 0 };
}

/* ------------------------------------------------------------------ */
/* Blog analytics (admin)                                              */
/* ------------------------------------------------------------------ */
// Definitions (also shown in the dashboard):
//   Views          page-view events on the article path (cookieless; one per page load, bots and the owner's browser excluded).
//   Unique readers not available: no identifiers are stored, so readers cannot be de-duplicated.
//   Free Kit       clicks on links to /starter-kit/ on the article (+ any Starter Kit Payhip / PDF click on the article itself).
//   30-Day/90-Day  clicks on links to /academy/launchpad/ or /academy/accelerator/ (+ any Payhip click for that course on the article).
//   CTR            (Free Kit + 30-Day + 90-Day clicks) ÷ views, for the same period and source filter. Clicks are not sales.
//   Orders/revenue not attributable: Payhip orders carry no link to a visit or article.
const ART_RE = /^\/blog\/[a-z0-9-]{1,80}\/$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BLOG_SOURCES = ["google", "bing", "tiktok", "direct", "internal", "other"];
const BLOG_SORT = ["title", "views", "google", "bing", "tiktok", "kit", "d30", "d90", "ctr", "last"];
let blogCache = { at: 0, list: null };

const decodeEnt = (t) => t.replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// The article list comes from the public /blog/ index (the source of truth for what is published); titles from each page's <title>.
async function blogArticles(env, origin) {
  if (blogCache.list && blogCache.list.length && now() - blogCache.at < 600) return blogCache.list;
  const list = [];
  try {
    const idx = await env.ASSETS.fetch(new Request(origin + "/blog/"));
    if (idx.ok) {
      const html = await idx.text();
      const paths = [...new Set([...html.matchAll(/href="(\/blog\/[a-z0-9-]{1,80}\/)"/g)].map((m) => m[1]))].slice(0, 200);
      for (const path of paths) {
        let title = path;
        try {
          const r = await env.ASSETS.fetch(new Request(origin + path));
          if (r.ok) { const m = (await r.text()).match(/<title>([^<]{1,200})<\/title>/i); if (m) title = decodeEnt(m[1]).replace(/\s*[·|]\s*Creator Signals\s*$/, "").trim(); }
        } catch { /* keep path as title */ }
        list.push({ path, title });
      }
    }
  } catch { /* fall back below */ }
  blogCache = { at: now(), list };
  return list;
}

const dayShift = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function blogPeriod(sp, todaySecs = now()) {
  const range = sp.get("range") || "30d";
  const today = amsDay(todaySecs);
  if (range === "custom") {
    const from = sp.get("from") || "", to = sp.get("to") || "";
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || isNaN(Date.parse(from)) || isNaN(Date.parse(to)) || from > to) return { error: "bad_range" };
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
    if (days > 800) return { error: "range_too_long" };
    return { range, from, to, days, prev: { from: dayShift(from, -days), to: dayShift(from, -1) } };
  }
  const days = RANGES[range] === undefined ? 30 : RANGES[range];
  if (days == null) return { range: "all", from: "0000-00-00", to: today, days: null, prev: null };
  const from = rangeStart(range, todaySecs);
  return { range: RANGES[range] === undefined ? "30d" : range, from, to: today, days, prev: { from: dayShift(from, -days), to: dayShift(from, -1) } };
}

const BLOG_AGG = `SELECT path, source, SUM(kind='view') AS views,
    SUM((kind='cta' AND product IN ('to-starter-kit','starter-kit')) OR (kind='download' AND product='starter-kit')) AS kit,
    SUM(kind='cta' AND product IN ('to-launchpad','launchpad')) AS d30,
    SUM(kind='cta' AND product IN ('to-accelerator','accelerator')) AS d90,
    MAX(ts) AS last
  FROM events WHERE day >= ? AND day <= ? AND path LIKE '/blog/%' AND source <> 'test'`;

const srcBucket = (s) => (BLOG_SOURCES.includes(s) ? s : "other");

function blogRows(articles, agg, source) {
  const by = Object.fromEntries(articles.map((a) => [a.path, { path: a.path, title: a.title, views: 0, google: 0, bing: 0, tiktok: 0, kit: 0, d30: 0, d90: 0, last: null }]));
  agg.forEach((r) => {
    const o = by[r.path];
    if (!o) return; // the /blog/ index itself, removed pages, typos
    if (source && srcBucket(r.source) !== source) return;
    o.views += r.views || 0; o.kit += r.kit || 0; o.d30 += r.d30 || 0; o.d90 += r.d90 || 0;
    if (r.source === "google" || r.source === "bing" || r.source === "tiktok") o[r.source] += r.views || 0;
    if (r.last && (!o.last || r.last > o.last)) o.last = r.last;
  });
  return Object.values(by).map((o) => ({ ...o, clicks: o.kit + o.d30 + o.d90, ctr: o.views ? (o.kit + o.d30 + o.d90) / o.views : null }));
}

function blogTotals(rows) {
  const t = rows.reduce((a, r) => ({ views: a.views + r.views, kit: a.kit + r.kit, d30: a.d30 + r.d30, d90: a.d90 + r.d90 }), { views: 0, kit: 0, d30: 0, d90: 0 });
  return { ...t, course: t.d30 + t.d90, clicks: t.kit + t.d30 + t.d90, ctr: t.views ? (t.kit + t.d30 + t.d90) / t.views : null, unique_readers: null };
}

async function blogList(env, url) {
  const sp = url.searchParams;
  const per = blogPeriod(sp);
  if (per.error) return json({ error: per.error }, 400);
  const source = BLOG_SOURCES.includes(sp.get("source")) ? sp.get("source") : "";
  const q = (sp.get("q") || "").trim().toLowerCase().slice(0, 80);
  const sort = BLOG_SORT.includes(sp.get("sort")) ? sp.get("sort") : "views";
  const dir = sp.get("dir") === "asc" ? 1 : -1;
  const size = 10;
  const agg = await all(env, `${BLOG_AGG} GROUP BY path, source LIMIT 5000`, per.from, per.to);
  let articles = await blogArticles(env, url.origin);
  if (!articles.length) articles = [...new Set(agg.map((r) => r.path).filter((x) => ART_RE.test(x)))].map((x) => ({ path: x, title: x }));
  let rows = blogRows(articles, agg, source);
  const kpi = blogTotals(rows);
  let prev = null;
  if (per.prev) prev = blogTotals(blogRows(articles, await all(env, `${BLOG_AGG} GROUP BY path, source LIMIT 5000`, per.prev.from, per.prev.to), source));
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q) || r.path.includes(q));
  rows.sort((a, b) => {
    const x = a[sort], y = b[sort];
    if (sort === "title") return dir * x.localeCompare(y);
    if (x == null && y == null) return a.title.localeCompare(b.title);
    if (x == null) return 1; if (y == null) return -1; // empty values always last
    return dir * (x - y) || a.title.localeCompare(b.title);
  });
  if (sp.get("format") === "csv") {
    const esc = (v) => { let t = String(v == null ? "" : v); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const lastDay = (t) => (t ? amsDay(t) : "");
    const head = "article,url,views,google_views,bing_views,tiktok_views,free_kit_clicks,launchpad_30day_clicks,accelerator_90day_clicks,cta_clicks,ctr_percent,last_activity_day_amsterdam\n";
    const body = rows.map((r) => [r.title, "https://" + url.host + r.path, r.views, r.google, r.bing, r.tiktok, r.kit, r.d30, r.d90, r.clicks,
      r.ctr == null ? "" : (r.ctr * 100).toFixed(1), lastDay(r.last)].map(esc).join(",")).join("\n");
    return new Response(head + body + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
      "content-disposition": `attachment; filename="creator-signals-blog-${per.range === "custom" ? per.from + "_" + per.to : per.range}.csv"` } });
  }
  const total = rows.length, pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(sp.get("page"))) || 1));
  return json({ range: per.range, from: per.from, to: per.to, prev_period: per.prev, source: source || "all", sort, dir: dir === 1 ? "asc" : "desc",
    kpi, prev, page, size, total, pages, rows: rows.slice((page - 1) * size, page * size),
    attribution: { orders: "not_attributable", revenue: "not_attributable", unique_readers: "not_available" } });
}

async function blogArticle(env, url) {
  const sp = url.searchParams;
  const path = sp.get("path") || "";
  if (!ART_RE.test(path)) return json({ error: "bad_path" }, 400);
  const per = blogPeriod(sp);
  if (per.error) return json({ error: per.error }, 400);
  const art = (await blogArticles(env, url.origin)).find((a) => a.path === path);
  if (!art) return json({ error: "not_found" }, 404);
  const source = BLOG_SOURCES.includes(sp.get("source")) ? sp.get("source") : "";
  const agg = await all(env, `${BLOG_AGG} AND path = ? GROUP BY path, source LIMIT 100`, per.from, per.to, path);
  const row = blogRows([art], agg, source)[0];
  const sources = {};
  agg.forEach((r) => { const k = srcBucket(r.source); sources[k] = (sources[k] || 0) + (r.views || 0); });
  const daily = (await all(env, `SELECT day, source, SUM(kind='view') AS views,
      SUM((kind='cta' AND product IN ('to-starter-kit','starter-kit','to-launchpad','launchpad','to-accelerator','accelerator')) OR (kind='download' AND product='starter-kit')) AS clicks
    FROM events WHERE day >= ? AND day <= ? AND path = ? AND source <> 'test' GROUP BY day, source ORDER BY day LIMIT 5000`, per.from, per.to, path));
  const days = {};
  daily.forEach((d) => { if (source && srcBucket(d.source) !== source) return; const o = (days[d.day] = days[d.day] || { day: d.day, views: 0, clicks: 0 }); o.views += d.views || 0; o.clicks += d.clicks || 0; });
  const campaigns = await all(env, `SELECT source, COALESCE(medium,'—') AS medium, campaign, SUM(kind='view') AS views,
      SUM(kind='cta' AND product IN ('to-starter-kit','starter-kit','to-launchpad','launchpad','to-accelerator','accelerator')) AS clicks
    FROM events WHERE day >= ? AND day <= ? AND path = ? AND campaign IS NOT NULL AND source <> 'test' GROUP BY source, medium, campaign ORDER BY views DESC LIMIT 20`, per.from, per.to, path);
  return json({ range: per.range, from: per.from, to: per.to, source: source || "all", article: { ...art, url: "https://" + url.host + path },
    totals: row, sources, trend: Object.values(days), campaigns,
    conversions: { orders: null, revenue: null, status: "not_attributable",
      note: "Payhip orders contain no link to a visit or article, so orders and revenue cannot be attributed to this article." } });
}
