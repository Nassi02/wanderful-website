// Wanderful Rappels — bot Telegram de rappels de publication
// Modes : ?mode=tick (cron toutes les 5 min), ?mode=setup (une fois), webhook Telegram (boutons)
import { createClient } from "npm:@supabase/supabase-js@2";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
function serviceKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0]; } catch { return Deno.env.get("SUPABASE_SECRET_KEY") || ""; }
}
const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey() as string, { auth: { persistSession: false } });
const TG = `https://api.telegram.org/bot${TOKEN}`;
const TZ = "Europe/Zurich";
const NET_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn" };

// ---------- utilitaires ----------
async function tg(method: string, body: unknown) {
  const r = await fetch(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return await r.json();
}
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function cfg(key: string) { const { data } = await sb.from("bot_config").select("value").eq("key", key).maybeSingle(); return data?.value ?? null; }
async function setCfg(key: string, value: string) { await sb.from("bot_config").upsert({ key, value, updated_at: new Date().toISOString() }); }

function zParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, h: +p.hour, m: +p.minute };
}
function tzOff(ts: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}
function zurichDate(day: string, hm: string) {
  const g = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5));
  return new Date(g - tzOff(g));
}
const londonHM = (d: Date) => new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(d).replace(":", "h");
const swissHM = (d: Date) => zParts(d).hm.replace(":", "h");

function netsOf(it: any): string[] {
  // Un contenu = un réseau, d'après sa plateforme (les versions TikTok sont des contenus séparés ;
  // Facebook suit Instagram via le partage automatique Instagram -> Facebook)
  const p = String(it.platform || "instagram").toLowerCase();
  return [p.includes("tiktok") ? "tiktok" : p.includes("linkedin") ? "linkedin" : p.includes("face") ? "facebook" : "instagram"];
}
function capFor(it: any, n: string) {
  const b = it.brief || {};
  const k = n === "tiktok" ? "caption_tt" : n === "linkedin" ? "caption_li" : n === "facebook" ? "caption_fb" : null;
  if (k && b[k] && String(b[k]).trim()) return String(b[k]);
  return it.caption || "";
}
function mediaList(it: any): string[] {
  const m = it.media_url; if (!m) return [];
  if (typeof m === "string" && m.startsWith("[")) { try { const a = JSON.parse(m); return Array.isArray(a) ? a : [m]; } catch { return [m]; } }
  return [m];
}
const isVideo = (u: string, it: any) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u) || String(it.media_type || "").startsWith("video");
const isPublished = (it: any) => it.status === "published" || it.publish_state === "published";

async function loadDefaults() {
  const out: Record<string, Record<string, string>> = {};
  for (const [n, t] of [["instagram", "ig_connections"], ["facebook", "fb_connections"], ["tiktok", "tt_connections"], ["linkedin", "li_connections"]]) {
    const { data } = await sb.from(t).select("client_id, default_time");
    for (const r of data || []) { (out[r.client_id] ||= {})[n] = r.default_time; }
  }
  return out;
}
function timeFor(it: any, n: string, defs: Record<string, Record<string, string>>) {
  const t = (it.brief || {}).time;
  if (/^\d{2}:\d{2}$/.test(t || "")) return t;
  const d = defs[it.client_id]?.[n];
  return /^\d{2}:\d{2}/.test(d || "") ? d.slice(0, 5) : "18:00";
}
function soundOf(it: any, n: string) {
  const b = it.brief || {};
  const s = (n === "tiktok" && b.sound_tt) || b.sound || b.music || (b.tt && typeof b.tt === "object" && n === "tiktok" && b.tt.sound);
  return s ? String(s) : "à choisir dans l'appli";
}

// ---------- envoi d'un rappel ----------
async function sendMedia(chat: string, it: any, caption: string) {
  const urls = mediaList(it);
  if (!urls.length) { await tg("sendMessage", { chat_id: chat, text: "⚠️ Aucun fichier déposé pour ce post dans l'espace client." }); return; }
  if (urls.length > 1) {
    const group = urls.slice(0, 10).map((u, i) => ({ type: isVideo(u, it) ? "video" : "photo", media: u, ...(i === 0 ? { caption } : {}) }));
    const r = await tg("sendMediaGroup", { chat_id: chat, media: group });
    if (r.ok) return;
  }
  const u = urls[0];
  const video = isVideo(u, it);
  // Taille du fichier : <= 20 Mo envoyé par lien, <= 49 Mo téléchargé puis envoyé, au-delà lien de téléchargement
  let size = 0;
  try { const h = await fetch(u, { method: "HEAD" }); size = +(h.headers.get("content-length") || 0); } catch { /* ignore */ }
  if (size && size <= 20e6) {
    const r = await tg(video ? "sendVideo" : "sendPhoto", { chat_id: chat, [video ? "video" : "photo"]: u, caption, supports_streaming: true });
    if (r.ok) return;
  }
  if (size && size <= 49e6) {
    const blob = await (await fetch(u)).blob();
    const fd = new FormData();
    fd.append("chat_id", chat); fd.append("caption", caption);
    fd.append(video ? "video" : "photo", blob, (u.split("/").pop() || "media").split("?")[0]);
    const r = await (await fetch(`${TG}/${video ? "sendVideo" : "sendPhoto"}`, { method: "POST", body: fd })).json();
    if (r.ok) return;
  }
  await tg("sendMessage", { chat_id: chat, text: `📎 Fichier trop lourd pour Telegram (${Math.round(size / 1e6)} Mo) : ${u}` });
}

async function sendReminder(chat: string, it: any, n: string, at: Date, clientName: string) {
  const fileName = `${clientName} · ${NET_LABEL[n] || n}${it.type ? " · " + it.type : ""}`;
  await sendMedia(chat, it, fileName);
  const cap = capFor(it, n);
  const lines = [
    `🔔 <b>C'est l'heure · ${esc(clientName)}</b>`,
    `<b>${esc(NET_LABEL[n] || n)}</b>${n === "instagram" ? " (Facebook suit tout seul)" : ""} · ${esc(it.type || "")}`,
    `<b>${esc(it.title || "")}</b>`,
    `🎵 <b>Son :</b> ${esc(soundOf(it, n))}`,
    cap ? `\n<b>Légende</b> (appuie pour copier) :\n<code>${esc(cap).slice(0, 3200)}</code>` : "",
    `\n<i>${swissHM(at)} Suisse · ${londonHM(at)} Londres</i>`,
  ].filter(Boolean);
  await tg("sendMessage", {
    chat_id: chat, text: lines.join("\n"), parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "✅ Publié", callback_data: `done:${it.id}:${n}` }, { text: "⏰ Reporter de 30 min", callback_data: `snz:${it.id}:${n}` }]] },
  });
}

// ---------- tick (toutes les 5 min) ----------
async function tick() {
  const chat = await cfg("chat_id");
  if (!chat) return { ok: false, reason: "no chat" };
  const now = new Date();
  const z = zParts(now);
  const defs = await loadDefaults();
  const { data: clients } = await sb.from("clients").select("id, name");
  const cname = (id: string) => (clients || []).find((c) => c.id === id)?.name?.replace(/\s*Sàrl$/, "") || "Client";
  const from = new Date(now.getTime() - 3 * 864e5).toISOString();
  const to = new Date(now.getTime() + 3 * 864e5).toISOString();
  const { data: items } = await sb.from("content_items").select("*").gte("scheduled_at", from).lte("scheduled_at", to);
  const { data: evs } = await sb.from("tg_events").select("*");
  const ev = (id: string, n: string, k: string) => (evs || []).find((e) => e.item_id === id && e.net === n && e.kind === k);
  const done: string[] = [];

  // Liste (post x réseau) avec heure de publication
  const slots: { it: any; n: string; at: Date; day: string }[] = [];
  for (const it of items || []) {
    if (!it.scheduled_at) continue;
    const day = zParts(new Date(it.scheduled_at)).day;
    for (const n of netsOf(it)) slots.push({ it, n, at: zurichDate(day, timeFor(it, n, defs)), day });
  }
  slots.sort((a, b) => a.at.getTime() - b.at.getTime());

  // 1. Programme du jour à 10h00 (heure suisse = 9h Londres)
  if (z.h === 10 && (await cfg("digest_day")) !== z.day) {
    const today = slots.filter((s) => s.day === z.day && !isPublished(s.it) && !ev(s.it.id, s.n, "done"));
    const lines = today.map((s) => `<b>${swissHM(s.at)}</b> · ${esc(cname(s.it.client_id))} · ${esc(NET_LABEL[s.n])}${s.n === "instagram" ? " (+ Facebook)" : ""}\n${esc(s.it.title || "")}${s.it.status !== "approved" ? " <i>(pas encore validé)</i>" : ""}`);
    await tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: `☀️ <b>Programme du jour</b>\n\n${lines.length ? lines.join("\n\n") : "Rien à publier aujourd'hui."}\n\n<i>Je te renvoie chaque post à son heure.</i>` });
    await setCfg("digest_day", z.day); done.push("digest");
  }

  // 2. Alerte la veille à 18h00 : posts de demain pas encore validés
  if (z.h === 18 && (await cfg("eve_day")) !== z.day) {
    const tomorrow = zParts(new Date(now.getTime() + 864e5)).day;
    const todo = slots.filter((s) => s.day === tomorrow && s.it.status !== "approved" && !isPublished(s.it));
    const seen = new Set<string>();
    for (const s of todo) {
      if (seen.has(s.it.id)) continue; seen.add(s.it.id);
      const why = s.it.status === "pending" ? "attend toujours la validation du client" : s.it.status === "changes_requested" ? "a une modification demandée par le client" : "n'est pas encore produit ni validé";
      await tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: `📅 <b>Pour demain</b> · ${esc(cname(s.it.client_id))}\n<b>${esc(s.it.title || "")}</b>, prévu demain ${swissHM(s.at)}, ${why}.` });
    }
    await setCfg("eve_day", z.day); done.push("eve:" + seen.size);
  }

  // 3. Rappels à l'heure + 4. relance si pas publié 30 min après
  for (const s of slots) {
    if (s.it.status !== "approved" || isPublished(s.it) || ev(s.it.id, s.n, "done")) continue;
    const snz = ev(s.it.id, s.n, "snooze");
    const due = new Date(Math.max(s.at.getTime(), snz?.until ? new Date(snz.until).getTime() : 0));
    const age = now.getTime() - due.getTime();
    if (age >= 0 && age < 6 * 36e5 && !ev(s.it.id, s.n, "remind")) {
      await sendReminder(chat, s.it, s.n, s.at, cname(s.it.client_id));
      await sb.from("tg_events").upsert({ item_id: s.it.id, net: s.n, kind: "remind", at: now.toISOString() });
      done.push("remind:" + s.it.id + ":" + s.n);
    } else if (age >= 30 * 6e4 && age < 24 * 36e5 && ev(s.it.id, s.n, "remind") && !ev(s.it.id, s.n, "late")) {
      await tg("sendMessage", {
        chat_id: chat, parse_mode: "HTML",
        text: `⏳ <b>Relance</b> · ${esc(cname(s.it.client_id))}\n<b>${esc(s.it.title || "")}</b> (${esc(NET_LABEL[s.n])}) était prévu à ${swissHM(s.at)} et n'est pas marqué publié.`,
        reply_markup: { inline_keyboard: [[{ text: "✅ C'est publié", callback_data: `done:${s.it.id}:${s.n}` }, { text: "⏰ Reporter de 30 min", callback_data: `snz:${s.it.id}:${s.n}` }]] },
      });
      await sb.from("tg_events").upsert({ item_id: s.it.id, net: s.n, kind: "late", at: now.toISOString() });
      done.push("late:" + s.it.id + ":" + s.n);
    }
  }
  return { ok: true, done };
}

// ---------- boutons Telegram ----------
async function onCallback(cb: any) {
  const chat = await cfg("chat_id");
  if (String(cb.message?.chat?.id) !== String(chat)) return;
  let [act, id, n] = String(cb.data || "").split(":");
  if (act === "cli") { n = id; id = (await cfg("last_idea")) || ""; }
  if (act === "noop") { await tg("answerCallbackQuery", { callback_query_id: cb.id }); return; }
  const { data: it } = await sb.from("content_items").select("*").eq("id", id).maybeSingle();
  if (!it) { await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Post introuvable" }); return; }
  if (act === "done") {
    await sb.from("tg_events").upsert({ item_id: id, net: n, kind: "done", at: new Date().toISOString() });
    const { data: evs } = await sb.from("tg_events").select("net").eq("item_id", id).eq("kind", "done");
    const doneNets = new Set((evs || []).map((e) => e.net));
    const all = netsOf(it).every((x) => doneNets.has(x));
    if (all) await sb.from("content_items").update({ status: "published", published_at: new Date().toISOString() }).eq("id", id);
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: all ? "Marqué publié dans l'espace client ✅" : `${NET_LABEL[n]} noté ✅` });
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: `✅ Publié · ${NET_LABEL[n]}`, callback_data: "noop" }]] } });
  } else if (act === "snz") {
    const until = new Date(Date.now() + 30 * 6e4);
    await sb.from("tg_events").delete().eq("item_id", id).eq("net", n).in("kind", ["remind", "late"]);
    await sb.from("tg_events").upsert({ item_id: id, net: n, kind: "snooze", at: new Date().toISOString(), until: until.toISOString() });
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `Je te le renvoie à ${swissHM(until)} (Suisse)` });
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: `⏰ Reporté à ${swissHM(until)}`, callback_data: "noop" }]] } });
  } else if (act === "cli") {
    // n = id du client choisi
    await sb.from("content_items").update({ client_id: n }).eq("id", id);
    const { data: c } = await sb.from("clients").select("name").eq("id", n).maybeSingle();
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: `Rangée chez ${c?.name || "ce client"}` });
    await tg("editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [[{ text: `📁 ${c?.name || "Client"}`, callback_data: "noop" }]] } });
  } else {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
  }
}

// ---------- idées : lien Instagram / TikTok envoyé au bot ----------
const WANDERFUL_ID = "04567b4c-87e5-47d7-b788-007d15497ecf";
async function saveInspiration(m: any) {
  const text = String(m.text || m.caption || "");
  const link = (text.match(/https?:\/\/\S+/) || [""])[0];
  const note = text.replace(link, "").trim();
  const platform = /tiktok/i.test(link) ? "TikTok" : /instagram|instagr\.am/i.test(link) ? "Instagram" : /linkedin/i.test(link) ? "LinkedIn" : "Instagram";
  const title = `💡 Inspiration ${platform}${note ? " · " + note.slice(0, 60) : ""}`;
  const { data: row, error } = await sb.from("content_items").insert({
    client_id: WANDERFUL_ID, platform, title, status: "idea",
    brief: { inspiration: link, notes: note ? `Inspiration envoyée via Telegram : ${note}` : "Inspiration envoyée via Telegram", nets: [platform.toLowerCase()] },
  }).select("id").single();
  if (error || !row) { await tg("sendMessage", { chat_id: m.chat.id, text: "⚠️ Je n'ai pas pu enregistrer cette idée : " + (error?.message || "erreur") }); return; }
  await setCfg("last_idea", row.id);
  const { data: clients } = await sb.from("clients").select("id, name").order("name");
  const others = (clients || []).filter((c) => c.id !== WANDERFUL_ID && !/test/i.test(c.name));
  await tg("sendMessage", {
    chat_id: m.chat.id, parse_mode: "HTML", reply_to_message_id: m.message_id,
    text: `💡 <b>Idée enregistrée</b> chez <b>Wanderful</b>, dans « Sans date » du calendrier.\nAjoute un mot avec le lien la prochaine fois (ex. « format à refaire pour Gary ») pour qu'il apparaisse dans le titre.\n\nC'est pour un autre client ?`,
    reply_markup: { inline_keyboard: others.slice(0, 6).map((c) => [{ text: c.name, callback_data: `cli:${c.id}` }]) },
  });
}

// ---------- installation ----------
async function setup(fnUrl: string, secret: string) {
  const up = await tg("getUpdates", {});
  const msg = (up.result || []).reverse().find((u: any) => u.message?.chat?.type === "private");
  if (!msg) return { ok: false, reason: "Aucun message reçu : envoie /start au bot puis relance." };
  const chat = String(msg.message.chat.id);
  await setCfg("chat_id", chat);
  const wh = await tg("setWebhook", { url: fnUrl, secret_token: secret, allowed_updates: ["callback_query", "message"] });
  await tg("setMyCommands", { commands: [{ command: "aujourdhui", description: "Programme du jour" }] });
  await tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: "👋 <b>Wanderful Rappels est branché.</b>\n\nChaque jour à 10h (heure suisse, 9h à Londres) : le programme du jour.\nÀ l'heure de chaque post : la vidéo, la légende à copier et le son.\nLa veille à 18h : les posts de demain pas encore validés.\n30 min après l'heure : une relance si ce n'est pas marqué publié." });
  return { ok: true, chat_set: true, webhook: wh.ok };
}

Deno.serve(async (req) => {
  const secret = await cfg("secret");
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const fromTelegram = req.headers.get("x-telegram-bot-api-secret-token");
  const fromCron = req.headers.get("x-wf-secret");
  if (!secret || (fromTelegram !== secret && fromCron !== secret)) return new Response("forbidden", { status: 403 });
  try {
    if (fromTelegram) {
      const u = await req.json();
      if (u.callback_query) await onCallback(u.callback_query);
      else if (u.message && String(u.message.chat.id) === String(await cfg("chat_id")) && /https?:\/\//.test(u.message.text || u.message.caption || "")) {
        await saveInspiration(u.message);
      } else if (u.message?.text?.startsWith("/aujourdhui") && String(u.message.chat.id) === String(await cfg("chat_id"))) {
        await forceDigest();
      }
      return new Response("ok");
    }
    if (mode === "setup") return Response.json(await setup(`${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-bot`, secret));
    if (mode === "digest") { await forceDigest(); return Response.json({ ok: true }); }
    return Response.json(await tick());
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});

// Programme du jour à la demande (/aujourdhui)
async function forceDigest() {
  const chat = await cfg("chat_id"); if (!chat) return;
  const now = new Date(); const z = zParts(now); const defs = await loadDefaults();
  const { data: clients } = await sb.from("clients").select("id, name");
  const cname = (id: string) => (clients || []).find((c) => c.id === id)?.name?.replace(/\s*Sàrl$/, "") || "Client";
  const { data: items } = await sb.from("content_items").select("*").gte("scheduled_at", new Date(now.getTime() - 864e5).toISOString()).lte("scheduled_at", new Date(now.getTime() + 864e5).toISOString());
  const rows: { at: Date; t: string }[] = [];
  for (const it of items || []) {
    if (!it.scheduled_at || isPublished(it)) continue;
    const day = zParts(new Date(it.scheduled_at)).day; if (day !== z.day) continue;
    for (const n of netsOf(it)) { const at = zurichDate(day, timeFor(it, n, defs)); rows.push({ at, t: `<b>${swissHM(at)}</b> · ${esc(cname(it.client_id))} · ${esc(NET_LABEL[n])}${n === "instagram" ? " (+ Facebook)" : ""}\n${esc(it.title || "")}${it.status !== "approved" ? " <i>(pas encore validé)</i>" : ""}` }); }
  }
  rows.sort((a, b) => a.at.getTime() - b.at.getTime());
  await tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: `☀️ <b>Programme du jour</b>\n\n${rows.length ? rows.map((r) => r.t).join("\n\n") : "Rien à publier aujourd'hui."}` });
}
