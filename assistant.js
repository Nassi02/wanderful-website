/* ============================================================
   Wanderful — Widget Assistant IA
   ------------------------------------------------------------
   Bulle de chat en bas à droite, aux couleurs Wanderful.
   Auto-contenu : injecte son propre CSS + HTML. Aucune dépendance.

   INSTALLATION
   1. Remplace WORKER_URL ci-dessous par l'URL de ton Worker Cloudflare.
   2. Ajoute ce fichier au repo (assistant.js), puis avant </body>
      de chaque page :  <script src="/assistant.js" defer></script>
   ============================================================ */
/* Wanderful Assistant — v1.0 */
(function () {
  "use strict";

  // ⚠️ À REMPLACER par l'URL de ton Worker (ex : https://wanderful-assistant.ton-sous-domaine.workers.dev)
  const WORKER_URL = "https://wanderful-assistant.marketingwanderful.workers.dev";

  // Couleurs de marque Wanderful
  const C = {
    p1: "#7B3FBD", p2: "#3D1766", p3: "#5A2898",
    p4: "#B07FE0", p5: "#D4B0F8", cy: "#7EC8DC",
  };

  const GREETING =
    "Bonjour et bienvenue chez Wanderful ✦ Je suis votre assistant. " +
    "Dites-moi ce que vous cherchez à améliorer — Google Ads, SEO, site web, contenu… — " +
    "et je vous oriente vers la bonne solution.";

  // Historique de conversation envoyé au proxy
  const history = [];

  // ── Styles (scoping via préfixe .wfc-) ─────────────────────
  const css = `
  .wfc-launch,.wfc-panel,.wfc-panel *{box-sizing:border-box;cursor:auto;}
  .wfc-launch{
    position:fixed;bottom:24px;right:24px;z-index:2147483000;
    width:62px;height:62px;border:none;border-radius:50%;
    background:linear-gradient(135deg,${C.p1} 0%,${C.p3} 100%);
    box-shadow:0 6px 24px rgba(123,63,189,.5);
    cursor:pointer;display:flex;align-items:center;justify-content:center;
    transition:transform .2s ease,box-shadow .2s ease;
  }
  .wfc-launch:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 10px 32px rgba(123,63,189,.65);}
  .wfc-launch svg{width:28px;height:28px;}
  .wfc-launch .wfc-badge{
    position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;
    background:${C.cy};box-shadow:0 0 8px ${C.cy};border:2px solid #fff;
  }
  .wfc-hidden{display:none !important;}

  .wfc-panel{
    position:fixed;bottom:24px;right:24px;z-index:2147483000;
    width:376px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 48px);
    background:#F7F5FF;border-radius:20px;overflow:hidden;
    display:flex;flex-direction:column;
    box-shadow:0 20px 60px rgba(61,23,102,.28);
    border:1px solid rgba(176,127,224,.35);
    font-family:'Outfit',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    animation:wfc-in .28s cubic-bezier(.34,1.56,.64,1);
  }
  @keyframes wfc-in{from{opacity:0;transform:translateY(16px) scale(.97);}to{opacity:1;transform:none;}}

  .wfc-head{
    background:linear-gradient(135deg,${C.p2} 0%,${C.p3} 55%,${C.p1} 100%);
    color:#fff;padding:16px 18px;display:flex;align-items:center;gap:12px;flex-shrink:0;
  }
  .wfc-head .wfc-avatar{
    width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.15);
    display:flex;align-items:center;justify-content:center;flex-shrink:0;
  }
  .wfc-head .wfc-avatar svg{width:20px;height:20px;}
  .wfc-head h4{margin:0;font-size:.98rem;font-weight:700;letter-spacing:-.01em;}
  .wfc-head .wfc-status{font-size:.72rem;opacity:.8;display:flex;align-items:center;gap:6px;margin-top:2px;}
  .wfc-head .wfc-dot{width:7px;height:7px;border-radius:50%;background:${C.cy};box-shadow:0 0 6px ${C.cy};}
  .wfc-close{margin-left:auto;background:none;border:none;color:#fff;opacity:.8;cursor:pointer;padding:4px;font-size:1.3rem;line-height:1;}
  .wfc-close:hover{opacity:1;}

  .wfc-body{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px;}
  .wfc-body::-webkit-scrollbar{width:6px;}
  .wfc-body::-webkit-scrollbar-thumb{background:rgba(176,127,224,.4);border-radius:3px;}

  .wfc-msg{max-width:82%;padding:11px 14px;font-size:.9rem;line-height:1.5;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;}
  .wfc-bot{align-self:flex-start;background:#fff;color:${C.p2};border:1px solid rgba(176,127,224,.25);border-bottom-left-radius:4px;}
  .wfc-bot a{color:${C.p1};font-weight:600;text-decoration:underline;}
  .wfc-bot strong{font-weight:700;color:${C.p2};}
  .wfc-user{align-self:flex-end;background:linear-gradient(135deg,${C.p1},${C.p3});color:#fff;border-bottom-right-radius:4px;}

  .wfc-typing{align-self:flex-start;background:#fff;border:1px solid rgba(176,127,224,.25);border-radius:14px;border-bottom-left-radius:4px;padding:13px 16px;display:flex;gap:5px;}
  .wfc-typing span{width:7px;height:7px;border-radius:50%;background:${C.p4};animation:wfc-bounce 1.2s infinite ease-in-out;}
  .wfc-typing span:nth-child(2){animation-delay:.15s;}
  .wfc-typing span:nth-child(3){animation-delay:.3s;}
  @keyframes wfc-bounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-5px);opacity:1;}}

  .wfc-quick{display:flex;flex-wrap:wrap;gap:7px;padding:0 18px 12px;}
  .wfc-chip{
    font-family:inherit;font-size:.78rem;font-weight:500;color:${C.p1};cursor:pointer;
    background:#fff;border:1px solid rgba(123,63,189,.3);border-radius:16px;padding:7px 12px;
    transition:background .15s,color .15s;
  }
  .wfc-chip:hover{background:${C.p1};color:#fff;}

  .wfc-foot{padding:12px;border-top:1px solid rgba(176,127,224,.25);background:#fff;flex-shrink:0;}
  .wfc-inrow{display:flex;gap:8px;align-items:flex-end;}
  .wfc-input{
    flex:1;resize:none;border:1px solid rgba(176,127,224,.4);border-radius:12px;
    padding:10px 12px;font-family:inherit;font-size:.9rem;color:${C.p2};
    max-height:96px;outline:none;line-height:1.4;
  }
  .wfc-input:focus{border-color:${C.p1};}
  .wfc-send{
    width:42px;height:42px;flex-shrink:0;border:none;border-radius:12px;cursor:pointer;
    background:linear-gradient(135deg,${C.p1},${C.p3});display:flex;align-items:center;justify-content:center;
    transition:transform .15s,box-shadow .15s;
  }
  .wfc-send:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(123,63,189,.4);}
  .wfc-send:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none;}
  .wfc-send svg{width:19px;height:19px;}
  .wfc-legal{text-align:center;font-size:.66rem;color:rgba(61,23,102,.45);margin-top:8px;}

  @media(max-width:480px){
    .wfc-panel{bottom:0;right:0;left:0;width:100%;max-width:100%;height:100%;max-height:100%;border-radius:0;}
    .wfc-launch{bottom:18px;right:18px;}
  }`;

  const WAND_SVG = `<svg viewBox="0 0 34 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 11 L5 38" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M7.5 33.5 L4.5 38.5" stroke="${C.p5}" stroke-width="3.8" stroke-linecap="round"/>
    <path d="M20 1 L21.4 6.6 L27 5 L21.4 8.4 L23 14 L20 9.6 L17 14 L18.6 8.4 L13 5 L18.6 6.6Z" fill="#fff" stroke="${C.p5}" stroke-width="0.9" stroke-linejoin="round"/>
  </svg>`;

  // ── Construction du DOM ────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const launch = document.createElement("button");
  launch.className = "wfc-launch";
  launch.setAttribute("aria-label", "Ouvrir l'assistant Wanderful");
  launch.innerHTML = WAND_SVG + '<span class="wfc-badge"></span>';
  document.body.appendChild(launch);

  const panel = document.createElement("div");
  panel.className = "wfc-panel wfc-hidden";
  panel.innerHTML = `
    <div class="wfc-head">
      <div class="wfc-avatar">${WAND_SVG}</div>
      <div>
        <h4>Assistant Wanderful</h4>
        <div class="wfc-status"><span class="wfc-dot"></span> En ligne · réponse immédiate</div>
      </div>
      <button class="wfc-close" aria-label="Fermer">×</button>
    </div>
    <div class="wfc-body"></div>
    <div class="wfc-quick">
      <button class="wfc-chip">Améliorer mes Google Ads</button>
      <button class="wfc-chip">Refaire mon site web</button>
      <button class="wfc-chip">Audit gratuit</button>
    </div>
    <div class="wfc-foot">
      <div class="wfc-inrow">
        <textarea class="wfc-input" rows="1" placeholder="Écrivez votre message…"></textarea>
        <button class="wfc-send" aria-label="Envoyer">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 12l16-8-6 16-2-6-8-2z" fill="#fff"/></svg>
        </button>
      </div>
      <div class="wfc-legal">Propulsé par l'IA · vérifiez les infos importantes</div>
    </div>`;
  document.body.appendChild(panel);

  const body = panel.querySelector(".wfc-body");
  const input = panel.querySelector(".wfc-input");
  const sendBtn = panel.querySelector(".wfc-send");
  const quick = panel.querySelector(".wfc-quick");
  let greeted = false;

  // ── Helpers UI ─────────────────────────────────────────────
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // Rendu markdown minimal et sûr : liens, gras, sauts de ligne.
  function mdToHtml(text) {
    let t = escapeHtml(text);
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\n/g, "<br>");
    return t;
  }

  function addMsg(text, who) {
    const el = document.createElement("div");
    el.className = "wfc-msg " + (who === "user" ? "wfc-user" : "wfc-bot");
    if (who === "user") el.textContent = text;
    else el.innerHTML = mdToHtml(text);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  function showTyping() {
    const t = document.createElement("div");
    t.className = "wfc-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    body.appendChild(t);
    body.scrollTop = body.scrollHeight;
    return t;
  }

  function openPanel() {
    panel.classList.remove("wfc-hidden");
    launch.classList.add("wfc-hidden");
    if (!greeted) { addMsg(GREETING, "bot"); greeted = true; }
    setTimeout(() => input.focus(), 100);
  }
  function closePanel() {
    panel.classList.add("wfc-hidden");
    launch.classList.remove("wfc-hidden");
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text) return;
    quick.classList.add("wfc-hidden");
    addMsg(text, "user");
    history.push({ role: "user", content: text });
    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;

    const typing = showTyping();
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      const data = await res.json();
      typing.remove();
      const reply = data.reply || "Désolé, une erreur est survenue. Réessayez ou passez par la page Contact.";
      addMsg(reply, "bot");
      history.push({ role: "assistant", content: reply });
    } catch (e) {
      typing.remove();
      addMsg("Connexion impossible pour le moment. Vous pouvez nous joindre via la page Contact.", "bot");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  // ── Événements ─────────────────────────────────────────────
  launch.addEventListener("click", openPanel);
  panel.querySelector(".wfc-close").addEventListener("click", closePanel);
  sendBtn.addEventListener("click", () => send(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 96) + "px";
  });
  quick.addEventListener("click", (e) => {
    if (e.target.classList.contains("wfc-chip")) send(e.target.textContent);
  });
})();
