// The shell calls these as real start-up steps finish. Nothing here is a timer or a guess.
window.setProgress = function (pct, text) {
  var p = Math.max(0, Math.min(100, Number(pct) || 0));
  document.getElementById("fill").style.width = p + "%";
  document.getElementById("status").textContent = String(text || "");
  document.querySelector(".progress").setAttribute("aria-valuenow", String(Math.round(p)));
};
window.setVersion = function (v) {
  document.getElementById("version").textContent = "Version " + String(v);
};
