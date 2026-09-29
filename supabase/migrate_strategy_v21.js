// Migration de la Stratégie Wanderful v2 → v2.1 (idempotente, conserve statuts, échéances et liens déjà saisis).
function migrateV2(v){
  v=JSON.parse(JSON.stringify(v));
  if(v.rev>=2)return v;
  const tab=k=>v.tabs.find(t=>t.k===k);
  // 6. Offres : exemples de livrables
  const offers=tab('cap').blocks.find(b=>b.type==='cards'&&/portes d'entrée/.test(b.title||''));
  const EX={'Clarifier la direction':['Diagnostic priorisé','Positionnement','Messages clés',"Plan d'action"],
            'Concevoir et lancer':['Site ou page de conversion','Campagne','Concept et variantes créatives'],
            'Piloter et améliorer':['Suivi des campagnes','Tests','Amélioration du parcours','Bilan et décisions']};
  offers.items.forEach(c=>{c.ex=EX[c.t];c.exLabel='Exemples de livrables';});
  offers.note="Exemples adaptés à chaque mandat : ce ne sont pas des prestations systématiquement incluses. Les services techniques (Google Ads, site, tracking, automatisations…) s'intègrent dans ces trois offres.";
  // 7. Fiches des deux séries
  v.series=v.series||[
    {k:'magie',t:'« Derrière la magie »',steps:['Réalisation','Problème','Choix','Résultat disponible ou enseignement'],pilot:'',format:'',needs:''},
    {k:'detail',t:'« Le détail qui change le choix »',steps:['Élément observé','Obstacle ou hypothèse','Amélioration','Application concrète'],pilot:'',format:'',needs:''}];
  const ct=tab('contenu').blocks;
  if(!ct.some(b=>b.type==='fiches')){
    const i=ct.findIndex(b=>b.title==='Les deux séries');
    ct.splice(i+1,0,{type:'fiches',title:'Fiches des séries — sujet pilote',note:"Aucun résultat client inventé : un résultat n'est mentionné que s'il est disponible et vérifiable ; sinon, on partage l'enseignement."});
  }
  // 9. Mesure : lien vers le SEO
  const me=tab('mesure');me.links=[{k:'stats',t:'Statistiques'},{k:'seo',t:'SEO / Référencement'}];
  // 8. Plan 90 jours : réorganisation, statuts conservés
  const all={};v.plan90.months.forEach(m=>m.items.forEach(x=>all[x.id]=x));
  const keep=(id,t)=>Object.assign({id,t,st:'todo',due:'',link:''},all[id]||{},t?{t}:{});
  const M=v.plan90.months;
  M[0].items=[keep('m1-1'),keep('m1-2'),keep('m1-3'),keep('m1-4','Aligner les messages prioritaires des pages principales.'),
    keep('m2-4','Mettre en place un suivi simple des demandes.'),
    keep('m1-7','Collecter les preuves Carewell disponibles (chiffres, éléments, accord de diffusion).'),
    keep('m1-5'),keep('m1-6'),keep('m1-8','Produire les premiers contenus pilotes des deux séries.'),
    keep('m2-5','Commencer les premières prises de contact pertinentes, en parallèle de la refonte.')];
  M[0].result="Wanderful peut être présentée clairement, les demandes sont suivies et les premiers contenus pilotes existent.";
  M[1].items=[keep('m2-1','Finaliser le cas Carewell documenté.'),keep('m2-2'),keep('m2-3'),keep('m2-6','Poursuivre une prospection ciblée compatible avec la charge.')];
  v.plan90.intro="Ordre de travail recommandé. Les dates exactes dépendent de la capacité disponible. Les prises de contact pertinentes commencent en parallèle, sans attendre la fin de la refonte.";
  v.rev=2;
  return v;
}
if(typeof module!=='undefined')module.exports=migrateV2;
