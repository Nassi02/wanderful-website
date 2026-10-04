# Version anglaise du site (/en/)

Ce dossier commence par `_` : GitHub Pages ne le publie pas.

- `pages.json` : correspondance page FR -> page EN
- `translations.json` : chaque texte FR -> sa traduction EN
- `overrides/` : remplacements propres à l'anglais (textes JS, vidéos EN, contenu différent du FR)
- `i18n.py` :
  - `extract` -> liste dans `todo.json` les textes FR modifiés/nouveaux sans traduction
  - `build` -> régénère toutes les pages `/en/` depuis les pages FR (les overrides sont réappliqués)
  - `sitemap` -> ajoute les pages EN + hreflang dans sitemap.xml
  - `link-fr` -> ajoute hreflang + bouton FR | EN dans le <head> des pages FR

Synchroniser après des retouches FR : extract -> traduire todo.json dans translations.json -> build -> sitemap.
Ne jamais modifier les fichiers /en/ à la main : utiliser overrides/ (sinon écrasé au prochain build).
