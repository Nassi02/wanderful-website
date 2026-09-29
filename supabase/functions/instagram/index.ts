// Fonction Edge « instagram » — API Instagram avec connexion Instagram (sans page Facebook)
//  GET  ?code&state            → retour OAuth : échange du code, jeton longue durée, enregistrement, retour à l'espace client
//  POST {action:'start'}       → lien de connexion signé (agence)
//  POST {action:'media'}       → dernières publications du compte (agence ou client du projet) pour l'aperçu du feed
//  POST {action:'publish_now'} → publie tout de suite un contenu validé (agence)
//  POST {cron:true}            → toutes les 5 min : publie les contenus validés arrivés à l'heure, rafraîchit les jetons
// Secrets requis : IG_APP_SECRET (clé secrète Instagram de l'app). IG_APP_ID a une valeur par défaut.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SB_URL, (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY'))!);
const APP_ID = Deno.env.get('IG_APP_ID') || '1332274202145239';
const APP_SECRET = Deno.env.get('IG_APP_SECRET') || '';
const REDIRECT = SB_URL.replace(/\/$/, '') + '/functions/v1/instagram';
const BACK = 'https://wanderful-marketing.com/espace-client/';
const G = 'https://graph.instagram.com/v23.0';
const SCOPES = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- état OAuth signé (HMAC) ----------
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function hmac(s: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
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

// ---------- appels Instagram ----------
async function ig(path: string, token: string, params: Record<string, unknown> = {}, method = 'GET') {
  const u = new URL(path.startsWith('http') ? path : G + path);
  let init: RequestInit = { method };
  if (method === 'GET') { for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v)); u.searchParams.set('access_token', token); }
  else { const f = new URLSearchParams(); for (const [k, v] of Object.entries(params)) f.set(k, String(v)); f.set('access_token', token); init = { method, body: f }; }
  const r = await fetch(u, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { const e: any = new Error(igMsg(d.error) || ('HTTP ' + r.status)); e.code = d.error?.code; throw e; }
  return d;
}
function igMsg(e: any) {
  if (!e) return '';
  const m = e.error_user_msg || e.message || '';
  if (e.code === 190) return 'Accès Instagram expiré ou retiré : reconnecte le compte. (' + m + ')';
  if (e.code === 9004 || /media type|format/i.test(m)) return 'Format refusé par Instagram (images : JPEG uniquement ; vidéos : MP4/MOV). (' + m + ')';
  if (e.code === 36003 || /aspect ratio/i.test(m)) return 'Proportions refusées par Instagram (images du feed entre 4:5 et 1,91:1). (' + m + ')';
  if (e.code === 4 || e.code === 9 || /limit/i.test(m)) return 'Limite de publication Instagram atteinte : nouvel essai plus tard. (' + m + ')';
  return m;
}

async function whoAmI(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: p } = await admin.from('profiles').select('role,client_id').eq('id', u.user.id).single();
  return { id: u.user.id, agency: p?.role === 'agency', client_id: p?.client_id };
}

// ---------- OAuth : retour de connexion ----------
async function callback(url: URL) {
  const back = (q: string) => Response.redirect(BACK + '?ig=' + q, 302);
  if (url.searchParams.get('error')) return back('refus&msg=' + encodeURIComponent(url.searchParams.get('error_description') || 'Connexion annulée'));
  try {
    if (!APP_SECRET) throw new Error('Secret IG_APP_SECRET absent côté Supabase');
    const st = await readState(url.searchParams.get('state') || '');
    const code = (url.searchParams.get('code') || '').replace(/#_$/, '');
    const f = new URLSearchParams({ client_id: APP_ID, client_secret: APP_SECRET, grant_type: 'authorization_code', redirect_uri: REDIRECT, code });
    const r = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: f });
    const d = await r.json();
    const short = d.access_token || d.data?.[0]?.access_token;
    if (!short) throw new Error(d.error_message || d.error?.message || 'Échange du code impossible');
    const perms = String(d.permissions || d.data?.[0]?.permissions || '');
    if (perms && !perms.includes('instagram_business_content_publish')) throw new Error('Autorisation de publication non accordée : recommence et laisse toutes les cases cochées');
    const ll = await ig('https://graph.instagram.com/access_token', short, { grant_type: 'ig_exchange_token', client_secret: APP_SECRET });
    const me = await ig('/me', ll.access_token, { fields: 'user_id,username,account_type,profile_picture_url,followers_count' });
    // Un compte Instagram = un seul projet (isolation)
    const { data: other } = await admin.from('ig_connections').select('client_id').eq('ig_user_id', String(me.user_id)).neq('client_id', st.c);
    if (other?.length) throw new Error('Ce compte Instagram est déjà relié à un autre projet');
    const row = {
      client_id: st.c, ig_user_id: String(me.user_id), username: me.username, account_type: me.account_type,
      profile_picture_url: me.profile_picture_url || null, followers: me.followers_count ?? null,
      access_token: ll.access_token, token_expires_at: new Date(Date.now() + (ll.expires_in || 5184000) * 1000).toISOString(),
      status: 'ok', last_error: null, last_error_at: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('ig_connections').upsert(row, { onConflict: 'client_id' });
    if (error) throw error;
    await syncSocial(st.c, me.username, me.followers_count, null);
    return back('ok&u=' + encodeURIComponent(me.username || ''));
  } catch (e) {
    return back('erreur&msg=' + encodeURIComponent((e as Error).message));
  }
}
async function syncSocial(cid: string, username: string | null, followers: number | null, auto: boolean | null) {
  const { data: ex } = await admin.from('social_accounts').select('id').eq('client_id', cid).eq('platform', 'instagram').limit(1);
  const v: Record<string, unknown> = { connected: true };
  if (username) v.handle = '@' + username;
  if (followers != null) v.followers = followers;
  if (auto != null) v.auto = auto;
  if (ex?.length) await admin.from('social_accounts').update(v).eq('id', ex[0].id);
  else await admin.from('social_accounts').insert({ client_id: cid, platform: 'instagram', auto: false, ...v });
}

// ---------- règles de publication ----------
const isVid = (u: string, t?: string) => /\.(mp4|mov|m4v)(\?|$)/i.test(u) || /video/i.test(t || '');
const isJpeg = (u: string) => /\.(jpe?g)(\?|$)/i.test(u);
function mediaOf(it: any): string[] {
  const m = it.media_url; if (!m) return [];
  if (typeof m === 'string' && m.startsWith('[')) { try { const a = JSON.parse(m); return Array.isArray(a) ? a : []; } catch { return [m]; } }
  return [m];
}
function netsOf(it: any) { const n = it.brief?.nets; if (Array.isArray(n) && n.length) return n; return [String(it.platform || 'instagram').toLowerCase().includes('face') ? 'facebook' : 'instagram']; }
function kindOf(it: any) {
  const m = mediaOf(it);
  if (/story/i.test(it.type || '') || (Array.isArray(it.brief?.chans) && it.brief.chans.includes('stories') && !it.brief.chans.includes('instagram'))) return 'STORIES';
  if (m.length > 1) return 'CAROUSEL';
  return m[0] && isVid(m[0], it.media_type) ? 'REELS' : 'IMAGE';
}
function problems(it: any) {
  const m = mediaOf(it), p: string[] = [];
  if (!m.length) p.push('Aucun visuel déposé');
  if (m.length > 10) p.push('Carrousel de plus de 10 éléments');
  m.forEach((u, i) => { if (!isVid(u, m.length > 1 ? '' : it.media_type) && !isJpeg(u)) p.push((m.length > 1 ? 'Slide ' + (i + 1) + ' : ' : '') + 'image non JPEG (Instagram n’accepte que le JPEG)'); });
  const cap = it.caption || '';
  if (cap.length > 2200) p.push('Légende de plus de 2 200 caractères');
  if ((cap.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) p.push('Plus de 30 hashtags');
  return p;
}
function tzOffset(ts: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}
function publishAt(it: any, conn: any) {
  if (!it.scheduled_at) return null;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(it.scheduled_at)); // AAAA-MM-JJ
  const t = /^\d{2}:\d{2}$/.test(it.brief?.time || '') ? it.brief.time : conn.default_time || '18:00';
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +t.slice(0, 2), +t.slice(3, 5));
  return new Date(guess - tzOffset(guess));
}

// ---------- publication d'un contenu (machine à états, reprise possible) ----------
async function containerStatus(id: string, token: string) { return (await ig('/' + id, token, { fields: 'status_code,status' })).status_code as string; }
async function step(it: any, conn: any) {
  const token = conn.access_token, uid = conn.ig_user_id;
  const s = (() => { try { return JSON.parse(it.ig_container_id || '{}'); } catch { return {}; } })();
  const save = async () => { await admin.from('content_items').update({ ig_container_id: JSON.stringify(s) }).eq('id', it.id); };
  const kind = kindOf(it), m = mediaOf(it), cap = it.caption || '';
  if (!s.parent) {
    if (kind === 'CAROUSEL') {
      if (!s.children) {
        s.children = [];
        for (const u of m) s.children.push((await ig('/' + uid + '/media', token, isVid(u) ? { media_type: 'VIDEO', video_url: u, is_carousel_item: true } : { image_url: u, is_carousel_item: true }, 'POST')).id);
        await save();
      }
      for (const c of s.children) { const st = await containerStatus(c, token); if (st === 'ERROR' || st === 'EXPIRED') throw new Error('Traitement refusé par Instagram pour un élément du carrousel'); if (st !== 'FINISHED') return 'wait'; }
      s.parent = (await ig('/' + uid + '/media', token, { media_type: 'CAROUSEL', children: s.children.join(','), caption: cap }, 'POST')).id;
    } else if (kind === 'REELS') {
      s.parent = (await ig('/' + uid + '/media', token, { media_type: 'REELS', video_url: m[0], caption: cap, share_to_feed: true }, 'POST')).id;
    } else if (kind === 'STORIES') {
      s.parent = (await ig('/' + uid + '/media', token, isVid(m[0], it.media_type) ? { media_type: 'STORIES', video_url: m[0] } : { media_type: 'STORIES', image_url: m[0] }, 'POST')).id;
    } else {
      s.parent = (await ig('/' + uid + '/media', token, { image_url: m[0], caption: cap }, 'POST')).id;
    }
    await save();
  }
  let st = '';
  for (let i = 0; i < 6; i++) { st = await containerStatus(s.parent, token); if (st !== 'IN_PROGRESS') break; await new Promise(r => setTimeout(r, 5000)); }
  if (st === 'ERROR' || st === 'EXPIRED') throw new Error('Traitement du média refusé par Instagram (' + st + ')');
  if (st !== 'FINISHED' && st !== 'PUBLISHED') return 'wait';
  const pub = await ig('/' + uid + '/media_publish', token, { creation_id: s.parent }, 'POST');
  const info = await ig('/' + pub.id, token, { fields: 'permalink,timestamp' }).catch(() => ({}));
  await admin.from('content_items').update({
    status: 'published', publish_state: 'published', publish_error: null, ig_media_id: pub.id,
    permalink: (info as any).permalink || null, published_at: (info as any).timestamp || new Date().toISOString(), ig_container_id: null,
  }).eq('id', it.id);
  return 'done';
}
async function run(it: any, conn: any) {
  // Réservation atomique : un seul passage publie un contenu donné
  if (!it.publish_state) {
    const { data } = await admin.from('content_items').update({ publish_state: 'processing', publish_error: null }).eq('id', it.id).is('publish_state', null).eq('status', 'approved').select('id');
    if (!data?.length) return { id: it.id, r: 'déjà pris' };
  }
  const bad = problems(it);
  try {
    if (bad.length) throw new Error(bad.join(' · '));
    return { id: it.id, r: await step(it, conn) };
  } catch (e) {
    await admin.from('content_items').update({ publish_state: 'error', publish_error: (e as Error).message, ig_container_id: null }).eq('id', it.id);
    if ((e as any).code === 190) await admin.from('ig_connections').update({ status: 'error', last_error: (e as Error).message, last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    return { id: it.id, r: 'erreur', e: (e as Error).message };
  }
}
async function maintain(conn: any) {
  const now = Date.now();
  // Jeton longue durée (60 j) : renouvelé à moins de 20 jours de l'échéance
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() - now < 20 * 864e5 && now - new Date(conn.connected_at).getTime() > 864e5) {
    try {
      const r = await ig('https://graph.instagram.com/refresh_access_token', conn.access_token, { grant_type: 'ig_refresh_token' });
      conn.access_token = r.access_token;
      await admin.from('ig_connections').update({ access_token: r.access_token, token_expires_at: new Date(now + (r.expires_in || 5184000) * 1000).toISOString(), status: 'ok', last_error: null, updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    } catch (e) {
      await admin.from('ig_connections').update({ status: 'error', last_error: 'Renouvellement de l’accès impossible : ' + (e as Error).message, last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    }
  }
  // Abonnés : mis à jour toutes les 6 h
  if (now - new Date(conn.updated_at).getTime() > 6 * 3600e3) {
    try {
      const me = await ig('/me', conn.access_token, { fields: 'username,followers_count,profile_picture_url' });
      await admin.from('ig_connections').update({ username: me.username, followers: me.followers_count ?? null, profile_picture_url: me.profile_picture_url || null, status: 'ok', last_error: null, updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
      await syncSocial(conn.client_id, me.username, me.followers_count ?? null, conn.publish_enabled);
    } catch (e) {
      await admin.from('ig_connections').update({ status: 'error', last_error: (e as Error).message, last_error_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    }
  }
}
async function cronRun() {
  const { data: conns } = await admin.from('ig_connections').select('*');
  const out: unknown[] = [];
  for (const conn of conns || []) {
    await maintain(conn);
    if (!conn.publish_enabled || !conn.enabled_at) continue;
    const { data: items } = await admin.from('content_items').select('*').eq('client_id', conn.client_id).eq('status', 'approved').or('publish_state.is.null,publish_state.eq.processing');
    const now = Date.now(), since = new Date(conn.enabled_at).getTime();
    for (const it of items || []) {
      if (!netsOf(it).includes('instagram')) continue;
      const at = publishAt(it, conn);
      if (!at || at.getTime() > now) continue;
      if (!it.publish_state && at.getTime() < since) continue; // prévu avant l'activation : jamais publié d'office
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
  const cid = body.client_id;
  if (body.action === 'media') {
    if (!me.agency && me.client_id !== cid) return json({ error: 'Accès refusé' }, 403);
    const { data: conn } = await admin.from('ig_connections').select('*').eq('client_id', cid).maybeSingle();
    if (!conn) return json({ connected: false, media: [] });
    try {
      const r = await ig('/' + conn.ig_user_id + '/media', conn.access_token, { fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp,caption', limit: 24 });
      return json({ connected: true, media: r.data || [] });
    } catch (e) { return json({ connected: true, media: [], error: (e as Error).message }); }
  }
  if (!me.agency) return json({ error: 'Réservé à la vue agence' }, 403);
  if (body.action === 'start') {
    if (!APP_SECRET) return json({ error: 'Le secret IG_APP_SECRET n’est pas encore enregistré dans Supabase' }, 400);
    if (!cid) return json({ error: 'client_id manquant' }, 400);
    const state = await signState({ c: cid, u: me.id, e: Date.now() + 7 * 864e5 });
    const u = new URL('https://www.instagram.com/oauth/authorize');
    u.search = new URLSearchParams({ enable_fb_login: '0', force_authentication: '1', client_id: APP_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES, state }).toString();
    return json({ url: u.toString() });
  }
  if (body.action === 'publish_now') {
    const { data: it } = await admin.from('content_items').select('*').eq('id', body.id).single();
    if (!it) return json({ error: 'Contenu introuvable' }, 404);
    if (it.status !== 'approved') return json({ error: 'Seuls les contenus validés peuvent être publiés' }, 400);
    if (it.publish_state === 'published') return json({ error: 'Déjà publié' }, 400);
    const { data: conn } = await admin.from('ig_connections').select('*').eq('client_id', it.client_id).maybeSingle();
    if (!conn) return json({ error: 'Instagram non connecté pour ce projet' }, 400);
    return json(await run(it, conn));
  }
  return json({ error: 'Action inconnue' }, 400);
});
