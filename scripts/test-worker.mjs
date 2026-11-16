// Tests for src/worker.js — run with: node scripts/test-worker.mjs
// D1 is replaced by an in-memory node:sqlite database with the real migration; Cloudflare Access by a self-signed RS256 key.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, createSign } from "node:crypto";
import worker, { classifySource, rangeStart, amsDay } from "../src/worker.js";

let pass = 0, fail = 0;
const check = (name, cond, info) => { if (cond) pass++; else { fail++; console.log("FAIL", name, info === undefined ? "" : JSON.stringify(info)); } };

/* ---------- D1 shim ---------- */
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_admin.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) || null,
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}

/* ---------- Access shim ---------- */
const TEAM = "cs-test.cloudflareaccess.com", AUD = "aud-123";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64u = (b) => Buffer.from(b).toString("base64url");
function token(payload, kid = "k1", key = privateKey) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = createSign("RSA-SHA256").update(h + "." + p).sign(key);
  return h + "." + p + "." + b64u(s);
}
const nowS = Math.floor(Date.now() / 1000);
const good = () => token({ aud: [AUD], iss: "https://" + TEAM, exp: nowS + 600, iat: nowS, email: "owner@example.com" });
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  if (String(u) === `https://${TEAM}/cdn-cgi/access/certs`) return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
  return realFetch(u);
};

/* ---------- env ---------- */
const API_KEY = "test-api-key-123";
function makeEnv(extra = {}) {
  return {
    DB: d1(), ACCESS_TEAM: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@example.com", PAYHIP_API_KEY: API_KEY,
    ASSETS: { fetch: async (req) => new Response("<html>asset " + new URL(req.url).pathname + "</html>", { headers: { "content-type": "text/html" } }) },
    ...extra,
  };
}
const ctx = { waitUntil: () => {} };
const H = "https://creatorsignals.blog";
const call = (env, path, init = {}) => worker.fetch(new Request(H + path, init), env, ctx);
const admin = (env, path, init = {}) => call(env, path, { ...init, headers: { "cf-access-jwt-assertion": good(), ...(init.headers || {}) } });
const sig = createHash("sha256").update(API_KEY).digest("hex");

/* ---------- unit ---------- */
check("source tiktok", classifySource("https://www.tiktok.com/@x", "creatorsignals.blog") === "tiktok");
check("source internal", classifySource("https://creatorsignals.blog/academy/", "creatorsignals.blog") === "internal");
check("source direct", classifySource("", "creatorsignals.blog") === "direct");
check("source google", classifySource("https://www.google.nl/", "creatorsignals.blog") === "google");
check("amsterdam day boundary", amsDay(Date.UTC(2026, 10, 16, 23, 30) / 1000) === "2026-11-17", amsDay(Date.UTC(2026, 10, 16, 23, 30) / 1000));
check("range 7d", rangeStart("7d", Date.UTC(2026, 10, 16, 12) / 1000) === "2026-11-10");
check("range all", rangeStart("all") === "0000-00-00");

/* ---------- static + routing ---------- */
{
  const env = makeEnv();
  const r = await call(env, "/academy/");
  check("static passthrough", r.status === 200 && (await r.text()).includes("asset /academy/"));
  check("unknown api 404", (await call(env, "/api/nope")).status === 404);
}

/* ---------- admin protection (fail closed) ---------- */
{
  const env = makeEnv();
  check("admin without token 403", (await call(env, "/admin/")).status === 403);
  check("admin api without token 403", (await call(env, "/api/admin/overview")).status === 403);
  const wrongAud = token({ aud: ["other"], iss: "https://" + TEAM, exp: nowS + 600, email: "owner@example.com" });
  check("wrong aud 403", (await call(env, "/api/admin/overview", { headers: { "cf-access-jwt-assertion": wrongAud } })).status === 403);
  const expired = token({ aud: [AUD], iss: "https://" + TEAM, exp: nowS - 3600, email: "owner@example.com" });
  check("expired 403", (await call(env, "/api/admin/overview", { headers: { "cf-access-jwt-assertion": expired } })).status === 403);
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const forged = token({ aud: [AUD], iss: "https://" + TEAM, exp: nowS + 600, email: "owner@example.com" }, "k1", other);
  check("forged signature 403", (await call(env, "/api/admin/overview", { headers: { "cf-access-jwt-assertion": forged } })).status === 403);
  const stranger = token({ aud: [AUD], iss: "https://" + TEAM, exp: nowS + 600, email: "someone@example.com" });
  check("not on allow-list 403", (await call(env, "/api/admin/overview", { headers: { "cf-access-jwt-assertion": stranger } })).status === 403);
  const r = await admin(env, "/admin/");
  check("admin with valid token 200", r.status === 200 && r.headers.get("x-robots-tag").includes("noindex") && r.headers.get("cache-control") === "no-store");
  const env2 = makeEnv({ ACCESS_TEAM: "", ACCESS_AUD: "" });
  const r2 = await admin(env2, "/admin/");
  check("not configured = closed", r2.status === 403 && (await r2.text()).includes("not configured"));
}

/* ---------- collect ---------- */
{
  const env = makeEnv();
  const post = (body, headers = {}) => call(env, "/api/e", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: H, "user-agent": "Mozilla/5.0 (iPhone)", ...headers } });
  check("view 204", (await post({ k: "view", p: "/academy/?x=1#y", r: "https://www.tiktok.com/", u: {} })).status === 204);
  check("cta 204", (await post({ k: "cta", p: "/academy/", pr: "launchpad", u: { s: "TikTok", m: "video", c: "launch-1" } })).status === 204);
  check("download 204", (await post({ k: "download", p: "/starter-kit/", pr: "starter-kit" })).status === 204);
  check("bad kind 400", (await post({ k: "evil", p: "/" })).status === 400);
  check("cross-origin 403", (await post({ k: "view", p: "/" }, { origin: "https://evil.example" })).status === 403);
  check("bot ignored", (await post({ k: "view", p: "/" }, { "user-agent": "Googlebot/2.1" })).status === 204);
  check("GET refused", (await call(env, "/api/e")).status === 405);
  const rows = env.DB.raw.prepare("SELECT * FROM events ORDER BY id").all();
  check("3 events stored (bot not)", rows.length === 3, rows.length);
  check("query stripped", rows[0].path === "/academy/");
  check("referrer classified", rows[0].source === "tiktok");
  check("utm kept lower-case", rows[1].source === "tiktok" && rows[1].campaign === "launch-1" && rows[1].medium === "video");
  check("device coarse", rows[0].device === "mobile");
  const cols = Object.keys(rows[0]);
  check("no identifiers stored", !cols.some((c) => /ip|agent|email|cookie|session|user/i.test(c)), cols);
}

/* ---------- Payhip webhook ---------- */
{
  const env = makeEnv();
  const hook = (body) => call(env, "/api/payhip/webhook", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const paid = { id: "TXN1", email: "buyer@example.com", ip_address: "1.2.3.4", currency: "EUR", price: 1900, vat_applied: true, payment_type: "paypal",
    items: [{ product_id: "1", product_name: "30-Day Creator Launchpad", product_key: "juEVT", quantity: "1", used_coupon: false }],
    payhip_fee: 95, stripe_fee: 0, date: Math.floor(Date.UTC(2026, 10, 16, 10) / 1000), type: "paid", signature: sig };
  check("bad signature 401", (await hook({ ...paid, signature: "nope" })).status === 401);
  check("paid 200", (await hook(paid)).status === 200);
  check("duplicate 200", (await hook(paid)).status === 200);
  const tx = env.DB.raw.prepare("SELECT * FROM transactions").all();
  check("one transaction (idempotent)", tx.length === 1, tx.length);
  check("no email / ip stored", !JSON.stringify(tx).includes("buyer@example.com") && !JSON.stringify(tx).includes("1.2.3.4"));
  const freeKit = { ...paid, id: "TXN2", price: 0, items: [{ product_key: "dmuVE", product_name: "Creator Starter Kit", quantity: 1 }] };
  await hook(freeKit);
  const coupon = { ...paid, id: "TXN3", price: 0, items: [{ product_key: "juEVT", product_name: "30-Day Creator Launchpad", quantity: 1, used_coupon: true }] };
  await hook(coupon);
  check("100 % coupon on paid product = test", env.DB.raw.prepare("SELECT is_test FROM transactions WHERE id='TXN3'").get().is_test === 1);
  check("free kit not a test", env.DB.raw.prepare("SELECT is_test FROM transactions WHERE id='TXN2'").get().is_test === 0);
  const refund = { ...paid, type: "refunded", amount_refunded: 1900, date_refunded: paid.date + 3600, date_created: paid.date };
  delete refund.date;
  check("refund 200", (await hook(refund)).status === 200);
  check("refund duplicate ignored", (await hook(refund)).status === 200 && env.DB.raw.prepare("SELECT COUNT(*) AS n FROM refunds").get().n === 1);
  const log = env.DB.raw.prepare("SELECT status FROM webhook_log ORDER BY id").all().map((r) => r.status);
  check("webhook log", log.join(",") === "bad_signature,ok,duplicate,ok,ok,ok,duplicate", log);
  const envNo = makeEnv({ PAYHIP_API_KEY: "" });
  const r = await worker.fetch(new Request(H + "/api/payhip/webhook", { method: "POST", body: JSON.stringify(paid), headers: { "content-type": "application/json" } }), envNo, ctx);
  check("no secret = 503 (Payhip retries)", r.status === 503);

  /* ---------- admin API on that data ---------- */
  await call(env, "/api/e", { method: "POST", body: JSON.stringify({ k: "cta", p: "/academy/", pr: "launchpad" }), headers: { origin: H, "content-type": "application/json" } });
  await call(env, "/api/e", { method: "POST", body: JSON.stringify({ k: "cta", p: "/academy/", pr: "launchpad" }), headers: { origin: H, "content-type": "application/json" } });
  const ov = await (await admin(env, "/api/admin/overview?range=all")).json();
  check("overview: 1 paid order, refunded → net 0", ov.kpi.orders === 1 && ov.kpi.gross === 1900 && ov.kpi.refunds === 1900 && ov.kpi.net === 0, ov.kpi);
  check("overview: 1 free order", ov.kpi.free_orders === 1);
  check("overview: conversion = orders / paid clicks", ov.kpi.conversion === 0.5, ov.kpi.conversion);
  const pr = await (await admin(env, "/api/admin/products?range=all")).json();
  const lp = pr.products.find((p) => p.slug === "launchpad");
  check("products: launchpad 1 order, 2 clicks", lp.orders === 1 && lp.clicks === 2 && lp.net === 0, lp);
  check("products: accelerator listed without key", pr.products.find((p) => p.slug === "accelerator").payhip_key === null);
  const od = await (await admin(env, "/api/admin/orders?range=all&size=10")).json();
  check("orders: 3 rows with statuses", od.total === 3 && od.rows.map((r) => r.status).sort().join(",") === "free,refunded,test", od.rows.map((r) => r.status));
  const od2 = await (await admin(env, "/api/admin/orders?range=all&status=test")).json();
  check("orders: status filter", od2.total === 1 && od2.rows[0].id === "TXN3");
  const csv = await (await admin(env, "/api/admin/orders?range=all&format=csv")).text();
  check("orders CSV", csv.startsWith("date_amsterdam,order_id") && csv.split("\n").length === 5 && !csv.includes("buyer@example.com"));
  const flagNoOrigin = await admin(env, "/api/admin/orders/TXN2/test", { method: "POST", body: JSON.stringify({ is_test: true }), headers: { "content-type": "application/json" } });
  check("mutation without origin refused (CSRF)", flagNoOrigin.status === 403);
  const flag = await admin(env, "/api/admin/orders/TXN2/test", { method: "POST", body: JSON.stringify({ is_test: true }), headers: { "content-type": "application/json", origin: H } });
  check("mark as test", flag.status === 200 && env.DB.raw.prepare("SELECT is_test FROM transactions WHERE id='TXN2'").get().is_test === 1);
  const key = await admin(env, "/api/admin/products/accelerator", { method: "PUT", body: JSON.stringify({ payhip_key: "AbC12" }), headers: { "content-type": "application/json", origin: H } });
  check("set accelerator key", key.status === 200 && env.DB.raw.prepare("SELECT payhip_key FROM products WHERE slug='accelerator'").get().payhip_key === "AbC12");
  const badKey = await admin(env, "/api/admin/products/accelerator", { method: "PUT", body: JSON.stringify({ payhip_key: "<script>" }), headers: { "content-type": "application/json", origin: H } });
  check("reject bad key", badKey.status === 400);
  const hl = await (await admin(env, "/api/admin/health")).json();
  check("health", hl.config.payhip_secret === true && hl.config.access === true && hl.log.length === 7 && hl.webhook_failures_7d === 1, hl);
  const ev = await admin(env, "/api/admin/events.csv?range=all");
  check("events CSV", ev.status === 200 && (await ev.text()).startsWith("day_amsterdam,kind"));
  const tr = await (await admin(env, "/api/admin/traffic?range=all")).json();
  check("traffic", Array.isArray(tr.sources) && tr.sources.length >= 1);
  const cp = await (await admin(env, "/api/admin/campaigns?range=all")).json();
  check("campaigns", Array.isArray(cp.rows));
}

console.log(`${pass + fail} checks · ${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);
