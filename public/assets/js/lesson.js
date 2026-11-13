/* Creator Signals — sample lesson: progress + journal saved in this browser */
(function () {
  "use strict";
  var S = window.CS.store, root = document.getElementById("steps");
  if (!root) return;
  var KEY = "cs.lesson." + root.dataset.lesson;
  var st = S.get(KEY, { steps: [], journal: {} });
  if (!st || !Array.isArray(st.steps)) st = { steps: [], journal: {} };
  var boxes = root.querySelectorAll("input[type=checkbox]");
  var bar = document.getElementById("lessonBar"), txt = document.getElementById("lessonTxt"), saved = document.getElementById("journalSaved");
  var prog = function () {
    var d = 0;
    boxes.forEach(function (b) { b.closest(".step").classList.toggle("done", b.checked); if (b.checked) d++; });
    bar.style.width = (d / boxes.length * 100) + "%";
    txt.textContent = d === boxes.length ? "Lesson complete — nice work! ⚡" : d + " of " + boxes.length + " steps done";
  };
  boxes.forEach(function (b, i) {
    b.checked = st.steps.indexOf(i) >= 0;
    b.addEventListener("change", function () {
      st.steps = []; boxes.forEach(function (x, j) { if (x.checked) st.steps.push(j); });
      S.set(KEY, st); prog();
    });
  });
  prog();
  var jf = document.getElementById("journal"), timer;
  if (jf) {
    Array.prototype.forEach.call(jf.elements, function (el) {
      if (!el.name) return;
      el.value = (st.journal && st.journal[el.name]) || "";
      el.addEventListener("input", function () {
        st.journal[el.name] = el.value.slice(0, 1000);
        clearTimeout(timer);
        timer = setTimeout(function () { saved.textContent = S.set(KEY, st) ? "Saved in this browser ✓" : "Could not save in this browser"; }, 400);
      });
    });
    document.getElementById("lessonReset").addEventListener("click", function () {
      st = { steps: [], journal: {} }; S.del(KEY);
      boxes.forEach(function (b) { b.checked = false; }); jf.reset(); prog(); saved.textContent = "Progress cleared";
    });
  }
})();
