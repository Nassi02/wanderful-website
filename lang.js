/* Wanderful — sélecteur de langue FR | EN + bandeau de suggestion.
   Fonctionne sur toutes les pages qui ont des <link rel="alternate" hreflang="fr|en">. */
(function () {
  "use strict";
  var KEY = "wf-lang";
  var html = document.documentElement;
  var cur = (html.lang || "fr").slice(0, 2).toLowerCase();
  var other = cur === "en" ? "fr" : "en";
  var alt = document.querySelector('link[rel="alternate"][hreflang="' + other + '"]');
  if (!alt) return;
  var url = new URL(alt.href, location.href);
  // en local / preview : garder le même hôte
  if (location.hostname !== url.hostname) url = new URL(url.pathname + url.search, location.origin);
  var target = url.pathname + location.hash;

  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function read() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  var css = document.createElement("style");
  css.textContent =
    ".wf-lang{display:inline-flex;align-items:center;gap:.15em;font-size:.85em;font-weight:600;letter-spacing:.04em;white-space:nowrap}" +
    ".wf-lang a,.wf-lang span{color:inherit;text-decoration:none;padding:.15em .3em;border-radius:6px}" +
    ".wf-lang .is-cur{opacity:1;color:#7B3FBD}.wf-lang a{opacity:.55}.wf-lang a:hover{opacity:1}" +
    ".wf-lang-bar{position:fixed;left:16px;bottom:16px;z-index:9998;display:flex;align-items:center;gap:10px;" +
    "max-width:calc(100vw - 110px);padding:10px 12px 10px 16px;border-radius:14px;background:rgba(255,255,255,.96);" +
    "box-shadow:0 10px 30px rgba(61,23,102,.18);border:1px solid #E7DDF7;font:500 14px/1.3 Poppins,Outfit,system-ui,sans-serif;color:#3D1766;" +
    "transform:translateY(20px);opacity:0;transition:.35s ease}" +
    ".wf-lang-bar.on{transform:none;opacity:1}" +
    ".wf-lang-bar a{background:linear-gradient(135deg,#8D7EF2,#B98DF2);color:#fff;text-decoration:none;padding:7px 12px;border-radius:9px;font-weight:600;white-space:nowrap}" +
    ".wf-lang-bar button{border:0;background:none;color:#8a7aa8;font-size:18px;line-height:1;cursor:pointer;padding:2px 4px}";
  document.head.appendChild(css);

  // ---- sélecteur dans la navigation ----
  function makeSwitch() {
    var w = document.createElement("span");
    w.className = "wf-lang";
    w.setAttribute("aria-label", cur === "en" ? "Language" : "Langue");
    ["fr", "en"].forEach(function (l, i) {
      if (i) { var s = document.createElement("span"); s.textContent = "|"; s.style.opacity = ".35"; s.style.padding = "0"; w.appendChild(s); }
      var el;
      if (l === cur) { el = document.createElement("span"); el.className = "is-cur"; el.setAttribute("aria-current", "true"); }
      else { el = document.createElement("a"); el.href = target; el.hreflang = l; el.lang = l;
             el.addEventListener("click", function () { store(l); }); }
      el.textContent = l.toUpperCase();
      w.appendChild(el);
    });
    return w;
  }
  var menu = document.querySelector("nav .menu");
  var nav = document.querySelector("nav");
  if (menu) {
    var cta = menu.querySelector(".menu-cta-btn");
    menu.insertBefore(makeSwitch(), cta || null);
  } else if (nav && nav.querySelector("ul")) {
    var ul = nav.querySelector("ul"), li = document.createElement("li");
    li.appendChild(makeSwitch()); ul.insertBefore(li, ul.lastElementChild);
  } else if (nav) {
    var sw = makeSwitch(); sw.style.marginLeft = "auto"; sw.style.marginRight = "1rem";
    var back = nav.querySelector(".back-btn");
    nav.insertBefore(sw, back || null);
  }

  // ---- bandeau de suggestion (une seule fois, jamais de redirection forcée) ----
  if (read()) return;
  var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""]);
  var pref = (langs[0] || "").slice(0, 2).toLowerCase();
  if (cur === "fr" && (pref === "fr" || pref === "")) return;
  if (cur === "en" && pref !== "fr") return;
  var bar = document.createElement("div");
  bar.className = "wf-lang-bar"; bar.setAttribute("role", "dialog");
  bar.lang = other;
  bar.innerHTML = other === "en"
    ? '<span>View this site in English?</span><a href="' + target + '" hreflang="en">English</a><button type="button" aria-label="Close">×</button>'
    : '<span>Voir ce site en français ?</span><a href="' + target + '" hreflang="fr">Français</a><button type="button" aria-label="Fermer">×</button>';
  bar.querySelector("a").addEventListener("click", function () { store(other); });
  bar.querySelector("button").addEventListener("click", function () { store(cur); bar.remove(); });
  setTimeout(function () { document.body.appendChild(bar); requestAnimationFrame(function () { bar.classList.add("on"); }); }, 1200);
})();
