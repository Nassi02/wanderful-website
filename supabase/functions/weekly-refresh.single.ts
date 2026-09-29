// Fonction Edge « weekly-refresh » — collecte hebdomadaire Search Console (et Analytics si configuré).
// Déclenchement : pg_cron (lundi 8 h Zurich) ou bouton « Actualiser maintenant » (vue agence).
// Secrets requis (à saisir dans Supabase > Edge Functions > Secrets, jamais dans le code) :
//   GOOGLE_SA_JSON  : clé JSON du compte de service Google (lecture seule sur les propriétés ajoutées)
// Fournis automatiquement par Supabase : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ---------- Analyse (copie de analysis.js, version fichier unique pour l'éditeur Supabase) ----------
// Analyse hebdomadaire Search Console — module pur (aucun accès réseau).
// Utilisé par la fonction Edge et par les tests. Aucune donnée n'est inventée :
// chaque constat renvoie aux chiffres fournis en entrée.

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s + 'T00:00:00Z') + n * DAY));

/** Périodes complètes, en tenant compte du délai de disponibilité (3 jours par défaut). */
function periods(todayISO, lagDays = 3) {
  const limit = addDays(todayISO, -lagDays);
  const d = new Date(Date.parse(limit + 'T00:00:00Z'));
  const back = d.getUTCDay(); // 0 = dimanche
  const end = addDays(limit, -back); // dernier dimanche <= limite
  return {
    lagDays,
    w: { start: addDays(end, -6), end },
    wp: { start: addDays(end, -13), end: addDays(end, -7) },
    t28: { start: addDays(end, -27), end },
    t28p: { start: addDays(end, -55), end: addDays(end, -28) },
    d90: { start: addDays(end, -89), end },
  };
}

const r1 = (x) => Math.round(x * 10) / 10;
/** Date lisible : 2026-09-14 → 14.09.2026 */
const fr = (s) => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '—');
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
function tot(row) {
  if (!row) return { clicks: 0, impressions: 0, ctr: null, position: null };
  return { clicks: row.clicks, impressions: row.impressions, ctr: row.impressions ? row.clicks / row.impressions : null, position: row.position != null ? r1(row.position) : null };
}
const shortUrl = (u) => (u || '').replace(/^https?:\/\/[^/]+/, '') || '/';

function movers(cur, prev, keyName, minImpr = 10) {
  const m = new Map();
  for (const r of prev) m.set(r.keys[0], { p: r });
  for (const r of cur) m.set(r.keys[0], Object.assign(m.get(r.keys[0]) || {}, { c: r }));
  const out = [];
  for (const [k, v] of m) {
    const c = v.c || { clicks: 0, impressions: 0 }, p = v.p || { clicks: 0, impressions: 0 };
    if (Math.max(c.impressions, p.impressions) < minImpr) continue;
    const dc = c.clicks - p.clicks, di = c.impressions - p.impressions;
    const sig = Math.abs(dc) >= 2 || (Math.abs(di) >= 10 && Math.abs(di) >= 0.3 * Math.max(p.impressions, 1));
    if (!sig) continue;
    out.push({ [keyName]: k, clicks: c.clicks, clicksPrev: p.clicks, impressions: c.impressions, impressionsPrev: p.impressions, position: c.position != null ? r1(c.position) : null, positionPrev: p.position != null ? r1(p.position) : null, dir: dc > 0 || (dc === 0 && di > 0) ? 'up' : 'down' });
  }
  return out.sort((a, b) => Math.abs(b.clicks - b.clicksPrev) - Math.abs(a.clicks - a.clicksPrev) || Math.abs(b.impressions - b.impressionsPrev) - Math.abs(a.impressions - a.impressionsPrev)).slice(0, 8);
}

/**
 * input: { site, today, P (periods), totals:{w,wp,t28,t28p}, daily:[rows date], lastDataDate,
 *          pagesT, pagesTp, queriesT, queriesTp, pageQueryT, pages90, sitemap:[{loc,lastmod}], pageMeta:{url:{title,description}} }
 */
function analyze(input) {
  const { P } = input;
  const T = {
    w: tot(input.totals.w), wp: tot(input.totals.wp), t28: tot(input.totals.t28), t28p: tot(input.totals.t28p),
  };
  const notes = [];
  let status = 'ok';
  if (!input.lastDataDate || input.lastDataDate < P.w.end) {
    status = 'partial';
    notes.push(`Données Search Console disponibles jusqu'au ${fr(input.lastDataDate)} seulement : la semaine du ${fr(P.w.start)} au ${fr(P.w.end)} peut être incomplète.`);
  }
  const lowVolume = T.t28.impressions < 300;
  if (lowVolume) notes.push(`Volume faible (${T.t28.impressions} impressions sur 28 jours) : les variations d'une semaine à l'autre sont peu significatives.`);
  const qClicks = (input.queriesT || []).reduce((a, r) => a + r.clicks, 0);
  if (T.t28.clicks > 0 && qClicks < T.t28.clicks) notes.push(`Sur 28 jours, ${T.t28.clicks - qClicks} clic(s) sur ${T.t28.clicks} ne sont rattachés à aucune requête visible : Google masque les requêtes rares ou anonymisées. Les totaux par requête sont donc inférieurs aux totaux par page.`);

  const countries = (input.countriesT || []).slice().sort((a, b) => b.impressions - a.impressions).slice(0, 5)
    .map((r) => ({ country: r.keys[0].toUpperCase(), clicks: r.clicks, impressions: r.impressions }));
  const che = (input.countriesT || []).find((r) => r.keys[0] === 'che');
  if (input.countriesT && input.countriesT.length && T.t28.impressions) {
    notes.push(`Sur 28 jours, ${Math.round(((che ? che.impressions : 0) / T.t28.impressions) * 100)} % des impressions et ${che ? che.clicks : 0} clic(s) sur ${T.t28.clicks} proviennent de Suisse.`);
  }
  const mv = {
    pages: movers(input.pagesT || [], input.pagesTp || [], 'page'),
    queries: movers(input.queriesT || [], input.queriesTp || [], 'query'),
  };

  const recos = [];
  const src28 = `Search Console, ${fr(P.t28.start)} → ${fr(P.t28.end)} (28 j) vs ${fr(P.t28p.start)} → ${fr(P.t28p.end)}`;

  // A. Pages du plan du site sans aucune impression sur 90 jours
  if (input.sitemap && input.sitemap.length) {
    const seen = new Set((input.pages90 || []).map((r) => r.keys[0].replace(/\/$/, '')));
    const legal = /(mentions-legales|politique|privacy|terms|confidentialite)/i;
    // Pages modifiées après la semaine analysée : trop récentes pour être jugées.
    const eligible = input.sitemap.filter((u) => !legal.test(u.loc) && !(u.lastmod && u.lastmod > P.w.end));
    const missing = eligible.filter((u) => !seen.has(u.loc.replace(/\/$/, '')));
    if (missing.length) {
      recos.push({
        key: 'indexation:sitemap', type: 'indexation', page: `${missing.length} page(s) du plan du site`, topic: 'Visibilité des pages de services et secteurs',
        observation: `${missing.length} des ${eligible.length} pages du plan du site (hors pages légales et pages modifiées après le ${fr(P.w.end)}) n'ont reçu aucune impression Google entre le ${fr(P.d90.start)} et le ${fr(P.d90.end)}. Pages concernées : ${missing.map((u) => shortUrl(u.loc)).join(', ')}.`,
        source: `Search Console (dimension page, 90 jours) + sitemap.xml du site`,
        interpretation: "Deux explications possibles, non départagées par ces données : les pages ne sont pas indexées, ou elles sont indexées mais n'apparaissent pour aucune recherche. Incertitude élevée tant que le statut d'indexation n'a pas été vérifié.",
        uncertainty: 'élevée',
        change: "Vérifier le statut de ces URL dans Search Console (rapport « Pages » ou inspection d'URL). Selon le motif indiqué par Google : renforcer les liens internes depuis l'accueil et les pages proches, compléter le contenu, puis demander l'indexation. Aucune modification du site sans examen préalable.",
        priority: 'haute', effort: 'faible (vérification) · variable (corrections)',
        evaluation: "Dans 4 semaines : nombre de pages du plan du site ayant au moins une impression sur 28 jours, comparé aux 28 jours précédents.",
      });
    }
  }

  // B. Requête à fort volume, CTR faible, site hors des premières positions
  for (const q of input.queriesT || []) {
    if (q.impressions >= 100 && q.clicks / q.impressions < 0.01 && q.position > 3) {
      const variants = (input.queriesT || []).filter((x) => x.keys[0] !== q.keys[0] && x.keys[0].includes(q.keys[0])).map((x) => `« ${x.keys[0]} » (${x.impressions} impr.)`);
      const pageRow = (input.pageQueryT || []).filter((r) => r.keys[1] === q.keys[0]).sort((a, b) => b.impressions - a.impressions)[0];
      const page = pageRow ? pageRow.keys[0] : null;
      const meta = page && input.pageMeta ? input.pageMeta[page] : null;
      const prev = (input.queriesTp || []).find((x) => x.keys[0] === q.keys[0]);
      recos.push({
        key: `ctr-requete:${q.keys[0]}`, type: 'ctr', page: page ? shortUrl(page) : '—', topic: `Requête « ${q.keys[0]} »`,
        observation: `« ${q.keys[0]} » : ${q.impressions} impressions, ${q.clicks} clic(s), CTR ${(q.clicks / q.impressions * 100).toFixed(2)} %, position moyenne ${r1(q.position)} sur 28 jours${prev ? ` (période précédente : ${prev.impressions} impr., ${prev.clicks} clic(s), position ${r1(prev.position)})` : ''}.${variants.length ? ' Requêtes proches relevées : ' + variants.join(', ') + '.' : ''}`,
        source: src28,
        interpretation: "Le site n'apparaît pas en tête pour cette requête ; d'autres résultats portant un nom proche captent probablement une partie des recherches. C'est une hypothèse : la page de résultats Google n'a pas été vérifiée automatiquement. Une position moyenne est une moyenne entre recherches, pas un rang fixe.",
        uncertainty: 'moyenne',
        change: "Examiner la page de résultats Google pour cette requête. Si l'intention correspond bien à l'agence, vérifier que le titre et la description identifient clairement Wanderful Marketing (nom complet, activité, lieu). Texte actuel ci-dessous ; toute réécriture reste à valider avant publication.",
        current_text: meta ? `Titre : ${meta.title || '—'}\nDescription : ${meta.description || '—'}` : null,
        priority: 'moyenne', effort: 'faible',
        evaluation: `Dans 4 semaines après modification : CTR et position moyenne de « ${q.keys[0]} » sur 28 jours, comparés aux 28 jours précédant la modification.`,
      });
    }
  }

  // C. Page à fort volume, CTR faible alors qu'elle est en première page
  for (const p of input.pagesT || []) {
    if (p.impressions >= 100 && p.clicks / p.impressions < 0.02 && p.position <= 10) {
      const qs = (input.pageQueryT || []).filter((r) => r.keys[0] === p.keys[0]).sort((a, b) => b.impressions - a.impressions).slice(0, 5);
      const meta = input.pageMeta ? input.pageMeta[p.keys[0]] : null;
      recos.push({
        key: `ctr-page:${shortUrl(p.keys[0])}`, type: 'ctr', page: shortUrl(p.keys[0]), topic: 'Page vue mais peu cliquée',
        observation: `${p.impressions} impressions, ${p.clicks} clic(s), CTR ${(p.clicks / p.impressions * 100).toFixed(2)} %, position moyenne ${r1(p.position)} (28 j). Requêtes principales : ${qs.map((r) => `« ${r.keys[1]} » ${r.impressions} impr.`).join(', ') || 'non visibles'}.`,
        source: src28,
        interpretation: "Avant de conclure que le titre est en cause, vérifier si les requêtes correspondent à l'intention de la page et si des éléments enrichis captent les clics. Incertitude moyenne.",
        uncertainty: 'moyenne',
        change: "Examiner les requêtes, la position et le contenu actuel ; proposer une réécriture seulement si l'écart d'intention est confirmé.",
        current_text: meta ? `Titre : ${meta.title || '—'}\nDescription : ${meta.description || '—'}` : null,
        priority: 'moyenne', effort: 'faible',
        evaluation: 'CTR de la page sur 28 jours, 4 semaines après modification, comparé aux 28 jours précédents.',
      });
    }
  }

  // D. Requêtes proches de la première page
  for (const q of input.queriesT || []) {
    if (q.impressions >= 20 && q.position >= 8 && q.position <= 20 && !recos.some((r) => r.key === `ctr-requete:${q.keys[0]}`)) {
      recos.push({
        key: `proche-p1:${q.keys[0]}`, type: 'opportunite', page: '—', topic: `Requête « ${q.keys[0]} » proche de la 1re page`,
        observation: `${q.impressions} impressions, position moyenne ${r1(q.position)} sur 28 jours.`, source: src28,
        interpretation: 'Une amélioration du contenu ciblant cette intention pourrait rapprocher la page des premiers résultats. Incertitude moyenne à élevée.',
        uncertainty: 'moyenne à élevée', change: "Identifier la page la plus pertinente pour cette requête et examiner si elle répond à l'intention.",
        priority: 'basse', effort: 'moyen', evaluation: 'Position moyenne et impressions de la requête sur 28 jours, 4 à 6 semaines après modification.',
      });
    }
  }

  const order = { haute: 0, moyenne: 1, basse: 2 };
  recos.sort((a, b) => order[a.priority] - order[b.priority]);

  const opportunities = recos.map((r) => r.topic);
  const w = T.w, wp = T.wp, t = T.t28, tp = T.t28p;
  const summary = [
    `Semaine du ${fr(P.w.start)} au ${fr(P.w.end)} : ${w.clicks} clic(s) et ${w.impressions} impressions (semaine précédente : ${wp.clicks} clic(s), ${wp.impressions} impressions).`,
    `Tendance 28 jours : ${t.clicks} clics (${tp.clicks} sur les 28 jours précédents), ${t.impressions} impressions (${tp.impressions}), position moyenne ${t.position ?? '—'} (${tp.position ?? '—'}).`,
  ];
  if (!mv.pages.length && !mv.queries.length) summary.push('Aucune variation significative par page ou par requête sur la période.');

  return {
    source: 'gsc', site: input.site, periods: P, status, lastDataDate: input.lastDataDate,
    totals: T, deltas: { w: { clicks: pct(w.clicks, wp.clicks), impressions: pct(w.impressions, wp.impressions) }, t28: { clicks: pct(t.clicks, tp.clicks), impressions: pct(t.impressions, tp.impressions) } },
    daily: input.daily || [], countries, pages: (input.pagesT || []).slice(0, 15), queries: (input.queriesT || []).slice(0, 15),
    movers: mv, lowVolume, notes, summary, opportunities,
    recos: recos.slice(0, 3),
    recosNote: recos.length === 0 ? 'Données insuffisantes pour formuler une recommandation fiable cette semaine.' : (recos.length < 3 ? `${recos.length} recommandation(s) seulement : les données ne justifient pas davantage.` : null),
  };
}

/** Extrait titre et meta description d'une page HTML consultée. */
function extractMeta(html) {
  const t = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
  const d = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1];
  const dec = (s) => (s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  return { title: dec(t), description: dec(d) };
}

function parseSitemap(xml) {
  const out = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1];
    const lastmod = (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
    if (loc) out.push({ loc: loc.trim(), lastmod: lastmod ? lastmod.trim().slice(0, 10) : null });
  }
  return out;
}

// ---------- Fonction ----------
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
