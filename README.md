# Poste COD

Application locale qui réunit vos applications COD et transforme un produit — ou une
catégorie — en campagne complète, sans intervention entre les étapes.

Vous tapez « tapis chauffant pliable pour plats ». Vous récupérez : la recherche marché,
la validation économique, les fournisseurs en gros avec leurs contacts, les annonces Meta
et TikTok en darija, trois scripts vidéo, neuf créas aux formats des régies, une landing
page COD bilingue prête à mettre en ligne, et le plan de lancement chiffré.

---

## Deux éditions

L'application existe sous deux formes. Même interface, mêmes calculs, mêmes livrables —
elles ne diffèrent que par ce qui tourne derrière.

### Édition HTML — rien à installer

**`dist/poste-cod.html`** : un seul fichier de 826 Ko. Vous le double-cliquez, il s'ouvre
dans votre navigateur, il marche. Les sept applications sont dedans, la chaîne complète
tourne dans l'onglet, vos données restent sur votre machine.

C'est l'édition à prendre si vous voulez simplement vous en servir.

Ce qu'elle fait : les huit étapes, les neuf créas, la landing page, les 41 routes d'achat,
le modèle économique, le plan de lancement. Un bouton **Tout télécharger (.zip)** rend la
campagne entière en une archive.

Ce qu'elle ne fait pas : la recherche web et la rédaction en darija, qui demandent une clé
API — et une clé API n'a pas sa place dans une page web qu'on s'envoie par WhatsApp.

Pour la reconstruire après une modification du code :

```bash
npm run build:html
```

### Édition Node — la chaîne complète

```bash
npm install          # une fois
npm start            # puis ouvrir http://localhost:4321
```

Elle ajoute ce que le navigateur seul ne peut pas faire : la recherche web, la rédaction
en darija, les vrais contacts fournisseurs, les photos produit Higgsfield, et l'API Make.

```bash
cp .env.example .env       # puis renseigner ANTHROPIC_API_KEY
npm start
```

Sans clé, l'édition Node se comporte exactement comme l'édition HTML.

Le bandeau en haut à droite dit toujours où vous en êtes : **Édition HTML**,
**Hors ligne**, ou **En direct**.

| | HTML | Node |
|---|---|---|
| Installation | aucune | `npm install` |
| Les 7 applications | ✓ | ✓ |
| Modèle économique, score, verdict | ✓ | ✓ |
| 41 routes d'achat | ✓ | ✓ |
| 9 créas + landing page | ✓ | ✓ |
| Plan de lancement chiffré | ✓ | ✓ |
| Archive .zip de la campagne | ✓ | ✓ |
| Recherche web du marché | — | avec clé |
| Ad copies et scripts en darija | — | avec clé |
| Contacts fournisseurs réels | — | avec clé |
| Photos produit Higgsfield | — | avec clé |
| Webhook Make | envoi sans retour | avec accusé |
| Stockage | navigateur | `data/` sur disque |

---

## Les applications réunies

Les six applications que vous aviez sont servies telles quelles, sans une ligne réécrite.
Une septième — Espion COD — a été construite ici, parce qu'elle existait comme base de
données mais pas comme application.

| | Application | Ce qu'elle fait |
|---|---|---|
| 🛰️ | **Espion COD** | Boutiques concurrentes suivies, produits repérés, ventes mesurées par relevés successifs |
| 🎯 | **Radar Produit COD** | 45 candidats notés sur huit critères, chiffrés sur neuf marchés |
| 🧭 | **Comptoir COD** | 41 sources d'approvisionnement, de Derb Omar à l'usine de Yiwu |
| 📊 | **Pilote COD** | Commandes, campagnes, marges — ce que la boutique a réellement encaissé |
| 📦 | **Rayon COD** | Stock, entrées, sorties, alertes de réapprovisionnement |
| 💬 | **Registre WhatsApp** | Les commandes qui arrivent en discussion, extraites en tableau |
| 🚀 | **Lancement COD** | Le dossier de campagne de septembre — cinq produits, cinq packs |

### Ce qui les relie

Trois liens, du plus simple au plus utile.

**Le stockage partagé.** Tout est servi depuis `http://localhost:4321`, donc depuis la même
origine. Les applications d'origine enregistrent leur état dans `localStorage` : servies
ainsi, elles partagent ce stockage au lieu d'avoir chacune le sien. Aucune n'a eu besoin
d'être modifiée pour ça.

**La passerelle.** Le serveur injecte une pastille dans chaque application. Elle fait deux
choses : ramener à l'atelier, et envoyer un produit à l'orchestrateur. Sélectionnez le nom
d'un produit dans le Radar, cliquez « Lancer une campagne », la chaîne démarre dessus.

**Le modèle économique commun.** Le Radar et le Pilote calculaient chacun leur CPA maximum,
dans leur coin. Ici il n'existe qu'une fois, dans `server/economics.js`, et c'est cette
version qui décide partout — score du Radar, verdict de l'orchestrateur, budgets de
campagne. Vos hypothèses se règlent à un seul endroit.

---

## L'orchestrateur

Huit étapes, dans cet ordre. Chacune se sert de ce que la précédente a trouvé.

| | Étape | Ce qu'elle produit |
|---|---|---|
| 1 | **Recherche marché** | Demande, concurrence, plafond de prix, prix de gros — cherché sur le web |
| 2 | **Validation produit** | Score sur 8 critères + CPA maximum. **Peut arrêter la chaîne** |
| 3 | **Fournisseurs** | Marketplaces B2B, annuaires, grossistes — avec leurs coordonnées publiées |
| 4 | **Ad copies** | 3 angles × (Meta + TikTok), en darija, avec bénéfices et objections |
| 5 | **Scripts vidéo** | 3 storyboards de 30 secondes, seconde par seconde |
| 6 | **Visuels** | 9 créas SVG : 3 angles × Feed 1:1, Portrait 4:5, Story 9:16 — plus 3 photos produit si Higgsfield est branché |
| 7 | **Landing page** | Page COD bilingue, formulaire 3 champs, sortie WhatsApp |
| 8 | **Stratégie** | Budget, plafonds d'enchère, 4 phases, règles de coupure |

### L'étape 2 peut dire non

C'est le point de la validation. Un produit dont le CPA maximum tombe sous le plancher
ne mérite pas qu'on lui fabrique des visuels : la chaîne s'arrête et explique pourquoi,
avec les deux sorties possibles.

> À 199 DH d'achat 150 DH, il ne reste que 6 DH de CPA maximum.
> Vendre à 269 DH, ou acheter à 80 DH — sinon la campagne perd de l'argent
> dès la première commande.

C'est exactement le verdict que votre dossier du 4 septembre portait sur le set de pots
à épices. Le modèle le retrouve tout seul.

### Une étape qui échoue n'arrête pas les autres

Si la rédaction tombe, les visuels, la landing page et la stratégie se font quand même,
avec ce qu'on a. Mieux vaut sept livrables sur huit qu'un écran d'erreur.

---

## Le modèle économique

Sur 100 commandes brutes : **85 confirmées, 70 livrées et encaissées, 15 refusées**,
35 DH de livraison par colis livré, 25 DH par refus.

```
CPA maximum = [ 70 × (vente − coût) − 70 × 35 − 15 × 25 ] ÷ 100
```

Le CPA maximum est un **plafond**, pas un objectif : au-delà, le produit perd de l'argent
dès la première commande. Le CPA cible est fixé à 70 % du plafond.

Ce modèle reproduit au dirham près les cinq produits chiffrés dans votre dossier
Lancement COD du 4 septembre :

| Produit | Prix / coût | CPA max calculé | CPA max publié |
|---|---|---|---|
| Set 12 bocaux 1700 ml | 249 / 135 | 51,55 DH | 51,5 DH |
| Set 12 pots à épices | 199 / 150 | 6,05 DH | 6,0 DH |
| Pistolet de massage | 349 / 180 | 90,05 DH | 90,0 DH |
| Appareil photo enfant | 329 / 140 | 104,05 DH | 104,0 DH |
| Tondeuse lame T | 229 / 100 | 62,05 DH | 62,0 DH |

C'est le test de régression le plus important de la suite : si le modèle dérive, `npm test`
le dit avant qu'une campagne ne parte sur de faux plafonds d'enchère.

**Réglez vos vrais taux dès que vous les avez.** Les 85 % et 70 % sont les valeurs du
marché. Dès que Pilote COD a plus de dix commandes terminées, remplacez-les dans Réglages :
tout le reste suit.

---

## Connecteurs

Deux liens vers l'extérieur, tous les deux facultatifs. L'application marche entièrement
sans eux ; l'écran **Réglages** dit toujours lesquels sont branchés.

### Make — l'automatisation

Le webhook reçoit trois évènements :

| Évènement | Quand | Ce qu'il porte |
|---|---|---|
| `campagne.terminee` | la chaîne aboutit | produit, prix, coût, score, CPA max et cible, liste des livrables |
| `campagne.arretee` | la validation dit non | les mêmes chiffres, plus `raisonArret` |
| `commande.recue` | quelqu'un commande sur une landing page | nom, téléphone normalisé, ville, produit, prix |

Créez un scénario Make démarrant par **Webhooks → Custom webhook**, collez son URL dans
Réglages, et vos dix scénarios existants reçoivent les commandes sans rien changer.

Le point important : **la landing page poste directement au webhook**, pas au serveur local.
Elle continue donc de fonctionner une fois hébergée ailleurs. L'envoi utilise `keepalive`,
sinon la navigation vers WhatsApp annulerait la requête en vol et la commande serait perdue.

Le jeton d'API est facultatif — il ne sert qu'à lister et déclencher vos scénarios depuis
l'atelier.

### Higgsfield — les photos produit

Une photo par angle (problème, preuve, offre), en plus des neuf créas SVG. Les prompts
interdisent explicitement le texte incrusté : le prix et le hook restent sur les créas SVG,
où ils se corrigent sans regénérer l'image. Quand des photos existent, la galerie de la
landing page les utilise à la place des créas.

**La documentation Higgsfield décrit deux contrats concurrents** et ne s'accorde pas sur
l'hôte selon la page consultée. Les deux sont implémentés : profil `v2`
(`api.higgsfield.ai`, en-tête `Authorization: Key id:secret`) et profil `v1`
(`platform.higgsfield.ai`, en-têtes `hf-api-key` / `hf-secret`). L'URL de l'image est
retrouvée en parcourant la réponse plutôt qu'à un chemin fixe, pour survivre à un
changement de forme.

Une génération qui échoue n'arrête pas la campagne : les créas SVG sont produites de toute
façon, et l'échec est affiché.

### Où mettre les clés

L'environnement l'emporte toujours sur les réglages. Saisies dans l'interface, les clés
vont dans `data/reglages.json`, en clair sur le disque — hors dépôt Git, mais elles partent
avec un export de données. Pour les garder à l'écart, mettez-les dans `.env`.

## Ce que l'application ne fait pas

- **Elle n'appelle aucun fournisseur.** Les coordonnées viennent de pages publiques et
  d'annuaires. Ce sont des pistes à qualifier, jamais des fournisseurs validés. Vérifiez
  l'existence légale sur Charika avant tout acompte.
- **Elle n'invente pas de prix.** Sans prix constaté quelque part, aucune route d'achat
  n'est chiffrée. Les indices sont des ordres de grandeur de filière, pas des devis.
- **Elle ne mesure pas les ventes des concurrents toute seule.** Espion COD mesure une
  pente entre deux relevés que vous faites. Un seul relevé ne dit rien, et l'application
  l'affiche comme tel plutôt que de sortir un chiffre.
- **Elle ne publie rien.** Aucune campagne n'est créée chez Meta ou TikTok, aucune page
  n'est mise en ligne. Vous récupérez des fichiers.
- **Les connecteurs n'ont pas été essayés en conditions réelles.** Make et Higgsfield sont
  écrits d'après leur documentation et couverts par des tests contre un serveur factice qui
  rejoue les formes de réponse documentées. Le premier appel avec de vraies clés, ce sera
  chez vous — d'où le bouton « Tester » à côté de chaque connecteur.

---

## Les fichiers produits

Chaque campagne écrit son dossier dans `data/campagnes/<id>/` :

```
campagne.json              le dossier complet : chiffres, sources, résultats de chaque étape
landing.html               la page, autonome — déposez-la telle quelle chez un hébergeur
crea-probleme-feed.svg     1080 × 1080
crea-probleme-carre.svg    1080 × 1350
crea-probleme-story.svg    1080 × 1920
crea-preuve-*.svg          les mêmes, angle preuve
crea-offre-*.svg           les mêmes, angle offre
```

Les créas sont en SVG : le bouton « PNG » de l'interface les convertit aux dimensions
exactes dans le navigateur. Le texte reste vectoriel, donc modifiable dans n'importe quel
éditeur sans tout refaire.

La landing page n'a aucune dépendance externe. Elle valide le numéro marocain avant envoi
(06 ou 07 + 8 chiffres) et pousse la commande dans WhatsApp — le canal réel de confirmation
au Maroc. **Renseignez votre WhatsApp dans Réglages** avant de lancer une campagne, sinon
la page se contente de garder les commandes dans le navigateur.

---

## Organisation du code

```
server/
  economics.js    le modèle COD — CPA max, score, budgets. Le cœur.
  horsligne.js    la chaîne sans réseau — partagée entre les deux éditions
  sources.js      les 41 sources du Comptoir, rendues interrogeables
  claude.js       accès à Claude : recherche web, rédaction, lecture des réponses
  pipeline.js     l'orchestrateur — les 8 étapes et leur enchaînement
  visuals.js      les créas SVG
  landing.js      la landing page COD
  connecteurs.js  Make et Higgsfield — webhook, API, génération d'images
  store.js        le magasin JSON partagé entre les applications
  index.js        le serveur local
  data/           comptoir.json (41 sources), radar.json (45 produits, 9 marchés)

public/           l'atelier : le shell, l'API locale, la passerelle injectée
outils/           le constructeur de l'édition HTML
dist/             poste-cod.html — l'édition autonome, régénérable
apps/             les sept applications, servies telles quelles
data/             vos données — hors dépôt
test/run.js       60 tests, sans réseau ni clé API
```

### Une seule chaîne, deux éditions

`server/horsligne.js` contient les huit étapes en fonctions pures : pas de disque, pas de
réseau, pas de Node. L'orchestrateur du serveur l'appelle, et le navigateur aussi. Le
constructeur refuse d'assembler l'édition HTML si un module partagé se met à dépendre de
`fs`, de `path` ou de `process.env` — la construction échoue plutôt que de livrer une page
qui plante à l'ouverture.

L'interface, elle, ne sait pas qui lui répond : `public/app.js` appelle `/api/…`, et selon
l'édition c'est le serveur Node ou `public/api-locale.js` qui répond. Le même écran, les
deux moteurs.

### Tests

```bash
npm test
```

92 tests, aucun appel sortant. Le mode direct est couvert avec un faux client Claude :
on vérifie que la chaîne sait lire les réponses, rattraper un JSON mal formé, faire
circuler ce qu'une étape a trouvé vers la suivante, et continuer quand une étape tombe.

Les connecteurs tournent contre un serveur factice local qui rejoue les réponses
documentées de Make et des deux contrats Higgsfield — y compris les cas d'échec :
webhook en panne, jeton refusé, crédits épuisés, tâche rejetée.

L'édition HTML est reconstruite à chaque exécution, et chaque bloc `<script>` de la page
produite est compilé. C'est exactement le défaut qui a cassé la première construction :
un `</script>` littéral dans `landing.js` fermait la balise et coupait le programme en
deux. Un test vérifie aussi que `dist/poste-cod.html` n'a pas pris de retard sur les
sources.

---

## Réglages

Dans l'atelier, onglet **Réglages** :

- **Nom de la boutique** — apparaît sur les créas et la landing page
- **WhatsApp** — format international sans `+`, ex. `212612345678`
- **Taux de confirmation / de livraison** — les vôtres dès que vous les connaissez
- **Frais de livraison / de refus** — ce que votre transporteur facture réellement
- **Fenêtre COD** — 149–499 DH par défaut, la zone qui convertit au Maroc
- **Plancher de CPA** — sous ce CPA maximum, la chaîne refuse de lancer
- **Connecteurs** — webhook Make, identifiants Higgsfield, avec un bouton « Tester » chacun

Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | active la recherche web et la rédaction |
| `POSTE_COD_MODEL` | `claude-opus-5` | modèle utilisé par l'orchestrateur |
| `MAKE_WEBHOOK_URL` | — | webhook qui reçoit campagnes et commandes |
| `MAKE_API_TOKEN` | — | facultatif : lister et déclencher les scénarios |
| `MAKE_ZONE` | `eu2` | zone Make (`eu1`, `eu2`, `us1`…) |
| `HIGGSFIELD_KEY_ID` / `HIGGSFIELD_KEY_SECRET` | — | photos produit |
| `HIGGSFIELD_PROFIL` | `v2` | `v2` ou `v1` selon vos identifiants |
| `PORT` | `4321` | port du serveur local |
| `POSTE_COD_DATA` | `./data` | dossier de données |

Le serveur n'écoute que sur `127.0.0.1` : rien n'est exposé au réseau local.
