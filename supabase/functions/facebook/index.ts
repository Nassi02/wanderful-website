// Fonction Edge « facebook » — API Pages Facebook (connexion Facebook Login for Business)
//  GET  ?code&state             → retour OAuth : jeton longue durée, pages administrées, retour à l'espace client
//  POST {action:'start'}        → lien de connexion signé (agence)
//  POST {action:'publish_now'}  → publie tout de suite un contenu validé sur la page (agence)
//  POST {cron:true}             → toutes les 5 min : publie les contenus validés arrivés à l'heure, rafraîchit la page
// Secrets requis : FB_APP_SECRET (clé secrète de l'app Meta). FB_APP_ID a une valeur par défaut.
// Optionnel : FB_CONFIG_ID (configuration Facebook Login for Business) — sinon les autorisations passent par « scope ».
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SB_URL, (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY'))!);
const APP_ID = (Deno.env.get('FB_APP_ID') || '1439795111669482').trim();
const APP_SECRET = (Deno.env.get('FB_APP_SECRET') || '').trim();
const CONFIG_ID = (Deno.env.get('FB_CONFIG_ID') || '').trim();
const REDIRECT = SB_URL.replace(/\/$/, '') + '/functions/v1/facebook';
const BACK = 'https://wanderful-marketing.com/espace-client/';
const V = 'v23.0';
const G = 'https://graph.facebook.com/' + V;
const SCOPES = 'pages_show_list,pages_manage_posts,pages_read_engagement,business_management';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- état OAuth signé ----------
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

// ---------- appels Graph ----------
async function fb(path: string, token: string, params: Record<string, unknown> = {}, method = 'GET') {
  const u = new URL(path.startsWith('http') ? path : G + path);
  let init: RequestInit = { method };
  if (method === 'GET') { for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v)); if (token) u.searchParams.set('access_token', token); }
  else {
    const f = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) f.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    if (token) f.set('access_token', token);
    init = { method, body: f };
  }
  const r = await fetch(u, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) { const e: any = new Error(fbMsg(d.error) || ('HTTP ' + r.status)); e.code = d.error?.code; throw e; }
  return d;
}
function fbMsg(e: any) {
  if (!e) return '';
  const m = e.error_user_msg || e.message || '';
  if (e.code === 190) return 'Accès Facebook expiré ou retiré : reconnecte la page. (' + m + ')';
  if (e.code === 10 || e.code === 200 || e.code === 3) return 'Facebook refuse l’action : droits insuffisants sur la page, ou autorisation de l’app pas encore validée par Meta. (' + m + ')';
  if (e.code === 368) return 'Facebook bloque temporairement la publication sur cette page. (' + m + ')';
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613) return 'Limite Facebook atteinte : nouvel essai plus tard. (' + m + ')';
  if (e.code === 324 || e.code === 352 || /format|aspect|duration|resolution/i.test(m)) return 'Média refusé par Facebook (format, proportions ou durée). (' + m + ')';
  return m + (e.code ? ' (code ' + e.code + (e.error_subcode ? '/' + e.error_subcode : '') + ')' : '');
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
  const back = (q: string) => Response.redirect(BACK + '?fb=' + q, 302);
  if (url.searchParams.get('error')) return back('refus&msg=' + encodeURIComponent(url.searchParams.get('error_description') || url.searchParams.get('error_reason') || 'Connexion annulée'));
  try {
    if (!APP_SECRET) throw new Error('Secret FB_APP_SECRET absent côté Supabase');
    const st = await readState(url.searchParams.get('state') || '');
    const short = await fb('/oauth/access_token', '', { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT, code: url.searchParams.get('code') || '' });
    if (!short.access_token) throw new Error('Échange du code impossible');
    const ll = await fb('/oauth/access_token', '', { grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: short.access_token });
    const ut = ll.access_token || short.access_token;
    const perms = await fb('/me/permissions', ut).catch(() => ({ data: [] }));
    const granted = new Set((perms.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission));
    if (granted.size && !granted.has('pages_manage_posts')) throw new Error('Autorisation de publication non accordée : recommence et laisse toutes les cases cochées');
    const me = await fb('/me', ut, { fields: 'name' }).catch(() => ({}));
    const acc = await fb('/me/accounts', ut, { fields: 'id,name,access_token,picture{url},followers_count,fan_count,tasks', limit: 100 });
    const pages = (acc.data || []).filter((p: any) => p.access_token && (!Array.isArray(p.tasks) || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE')));
    if (!pages.length) throw new Error('Aucune page Facebook sélectionnée ou administrée par ce compte : recommence et coche la page de l’entreprise');
    // Une page = un seul projet (isolation)
    const { data: others } = await admin.from('fb_connections').select('client_id,page_id').neq('client_id', st.c);
    const taken = new Set((others || []).map((o: any) => o.page_id).filter(Boolean));
    const free = pages.filter((p: any) => !taken.has(String(p.id)));
    if (!free.length) throw new Error('Cette page Facebook est déjà reliée à un autre projet');
    const choices = free.map((p: any) => ({ id: String(p.id), name: p.name, picture: p.picture?.data?.url || null, followers: p.followers_count ?? p.fan_count ?? null }));
    const tokens: Record<string, string> = {}; for (const p of free) tokens[String(p.id)] = p.access_token;
    const one = choices.length === 1 ? choices[0] : null;
    const row = {
      client_id: st.c, page_choices: choices, page_tokens: tokens, user_name: me.name || null, user_token: ut,
      token_expires_at: ll.expires_in ? new Date(Date.now() + ll.expires_in * 1000).toISOString() : null,
      page_id: one?.id || null, page_name: one?.name || null, page_picture: one?.picture || null, followers: one?.followers ?? null,
      status: 'ok', last_error: null, last_error_at: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('fb_connections').upsert(row, { onConflict: 'client_id' });
    if (error) throw error;
    await syncSocial(st.c, one?.name || null, one?.followers ?? null, null);
    return back('ok&u=' + encodeURIComponent(one?.name || (choices.length + ' pages')));
  } catch (e) { return back('erreur&msg=' + encodeURIComponent((e as Error).message)); }
}
async function syncSocial(cid: string, name: string | null, followers: number | null, auto: boolean | null) {
  const { data: ex } = await admin.from('social_accounts').select('id').eq('client_id', cid).eq('platform', 'facebook').limit(1);
  const v: Record<string, unknown> = { connected: true };
  if (name) v.handle = name;
  if (followers != null) v.followers = followers;
  if (auto != null) v.auto = auto;
  if (ex?.length) await admin.from('social_accounts').update(v).eq('id', ex[0].id);
  else await admin.from('social_accounts').insert({ client_id: cid, platform: 'facebook', auto: false, ...v });
}

// ---------- règles ----------
const isVid = (u: string, t?: string) => /\.(mp4|mov|m4v)(\?|$)/i.test(u) || /video/i.test(t || '');
function parseList(m: unknown): string[] {
  if (!m) return [];
  if (Array.isArray(m)) return m.filter(Boolean).map(String);
  if (typeof m === 'string' && m.startsWith('[')) { try { const a = JSON.parse(m); return Array.isArray(a) ? a : []; } catch { return [m]; } }
  return [String(m)];
}
const igMedia = (it: any) => parseList(it.media_url);
function mediaOf(it: any) { const f = parseList(it.brief?.fb_media); return f.length ? f : igMedia(it); }
function mediaTypeOf(it: any) { return parseList(it.brief?.fb_media).length ? (it.brief?.fb_media_type || '') : (it.media_type || ''); }
function isStory(it: any) { return /story/i.test(it.type || '') || (Array.isArray(it.brief?.chans) && it.brief.chans.includes('stories') && !it.brief.chans.includes('instagram')); }
function netsOf(it: any) {
  const n = it.brief?.nets; if (Array.isArray(n) && n.length) return n;
  const p = String(it.platform || 'instagram').toLowerCase();
  return [p.includes('face') ? 'facebook' : p.includes('linkedin') ? 'linkedin' : p.includes('tiktok') ? 'tiktok' : 'instagram'];
}
// Facebook est inclus s'il est coché, ou si « Reprendre Instagram » est actif et qu'on ne l'a pas décoché
function fbIncluded(it: any, conn: any) {
  const n = netsOf(it), b = it.brief || {};
  if (n.includes('facebook')) return true;
  if (b.fb_off) return false;
  return !!conn?.mirror_ig && n.includes('instagram') && !isStory(it);
}
function captionOf(it: any) { const b = it.brief || {}; return (b.caption_fb != null && String(b.caption_fb).trim()) ? String(b.caption_fb) : (it.caption || ''); }
function linkOf(it: any) { const l = String(it.brief?.fb_link || '').trim(); return /^https?:\/\/\S+$/i.test(l) ? l : ''; }
function kindOf(it: any) {
  const m = mediaOf(it);
  if (!m.length) return 'TEXT';
  if (m.length === 1 && isVid(m[0], mediaTypeOf(it))) return it.brief?.fb_format === 'video' ? 'VIDEO' : 'REEL';
  return m.length > 1 ? 'MULTI' : 'PHOTO';
}
function problems(it: any) {
  const m = mediaOf(it), p: string[] = [];
  if (m.length > 1 && m.some(u => isVid(u))) p.push('Facebook ne mélange pas vidéo et photos dans un même post');
  if (m.length > 30) p.push('Plus de 30 photos');
  if (!m.length && !captionOf(it).trim() && !linkOf(it)) p.push('Ni visuel, ni texte, ni lien');
  if (String(it.brief?.fb_link || '').trim() && !linkOf(it)) p.push('Lien Facebook invalide (il doit commencer par https://)');
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
function allDone(it: any, upd: Record<string, unknown>, conn: any) {
  const x = { ...it, ...upd };
  const n = new Set(netsOf(x)); if (fbIncluded(x, conn)) n.add('facebook');
  return [...n].every((k: string) => k === 'instagram' ? x.publish_state === 'published' : k === 'linkedin' ? x.li_state === 'published' : k === 'tiktok' ? x.tt_state === 'published' : k === 'facebook' ? x.fb_state === 'published' : true);
}

// ---------- publication (reprise possible : l'avancement est gardé dans fb_work) ----------
const abs = (u: string) => !u ? null : (u.startsWith('http') ? u : 'https://www.facebook.com' + (u.startsWith('/') ? '' : '/') + u);
async function step(it: any, conn: any) {
  const page = conn.page_id, token = (conn.page_tokens || {})[page];
  if (!token) throw new Error('Jeton de la page introuvable : reconnecte Facebook');
  const w = it.fb_work || {};
  const save = async () => { await admin.from('content_items').update({ fb_work: w }).eq('id', it.id); };
  const m = mediaOf(it), kind = kindOf(it), link = linkOf(it);
  let msg = captionOf(it);
  if (link && kind !== 'TEXT' && !msg.includes(link)) msg = (msg ? msg + '\n\n' : '') + link;
  let postId = '', permalink: string | null = null;

  if (kind === 'TEXT') {
    const r = await fb('/' + page + '/feed', token, { message: msg || undefined, link: link || undefined }, 'POST');
    postId = r.id;
  } else if (kind === 'PHOTO') {
    const r = await fb('/' + page + '/photos', token, { url: m[0], message: msg || undefined, published: true }, 'POST');
    postId = r.post_id || r.id;
  } else if (kind === 'MULTI') {
    if (!w.photos) w.photos = [];
    for (let i = w.photos.length; i < m.length; i++) {
      w.photos.push((await fb('/' + page + '/photos', token, { url: m[i], published: false }, 'POST')).id);
      await save();
    }
    const r = await fb('/' + page + '/feed', token, { message: msg || undefined, attached_media: w.photos.map((id: string) => ({ media_fbid: id })) }, 'POST');
    postId = r.id;
  } else if (kind === 'VIDEO') {
    if (!w.video) { w.video = (await fb('/' + page + '/videos', token, { file_url: m[0], description: msg || undefined, published: true }, 'POST')).id; await save(); }
    const s = await fb('/' + w.video, token, { fields: 'status,permalink_url' });
    const vs = s.status?.video_status;
    if (vs === 'error') throw new Error('Traitement de la vidéo refusé par Facebook');
    if (vs !== 'ready') return 'wait';
    postId = w.video; permalink = abs(s.permalink_url);
  } else { // REEL
    if (!w.reel) {
      const st = await fb('/' + page + '/video_reels', token, { upload_phase: 'start' }, 'POST');
      w.reel = st.video_id; await save();
      const up = await fetch(st.upload_url || ('https://rupload.facebook.com/video-upload/' + V + '/' + st.video_id), { method: 'POST', headers: { Authorization: 'OAuth ' + token, file_url: m[0] } });
      const ud = await up.json().catch(() => ({}));
      if (!up.ok || ud.success === false) throw new Error('Envoi du reel refusé par Facebook' + (ud.debug_info?.message ? ' : ' + ud.debug_info.message : ''));
    }
    if (!w.finished) {
      // Attendre que Facebook ait téléchargé la vidéo avant de publier
      const s0 = await fb('/' + w.reel, token, { fields: 'status' });
      const up = s0.status?.uploading_phase?.status;
      if (up === 'error' || s0.status?.video_status === 'error') throw new Error('Facebook n’a pas pu récupérer la vidéo du reel (' + (s0.status?.uploading_phase?.errors?.[0]?.message || 'erreur') + ')');
      if (up && up !== 'complete') return 'wait';
      await fb('/' + page + '/video_reels', token, { upload_phase: 'finish', video_id: w.reel, video_state: 'PUBLISHED', description: msg || undefined }, 'POST');
      w.finished = true; await save();
    }
    const s = await fb('/' + w.reel, token, { fields: 'status,permalink_url' });
    const ph = s.status?.publishing_phase?.status, vs = s.status?.video_status;
    if (ph === 'error' || vs === 'error') throw new Error('Publication du reel refusée par Facebook (format 9:16, 3 à 90 s, au moins 540×960). ' + (s.status?.processing_phase?.errors?.[0]?.message || s.status?.publishing_phase?.errors?.[0]?.message || ''));
    if (ph !== 'complete') return 'wait';
    postId = w.reel; permalink = abs(s.permalink_url);
  }
  if (!permalink && postId) {
    const info = await fb('/' + postId, token, { fields: 'permalink_url' }).catch(() => ({}));
    permalink = abs((info as any).permalink_url) || ('https://www.facebook.com/' + postId);
  }
  const upd: Record<string, unknown> = { fb_state: 'published', fb_error: null, fb_post_id: postId, fb_permalink: permalink, fb_published_at: new Date().toISOString(), fb_work: null };
  if (allDone(it, upd, conn)) upd.status = 'published';
  await admin.from('content_items').update(upd).eq('id', it.id);
  return 'done';
}
async function run(it: any, conn: any) {
  if (!conn.page_id) return { id: it.id, r: 'erreur', e: 'Aucune page Facebook choisie' };
  if (!it.fb_state) {
    const { data } = await admin.from('content_items').update({ fb_state: 'processing', fb_error: null }).eq('id', it.id).is('fb_state', null).in('status', ['approved', 'published']).select('id');
    if (!data?.length) return { id: it.id, r: 'déjà pris' };
  }
  const bad = problems(it);
  try {
    if (bad.length) throw new Error(bad.join(' · '));
    return { id: it.id, r: await step(it, conn) };
  } catch (e) {
    await admin.from('content_items').update({ fb_state: 'error', fb_error: (e as Error).message, fb_work: null }).eq('id', it.id);
    if ((e as any).code === 190) await admin.from('fb_connections').update({ status: 'error', last_error: (e as Error).message, last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    return { id: it.id, r: 'erreur', e: (e as Error).message };
  }
}
async function maintain(conn: any) {
  // Les jetons de page obtenus depuis un jeton longue durée n'expirent pas : on vérifie juste la page toutes les 6 h
  if (!conn.page_id || Date.now() - new Date(conn.updated_at).getTime() < 6 * 3600e3) return;
  const token = (conn.page_tokens || {})[conn.page_id];
  try {
    const p = await fb('/' + conn.page_id, token, { fields: 'name,followers_count,fan_count,picture{url}' });
    const followers = p.followers_count ?? p.fan_count ?? null;
    await admin.from('fb_connections').update({ page_name: p.name, page_picture: p.picture?.data?.url || conn.page_picture, followers, status: 'ok', last_error: null, updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    await syncSocial(conn.client_id, p.name, followers, conn.publish_enabled);
  } catch (e) {
    await admin.from('fb_connections').update({ status: 'error', last_error: (e as Error).message, last_error_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
  }
}
async function cronRun() {
  const { data: conns } = await admin.from('fb_connections').select('*');
  const out: unknown[] = [];
  for (const conn of conns || []) {
    await maintain(conn);
    if (!conn.publish_enabled || !conn.enabled_at || !conn.page_id) continue;
    const { data: items } = await admin.from('content_items').select('*').eq('client_id', conn.client_id).in('status', ['approved', 'published']).or('fb_state.is.null,fb_state.eq.processing');
    const now = Date.now(), since = new Date(conn.enabled_at).getTime();
    for (const it of items || []) {
      if (!fbIncluded(it, conn)) continue;
      if (it.fb_state === 'processing' && !it.fb_work) continue; // envoi en cours dans un autre passage
      const at = publishAt(it, conn);
      if (!at || at.getTime() > now) continue;
      if (!it.fb_state && at.getTime() < since) continue; // prévu avant l'activation : jamais publié d'office
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
  if (!me.agency) return json({ error: 'Réservé à la vue agence' }, 403);
  if (body.action === 'start') {
    if (!APP_SECRET) return json({ error: 'Le secret FB_APP_SECRET n’est pas encore enregistré dans Supabase' }, 400);
    if (!body.client_id) return json({ error: 'client_id manquant' }, 400);
    const state = await signState({ c: body.client_id, u: me.id, e: Date.now() + 7 * 864e5 });
    const u = new URL('https://www.facebook.com/' + V + '/dialog/oauth');
    const q: Record<string, string> = { client_id: APP_ID, redirect_uri: REDIRECT, state, response_type: 'code', auth_type: 'rerequest' };
    if (CONFIG_ID) { q.config_id = CONFIG_ID; q.override_default_response_type = 'true'; } else q.scope = SCOPES;
    u.search = new URLSearchParams(q).toString();
    return json({ url: u.toString() });
  }
  if (body.action === 'publish_now') {
    const { data: it } = await admin.from('content_items').select('*').eq('id', body.id).single();
    if (!it) return json({ error: 'Contenu introuvable' }, 404);
    if (it.status !== 'approved' && it.status !== 'published') return json({ error: 'Seuls les contenus validés peuvent être publiés' }, 400);
    if (it.fb_state === 'published') return json({ error: 'Déjà publié sur Facebook' }, 400);
    const { data: conn } = await admin.from('fb_connections').select('*').eq('client_id', it.client_id).maybeSingle();
    if (!conn) return json({ error: 'Facebook non connecté pour ce projet' }, 400);
    if (it.fb_state === 'error' || (it.fb_state === 'processing' && !it.fb_work)) { await admin.from('content_items').update({ fb_state: null, fb_error: null, fb_work: null }).eq('id', it.id); it.fb_state = null; it.fb_work = null; }
    return json(await run(it, conn));
  }
  return json({ error: 'Action inconnue' }, 400);
});
