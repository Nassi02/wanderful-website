// Fonction Edge « linkedin » — Community Management API (pages entreprise)
//  GET  ?code&state             → retour OAuth : jeton, liste des pages administrées, retour à l'espace client
//  POST {action:'start'}        → lien de connexion signé (agence)
//  POST {action:'publish_now'}  → publie tout de suite un contenu validé sur LinkedIn (agence)
//  POST {cron:true}             → toutes les 5 min : publie les contenus validés arrivés à l'heure, renouvelle les jetons
// Secrets requis : LI_CLIENT_SECRET. LI_CLIENT_ID a une valeur par défaut.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(SB_URL, (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY'))!);
const CLIENT_ID = Deno.env.get('LI_CLIENT_ID') || '78qm62bwy2mg6v';
const CLIENT_SECRET = Deno.env.get('LI_CLIENT_SECRET') || '';
const REDIRECT = SB_URL.replace(/\/$/, '') + '/functions/v1/linkedin';
const BACK = 'https://wanderful-marketing.com/espace-client/';
const SCOPES = 'r_organization_social w_organization_social rw_organization_admin';
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

// ---------- API REST LinkedIn (versionnée ; la version la plus récente disponible est trouvée automatiquement) ----------
let VERSION = Deno.env.get('LI_VERSION') || '';
function candidates() {
  const out: string[] = []; const d = new Date();
  for (let i = 1; i <= 14; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.getUTCFullYear() + String(x.getUTCMonth() + 1).padStart(2, '0')); }
  return out;
}
async function li(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const tries = VERSION ? [VERSION] : candidates();
  let last: Response | null = null;
  for (const v of tries) {
    const r = await fetch('https://api.linkedin.com/rest' + path, { ...init, headers: { Authorization: 'Bearer ' + token, 'LinkedIn-Version': v, 'X-Restli-Protocol-Version': '2.0.0', ...(init.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
    if (r.status === 426 || (r.status === 400 && (await r.clone().text()).includes('VERSION'))) { last = r; continue; }
    VERSION = v; return r;
  }
  return last!;
}
async function liJson(path: string, token: string, init: RequestInit = {}) {
  const r = await li(path, token, init);
  const t = await r.text(); let d: any = {}; try { d = t ? JSON.parse(t) : {}; } catch { d = { message: t }; }
  if (!r.ok) { const e: any = new Error(liMsg(r.status, d)); e.status = r.status; throw e; }
  return { d, r };
}
function liMsg(status: number, d: any) {
  const m = d?.message || d?.error_description || ('HTTP ' + status);
  if (status === 401) return 'Accès LinkedIn expiré ou retiré : reconnecte la page. (' + m + ')';
  if (status === 403) return 'LinkedIn refuse l’action (droits de la page ou accès API pas encore accordé). (' + m + ')';
  if (status === 429) return 'Limite LinkedIn atteinte : nouvel essai plus tard. (' + m + ')';
  return m;
}

async function whoAmI(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: p } = await admin.from('profiles').select('role,client_id').eq('id', u.user.id).single();
  return { id: u.user.id, agency: p?.role === 'agency', client_id: p?.client_id };
}

// ---------- OAuth ----------
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || 'Échange du code impossible');
  return d;
}
async function adminPages(token: string) {
  const { d } = await liJson('/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50', token);
  const urns: string[] = (d.elements || []).map((e: any) => e.organization || e.organizationTarget).filter(Boolean);
  const out: { urn: string; name: string }[] = [];
  for (const u of urns) {
    const id = u.split(':').pop();
    let name = u;
    try { const o = await liJson('/organizations/' + id, token); name = o.d.localizedName || o.d.name?.localized?.fr_FR || o.d.name?.localized?.en_US || u; } catch { /* nom indisponible */ }
    out.push({ urn: u, name });
  }
  return out;
}
async function callback(url: URL) {
  const back = (q: string) => Response.redirect(BACK + '?li=' + q, 302);
  if (url.searchParams.get('error')) return back('refus&msg=' + encodeURIComponent(url.searchParams.get('error_description') || 'Connexion annulée'));
  try {
    if (!CLIENT_SECRET) throw new Error('Secret LI_CLIENT_SECRET absent côté Supabase');
    const st = await readState(url.searchParams.get('state') || '');
    const t = await tokenRequest({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: REDIRECT });
    const pages = await adminPages(t.access_token);
    if (!pages.length) throw new Error('Aucune page LinkedIn administrée par ce compte');
    // Une page = un seul projet (isolation)
    const { data: others } = await admin.from('li_connections').select('client_id,org_urn').neq('client_id', st.c);
    const taken = new Set((others || []).map((o: any) => o.org_urn));
    const free = pages.filter(p => !taken.has(p.urn));
    if (!free.length) throw new Error('Cette page LinkedIn est déjà reliée à un autre projet');
    const now = Date.now();
    const row = {
      client_id: st.c, org_choices: free, org_urn: free.length === 1 ? free[0].urn : null, org_name: free.length === 1 ? free[0].name : null,
      access_token: t.access_token, token_expires_at: new Date(now + (t.expires_in || 5184000) * 1000).toISOString(),
      refresh_token: t.refresh_token || null, refresh_expires_at: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000).toISOString() : null,
      status: 'ok', last_error: null, last_error_at: null, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from('li_connections').upsert(row, { onConflict: 'client_id' });
    if (error) throw error;
    const { data: ex } = await admin.from('social_accounts').select('id').eq('client_id', st.c).eq('platform', 'linkedin').limit(1);
    const v = { connected: true, handle: row.org_name || 'Page LinkedIn' };
    if (ex?.length) await admin.from('social_accounts').update(v).eq('id', ex[0].id);
    else await admin.from('social_accounts').insert({ client_id: st.c, platform: 'linkedin', auto: false, ...v });
    return back('ok&u=' + encodeURIComponent(row.org_name || (free.length + ' pages')));
  } catch (e) { return back('erreur&msg=' + encodeURIComponent((e as Error).message)); }
}

// ---------- règles de publication ----------
const isVid = (u: string, t?: string) => /\.(mp4|mov|m4v)(\?|$)/i.test(u) || /video/i.test(t || '');
function mediaOf(it: any): string[] {
  const m = it.media_url; if (!m) return [];
  if (typeof m === 'string' && m.startsWith('[')) { try { const a = JSON.parse(m); return Array.isArray(a) ? a : []; } catch { return [m]; } }
  return [m];
}
function netsOf(it: any) { const n = it.brief?.nets; if (Array.isArray(n) && n.length) return n; return [String(it.platform || 'instagram').toLowerCase().includes('face') ? 'facebook' : (String(it.platform || '').toLowerCase().includes('linkedin') ? 'linkedin' : 'instagram')]; }
function captionOf(it: any) { const b = it.brief || {}; return (b.caption_li && String(b.caption_li).trim()) ? b.caption_li : (it.caption || ''); }
// Texte « little text » de LinkedIn : caractères réservés échappés, #mots transformés en vrais hashtags
function littleText(s: string) {
  const tags: string[] = [];
  s = s.replace(/#([\p{L}\p{N}_]+)/gu, (_m, w) => { tags.push(w); return '\u0000' + (tags.length - 1) + '\u0000'; });
  s = s.replace(/[\\|{}@\[\]()<>*_~#]/g, c => '\\' + c);
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => '{hashtag|\\#|' + tags[+i] + '}');
}
function problems(it: any) {
  const m = mediaOf(it), p: string[] = [];
  if (m.length > 20) p.push('Plus de 20 images');
  if (m.length > 1 && m.some(u => isVid(u))) p.push('LinkedIn ne mélange pas vidéo et images dans un même post');
  if (captionOf(it).length > 3000) p.push('Texte LinkedIn de plus de 3 000 caractères');
  if (!m.length && !captionOf(it).trim()) p.push('Ni visuel ni texte');
  return p;
}
function tzOffset(ts: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}
function publishAt(it: any, conn: any) {
  if (!it.scheduled_at) return null;
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date(it.scheduled_at));
  const t = /^\d{2}:\d{2}$/.test(it.brief?.time || '') ? it.brief.time : conn.default_time || '09:00';
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), +t.slice(0, 2), +t.slice(3, 5));
  return new Date(guess - tzOffset(guess));
}

// ---------- envoi des médias ----------
async function uploadImage(url: string, owner: string, token: string) {
  const { d } = await liJson('/images?action=initializeUpload', token, { method: 'POST', body: JSON.stringify({ initializeUploadRequest: { owner } }) });
  const bin = await (await fetch(url)).arrayBuffer();
  const up = await fetch(d.value.uploadUrl, { method: 'PUT', headers: { Authorization: 'Bearer ' + token }, body: bin });
  if (!up.ok) throw new Error('Envoi de l’image refusé par LinkedIn (HTTP ' + up.status + ')');
  return d.value.image as string;
}
async function uploadVideo(url: string, owner: string, token: string) {
  const bin = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const { d } = await liJson('/videos?action=initializeUpload', token, { method: 'POST', body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: bin.byteLength, uploadCaptions: false, uploadThumbnail: false } }) });
  const v = d.value; const etags: string[] = [];
  for (const ins of v.uploadInstructions) {
    const up = await fetch(ins.uploadUrl, { method: 'PUT', body: bin.slice(ins.firstByte, ins.lastByte + 1) });
    if (!up.ok) throw new Error('Envoi de la vidéo refusé par LinkedIn (HTTP ' + up.status + ')');
    etags.push(up.headers.get('etag') || '');
  }
  await liJson('/videos?action=finalizeUpload', token, { method: 'POST', body: JSON.stringify({ finalizeUploadRequest: { video: v.video, uploadToken: v.uploadToken || '', uploadedPartIds: etags } }) });
  return v.video as string;
}
async function videoReady(urn: string, token: string) {
  const { d } = await liJson('/videos/' + encodeURIComponent(urn), token);
  if (d.status === 'PROCESSING_FAILED') throw new Error('Traitement de la vidéo refusé par LinkedIn');
  return d.status === 'AVAILABLE';
}

// ---------- publication (reprise possible : les médias déjà envoyés sont gardés dans li_work) ----------
async function step(it: any, conn: any) {
  const token = conn.access_token, owner = conn.org_urn;
  const w = it.li_work || {};
  const save = async () => { await admin.from('content_items').update({ li_work: w }).eq('id', it.id); };
  const m = mediaOf(it);
  if (m.length && !w.media) {
    if (m.length === 1 && isVid(m[0], it.media_type)) w.media = [await uploadVideo(m[0], owner, token)];
    else { w.media = []; for (const u of m) w.media.push(await uploadImage(u, owner, token)); }
    await save();
  }
  if (w.media?.length === 1 && String(w.media[0]).includes(':video:')) {
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) { ok = await videoReady(w.media[0], token); if (!ok) await new Promise(r => setTimeout(r, 5000)); }
    if (!ok) return 'wait';
  }
  const post: any = {
    author: owner, commentary: littleText(captionOf(it)), visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
  };
  if (w.media?.length === 1) post.content = { media: { id: w.media[0], title: it.title || undefined } };
  else if (w.media?.length > 1) post.content = { multiImage: { images: w.media.map((id: string) => ({ id })) } };
  const { r } = await liJson('/posts', token, { method: 'POST', body: JSON.stringify(post) });
  const urn = r.headers.get('x-restli-id') || r.headers.get('x-linkedin-id') || '';
  const nets = netsOf(it);
  const upd: Record<string, unknown> = { li_state: 'published', li_error: null, li_post_urn: urn, li_permalink: urn ? 'https://www.linkedin.com/feed/update/' + urn + '/' : null, li_published_at: new Date().toISOString(), li_work: null };
  if (!nets.includes('instagram') || it.publish_state === 'published') upd.status = 'published';
  await admin.from('content_items').update(upd).eq('id', it.id);
  return 'done';
}
async function run(it: any, conn: any) {
  if (!conn.org_urn) return { id: it.id, r: 'erreur', e: 'Aucune page LinkedIn choisie' };
  if (!it.li_state) {
    const { data } = await admin.from('content_items').update({ li_state: 'processing', li_error: null }).eq('id', it.id).is('li_state', null).in('status', ['approved', 'published']).select('id');
    if (!data?.length) return { id: it.id, r: 'déjà pris' };
  }
  const bad = problems(it);
  try {
    if (bad.length) throw new Error(bad.join(' · '));
    return { id: it.id, r: await step(it, conn) };
  } catch (e) {
    await admin.from('content_items').update({ li_state: 'error', li_error: (e as Error).message, li_work: null }).eq('id', it.id);
    if ((e as any).status === 401) await admin.from('li_connections').update({ status: 'error', last_error: (e as Error).message, last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    return { id: it.id, r: 'erreur', e: (e as Error).message };
  }
}
async function maintain(conn: any) {
  const now = Date.now();
  if (conn.refresh_token && conn.token_expires_at && new Date(conn.token_expires_at).getTime() - now < 10 * 864e5) {
    try {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
      conn.access_token = t.access_token;
      await admin.from('li_connections').update({ access_token: t.access_token, token_expires_at: new Date(now + (t.expires_in || 5184000) * 1000).toISOString(), refresh_token: t.refresh_token || conn.refresh_token, status: 'ok', last_error: null, updated_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    } catch (e) {
      await admin.from('li_connections').update({ status: 'error', last_error: 'Renouvellement de l’accès impossible : ' + (e as Error).message, last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
    }
  } else if (!conn.refresh_token && conn.token_expires_at && new Date(conn.token_expires_at).getTime() - now < 7 * 864e5 && conn.status !== 'error') {
    await admin.from('li_connections').update({ status: 'error', last_error: 'L’accès LinkedIn expire le ' + new Date(conn.token_expires_at).toLocaleDateString('fr-CH') + ' : reconnecte la page.', last_error_at: new Date().toISOString() }).eq('client_id', conn.client_id);
  }
}
async function cronRun() {
  const { data: conns } = await admin.from('li_connections').select('*');
  const out: unknown[] = [];
  for (const conn of conns || []) {
    await maintain(conn);
    if (!conn.publish_enabled || !conn.enabled_at || !conn.org_urn) continue;
    const { data: items } = await admin.from('content_items').select('*').eq('client_id', conn.client_id).in('status', ['approved', 'published']).or('li_state.is.null,li_state.eq.processing');
    const now = Date.now(), since = new Date(conn.enabled_at).getTime();
    for (const it of items || []) {
      if (!netsOf(it).includes('linkedin')) continue;
      const at = publishAt(it, conn);
      if (!at || at.getTime() > now) continue;
      if (!it.li_state && at.getTime() < since) continue; // prévu avant l'activation : jamais publié d'office
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
    if (!CLIENT_SECRET) return json({ error: 'Le secret LI_CLIENT_SECRET n’est pas encore enregistré dans Supabase' }, 400);
    if (!body.client_id) return json({ error: 'client_id manquant' }, 400);
    const state = await signState({ c: body.client_id, u: me.id, e: Date.now() + 7 * 864e5 });
    const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
    u.search = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: REDIRECT, state, scope: SCOPES }).toString();
    return json({ url: u.toString() });
  }
  if (body.action === 'publish_now') {
    const { data: it } = await admin.from('content_items').select('*').eq('id', body.id).single();
    if (!it) return json({ error: 'Contenu introuvable' }, 404);
    if (it.status !== 'approved' && it.status !== 'published') return json({ error: 'Seuls les contenus validés peuvent être publiés' }, 400);
    if (it.li_state === 'published') return json({ error: 'Déjà publié sur LinkedIn' }, 400);
    const { data: conn } = await admin.from('li_connections').select('*').eq('client_id', it.client_id).maybeSingle();
    if (!conn) return json({ error: 'LinkedIn non connecté pour ce projet' }, 400);
    return json(await run(it, conn));
  }
  return json({ error: 'Action inconnue' }, 400);
});
