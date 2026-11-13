/* Creator Signals — 30-Day Content Planner. Data stays in this browser (localStorage). */
(function () {
  "use strict";
  var S = window.CS.store, KEY = "cs.planner.v1", INBOX = "cs.planner.inbox";
  var $ = function (id) { return document.getElementById(id); };
  var NUMS = ["views", "likes", "comments", "shares"];
  var FIELDS = ["idea", "hook", "cat", "status", "link", "notes"].concat(NUMS);
  var STATUS = { idea: "Idea", planned: "Planned", published: "Published" };

  var iso = function (d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  var parse = function (s) { var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return p ? new Date(+p[1], +p[2] - 1, +p[3]) : null; };
  var data = S.get(KEY, null);
  if (!data || typeof data !== "object" || !data.days) data = { start: iso(new Date()), days: {}, reviews: {} };
  if (!data.reviews) data.reviews = {};
  var save = function () {
    var ok = S.set(KEY, data);
    $("saveState").textContent = ok ? "Saved in this browser" : "Could not save — storage is blocked in this browser";
  };

  var dayDate = function (n) { var d = parse(data.start) || new Date(); d.setDate(d.getDate() + n - 1); return d; };
  var label = function (d) { return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); };
  var num = function (v) { return /^\d{1,12}$/.test(String(v || "")) ? parseInt(v, 10) : 0; };
  var fmt = function (n) { return n.toLocaleString("en-GB"); };
  var safeLink = function (s) { s = (s || "").trim(); return /^https:\/\/[^\s]+$/i.test(s) ? s : ""; };

  /* ---------- Calendar render ---------- */
  var WEEKS = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]];
  var render = function () {
    var cal = $("cal"); cal.textContent = "";
    var todayIso = iso(new Date());
    WEEKS.forEach(function (w, wi) {
      var lab = document.createElement("div"); lab.className = "week-label";
      var t = document.createElement("span"); t.textContent = wi < 4 ? "Week " + (wi + 1) : "Days 29–30";
      lab.appendChild(t);
      var rb = document.createElement("button"); rb.type = "button"; rb.className = "btn btn-xs review-btn";
      rb.textContent = wi < 4 ? "Weekly review" : "Month review";
      rb.addEventListener("click", function () { openReview(wi); });
      lab.appendChild(rb); cal.appendChild(lab);
      for (var n = w[0]; n <= w[1]; n++) {
        var e = data.days[n] || {}, b = document.createElement("button");
        b.type = "button"; b.className = "day"; b.dataset.status = e.status || "";
        var dd = dayDate(n); if (iso(dd) === todayIso) b.classList.add("today");
        var dn = document.createElement("span"); dn.className = "dn"; dn.textContent = "Day " + n;
        var dt = document.createElement("span"); dt.className = "dd"; dt.textContent = label(dd);
        var di = document.createElement("span"); di.className = "di" + (e.idea || e.hook ? "" : " empty"); di.textContent = e.idea || e.hook || "+ Add content";
        b.appendChild(dn); b.appendChild(dt); b.appendChild(di);
        if (e.status) { var st = document.createElement("span"); st.className = "st"; st.textContent = STATUS[e.status]; b.appendChild(st); }
        b.setAttribute("aria-label", "Day " + n + ", " + label(dd) + (e.idea ? ", " + e.idea : ", empty") + (e.status ? ", " + STATUS[e.status] : ""));
        (function (k) { b.addEventListener("click", function () { openDay(k); }); })(n);
        cal.appendChild(b);
      }
    });
    stats(); inbox();
  };

  var sumRange = function (a, z) {
    var r = { pub: 0, plan: 0, views: 0, inter: 0, hooks: 0, best: null };
    for (var n = a; n <= z; n++) {
      var e = data.days[n]; if (!e) continue;
      if (e.status === "planned") r.plan++;
      if (e.status === "published") {
        r.pub++; var v = num(e.views); r.views += v; r.inter += num(e.likes) + num(e.comments) + num(e.shares);
        if (e.hook) r.hooks++;
        if (!r.best || v > r.best.v) r.best = { n: n, v: v, idea: e.idea || e.hook || "Untitled" };
      }
    }
    return r;
  };
  var stats = function () {
    var r = sumRange(1, 30);
    $("stPub").textContent = r.pub + " / 30"; $("stPlan").textContent = r.plan;
    $("stViews").textContent = fmt(r.views); $("stHooks").textContent = r.hooks;
  };

  /* ---------- Day dialog ---------- */
  var dlg = $("dayDlg"), df = $("dayForm"), cur = 0;
  var openDay = function (n, preset) {
    cur = n; var e = data.days[n] || {};
    $("dayTitle").textContent = "Day " + n + " · " + label(dayDate(n));
    FIELDS.forEach(function (f) { var el = df.elements[f]; if (el) el.value = e[f] || (f === "status" ? "idea" : ""); });
    if (preset) Object.keys(preset).forEach(function (k) { df.elements[k].value = preset[k]; });
    $("linkErr").textContent = ""; $("numErr").textContent = "";
    dlg.showModal(); df.elements.idea.focus();
  };
  df.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var e = {}, bad = false;
    FIELDS.forEach(function (f) { var el = df.elements[f]; if (el) e[f] = el.value.trim().slice(0, f === "notes" ? 1000 : 300); });
    if (e.link && !safeLink(e.link)) { $("linkErr").textContent = "Use a full link starting with https://"; bad = true; }
    NUMS.forEach(function (k) { if (e[k] && !/^\d{1,12}$/.test(e[k])) bad = $("numErr").textContent = "Use whole numbers only."; });
    if (bad) return;
    if (!e.idea && !e.hook && !e.notes && !e.link && !NUMS.some(function (k) { return e[k]; })) delete data.days[cur];
    else data.days[cur] = e;
    save(); render(); dlg.close();
  });
  $("dayClear").addEventListener("click", function () { delete data.days[cur]; save(); render(); dlg.close(); });
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { b.closest("dialog").close(); }); });

  /* ---------- Weekly review ---------- */
  var rdlg = $("revDlg"), rf = $("revForm"), curW = 0;
  var openReview = function (wi) {
    curW = wi; var w = WEEKS[wi], r = wi < 4 ? sumRange(w[0], w[1]) : sumRange(1, 30);
    $("revTitle").textContent = wi < 4 ? "Week " + (wi + 1) + " review · days " + w[0] + "–" + w[1] : "Month review · days 1–30";
    $("rvPub").textContent = r.pub; $("rvViews").textContent = fmt(r.views); $("rvHooks").textContent = r.hooks;
    $("rvBest").textContent = r.best ? "Day " + r.best.n + " · " + fmt(r.best.v) + " views — " + r.best.idea : "No published videos with views yet";
    var rv = data.reviews[wi] || {};
    ["worked", "didnt", "next"].forEach(function (k) { rf.elements[k].value = rv[k] || ""; });
    rdlg.showModal();
  };
  rf.addEventListener("submit", function (ev) {
    ev.preventDefault();
    data.reviews[curW] = { worked: rf.elements.worked.value.slice(0, 1000), didnt: rf.elements.didnt.value.slice(0, 1000), next: rf.elements.next.value.slice(0, 1000) };
    save(); rdlg.close();
  });

  /* ---------- Hook inbox (from Hook Builder) ---------- */
  var inbox = function () {
    var list = S.get(INBOX, []), ul = $("inboxList"), box = $("inbox");
    if (!Array.isArray(list)) list = [];
    ul.textContent = ""; box.hidden = list.length === 0; $("inboxCount").textContent = list.length;
    list.forEach(function (h) {
      var li = document.createElement("li"), t = document.createElement("span"), acts = document.createElement("span");
      t.textContent = "“" + h.hook + "”"; acts.className = "acts";
      var use = document.createElement("button"); use.type = "button"; use.className = "btn btn-xs"; use.textContent = "Use on next free day";
      use.addEventListener("click", function () {
        var n = 1; while (n <= 30 && data.days[n] && (data.days[n].idea || data.days[n].hook)) n++;
        if (n > 30) { alert("All 30 days already have content. Clear a day first."); return; }
        S.set(INBOX, S.get(INBOX, []).filter(function (x) { return x.id !== h.id; }));
        openDay(n, { hook: h.hook, idea: h.topic || "", status: "planned" }); inbox();
      });
      var rm = document.createElement("button"); rm.type = "button"; rm.className = "btn btn-xs"; rm.textContent = "Remove";
      rm.addEventListener("click", function () { S.set(INBOX, S.get(INBOX, []).filter(function (x) { return x.id !== h.id; })); inbox(); });
      acts.appendChild(use); acts.appendChild(rm); li.appendChild(t); li.appendChild(acts); ul.appendChild(li);
    });
  };

  /* ---------- Start date ---------- */
  var sd = $("startDate"); sd.value = data.start;
  sd.addEventListener("change", function () { if (parse(sd.value)) { data.start = sd.value; save(); render(); } });

  /* ---------- Export / import / reset ---------- */
  var download = function (name, text, type) {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  var cell = function (v) { v = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  $("exportCsv").addEventListener("click", function () {
    var rows = [["Day", "Date", "Status", "Category", "Idea", "Hook", "Link", "Views", "Likes", "Comments", "Shares", "Engagement rate %", "Notes"]];
    for (var n = 1; n <= 30; n++) {
      var e = data.days[n] || {}, v = num(e.views), i = num(e.likes) + num(e.comments) + num(e.shares);
      rows.push([n, iso(dayDate(n)), e.status ? STATUS[e.status] : "", e.cat || "", e.idea || "", e.hook || "", e.link || "",
        e.views || "", e.likes || "", e.comments || "", e.shares || "", v ? (i / v * 100).toFixed(2) : "", e.notes || ""]);
    }
    download("creator-signals-planner.csv", "﻿" + rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n"), "text/csv;charset=utf-8");
  });
  $("exportJson").addEventListener("click", function () {
    download("creator-signals-planner-backup.json", JSON.stringify({ app: "creator-signals-planner", v: 1, data: data }, null, 2), "application/json");
  });
  $("importJson").addEventListener("change", function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    if (f.size > 1e6) { alert("This file is too large to be a planner backup."); return; }
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var j = JSON.parse(rd.result);
        if (!j || j.app !== "creator-signals-planner" || !j.data || typeof j.data.days !== "object") throw 0;
        var d = { start: parse(j.data.start) ? j.data.start : iso(new Date()), days: {}, reviews: {} };
        for (var n = 1; n <= 30; n++) {
          var e = j.data.days[n]; if (!e || typeof e !== "object") continue;
          var c = {}; FIELDS.forEach(function (k) { if (typeof e[k] === "string") c[k] = e[k].slice(0, 1000); });
          if (c.status && !STATUS[c.status]) delete c.status;
          if (c.link && !safeLink(c.link)) delete c.link;
          d.days[n] = c;
        }
        for (var w = 0; w < 5; w++) { var r = (j.data.reviews || {})[w]; if (r && typeof r === "object") d.reviews[w] = { worked: String(r.worked || "").slice(0, 1000), didnt: String(r.didnt || "").slice(0, 1000), next: String(r.next || "").slice(0, 1000) }; }
        data = d; sd.value = data.start; save(); render();
      } catch (x) { alert("This doesn't look like a Creator Signals planner backup."); }
      ev.target.value = "";
    };
    rd.readAsText(f);
  });
  $("resetAll").addEventListener("click", function () {
    if (!confirm("Delete all planner data in this browser? Export a backup first if you want to keep it.")) return;
    data = { start: iso(new Date()), days: {}, reviews: {} }; S.del(INBOX); sd.value = data.start; save(); render();
  });

  render();
  $("saveState").textContent = "Saved in this browser";
})();
