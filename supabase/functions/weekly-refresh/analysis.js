// Analyse hebdomadaire Search Console — module pur (aucun accès réseau).
// Utilisé par la fonction Edge et par les tests. Aucune donnée n'est inventée :
// chaque constat renvoie aux chiffres fournis en entrée.

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s + 'T00:00:00Z') + n * DAY));

/** Périodes complètes, en tenant compte du délai de disponibilité (3 jours par défaut). */
export function periods(todayISO, lagDays = 3) {
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
export const fr = (s) => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '—');
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
export function tot(row) {
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
export function analyze(input) {
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
export function extractMeta(html) {
  const t = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
  const d = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1];
  const dec = (s) => (s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  return { title: dec(t), description: dec(d) };
}

export function parseSitemap(xml) {
  const out = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1];
    const lastmod = (m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
    if (loc) out.push({ loc: loc.trim(), lastmod: lastmod ? lastmod.trim().slice(0, 10) : null });
  }
  return out;
}

/**
 * Site technique (PageSpeed Insights). input: { url, today, availability:{status, ms}, mobile, desktop, prev }
 * mobile/desktop : réponses brutes PageSpeed (ou null). prev : bilan précédent (ou null).
 */
export function analyzePagespeed(input) {
  const P = periods(input.today, 0);
  const pick = (r) => {
    if (!r || !r.lighthouseResult) return null;
    const a = r.lighthouseResult.audits || {};
    const sc = r.lighthouseResult.categories && r.lighthouseResult.categories.performance ? Math.round(r.lighthouseResult.categories.performance.score * 100) : null;
    const opp = Object.values(a).filter((x) => x.details && x.details.type === 'opportunity' && (x.details.overallSavingsMs || 0) >= 300)
      .sort((x, y) => y.details.overallSavingsMs - x.details.overallSavingsMs).slice(0, 3)
      .map((x) => ({ title: x.title, savingsMs: Math.round(x.details.overallSavingsMs) }));
    const le = r.loadingExperience || {};
    const fm = le.metrics || {};
    return {
      score: sc,
      lab: { lcp: a['largest-contentful-paint'] && a['largest-contentful-paint'].displayValue, cls: a['cumulative-layout-shift'] && a['cumulative-layout-shift'].displayValue, tbt: a['total-blocking-time'] && a['total-blocking-time'].displayValue },
      field: le.overall_category ? { category: le.overall_category, lcpMs: fm.LARGEST_CONTENTFUL_PAINT_MS && fm.LARGEST_CONTENTFUL_PAINT_MS.percentile, inpMs: fm.INTERACTION_TO_NEXT_PAINT && fm.INTERACTION_TO_NEXT_PAINT.percentile, cls: fm.CUMULATIVE_LAYOUT_SHIFT_SCORE ? fm.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null } : null,
      opportunities: opp,
    };
  };
  const m = pick(input.mobile), d = pick(input.desktop);
  const av = input.availability || {};
  const up = av.status && av.status < 400;
  const notes = ['Le score PageSpeed est une mesure simulée : il peut varier de quelques points d’un test à l’autre sans changement sur le site.'];
  if (m && !m.field) notes.push('Pas encore assez de visites réelles pour que Google publie des mesures terrain (Core Web Vitals) : seules les mesures simulées sont disponibles.');
  const prev = input.prev && input.prev.mobile ? input.prev.mobile.score : null;
  const summary = [];
  summary.push(up ? `Site accessible au moment du contrôle (réponse ${av.status}, ${av.ms} ms).` : `Site inaccessible au moment du contrôle${av.status ? ' (code ' + av.status + ')' : ''}.`);
  if (m) summary.push(`Score performance mobile : ${m.score}/100${prev != null ? ` (bilan précédent : ${prev}/100)` : ''}${d ? ` · ordinateur : ${d.score}/100` : ''}.`);
  const recos = [];
  const src = `PageSpeed Insights (Google), test du ${fr(input.today)} sur ${input.url}`;
  if (!up) recos.push({ key: `site-down:${input.url}`, type: 'disponibilite', theme: 'site', page: input.url, topic: 'Site inaccessible au moment du contrôle',
    observation: `Le contrôle du ${fr(input.today)} a obtenu ${av.status ? 'le code ' + av.status : 'aucune réponse'}.`, source: 'Contrôle direct depuis le serveur de collecte',
    interpretation: 'Un seul contrôle ne suffit pas à conclure à une panne durable (maintenance, coupure brève possible).', uncertainty: 'moyenne',
    change: 'Ouvrir le site, vérifier l’hébergement et le nom de domaine ; relancer « Actualiser maintenant » pour confirmer.', priority: 'haute', effort: 'faible', evaluation: 'Nouveau contrôle immédiat, puis au prochain bilan.' });
  if (m && m.score != null && m.score < 50) recos.push({ key: `perf-mobile:${input.url}`, type: 'performance', theme: 'site', page: input.url, topic: 'Performance mobile faible',
    observation: `Score mobile ${m.score}/100 (LCP ${m.lab.lcp || '—'}, TBT ${m.lab.tbt || '—'}, CLS ${m.lab.cls || '—'}).${m.opportunities.length ? ' Pistes signalées par PageSpeed : ' + m.opportunities.map((o) => `${o.title} (≈ ${(o.savingsMs / 1000).toFixed(1)} s)`).join(' ; ') + '.' : ''}`,
    source: src, interpretation: 'Un site lent sur mobile peut décourager une partie des visiteurs. Le gain réel dépend des pages et des visiteurs ; mesure simulée.', uncertainty: 'moyenne',
    change: 'Examiner les pistes listées (images, scripts, polices) en commençant par la plus lourde ; aucune modification sans vérification sur une copie du site.', priority: m.score < 30 ? 'haute' : 'moyenne', effort: 'moyen',
    evaluation: 'Score mobile et LCP au prochain bilan (comparer plusieurs semaines, la mesure varie).' });
  if (m && m.field && m.field.category === 'SLOW') recos.push({ key: `cwv:${input.url}`, type: 'performance', theme: 'site', page: input.url, topic: 'Expérience réelle jugée lente par Google',
    observation: `Mesures terrain (visiteurs réels, 28 j) : catégorie « lente » ; LCP ${m.field.lcpMs != null ? (m.field.lcpMs / 1000).toFixed(1) + ' s' : '—'}, INP ${m.field.inpMs != null ? m.field.inpMs + ' ms' : '—'}.`,
    source: 'Chrome UX Report via PageSpeed Insights', interpretation: 'Donnée issue de vrais visiteurs : plus fiable que le score simulé.', uncertainty: 'faible',
    change: 'Prioriser l’amélioration de l’indicateur le plus éloigné du seuil « bon ».', priority: 'haute', effort: 'moyen', evaluation: 'Mesures terrain 4 à 6 semaines après correction (moyenne glissante de 28 jours).' });
  return { source: 'pagespeed', url: input.url, periods: P, status: m ? 'ok' : 'partial', availability: av, mobile: m, desktop: d, summary, notes, recos: recos.slice(0, 3),
    recosNote: recos.length ? null : 'Aucun problème technique notable détecté cette semaine.' };
}
