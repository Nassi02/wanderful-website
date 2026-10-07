/* Mesure Wanderful Marketing — GA4 + 3 conversions.
   Posee sur toutes les pages via une seule ligne dans le <head>.
   Suit cinq evenements : prise de rendez-vous, formulaire commence, formulaire envoye
   (uniquement en cas de succes), clic e-mail, clic telephone. */
(function(){
  var ID = 'G-RZM7GFLT2K';

  /* ---- 1. gtag.js ---- */
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('js', new Date());
  gtag('config', ID);

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
  (document.head || document.documentElement).appendChild(s);

  function envoie(nom, params){
    params = params || {};
    params.page_chemin = location.pathname;
    params.langue = (document.documentElement.getAttribute('lang') || '').slice(0,2);
    try { window.gtag('event', nom, params); } catch(e){}
  }

  /* ---- 2. Clic e-mail et clic telephone ---- */
  document.addEventListener('click', function(e){
    var cible = e.target;
    if(!cible || !cible.closest) return;
    var a = cible.closest('a[href]');
    if(!a) return;
    var href = a.getAttribute('href') || '';
    if(/^mailto:/i.test(href)){
      envoie('clic_email', { adresse: href.replace(/^mailto:/i,'').split('?')[0] });
    } else if(/^tel:/i.test(href)){
      envoie('clic_telephone', { numero: href.replace(/^tel:/i,'') });
    } else if(/calendar\.app\.google|appointment-schedule/i.test(href)){
      envoie('clic_rdv', { libelle: (a.textContent || '').replace(/\s+/g,' ').trim().slice(0,80) });
    }
  }, true);

  /* ---- 3. Formulaire envoye ----
     Les formulaires du site partent en fetch() vers Formspree sans recharger la page.
     On surveille donc la reponse de fetch : la conversion ne compte qu'en cas de succes. */
  var dernierFormulaire = null;

  document.addEventListener('submit', function(e){
    var f = e.target;
    if(!f || f.tagName !== 'FORM') return;
    dernierFormulaire = f;
    var action = f.getAttribute('action') || '';
    /* Formulaire classique (sans fetch) : on compte a l'envoi. */
    if(!/formspree\.io/i.test(action)) decrit(f, 'formulaire_envoye');
  }, true);

  function decrit(f, nom){
    var sujet = '';
    try {
      var champ = f && f.querySelector('[name="sujet"]');
      if(champ) sujet = String(champ.value || '').slice(0,100);
    } catch(err){}
    envoie(nom, {
      formulaire: (f && (f.id || f.getAttribute('name'))) || 'sans-id',
      sujet: sujet
    });
  }

  /* ---- 4. Formulaire commence ----
     Premiere saisie reelle dans un formulaire, comptee une seule fois par page.
     Compare au nombre d'envois, cela donne le taux d'abandon du formulaire. */
  var formulairesCommences = [];
  document.addEventListener('focusin', function(e){
    var champ = e.target;
    if(!champ || !champ.form) return;
    if(['INPUT','TEXTAREA','SELECT'].indexOf(champ.tagName) === -1) return;
    if(champ.type === 'hidden' || champ.type === 'submit') return;
    var f = champ.form;
    if(formulairesCommences.indexOf(f) !== -1) return;
    formulairesCommences.push(f);
    decrit(f, 'formulaire_commence');
  }, true);

  var fetchOrigine = window.fetch;
  if(typeof fetchOrigine === 'function'){
    window.fetch = function(entree, options){
      var url = '';
      try { url = (typeof entree === 'string') ? entree : (entree && entree.url) || ''; } catch(e){}
      var promesse = fetchOrigine.apply(this, arguments);
      if(/formspree\.io/i.test(url)){
        var f = dernierFormulaire;
        try {
          promesse.then(function(r){ if(r && r.ok) decrit(f, 'formulaire_envoye'); })
                  .catch(function(){});
        } catch(e){}
      }
      return promesse;
    };
  }
})();
