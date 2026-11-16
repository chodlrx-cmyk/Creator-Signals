/* Creator Signals — admin dashboard client. Talks only to /api/admin/* (same origin, Cloudflare Access session). */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var state = { tab: "overview", range: "30d", orders: { page: 1, size: 10, status: "", q: "", sort: "date", dir: "desc" } };
  var nlNum = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nlInt = new Intl.NumberFormat("nl-NL");
  var CUR = { EUR: "€", GBP: "£", USD: "$" };

  /* Money: minus sign for negatives, plus for positives, €0,00 for zero (owner's reporting convention). */
  function money(minor, cur) {
    if (minor === null || minor === undefined) return "—";
    var sym = CUR[cur] || (cur ? cur + " " : "€");
    var v = minor / 100;
    if (v === 0) return sym + nlNum.format(0);
    return (v < 0 ? "\u2212" : "+") + "\u2060" + sym + "\u2060" + nlNum.format(Math.abs(v)); // word joiners keep sign, symbol and amount together
  }
  function int(n) { return n === null || n === undefined ? "—" : nlInt.format(n); }
  function esc(s) { return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function when(secs) {
    if (!secs) return "—";
    return new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "medium", timeStyle: "short" }).format(new Date(secs * 1000));
  }
  function ago(secs) {
    if (!secs) return null;
    var d = Date.now() / 1000 - secs;
    if (d < 120) return "just now";
    if (d < 7200) return Math.round(d / 60) + " min ago";
    if (d < 172800) return Math.round(d / 3600) + " h ago";
    return Math.round(d / 86400) + " days ago";
  }

  function api(path, opts) {
    var sep = path.indexOf("?") < 0 ? "?" : "&";
    return fetch("/api/admin" + path + sep + "range=" + state.range, Object.assign({ credentials: "same-origin", headers: { accept: "application/json" } }, opts || {}))
      .then(function (r) {
        if (r.status === 403) throw new Error("Access denied — sign in again through Cloudflare Access.");
        if (!r.ok) throw new Error("Server error (" + r.status + ")");
        return r.json();
      });
  }
  function banner(msg, err) {
    var b = $("#banner");
    if (!msg) { b.hidden = true; return; }
    b.textContent = msg; b.className = "banner" + (err ? " err" : ""); b.hidden = false;
  }

  /* ---------- generic table with client-side paging ---------- */
  function table(el, cols, rows, opts) {
    opts = opts || {};
    var size = opts.size || 10, pagerEl = opts.pager;
    var page = 1;
    function draw() {
      if (!rows.length) { el.innerHTML = '<p class="empty">' + esc(opts.empty || "No data yet for this period.") + "</p>"; if (pagerEl) pagerEl.innerHTML = ""; return; }
      var pages = Math.max(1, Math.ceil(rows.length / size));
      if (page > pages) page = pages;
      var slice = pagerEl ? rows.slice((page - 1) * size, page * size) : rows.slice(0, opts.limit || rows.length);
      var h = '<table class="stack"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.n ? "n" : "") + '">' + esc(c.h) + "</th>"; }).join("") + "</tr></thead><tbody>";
      slice.forEach(function (r) {
        h += "<tr>" + cols.map(function (c) { var v = c.f ? c.f(r) : esc(r[c.k]); return '<td data-l="' + esc(c.h) + '" class="' + (c.n ? "n" : "") + '">' + v + "</td>"; }).join("") + "</tr>";
      });
      el.innerHTML = h + "</tbody></table>";
      if (pagerEl) pager(pagerEl, page, pages, rows.length, function (p) { page = p; draw(); });
    }
    draw();
  }
  function pager(el, page, pages, total, go) {
    var b = function (label, p, dis, cur, aria) { return '<button type="button" data-p="' + p + '"' + (dis ? " disabled" : "") + (cur ? ' aria-current="page"' : "") + ' aria-label="' + aria + '">' + label + "</button>"; };
    var h = "<span>" + int(total) + " rows</span>" + b("«", 1, page === 1, false, "First page") + b("‹", page - 1, page === 1, false, "Previous page");
    var start = Math.max(1, Math.min(page - 2, pages - 4)), end = Math.min(pages, start + 4);
    for (var i = start; i <= end; i++) h += b(i, i, false, i === page, "Page " + i);
    h += b("›", page + 1, page === pages, false, "Next page") + b("»", pages, page === pages, false, "Last page");
    el.innerHTML = h;
    el.onclick = function (e) { var t = e.target.closest("button[data-p]"); if (t && !t.disabled) go(Number(t.getAttribute("data-p"))); };
  }
  function pill(s) { var label = { paid: "Paid", free: "Free", refunded: "Refunded", partial: "Partly refunded", test: "Test" }[s] || s; return '<span class="pill ' + esc(s) + '">' + esc(label) + "</span>"; }

  /* ---------- chart (inline SVG, no external libraries) ---------- */
  function chart(el, ev, tx, from) {
    var days = {}, keys = [];
    ev.forEach(function (d) { days[d.day] = { v: d.views || 0, c: d.clicks || 0, o: 0 }; });
    tx.forEach(function (d) { (days[d.day] = days[d.day] || { v: 0, c: 0, o: 0 }).o = d.orders || 0; });
    keys = Object.keys(days).sort();
    if (!keys.length) { el.innerHTML = '<p class="empty">No activity recorded in this period yet.</p>'; return; }
    var W = 640, H = 200, P = 26, max = 1;
    keys.forEach(function (k) { max = Math.max(max, days[k].v, days[k].c, days[k].o); });
    var x = function (i) { return P + (keys.length === 1 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (keys.length - 1)); };
    var y = function (v) { return H - P - v * (H - 2 * P) / max; };
    var line = function (f, col) { return '<polyline fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" points="' + keys.map(function (k, i) { return x(i).toFixed(1) + "," + y(f(days[k])).toFixed(1); }).join(" ") + '"/>'; };
    var grid = "";
    [0, 0.5, 1].forEach(function (g) { var yy = y(max * g); grid += '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + yy + '" y2="' + yy + '" stroke="#262632"/><text x="2" y="' + (yy + 4) + '" fill="#9A9AAD" font-size="10">' + Math.round(max * g) + "</text>"; });
    var lab = '<text x="' + P + '" y="' + (H - 6) + '" fill="#9A9AAD" font-size="10">' + esc(keys[0]) + '</text><text x="' + (W - P) + '" y="' + (H - 6) + '" fill="#9A9AAD" font-size="10" text-anchor="end">' + esc(keys[keys.length - 1]) + "</text>";
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">' + grid + line(function (d) { return d.v; }, "#25F4EE") + line(function (d) { return d.c; }, "#8B5CF6") + line(function (d) { return d.o; }, "#FE2C55") + lab + "</svg>";
  }

  /* ---------- tabs ---------- */
  var loaders = {
    overview: function () {
      return api("/overview").then(function (d) {
        var k = d.kpi;
        $("#ov-sub").textContent = d.range === "all" ? "All time" : "From " + d.from + " (Europe/Amsterdam)";
        $("#k-views").textContent = int(k.views);
        $("#k-clicks").textContent = int(k.clicks);
        $("#k-downloads").textContent = int(k.downloads);
        $("#k-downloads-note").textContent = "Download clicks on the site · " + int(k.free_orders) + " confirmed free Payhip orders";
        $("#k-orders").textContent = int(k.orders);
        $("#k-net").textContent = k.orders ? money(k.net, k.currency) : "—";
        $("#k-net-note").textContent = k.orders ? "Gross " + money(k.gross, k.currency) + " · refunds " + money(-k.refunds, k.currency) + (k.mixed_currency ? " · mixed currencies!" : "") : "Incl. VAT where applied, after refunds";
        $("#k-conv").textContent = k.conversion === null ? "—" : (k.conversion * 100).toLocaleString("nl-NL", { maximumFractionDigits: 1 }) + "%";
        chart($("#chart"), d.trend, d.txTrend, d.from);
        healthList($("#health"), d.health);
        table($("#recent"), orderCols(false), d.recent, { empty: "No orders received yet. Orders appear here once Payhip sends its first signed webhook." });
      });
    },
    traffic: function () {
      $("#csv-events").href = "/api/admin/events.csv?range=" + state.range;
      return api("/traffic").then(function (d) {
        var cols = function (h) { return [{ h: h, k: "k" }, { h: "Views", n: 1, f: function (r) { return int(r.views); } }, { h: "Clicks", n: 1, f: function (r) { return int(r.clicks); } }, { h: "Downloads", n: 1, f: function (r) { return int(r.downloads); } }]; };
        table($("#t-pages"), cols("Page"), d.pages, { limit: 10 });
        table($("#t-sources"), cols("Source"), d.sources, { limit: 10 });
        table($("#t-countries"), cols("Country"), d.countries, { limit: 10 });
        table($("#t-devices"), cols("Device"), d.devices, { limit: 10 });
      });
    },
    products: function () {
      return api("/products").then(function (d) {
        table($("#p-table"), [
          { h: "Product", f: function (r) { return "<b>" + esc(r.name) + "</b>" + (r.payhip_key ? "" : ' <span class="pill test">No Payhip product yet</span>'); } },
          { h: "Clicks", n: 1, f: function (r) { return int(r.clicks); } },
          { h: "Downloads", n: 1, f: function (r) { return r.kind === "free" ? int(r.downloads) : "—"; } },
          { h: "Orders", n: 1, f: function (r) { return r.kind === "free" ? int(r.free_orders) + " free" : int(r.orders); } },
          { h: "Gross", n: 1, f: function (r) { return r.kind === "free" ? "—" : money(r.gross, "EUR"); } },
          { h: "Refunds", n: 1, f: function (r) { return r.kind === "free" ? "—" : money(-r.refunds, "EUR"); } },
          { h: "Net revenue", n: 1, f: function (r) { return r.kind === "free" ? "—" : money(r.net, "EUR"); } }
        ], d.products);
        $("#p-note").textContent = "Clicks = clicks on that product's buttons on this site. Orders and revenue = signed Payhip webhooks, test orders excluded." + (d.unmapped ? " " + d.unmapped + " order(s) could not be matched to a product — check the Payhip keys in Settings." : "");
      });
    },
    orders: function () {
      var o = state.orders;
      $("#csv-orders").href = "/api/admin/orders?format=csv&range=" + state.range + "&status=" + encodeURIComponent(o.status) + "&q=" + encodeURIComponent(o.q);
      return api("/orders?page=" + o.page + "&size=" + o.size + "&status=" + encodeURIComponent(o.status) + "&q=" + encodeURIComponent(o.q) + "&sort=" + o.sort + "&dir=" + o.dir).then(function (d) {
        table($("#o-table"), orderCols(true), d.rows, { empty: "No orders match. Orders appear once Payhip sends signed webhooks." });
        pager($("#o-pager"), d.page, d.pages, d.total, function (p) { o.page = p; loaders.orders(); });
      });
    },
    campaigns: function () {
      return api("/campaigns").then(function (d) {
        table($("#c-table"), [{ h: "Source", k: "source" }, { h: "Medium", k: "medium" }, { h: "Campaign", k: "campaign" },
          { h: "Views", n: 1, f: function (r) { return int(r.views); } }, { h: "Clicks", n: 1, f: function (r) { return int(r.clicks); } }, { h: "Downloads", n: 1, f: function (r) { return int(r.downloads); } }],
          d.rows, { pager: $("#c-pager"), size: 20 });
      });
    },
    settings: function () {
      return api("/health").then(function (d) {
        var c = d.config;
        $("#s-config").innerHTML = [
          ["Cloudflare Access", c.access ? '<span class="ok">Configured</span>' : '<span class="bad">Not configured</span>'],
          ["E-mail allow-list", c.allow_list ? '<span class="ok">On</span>' : '<span class="warn">Off (Access policy only)</span>'],
          ["Payhip webhook secret", c.payhip_secret ? '<span class="ok">Set</span>' : '<span class="bad">Missing — webhooks are refused</span>'],
          ["Webhook URL for Payhip", '<span class="mono">' + esc(location.origin) + "/api/payhip/webhook</span>"],
          ["Last webhook", d.last_webhook ? when(d.last_webhook) : '<span class="warn">None received yet</span>'],
          ["Failed deliveries (7 days)", d.webhook_failures_7d ? '<span class="bad">' + d.webhook_failures_7d + "</span>" : '<span class="ok">0</span>']
        ].map(function (r) { return "<li><span>" + r[0] + "</span><span>" + r[1] + "</span></li>"; }).join("");
        $("#s-products").innerHTML = d.products.map(function (p) {
          return '<div class="keyrow"><div><b>' + esc(p.name) + "</b><small>" + esc(p.slug) + " · " + esc(p.kind) + '</small></div><input aria-label="Payhip key for ' + esc(p.name) + '" value="' + esc(p.payhip_key || "") + '" placeholder="not set" data-slug="' + esc(p.slug) + '"><button type="button" class="btn small" data-save="' + esc(p.slug) + '">Save</button></div>';
        }).join("");
        table($("#s-log"), [{ h: "Received", f: function (r) { return esc(when(r.received_at)); } }, { h: "Type", k: "type" }, { h: "Order", f: function (r) { return '<span class="mono">' + esc(r.txn_id || "—") + "</span>"; } },
          { h: "Status", f: function (r) { var cl = r.status === "ok" || r.status === "duplicate" ? "ok" : "bad"; return '<span class="' + cl + '">' + esc(r.status) + "</span>"; } }, { h: "Detail", k: "detail" }],
          d.log, { pager: $("#s-pager"), size: 10, empty: "No webhook deliveries yet." });
      });
    }
  };

  function orderCols(full) {
    var cols = [
      { h: "Date", f: function (r) { return esc(when(r.ts)); } },
      { h: "Order", f: function (r) { return '<span class="mono">' + esc(r.id) + "</span>"; } },
      { h: "Product", k: "products" },
      { h: "Status", f: function (r) { return pill(r.status); } },
      { h: "Amount", n: 1, f: function (r) { return money(r.price, r.currency); } },
      { h: "Net", n: 1, f: function (r) { return r.is_test ? "—" : money(r.net, r.currency); } }
    ];
    if (full) cols.push({ h: "", f: function (r) { return '<button type="button" class="btn small" data-test="' + esc(r.id) + '" data-val="' + (r.is_test ? 0 : 1) + '">' + (r.is_test ? "Not a test" : "Mark as test") + "</button>"; } });
    return cols;
  }

  function healthList(el, h) {
    var items = [
      ["Payhip webhook secret", h.payhip_secret_set ? '<span class="ok">Set</span>' : '<span class="bad">Missing</span>'],
      ["Last Payhip webhook", h.last_webhook ? esc(ago(h.last_webhook)) : '<span class="warn">None yet</span>'],
      ["Failed webhooks (7 days)", h.webhook_failures_7d ? '<span class="bad">' + h.webhook_failures_7d + "</span>" : '<span class="ok">0</span>'],
      ["Last website event", h.last_event ? esc(ago(h.last_event)) : '<span class="warn">None yet</span>'],
      ["Paid products without Payhip key", h.products_without_key ? '<span class="warn">' + h.products_without_key + "</span>" : '<span class="ok">0</span>']
    ];
    el.innerHTML = items.map(function (r) { return "<li><span>" + r[0] + "</span><span>" + r[1] + "</span></li>"; }).join("");
    var warn = [];
    if (!h.payhip_secret_set) warn.push("Payhip webhook secret is not set, so orders cannot be received yet.");
    if (h.webhook_failures_7d) warn.push(h.webhook_failures_7d + " webhook deliveries failed in the last 7 days — see Settings.");
    banner(warn.join(" "), !!h.webhook_failures_7d);
  }

  function show(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach(function (s) { s.hidden = s.id !== "tab-" + tab; });
    document.querySelectorAll("[data-tab]").forEach(function (b) { if (b.getAttribute("data-tab") === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    if (tab !== "overview") banner("");
    loaders[tab]().catch(function (e) { banner(e.message, true); });
    try { history.replaceState(null, "", "#" + tab); } catch (e) {}
  }

  document.addEventListener("click", function (e) {
    var t;
    if ((t = e.target.closest("[data-tab]"))) return show(t.getAttribute("data-tab"));
    if ((t = e.target.closest("[data-goto]"))) return show(t.getAttribute("data-goto"));
    if ((t = e.target.closest("[data-range]"))) {
      state.range = t.getAttribute("data-range"); state.orders.page = 1;
      document.querySelectorAll("[data-range]").forEach(function (b) { b.classList.toggle("on", b === t); });
      return show(state.tab);
    }
    if ((t = e.target.closest("[data-test]"))) {
      t.disabled = true;
      return fetch("/api/admin/orders/" + encodeURIComponent(t.getAttribute("data-test")) + "/test", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_test: t.getAttribute("data-val") === "1" }) })
        .then(function (r) { if (!r.ok) throw new Error("Could not update the order (" + r.status + ")"); return loaders.orders(); })
        .catch(function (err) { banner(err.message, true); });
    }
    if ((t = e.target.closest("[data-save]"))) {
      var slug = t.getAttribute("data-save"), inp = document.querySelector('input[data-slug="' + slug + '"]');
      t.disabled = true;
      return fetch("/api/admin/products/" + slug, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ payhip_key: inp.value.trim() || null }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status === 400 ? "That key is not valid (letters and digits only)." : "Could not save (" + r.status + ")"); t.textContent = "Saved"; banner(""); })
        .catch(function (err) { banner(err.message, true); })
        .then(function () { t.disabled = false; });
    }
  });
  var qTimer;
  $("#o-q").addEventListener("input", function () { clearTimeout(qTimer); qTimer = setTimeout(function () { state.orders.q = $("#o-q").value; state.orders.page = 1; loaders.orders().catch(function (e) { banner(e.message, true); }); }, 250); });
  $("#o-status").addEventListener("change", function () { state.orders.status = this.value; state.orders.page = 1; loaders.orders().catch(function (e) { banner(e.message, true); }); });
  $("#o-size").addEventListener("change", function () { state.orders.size = Number(this.value); state.orders.page = 1; loaders.orders().catch(function (e) { banner(e.message, true); }); });

  fetch("/api/admin/me", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && d.email) $("#who").textContent = "Signed in as " + d.email; }).catch(function () {});
  var initial = (location.hash || "").replace("#", "");
  show(loaders[initial] ? initial : "overview");
})();
