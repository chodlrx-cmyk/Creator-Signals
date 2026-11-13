/* Creator Signals — shared site script (nav, reveal, storage helper, newsletter) */
(function () {
  "use strict";
  var doc = document.documentElement;
  doc.classList.remove("no-js");

  /* ---------- Config ----------
     NEWSLETTER_ENDPOINT: leave "" until a real provider is connected.
     When empty, the signup form is shown as "opening soon" and stores nothing.
     When set, the form POSTs JSON {email, consent, source} and shows success ONLY on a 2xx response.
     Remember to add the endpoint's origin to connect-src in /_headers. */
  var CONFIG = { NEWSLETTER_ENDPOINT: "" };

  /* ---------- Safe localStorage helper (shared with tool scripts) ---------- */
  var store = {
    get: function (k, fb) {
      try { var v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  window.CS = { store: store, config: CONFIG };

  /* ---------- Mobile menu ---------- */
  var mb = document.querySelector(".menu-btn"), menu = document.getElementById("menu");
  if (mb && menu) {
    var close = function () { menu.classList.remove("open"); mb.setAttribute("aria-expanded", "false"); };
    mb.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      mb.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.addEventListener("click", function (e) { if (e.target.closest("a")) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  }

  /* ---------- Current year ---------- */
  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- Reveal on scroll ---------- */
  var els = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
    els.forEach(function (el) { io.observe(el); });
  } else { els.forEach(function (el) { el.classList.add("in"); }); }

  /* ---------- Newsletter ---------- */
  var form = document.getElementById("signup");
  if (form) {
    var email = form.querySelector("input[type=email]"),
        consent = form.querySelector("#consent"),
        btn = form.querySelector("button"),
        msg = document.getElementById("formMsg");
    var say = function (t, cls) { msg.textContent = t; msg.className = "form-msg " + (cls || ""); };

    if (!CONFIG.NEWSLETTER_ENDPOINT) {
      email.disabled = true; consent.disabled = true; btn.disabled = true;
      btn.textContent = "Opening soon";
      say("Sign-ups open soon. Nothing is collected yet — follow @creatorsignals on TikTok in the meantime.");
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!CONFIG.NEWSLETTER_ENDPOINT) return;
      if (!email.value || !email.checkValidity()) { say("Please enter a valid email address.", "bad"); email.focus(); return; }
      if (!consent.checked) { say("Please tick the consent box to subscribe.", "bad"); return; }
      btn.disabled = true; say("Sending…");
      fetch(CONFIG.NEWSLETTER_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.value.trim(), consent: true, source: location.pathname })
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        say("Almost done — check your inbox to confirm your subscription.", "ok");
        form.reset();
      }).catch(function () {
        say("Something went wrong, you are not subscribed yet. Please try again later.", "bad");
      }).finally(function () { btn.disabled = false; });
    });
  }
})();
