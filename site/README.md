# Site public de Veto

Site statique (HTML, CSS, JS), sans framework ni étape de construction, déployé sur Vercel.
Il ne dépend d'aucune ressource externe : polices, scripts et styles sont servis par le site lui-même.
Il ne pose aucun cookie et ne charge aucun traceur.

## Structure

| Chemin | Rôle |
|---|---|
| `index.html` | `/` : la landing (texte de `docs/site/maquette-site.html`) |
| `demo.html` | `/demo` : « Voir Veto sur vos propres cas », avec le bouton de rendez-vous et l'e-mail de contact |
| `demo-console.html` | `/demo-console` : console de démonstration (société fictive Aubert Industrie), avec un bandeau permanent |
| `mentions-legales.html`, `confidentialite.html` | Pages légales |
| `404.html` | Page introuvable, servie par Vercel pour toute URL inconnue |
| `config.js` | **Seul fichier de réglage** : `RDV_URL` et `CONTACT_EMAIL` |
| `assets/site.css`, `assets/console.css` | Styles (aucun style en ligne : la CSP les interdit) |
| `assets/console.js` | Console de démo, entièrement dans le navigateur, données fictives |
| `assets/contact.js` | Remplit le bouton de rendez-vous et l'adresse de contact depuis `config.js` |
| `fonts/` | Geist 1.7.2 et Geist Mono, avec leur licence SIL OFL 1.1 (`fonts/LICENSE.txt`) |
| `favicon.svg`, `og.png` | Logo table ronde, image Open Graph 1200 × 630 |
| `robots.txt`, `sitemap.xml` | Référencement |
| `vercel.json` | URL propres et en-têtes de sécurité (CSP, nosniff, Referrer-Policy, Permissions-Policy) |
| `tools/check.mjs` | Contrôles avant commit (`make site`) |
| `tools/serve.mjs` | Prévisualisation locale qui applique `vercel.json` |
| `tools/og.html` | Source de `og.png` |

`.vercelignore` exclut du déploiement `tools/`, ce README, `package.json` et `package-lock.json`.

## Prévisualisation locale

La plus fidèle à Vercel (URL propres, CSP, page 404), sans dépendance :

```sh
node site/tools/serve.mjs        # http://127.0.0.1:4173
```

Autres possibilités, sans les en-têtes de `vercel.json` :

```sh
npx serve site                   # URL propres gérées : /demo fonctionne
python3 -m http.server -d site   # pas d'URL propres : ouvrir /demo.html, /demo-console.html…
```

## Contrôles

```sh
make site                        # ou : cd site && npm run check
```

`tools/check.mjs` vérifie :

- les liens internes (et leurs ancres) : ils pointent tous vers une page existante ;
- les URL `http(s)://` : seules sont admises l'URL de production (lue dans `sitemap.xml`), `RDV_URL` et les espaces de noms SVG et sitemap ;
- l'absence de `<script>` en ligne, de `<style>`, d'attribut `style` et de gestionnaire `on…=`, y compris dans le HTML produit par les scripts ;
- les formulations interdites, dans tout `site/` ;
- `lang="fr"`, `<title>`, meta description et Open Graph sur chaque page ;
- dans la console de démo, le bandeau et la pastille « En construction » de chaque fonction concernée ;
- les en-têtes de `vercel.json` et les dimensions de `og.png`.

Il liste aussi les valeurs encore à compléter (lignes `info`), sans échouer.

## Valeurs à compléter

1. **`config.js`** :
   - `RDV_URL` est le lien public de l'outil de prise de rendez-vous, en `https`.
   - `CONTACT_EMAIL` est l'adresse de contact.

   Tant qu'une valeur pointe vers `a-completer.invalid`, le site la traite comme absente. Le bouton « Prendre rendez-vous » est alors masqué et un message d'attente le remplace. L'adresse affiche « adresse en cours de publication » et le bouton « Copier » est masqué.
2. **`mentions-legales.html`**, champs marqués `À COMPLÉTER` :
   - nom ou raison sociale de l'éditeur ;
   - forme juridique et capital ;
   - adresse ;
   - immatriculation (RCS ou SIREN, le cas échéant) ;
   - directeur ou directrice de la publication.
3. **URL de production** : remplacer `https://a-completer.invalid` partout. Les fichiers concernés sont `sitemap.xml`, `robots.txt` et la balise `og:image` des six pages :

   ```sh
   grep -rl 'https://a-completer.invalid' site --include='*.html' --include='*.xml' --include='*.txt' \
     | xargs sed -i 's|https://a-completer.invalid|https://VOTRE-DOMAINE|g'
   ```

   Retirer ensuite les commentaires `À COMPLÉTER` correspondants, puis lancer `make site`.

## Semgrep : innerHTML de la console de démo

Semgrep signale les `innerHTML` et les gabarits HTML de `assets/console.js`. Ces alertes sont informatives : l'étape semgrep ne bloque ni `make check` ni la CI. Elles ne correspondent pas à une injection possible :

- toutes les données affichées sont des constantes du script (société, factures, incidents fictifs), passées par `esc()` avant insertion ;
- aucune saisie n'est réinjectée dans la page : le champ de recherche sert seulement à filtrer, et sa valeur n'est jamais affichée ;
- c'est une page de démonstration, sans compte, sans serveur et sans donnée réelle, sous une CSP qui refuse tout script en ligne.

La réécriture de la console sans `innerHTML` est reportée.

## Réglages Vercel

| Réglage | Valeur |
|---|---|
| Root Directory | `site` |
| Framework Preset | Other |
| Build Command | vide |
| Output Directory | `.` |
| Branche de production | `main` |

Aucune variable d'environnement n'est nécessaire.

### Déploiements de prévisualisation non indexés

Vercel ajoute déjà `X-Robots-Tag: noindex` aux déploiements hors production : URL de prévisualisation des branches et anciennes productions. Rien n'est donc ajouté dans `vercel.json`.

**Exception :** un domaine personnalisé rattaché à une branche autre que `main` ne reçoit pas cet en-tête. Si l'équipe en crée un, il faut ajouter dans `vercel.json` une règle `headers` conditionnée par `has: [{ "type": "host", "value": "<ce domaine>" }]`, avec `X-Robots-Tag: noindex`.

À vérifier après le premier déploiement :

```sh
curl -sI https://<url-de-preview>.vercel.app | grep -i x-robots-tag   # attendu : noindex
curl -sI https://<domaine-de-production>    | grep -i x-robots-tag   # attendu : rien
```

## Régénérer `og.png`

Ouvrir `tools/og.html` dans un navigateur sans interface, en fenêtre de 1200 × 630, puis enregistrer la capture sous `og.png`. Par exemple, avec Playwright : `page.setViewportSize({ width: 1200, height: 630 })`, puis `page.screenshot({ path: "site/og.png" })`.

## Règles de contenu

Le texte reprend la maquette sans ajouter de promesse. La section « Avancement » et les conditions des chiffres restent mot pour mot. Les noms de la console sont ceux de la société fictive. `make site` refuse les formulations interdites.
