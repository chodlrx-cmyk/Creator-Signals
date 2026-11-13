/* Creator Signals — Hook Builder v2 + Engagement Calculator (A/B). All output via textContent. */
(function () {
  "use strict";
  var S = window.CS && window.CS.store;

  /* =================== HOOK BUILDER =================== */
  var hf = document.getElementById("hookForm");
  if (hf) {
    // {t}=topic (noun phrase), {a}=audience (plural), {n}=niche. Templates written so any noun phrase reads naturally.
    var BANK = [
      ["curiosity", "edu opinion", "Nobody tells {a} this about {t}"],
      ["curiosity", "edu list", "The one tip about {t} I wish I'd known sooner"],
      ["curiosity", "edu", "This is why {t} isn't working for you yet"],
      ["curiosity", "edu story", "I tested this idea for {t} so you don't have to"],
      ["curiosity", "opinion edu", "Most people get {t} backwards. Here's why"],
      ["mistake", "edu list", "3 mistakes {a} make with {t} (and how to fix them)"],
      ["mistake", "edu opinion", "Stop doing this if you're serious about {t}"],
      ["mistake", "story", "The biggest mistake I made with {t}"],
      ["mistake", "edu", "New to {n}? Avoid this trap with {t}"],
      ["mistake", "edu", "Are you making this mistake with {t} too?"],
      ["result", "story", "I tried {t} for 7 days. Here's what changed"],
      ["result", "story edu", "What one week of {t} actually looks like"],
      ["result", "story", "Before and after: what {t} did for me"],
      ["question", "opinion", "Is {t} really worth it for {a}?"],
      ["question", "edu", "Why does nobody explain {t} like this?"],
      ["question", "story opinion", "What would you do differently with {t}?"],
      ["howto", "edu", "How to start with {t} — even as a complete beginner"],
      ["howto", "edu list", "{T} in 3 simple steps"],
      ["howto", "edu", "The easiest way for {a} to get started with {t}"],
      ["howto", "list", "Save this: a simple checklist for {t}"],
      ["bold", "opinion", "Unpopular opinion: {t} is simpler than you think"],
      ["bold", "opinion edu", "You don't need more motivation for {t}. You need a plan"],
      ["bold", "opinion", "Everyone in {n} says this about {t}. I disagree"],
      ["bold", "story", "This changed the way I think about {t}"],
      ["list", "list", "5 small changes that make {t} easier"],
      ["list", "list edu", "3 things every beginner should know about {t}"],
      ["list", "list opinion", "Ranking tips about {t} from useless to essential"],
      ["story", "story", "The day {t} finally clicked for me"],
      ["story", "story", "6 months ago I knew nothing about {t}"],
      ["story", "story", "What {t} taught me that no video ever did"]
    ];
    var LABEL = { curiosity: "Curiosity", mistake: "Mistake", result: "Result-first", question: "Question", howto: "How-to", bold: "Bold claim", list: "List", story: "Story" };
    var out = document.getElementById("hookOut"), moreBtn = document.getElementById("hookMore"), note = document.getElementById("hookNote");
    var clean = function (s) { return (s || "").replace(/\s+/g, " ").trim().slice(0, 60); };
    var shuffle = function (a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; } return a; };
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };

    var build = function () {
      var t = clean(hf.hTopic.value), a = clean(hf.hAudience.value) || "beginners", n = clean(hf.hNiche.value);
      var goal = hf.hGoal.value, style = hf.hStyle.value;
      var err = document.getElementById("hTopicErr");
      if (!t) { err.textContent = "Add a video topic first, e.g. “beginner workouts”."; hf.hTopic.setAttribute("aria-invalid", "true"); hf.hTopic.focus(); return; }
      err.textContent = ""; hf.hTopic.removeAttribute("aria-invalid");
      var usable = BANK.filter(function (h) { return n || h[2].indexOf("{n}") < 0; });
      var primary = usable.filter(function (h) { return (style === "any" || h[0] === style) && h[1].indexOf(goal) >= 0; });
      var secondary = usable.filter(function (h) { return primary.indexOf(h) < 0 && (style === "any" ? h[1].indexOf(goal) < 0 : h[0] === style); });
      var list = shuffle(primary).concat(shuffle(secondary));
      if (list.length < 10) list = list.concat(shuffle(usable.filter(function (h) { return list.indexOf(h) < 0; })));
      list = list.slice(0, 10);
      out.textContent = "";
      list.forEach(function (h) {
        var txt = cap(h[2].replace(/\{T\}/g, cap(t)).replace(/\{t\}/g, t).replace(/\{a\}/g, a).replace(/\{n\}/g, n));
        var li = document.createElement("li"), sp = document.createElement("span"), em = document.createElement("em"), acts = document.createElement("span");
        em.textContent = LABEL[h[0]]; sp.appendChild(em); sp.appendChild(document.createTextNode("“" + txt + "”"));
        acts.className = "acts";
        var copy = document.createElement("button"); copy.type = "button"; copy.className = "btn btn-xs"; copy.textContent = "Copy";
        copy.addEventListener("click", function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(function () { copy.textContent = "Copied ✓"; setTimeout(function () { copy.textContent = "Copy"; }, 1500); }, function () {});
          }
        });
        var add = document.createElement("button"); add.type = "button"; add.className = "btn btn-xs"; add.textContent = "+ Planner";
        add.setAttribute("aria-label", "Add hook to Content Planner inbox");
        add.addEventListener("click", function () {
          if (!S) return;
          var inbox = S.get("cs.planner.inbox", []);
          if (inbox.some(function (x) { return x.hook === txt; })) { add.textContent = "In planner"; return; }
          inbox.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), hook: txt, topic: t });
          add.textContent = S.set("cs.planner.inbox", inbox.slice(-50)) ? "Added ✓" : "Not saved";
          add.disabled = true;
        });
        acts.appendChild(copy); acts.appendChild(add);
        li.appendChild(sp); li.appendChild(acts); out.appendChild(li);
      });
      moreBtn.hidden = false; note.hidden = false;
    };
    hf.addEventListener("submit", function (e) { e.preventDefault(); build(); });
    moreBtn.addEventListener("click", build);
  }

  /* =================== ENGAGEMENT CALCULATOR (A/B) =================== */
  var ef = document.getElementById("erForm");
  if (ef) {
    var KEYS = ["views", "likes", "comments", "shares"];
    var fmt = function (n, d) { return n.toLocaleString("en-GB", { maximumFractionDigits: d || 0 }); };
    var read = function (v) {
      var o = { filled: false, ok: true, d: {} };
      KEYS.forEach(function (k) {
        var el = document.getElementById(v + "-" + k), raw = el.value.trim();
        if (raw !== "") o.filled = true;
        var valid = raw === "" || /^\d{1,12}$/.test(raw);
        el.setAttribute("aria-invalid", valid ? "false" : "true");
        if (!valid) o.ok = false;
        o.d[k] = valid && raw !== "" ? parseInt(raw, 10) : 0;
      });
      o.inter = o.d.likes + o.d.comments + o.d.shares;
      o.rate = o.d.views > 0 ? o.inter / o.d.views * 100 : null;
      return o;
    };
    var show = function (v, o) {
      var val = document.getElementById(v + "-rate"), sub = document.getElementById(v + "-sub"), bar = document.getElementById(v + "-bar");
      if (!o.ok) { val.textContent = "—"; sub.textContent = "Use whole numbers only (0 or more)."; bar.style.width = "0"; return; }
      if (o.rate === null) { val.textContent = "—"; sub.textContent = o.filled ? "Views must be more than 0" : "Enter views and interactions"; bar.style.width = "0"; return; }
      val.textContent = fmt(o.rate, 2) + "%";
      sub.textContent = fmt(o.inter) + " interactions · " + fmt(o.d.views) + " views";
      bar.style.width = Math.min(o.rate, 20) / 20 * 100 + "%";
    };
    var calc = function () {
      var A = read("a"), B = read("b"), vd = document.getElementById("verdict");
      show("a", A); show("b", B);
      vd.textContent = "";
      if (A.rate === null || B.rate === null || !A.ok || !B.ok) { vd.hidden = true; return; }
      vd.hidden = false;
      var p = function (t, bold) { var s = document.createElement(bold ? "b" : "span"); s.textContent = t; vd.appendChild(s); };
      var hiRate = A.rate === B.rate ? null : (A.rate > B.rate ? "A" : "B");
      var hiViews = A.d.views === B.d.views ? null : (A.d.views > B.d.views ? "A" : "B");
      if (!hiRate) p("Both videos have the same engagement rate. ", true);
      else if (hiViews && hiViews !== hiRate) p("Video " + hiViews + " reached more people, but Video " + hiRate + " has the higher engagement rate. ", true);
      else p("Video " + hiRate + " scores higher on engagement rate" + (hiViews === hiRate ? " and views" : "") + ". ", true);
      p("Both numbers matter: reach shows how far a video travelled, engagement rate shows how strongly viewers reacted. One comparison is a signal, not proof — topic, posting time and audience can all explain differences. Test again before drawing conclusions.");
    };
    ef.addEventListener("input", calc);
    ef.addEventListener("submit", function (e) { e.preventDefault(); });
    document.getElementById("erReset").addEventListener("click", function () { ef.reset(); calc(); });
  }
})();
