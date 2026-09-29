// Fonction Edge « weekly-refresh » — collecte hebdomadaire Search Console (et Analytics si configuré).
// Déclenchement : pg_cron (lundi 8 h Zurich) ou bouton « Actualiser maintenant » (vue agence).
// Secrets requis (à saisir dans Supabase > Edge Functions > Secrets, jamais dans le code) :
//   GOOGLE_SA_JSON  : clé JSON du compte de service Google (lecture seule sur les propriétés ajoutées)
// Fournis automatiquement par Supabase : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { periods, analyze, extractMeta, parseSitemap } from './analysis.js';

const cors = { 'Access-Control-Allow-Origin': 'https://wanderful-marketing.com', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY'))!);

// ---------- Jeton Google (compte de service, renouvelé à chaque exécution) ----------
function b64url(buf: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function googleToken(scopes: string[]) {
  const sa = JSON.parse(Deno.env.get('GOOGLE_SA_JSON') || 'null');
  if (!sa) throw new Error('Accès Google non configuré (secret GOOGLE_SA_JSON absent)');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: scopes.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${claim}.${b64url(sig)}` });
  const j = await r.json();
  if (!j.access_token) throw new Error('Jeton Google refusé : ' + (j.error_description || j.error || r.status));
  return j.access_token as string;
}

// ---------- Search Console ----------
async function gsc(token: string, site: string, start: string, end: string, dims: string[] = [], rowLimit = 250) {
  const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate: start, endDate: end, dimensions: dims, rowLimit, dataState: 'final' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Search Console ${r.status} : ${j.error?.message || 'erreur'}`);
  return (j.rows || []) as any[];
}

async function collectGsc(token: string, site: string, domain: string | null, today: string) {
  const P = periods(today, 3);
  const one = async (p: { start: string; end: string }) => (await gsc(token, site, p.start, p.end, [], 1))[0] || null;
  const [w, wp, t28, t28p] = await Promise.all([one(P.w), one(P.wp), one(P.t28), one(P.t28p)]);
  const [daily, pagesT, pagesTp, queriesT, queriesTp, pageQueryT, pages90, recent, countriesT] = await Promise.all([
    gsc(token, site, P.t28p.start, P.w.end, ['date'], 100),
    gsc(token, site, P.t28.start, P.t28.end, ['page']), gsc(token, site, P.t28p.start, P.t28p.end, ['page']),
    gsc(token, site, P.t28.start, P.t28.end, ['query']), gsc(token, site, P.t28p.start, P.t28p.end, ['query']),
    gsc(token, site, P.t28.start, P.t28.end, ['page', 'query'], 500),
    gsc(token, site, P.d90.start, P.d90.end, ['page'], 1000),
    gsc(token, site, P.w.start, today, ['date'], 30),
    gsc(token, site, P.t28.start, P.t28.end, ['country'], 50),
  ]);
  const lastDataDate = recent.map((r) => r.keys[0]).sort().pop() || null;
  let sitemap: any[] = [], pageMeta: Record<string, any> = {};
  if (domain) {
    try { sitemap = parseSitemap(await (await fetch(`https://${domain}/sitemap.xml`)).text()); } catch { /* pas de sitemap : règle ignorée */ }
    for (const p of pagesT.slice(0, 5)) {
      try { pageMeta[p.keys[0]] = extractMeta(await (await fetch(p.keys[0])).text()); } catch { /* page non consultable */ }
    }
  }
  return analyze({ site, P, totals: { w, wp, t28, t28p }, daily: daily.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })), lastDataDate, pagesT, pagesTp, queriesT, queriesTp, pageQueryT, pages90, countriesT, sitemap, pageMeta });
}

// ---------- Analytics (GA4), si une propriété est configurée ----------
async function collectGa4(token: string, property: string, today: string) {
  const P = periods(today, 2);
  const run = async (body: any) => {
    const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(`Analytics ${r.status} : ${j.error?.message || 'erreur'}`); return j;
  };
  const organic = { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } } };
  const ranges = [{ startDate: P.t28.start, endDate: P.t28.end, name: 't28' }, { startDate: P.t28p.start, endDate: P.t28p.end, name: 't28p' }];
  const [tot, landing, events] = await Promise.all([
    run({ dateRanges: ranges, metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], dimensionFilter: organic }),
    run({ dateRanges: [ranges[0]], dimensions: [{ name: 'landingPagePlusQueryString' }], metrics: [{ name: 'sessions' }], dimensionFilter: organic, limit: 15 }),
    run({ dateRanges: [ranges[0]], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'keyEvents' }], limit: 20 }),
  ]);
  return { source: 'ga4', property, periods: P, status: 'ok', totals: tot.rows || [], landing: landing.rows || [], keyEvents: (events.rows || []).filter((r: any) => Number(r.metricValues[0].value) > 0), note: "Les événements clés sont listés sous leur nom GA4 : leur signification (prospect, contact…) reste à vérifier avant interprétation." };
}

async function saveRecos(clientId: string, recos: any[], today: string) {
  for (const r of recos) {
    const { data: ex } = await admin.from('seo_recos').select('id,status').eq('client_id', clientId).eq('key', r.key).maybeSingle();
    const fields = { type: r.type, page: r.page, topic: r.topic, observation: r.observation, source: r.source, interpretation: r.interpretation, uncertainty: r.uncertainty, change: r.change, current_text: r.current_text ?? null, priority: r.priority, effort: r.effort, evaluation: r.evaluation, last_seen: today, updated_at: new Date().toISOString() };
    if (!ex) await admin.from('seo_recos').insert({ client_id: clientId, key: r.key, first_seen: today, ...fields });
    else if (ex.status === 'open' || ex.status === 'in_plan') await admin.from('seo_recos').update(fields).eq('id', ex.id); // mise à jour, pas de doublon
    // 'done' ou 'dismissed' : on n'écrase pas la décision prise
  }
}

async function refreshClient(clientId: string, trigger: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
  const { data: run } = await admin.from('refresh_runs').insert({ client_id: clientId, trigger, status: 'running' }).select('id').single();
  const { data: sources } = await admin.from('data_sources').select('*').eq('client_id', clientId).eq('active', true);
  const results: any[] = [];
  let token: string | null = null;
  for (const s of sources || []) {
    try {
      token = token || await googleToken(['https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly']);
      const rep = s.source === 'gsc' ? await collectGsc(token, s.property, s.domain, today) : await collectGa4(token, s.property, today);
      await admin.from('metric_reports').upsert({ client_id: clientId, source: s.source, period_start: rep.periods.w.start, period_end: rep.periods.w.end, status: rep.status, data: rep }, { onConflict: 'client_id,source,period_end' });
      if (s.source === 'gsc') await saveRecos(clientId, rep.recos, today);
      await admin.from('data_sources').update({ status: rep.status, last_success_at: new Date().toISOString(), last_error: null }).eq('id', s.id);
      results.push({ source: s.source, status: rep.status });
    } catch (e) {
      // Échec : on garde les derniers bilans fiables, on signale le problème. Jamais de remplacement par zéro.
      await admin.from('data_sources').update({ status: 'error', last_error: String((e as Error).message || e), last_error_at: new Date().toISOString() }).eq('id', s.id);
      results.push({ source: s.source, status: 'error', message: String((e as Error).message || e) });
    }
  }
  const st = !results.length ? 'no_source' : results.every((r) => r.status === 'ok') ? 'ok' : results.some((r) => r.status !== 'error') ? 'partial' : 'error';
  await admin.from('refresh_runs').update({ status: st, message: JSON.stringify(results), finished_at: new Date().toISOString() }).eq('id', run!.id);
  return { client_id: clientId, status: st, results };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.json().catch(() => ({}));
  if (body.trigger === 'cron') {
    // Deux déclenchements UTC (6 h et 7 h) : on ne travaille qu'à 8 h, heure de Zurich.
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', hour12: false }).format(new Date()));
    const wd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short' }).format(new Date());
    if (wd !== 'Mon' || h !== 8) return json({ skipped: true, reason: `Zurich ${wd} ${h}h` });
    const { data: ids } = await admin.from('data_sources').select('client_id').eq('active', true);
    const out = [];
    for (const id of [...new Set((ids || []).map((r: any) => r.client_id))]) out.push(await refreshClient(id as string, 'cron'));
    return json({ ok: true, out });
  }
  // Déclenchement manuel : réservé à l'agence, un seul projet à la fois.
  const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user) return json({ error: 'Non authentifié' }, 401);
  const { data: prof } = await admin.from('profiles').select('role').eq('id', u.user.id).single();
  if (prof?.role !== 'agency') return json({ error: 'Réservé à la vue agence' }, 403);
  if (!body.client_id) return json({ error: 'client_id manquant' }, 400);
  return json(await refreshClient(body.client_id, 'manual'));
});
