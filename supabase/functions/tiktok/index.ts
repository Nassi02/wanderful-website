// Fonction Edge « tiktok » — Login Kit + Content Posting API
//  GET  ?code&state             → retour OAuth : jeton, profil, options de publication, retour à l'espace client
//  POST {action:'start'}        → lien de connexion signé (agence)
//  POST {action:'creator'}      → rafraîchit les options de publication du compte (agence ou client du projet)
//  POST {action:'publish_now'}  → publie tout de suite une vidéo validée (agence)
//  POST {cron:true}             → toutes les 5 min : publie les vidéos validées arrivées à l'heure, suit leur traitement, renouvelle les jetons
// Secrets requis : TT_CLIENT_KEY, TT_CLIENT_SECRET.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SB_URL, (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY'))!);
const CLIENT_KEY = Deno.env.get('TT_CLIENT_KEY') || '';
const CLIENT_SECRET = Deno.env.get('TT_CLIENT_SECRET') || '';
const REDIRECT = SB_URL.replace(/\/$/, '') + '/functions/v1/tiktok';
const BACK = 'https://wanderful-marketing.com/espace-client/';
const SCOPES = 'user.info.basic,video.publish,video.upload';
const API = 'https://open.tiktokapis.com/v2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- état OAuth signé ----------
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function hmac(s: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(CLIENT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s))));
}
async function signState(o: Record<string, unknown>) { const p = b64u(new TextEncoder().encode(JSON.stringify(o))); return p + '.' + await hmac(p); }
async function readState(s: string) {
  const [p, sig] = (s || '').split('.');
  if (!p || !sig || sig !== await hmac(p)) throw new Error('Lien de connexion invalide');
  const o = JSON.parse(new TextDecoder().decode(unb64u(p)));
  if (Date.now() > o.e) throw new Error('Lien de connexion expiré : génère un nouveau lien depuis l’espace client');
  return o;
}

// ---------- API TikTok ----------
function ttMsg(e: any, status: number) {
  const code = e?.code || '', m = e?.message || e?.log_id || ('HTTP ' + status);
  if (code === 'access_token_invalid' || status === 401) return 'Accès TikTok expiré ou retiré : reconnecte le compte. (' + m + ')';
  if (code === 'scope_not_authorized') return 'Autorisation de publication non accordée : reconnecte le compte en acceptant toutes les autorisations.';
  if (code === 'spam_risk_too_many_posts') return 'TikTok limite le nombre de publications par jour pour ce compte : nouvel essai demain.';
  if (code === 'spam_risk_user_banned_from_posting') return 'Ce compte TikTok est temporairement bloqué pour la publication.';
  if (code === 'reached_active_user_cap') return 'Limite quotidienne de l’app TikTok atteinte : nouvel essai plus tard.';
  if (code === 'unaudited_client_can_only_post_to_private_accounts') return 'Tant que TikTok n’a pas validé l’app, le compte doit être en privé pour recevoir des publications (ou choisir « Moi uniquement »).';
  if (code === 'privacy_level_option_mismatch') return 'La visibilité choisie n’est plus proposée par ce compte : choisis-en une autre.';
  if (status === 429 || code === 'rate_limit_exceeded') return 'Limite TikTok atteinte : nouvel essai plus tard.';
  return code ? code + ' : ' + m : m;
}
async function tt(path: string, token: string, body?: unknown, method = 'POST') {
  const r = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || (d.error && d.error.code && d.error.code !== 'ok')) { const e: any = new Error(ttMsg(d.error, r.status)); e.status = r.status; e.code = d.error?.code; throw e; }
  return d.data || {};
}
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch(API + '/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_key: CLIENT_KEY, client_secret: CLIENT_SECRET, ...params }) });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || 'Échange du code impossible');
  return d;
}
function tokenRow(t: any) {
  const now = Date.now();
  return {
    access_token: t.access_token, token_expires_at: new Date(now + (t.expires_in || 86400) * 1000).toISOString(),
    refresh_token: t.refresh_token || null, refresh_expires_at: t.refresh_expires_in ? new Date(now + t.refresh_expires_in * 1000).toISOString() : null,
  };
}
async function creatorInfo(token: string) {
  const d = await tt('/post/publish/creator_info/query/', token, {});
  return {
    nickname: d.creator_nickname || null, username: d.creator_username || null, avatar: d.creator_avatar_url || null,
    privacy_level_options: d.privacy_level_options || [], comment_disabled: !!d.comment_disabled, duet_disabled: !!d.duet_disabled,
    stitch_disabled: !!d.stitch_disabled, max_video_post_duration_sec: d.max_video_post_duration_sec || null, at: new Date().toISOString(),
  };
}

async function whoAmI(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: p } = await admin.from('profiles').select('role,client_id').eq('id', u.user.id).single();
  return { id: u.user.id, agency: p?.role === 'agency', client_id: p?.client_id };
}

// ---------- OAuth ----------
async function callback(url: URL) {
  const back = (q: string) => Response.redirect(BACK + '?tt=' + q, 302);
  if (url.searchParams.get('error')) return back('refus&msg=' + encodeURIComponent(url.searchParams.get('error_description') || 'Connexion annulée'));
  try {
    if (!CLIENT_KEY || !CLIENT_SECRET) throw new Error('Secrets TT_CLIENT_KEY / TT_CLIENT_SECRET absents côté Supabase');
    const st = await readState(url.searchParams.get('state') || '');
    const t = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: REDIRECT });
    const granted = String(t.scope || '').split(',');
    if (!granted.includes('video.publish') && !granted.includes('video.upload')) throw new Error('Autorisation de publication refusée : recommence en acceptant toutes les autorisations');
    // Un compte TikTok = un seul projet (isolation)
    const { data: other } = await admin.from('tt_connections').select('client_id').eq('open_id', t.open_id).neq('client_id', st.c).limit(1);
    if (other?.length) throw new Error('Ce compte TikTok est déjà relié à un autre projet');
    let user: any = {};
    try { user = (await tt('/user/info/?fields=open_id,avatar_url,display_name,username', t.access_token, undefined, 'GET')).user || {}; } catch { /* profil indisponible */ }
    let creator: any = null;
    try { creator = await creatorInfo(t.access_token); } catch { /* options lues à la première publication */ }
    const row = {
      client_id: st.c, open_id: t.open_id, username: user.username || creator?.username || null, display_name: user.display_name || creator?.nickname || null,
      avatar_url: user.avatar_url || creator?.avatar || null, creator, ...tokenRow(t),
      status: 'ok', last_error: null, last_error_at: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('tt_connections').upsert(row, { onConflict: 'client_id' });
    if (error) throw error;
    const { data: ex } = await admin.from('social_accounts').select('id').eq('client_id', st.c).eq('platform', 'tiktok').limit(1);
    const v = { connected: true, handle: row.username ? '@' + row.username : (row.display_name || 'TikTok') };
    if (ex?.length) await admin.from('social_accounts').update(v).eq('id', ex[0].id);
    else await admin.from('social_accounts').insert({ client_id: st.c, platform: 'tiktok', auto: false, ...v });
    return back('ok&u=' + encodeURIComponent(row.username || row.display_name || ''));
  } catch (e) { return back('erreur&msg=' + encodeURIComponent((e as Error).message)); }
}

// ---------- règles de publication ----------
const isVid = (u: string, t?: string) => /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(u) || /video/i.test(t || '');
function mediaOf(it: any): string[] {
  const m = it.media_url; if (!m) return [];
  if (typeof m === 'string' && m.startsWith('[')) { try { const a = JSON.parse(m); return Array.isArray(a) ? a : []; } catch { return [m]; } }
  return [m];
}
function netsOf(it: any) {
  const n = it.brief?.nets; if (Array.isArray(n) && n.length) return n;
  const p = String(it.platform || 'instagram').toLowerCase();
  return [p.includes('face') ? 'facebook' : p.includes('linkedin') ? 'linkedin' : p.includes('tiktok') ? 'tiktok' : 'instagram'];
}
function captionOf(it: any) { const b = it.brief || {}; return (b.caption_tt && String(b.caption_tt).trim()) ? b.caption_tt : (it.caption || ''); }
function settingsOf(it: any) { return (it.brief && it.brief.tt) || {}; }
function problems(it: any, conn: any) {
  const m = mediaOf(it), p: string[] = [], s = settingsOf(it);
  if (m.length !== 1 || !isVid(m[0], it.media_type)) p.push('TikTok : une seule vidéo par publication (les photos ne sont pas encore prises en charge)');
  if (captionOf(it).length > 2200) p.push('Texte TikTok de plus de 2 200 caractères');
  if (!s.privacy) p.push('Visibilité TikTok à choisir');
  else if (!conn.audited && s.mode !== 'draft' && s.privacy !== 'SELF_ONLY') p.push('Tant que TikTok n’a pas validé l’app, seule la visibilité « Moi uniquement » est possible');
  if (s.brand_content && s.privacy === 'SELF_ONLY') p.push('Un contenu de marque (partenariat) ne peut pas être privé sur TikTok');
  return p;
}
function tzOffset(ts: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}
function publishAt(it: any, conn: any) {
  if (!it.scheduled_at) return null;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(it.scheduled_at));
  const t = /^\d{2}:\d{2}$/.test(it.brief?.time || '') ? it.brief.time : conn.default_time || '18:00';
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +t.slice(0, 2), +t.slice(3, 5));
  return new Date(guess - tzOffset(guess));
}
function allDone(it: any, upd: Record<string, unknown>) {
  const x = { ...it, ...upd };
  return netsOf(x).every((n: string) => n === 'instagram' ? x.publish_state === 'published' : n === 'linkedin' ? x.li_state === 'published' : n === 'tiktok' ? x.tt_state === 'published' : true);
}

// ---------- publication ----------
async function send(it: any, conn: any) {
  const token = conn.access_token, s = settingsOf(it), draft = s.mode === 'draft';
  // Options du compte relues juste avant de publier (exigence TikTok)
  const cr = await creatorInfo(token);
  await admin.from('tt_connections').update({ creator: cr, updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
  if (!draft && !cr.privacy_level_options.includes(s.privacy)) throw new Error('La visibilité « ' + s.privacy + ' » n’est pas proposée par ce compte TikTok : choisis-en une autre.');
  const res = await fetch(mediaOf(it)[0]);
  if (!res.ok) throw new Error('Vidéo introuvable (HTTP ' + res.status + ')');
  const bin = new Uint8Array(await res.arrayBuffer());
  const size = bin.byteLength, MB = 1024 * 1024;
  const chunk = size <= 64 * MB ? size : 10 * MB, count = size <= 64 * MB ? 1 : Math.floor(size / chunk);
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count };
  let d: any;
  if (draft) d = await tt('/post/publish/inbox/video/init/', token, { source_info });
  else {
    const post_info: Record<string, unknown> = {
      title: captionOf(it), privacy_level: s.privacy,
      disable_comment: cr.comment_disabled || s.comment === false, disable_duet: cr.duet_disabled || s.duet === false, disable_stitch: cr.stitch_disabled || s.stitch === false,
      brand_content_toggle: !!s.brand_content, brand_organic_toggle: !!s.brand_organic,
    };
    if (s.cover_ms != null) post_info.video_cover_timestamp_ms = +s.cover_ms;
    d = await tt('/post/publish/video/init/', token, { post_info, source_info });
  }
  for (let i = 0; i < count; i++) {
    const a = i * chunk, b = i === count - 1 ? size : a + chunk;
    const up = await fetch(d.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${a}-${b - 1}/${size}` }, body: bin.slice(a, b) });
    if (!up.ok && up.status !== 206 && up.status !== 201) throw new Error('Envoi de la vidéo refusé par TikTok (HTTP ' + up.status + ')');
  }
  await admin.from('content_items').update({ tt_publish_id: d.publish_id }).eq('id', it.id);
  it.tt_publish_id = d.publish_id;
  return await check(it, conn);
}
async function check(it: any, conn: any) {
  const d = await tt('/post/publish/status/fetch/', conn.access_token, { publish_id: it.tt_publish_id });
  const st = d.status;
  if (st === 'FAILED') throw new Error('TikTok a refusé la vidéo : ' + (d.fail_reason || 'raison non précisée'));
  if (st === 'PUBLISH_COMPLETE' || st === 'SEND_TO_USER_INBOX') {
    const ids: string[] = d.publicaly_available_post_id || d.publicly_available_post_id || [];
    const id = ids.length ? String(ids[0]) : null;
    const user = conn.username ? '@' + conn.username : null;
    const upd: Record<string, unknown> = {
      tt_state: 'published', tt_error: st === 'SEND_TO_USER_INBOX' ? 'Envoyée en brouillon : à finaliser dans l’app TikTok (notifications)' : null,
      tt_post_id: id, tt_permalink: id && user ? `https://www.tiktok.com/${user}/video/${id}` : (user ? `https://www.tiktok.com/${user}` : null),
      tt_published_at: new Date().toISOString(),
    };
    if (allDone(it, upd)) upd.status = 'published';
    await admin.from('content_items').update(upd).eq('id', it.id);
    return 'done';
  }
  return 'wait'; // PROCESSING_UPLOAD / PROCESSING_DOWNLOAD : on repasse au prochain tour
}
async function run(it: any, conn: any) {
  if (!it.tt_state) {
    const { data } = await admin.from('content_items').update({ tt_state: 'processing', tt_error: null, tt_publish_id: null }).eq('id', it.id).is('tt_state', null).in('status', ['approved', 'published']).select('id');
    if (!data?.length) return { id: it.id, r: 'déjà pris' };
  }
  try {
    if (it.tt_publish_id) return { id: it.id, r: await check(it, conn) };
    const bad = problems(it, conn);
    if (bad.length) throw new Error(bad.join(' · '));
    return { id: it.id, r: await send(it, conn) };
  } catch (e) {
    await admin.from('content_items').update({ tt_state: 'error', tt_error: (e as Error).message }).eq('id', it.id);
    if ((e as any).status === 401 || (e as any).code === 'access_token_invalid') await admin.from('tt_connections').update({ status: 'error', last_error: (e as Error).message, last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    return { id: it.id, r: 'erreur', e: (e as Error).message };
  }
}
async function maintain(conn: any) {
  const now = Date.now();
  // Jeton d'accès valable 24 h : renouvelé dès qu'il reste moins de 2 h
  if (conn.refresh_token && (!conn.token_expires_at || new Date(conn.token_expires_at).getTime() - now < 2 * 3600e3)) {
    try {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
      const r = tokenRow(t); Object.assign(conn, r);
      await admin.from('tt_connections').update({ ...r, refresh_token: r.refresh_token || conn.refresh_token, status: 'ok', last_error: null, updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    } catch (e) {
      await admin.from('tt_connections').update({ status: 'error', last_error: 'Renouvellement de l’accès impossible : ' + (e as Error).message + ' — reconnecte le compte.', last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
      conn.status = 'error';
    }
  }
  if (conn.refresh_expires_at && new Date(conn.refresh_expires_at).getTime() - now < 7 * 864e5 && conn.status !== 'error') {
    await admin.from('tt_connections').update({ status: 'error', last_error: 'L’accès TikTok expire le ' + new Date(conn.refresh_expires_at).toLocaleDateString('fr-CH') + ' : reconnecte le compte.', last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
  }
}
async function cronRun() {
  const { data: conns } = await admin.from('tt_connections').select('*');
  const out: unknown[] = [];
  for (const conn of conns || []) {
    await maintain(conn);
    if (conn.status === 'error') continue;
    // Suivi des vidéos en cours de traitement chez TikTok
    const { data: proc } = await admin.from('content_items').select('*').eq('client_id', conn.client_id).eq('tt_state', 'processing').not('tt_publish_id', 'is', null);
    for (const it of proc || []) out.push(await run(it, conn));
    if (!conn.publish_enabled || !conn.enabled_at) continue;
    const { data: items } = await admin.from('content_items').select('*').eq('client_id', conn.client_id).in('status', ['approved', 'published']).is('tt_state', null);
    const now = Date.now(), since = new Date(conn.enabled_at).getTime();
    for (const it of items || []) {
      if (!netsOf(it).includes('tiktok')) continue;
      const at = publishAt(it, conn);
      if (!at || at.getTime() > now || at.getTime() < since) continue; // prévu avant l'activation : jamais publié d'office
      out.push(await run(it, conn));
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.has('code') || url.searchParams.has('error')) return callback(url);
    return json({ ok: true });
  }
  const body = await req.json().catch(() => ({}));
  if (body.cron) return json({ ok: true, out: await cronRun() });
  const me = await whoAmI(req);
  if (!me) return json({ error: 'Non authentifié' }, 401);
  if (body.action === 'creator') {
    const cid = body.client_id;
    if (!cid || (!me.agency && me.client_id !== cid)) return json({ error: 'Accès refusé' }, 403);
    const { data: conn } = await admin.from('tt_connections').select('*').eq('client_id', cid).maybeSingle();
    if (!conn) return json({ error: 'TikTok non connecté pour ce projet' }, 400);
    await maintain(conn);
    try { const cr = await creatorInfo(conn.access_token); await admin.from('tt_connections').update({ creator: cr, updated_at: new Date().toISOString() }).eq('client_id', cid); return json({ creator: cr }); }
    catch (e) { return json({ error: (e as Error).message }, 400); }
  }
  if (!me.agency) return json({ error: 'Réservé à la vue agence' }, 403);
  if (body.action === 'start') {
    if (!CLIENT_KEY || !CLIENT_SECRET) return json({ error: 'Les secrets TT_CLIENT_KEY et TT_CLIENT_SECRET ne sont pas encore enregistrés dans Supabase' }, 400);
    if (!body.client_id) return json({ error: 'client_id manquant' }, 400);
    const state = await signState({ c: body.client_id, u: me.id, e: Date.now() + 7 * 864e5 });
    const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
    u.search = new URLSearchParams({ client_key: CLIENT_KEY, response_type: 'code', scope: SCOPES, redirect_uri: REDIRECT, state }).toString();
    return json({ url: u.toString() });
  }
  if (body.action === 'publish_now') {
    const { data: it } = await admin.from('content_items').select('*').eq('id', body.id).single();
    if (!it) return json({ error: 'Contenu introuvable' }, 404);
    if (it.status !== 'approved' && it.status !== 'published') return json({ error: 'Seuls les contenus validés peuvent être publiés' }, 400);
    if (it.tt_state === 'published') return json({ error: 'Déjà publié sur TikTok' }, 400);
    if (it.tt_state === 'processing' && !it.tt_publish_id) return json({ error: 'Publication déjà en cours' }, 400);
    const { data: conn } = await admin.from('tt_connections').select('*').eq('client_id', it.client_id).maybeSingle();
    if (!conn) return json({ error: 'TikTok non connecté pour ce projet' }, 400);
    await maintain(conn);
    if (it.tt_state === 'error') { await admin.from('content_items').update({ tt_state: null, tt_error: null, tt_publish_id: null }).eq('id', it.id); it.tt_state = null; it.tt_publish_id = null; }
    return json(await run(it, conn));
  }
  return json({ error: 'Action inconnue' }, 400);
});
