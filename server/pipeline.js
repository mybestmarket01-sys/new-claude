"use strict";
/* =============================================================================
   L'orchestrateur.

   Vous choisissez un produit ou une catégorie. Il enchaîne, dans cet ordre :

     1. Recherche        — ce que le marché dit du produit, en direct
     2. Validation       — score sur 8 critères + économie COD, verdict
     3. Fournisseurs     — routes d'achat, prix de gros, contacts à appeler
     4. Ad copies        — annonces Meta et TikTok, 3 angles, en darija
     5. Scripts vidéo    — 3 storyboards de 30 secondes, seconde par seconde
     6. Visuels          — 9 créas SVG aux formats des régies
     7. Landing page     — page COD bilingue prête à mettre en ligne
     8. Stratégie        — budget, plafonds d'enchère, phases, règles de coupure

   L'étape 2 peut arrêter la chaîne : un produit dont le CPA maximum est sous
   le plancher ne mérite pas qu'on lui fabrique des visuels. C'est le point de
   la validation — dire non tôt coûte moins cher que dire non après la pub.

   Chaque étape a deux modes. Avec une clé API, Claude cherche sur le web et
   rédige. Sans clé, l'étape se rabat sur la base intégrée et les gabarits :
   moins riche, mais l'application reste utilisable et le dit franchement.
   ========================================================================== */

const eco = require("./economics");
const claude = require("./claude");
const src = require("./sources");
const visuals = require("./visuals");
const landing = require("./landing");
const store = require("./store");
const connecteurs = require("./connecteurs");
const hl = require("./horsligne");

const radar = require("./data/radar.json");

/* ---------------------------------------------------------------------------
   Registre des travaux en cours
   ------------------------------------------------------------------------ */
const travaux = new Map();
const abonnes = new Map();   // jobId -> Set de fonctions

const ETAPES = [
  { id: "recherche",    nom: "Recherche marché",      verbe: "Recherche en cours" },
  { id: "validation",   nom: "Validation produit",    verbe: "Validation économique" },
  { id: "fournisseurs", nom: "Fournisseurs en gros",  verbe: "Recherche fournisseurs" },
  { id: "adcopy",       nom: "Ad copies",             verbe: "Rédaction des annonces" },
  { id: "scripts",      nom: "Scripts vidéo",         verbe: "Écriture des scripts" },
  { id: "visuels",      nom: "Visuels publicitaires", verbe: "Production des créas" },
  { id: "landing",      nom: "Landing page",          verbe: "Construction de la page" },
  { id: "strategie",    nom: "Stratégie de campagne", verbe: "Plan de lancement" }
];

function diffuser(jobId, evenement) {
  const s = abonnes.get(jobId);
  if (!s) return;
  s.forEach(fn => { try { fn(evenement); } catch (err) { /* abonné parti */ } });
}

function abonner(jobId, fn) {
  if (!abonnes.has(jobId)) abonnes.set(jobId, new Set());
  abonnes.get(jobId).add(fn);
  return () => {
    const s = abonnes.get(jobId);
    if (s) { s.delete(fn); if (!s.size) abonnes.delete(jobId); }
  };
}

function majEtape(job, id, champs) {
  const e = job.etapes.find(x => x.id === id);
  if (!e) return;
  Object.assign(e, champs);
  diffuser(job.id, { type: "etape", etape: e, job: resume(job) });
}

function resume(job) {
  return {
    id: job.id, cible: job.cible, type: job.type, statut: job.statut,
    mode: job.mode, debut: job.debut, fin: job.fin || null,
    erreur: job.erreur || null,
    etapes: job.etapes.map(e => ({
      id: e.id, nom: e.nom, verbe: e.verbe, statut: e.statut,
      duree: e.duree || null, note: e.note || null, erreur: e.erreur || null
    })),
    livrables: job.livrables || []
  };
}

/* ---------------------------------------------------------------------------
   Lancement
   ------------------------------------------------------------------------ */
function lancer(demande) {
  const d = demande || {};
  const reglages = store.reglages();
  const id = store.uid("camp");

  const job = {
    id,
    cible: String(d.cible || "").trim(),
    type: d.type === "categorie" ? "categorie" : "produit",
    prix: d.prix != null ? Number(d.prix) : null,
    cout: d.cout != null ? Number(d.cout) : null,
    boutique: d.boutique || reglages.boutique,
    whatsapp: d.whatsapp || reglages.whatsapp || "",
    hypotheses: Object.assign({}, reglages.hypotheses, d.hypotheses || {}),
    devise: reglages.symbole || "DH",
    modele: reglages.modele,
    mode: claude.disponible() ? "live" : "hors-ligne",
    statut: "en-cours",
    debut: new Date().toISOString(),
    etapes: ETAPES.map(e => Object.assign({ statut: "attente" }, e)),
    resultats: {},
    livrables: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    sources: []
  };

  if (!job.cible) throw new Error("Indiquez un produit ou une catégorie.");

  travaux.set(id, job);
  /* On rend la main tout de suite : l'interface suit la progression en SSE. */
  executer(job).catch(err => {
    job.statut = "echec";
    job.erreur = claude.messageErreur(err);
    job.fin = new Date().toISOString();
    diffuser(id, { type: "fin", job: resume(job) });
  });

  return resume(job);
}

async function executer(job) {
  const suite = [
    ["recherche",    etapeRecherche],
    ["validation",   etapeValidation],
    ["fournisseurs", etapeFournisseurs],
    ["adcopy",       etapeAdCopy],
    ["scripts",      etapeScripts],
    ["visuels",      etapeVisuels],
    ["landing",      etapeLanding],
    ["strategie",    etapeStrategie]
  ];

  for (const [id, fn] of suite) {
    const t0 = Date.now();
    majEtape(job, id, { statut: "en-cours" });
    try {
      const res = await fn(job);
      job.resultats[id] = res;
      majEtape(job, id, {
        statut: "fait",
        duree: Date.now() - t0,
        note: res && res.note ? res.note : null
      });

      /* Garde-fou : un produit qui ne supporte pas la publicité n'a pas
         besoin de créas. On s'arrête et on explique pourquoi. */
      if (id === "validation" && res.verdict === "bloquant" && !job.forcer) {
        job.statut = "arrete";
        job.arret = res.raison;
        job.fin = new Date().toISOString();
        job.etapes.filter(e => e.statut === "attente")
          .forEach(e => majEtape(job, e.id, { statut: "sautee", note: "Arrêté à la validation" }));
        enregistrer(job);
        await notifierMake(job);
        diffuser(job.id, { type: "fin", job: resume(job) });
        return;
      }
    } catch (err) {
      majEtape(job, id, {
        statut: "echec",
        duree: Date.now() - t0,
        erreur: claude.messageErreur(err)
      });
      /* Une étape qui échoue ne fait pas tomber la chaîne : les suivantes
         travaillent avec ce qu'elles ont. Mieux vaut sept livrables sur huit
         qu'un écran d'erreur. */
      job.resultats[id] = { echec: true, erreur: claude.messageErreur(err) };
    }
  }

  job.statut = "fini";
  job.fin = new Date().toISOString();
  enregistrer(job);
  await notifierMake(job);
  diffuser(job.id, { type: "fin", job: resume(job) });
}

/* Prévient Make qu'une campagne s'est terminée — ou s'est arrêtée, et pourquoi.
   Un webhook injoignable ne doit pas faire échouer la campagne : on note le
   résultat de l'envoi dans le dossier et on continue. */
async function notifierMake(job) {
  const reglages = store.reglages();
  if (!connecteurs.etat(reglages).make.webhook) return;

  const v = job.resultats.validation || {};
  const e = v.economie || {};
  const r = await connecteurs.pousserMake(reglages,
    job.statut === "arrete" ? "campagne.arretee" : "campagne.terminee", {
      campagne: job.id,
      cible: job.cible,
      produit: job.produitRetenu || job.cible,
      boutique: job.boutique,
      mode: job.mode,
      prix: job.prix,
      cout: job.cout,
      score: v.score != null ? v.score : null,
      verdict: v.verdict || null,
      cpaMax: e.cpaMax != null ? e.cpaMax : null,
      cpaCible: e.cpaCible != null ? e.cpaCible : null,
      netParLivree: e.netParLivree != null ? e.netParLivree : null,
      raisonArret: job.arret || null,
      livrables: store.livrables(job.id).map(f => f.fichier)
    });
  job.make = r;
}

function enregistrer(job) {
  const dossier = { id: job.id, cible: job.cible, type: job.type, mode: job.mode,
    debut: job.debut, fin: job.fin, statut: job.statut, arret: job.arret || null,
    boutique: job.boutique, hypotheses: job.hypotheses,
    resultats: job.resultats, usage: job.usage, sources: job.sources };
  store.ecrireLivrable(job.id, "campagne.json", JSON.stringify(dossier, null, 1));
  job.livrables = store.livrables(job.id);

  store.fusionner("campagnes", "id", {
    id: job.id, cible: job.cible, type: job.type, statut: job.statut,
    mode: job.mode, debut: job.debut, fin: job.fin,
    score: (job.resultats.validation && job.resultats.validation.score) || null,
    verdict: (job.resultats.validation && job.resultats.validation.verdict) || null,
    prix: job.prix, cout: job.cout
  });
}

function comptabiliser(job, r) {
  if (r && r.usage) {
    job.usage.input_tokens += r.usage.input_tokens || 0;
    job.usage.output_tokens += r.usage.output_tokens || 0;
  }
  if (r && r.sources && r.sources.length) {
    r.sources.forEach(s => { if (!job.sources.some(x => x.url === s.url)) job.sources.push(s); });
  }
}

const CONTEXTE = `Tu travailles pour une boutique e-commerce marocaine qui vend en COD
(paiement à la livraison). Le marché : le client paie en espèces au livreur, il peut
refuser le colis, et environ 15 % des commandes confirmées reviennent. La fenêtre de
prix qui convertit est 149–499 MAD. Le client type est marocain, parle darija, achète
sur Facebook et TikTok depuis son téléphone.

Règles absolues :
- Ne jamais inventer un prix, un contact, un chiffre de vente ou un avis. Si tu ne l'as
  pas trouvé, écris "non trouvé" — c'est une information utile, pas un échec.
- Le darija s'écrit en caractères arabes, pas en translittération latine.
- Pas de promesse de santé, pas de superlatif invérifiable.
- Écris comme on parle à un commerçant, pas comme une brochure.`;

/* ===========================================================================
   1. RECHERCHE
   ======================================================================== */
async function etapeRecherche(job) {
  const categorie = src.categoriser(job.cible);

  if (job.mode !== "live") return hl.recherche(job);

  const prompt = `${CONTEXTE}

Recherche sur le web l'état du marché pour : « ${job.cible} »${job.type === "categorie" ? " (c'est une catégorie, pas un produit précis)" : ""}, au Maroc, en ${new Date().getFullYear()}.

Cherche et rapporte :
1. La demande : tendance TikTok/Google, saisonnalité, qui achète.
2. La concurrence au Maroc : qui vend déjà (boutiques, Jumia, Avito), à quel prix public.
3. Le plafond de prix : le prix public le plus bas trouvé au Maroc.
4. Les prix de gros : ce que tu trouves sur eGRO, JemlaMaroc, Alibaba, 1688 (donne les prix vus, avec la source).
5. Les risques : réglementation (cosmétique, complément, électrique), fragilité, SAV.
${job.type === "categorie" ? "6. Les 3 à 5 produits les plus prometteurs de cette catégorie pour du COD marocain, avec pour chacun un prix de vente et un coût d'achat estimés." : ""}

Réponds en JSON :
{
  "synthese": "3 à 5 phrases : ce qu'il faut retenir avant d'engager du budget",
  "demande": {"tendance": "...", "saison": "...", "cible": "..."},
  "concurrence": [{"acteur":"...","prix":"...","source":"url"}],
  "plafondPrix": {"valeur": nombre ou null, "ou": "...", "source": "url"},
  "prixGros": [{"source":"...","prix":"...","url":"...","note":"..."}],
  "risques": ["..."],
  "prixVenteConseille": nombre ou null,
  "coutAchatConstate": nombre ou null,
  "candidats": [{"nom":"...","prix":nombre,"cout":nombre,"pourquoi":"..."}]
}`;

  const r = await claude.demanderJson({ prompt, recherche: true, maxRecherches: 10, maxTokens: 24000, modele: job.modele });
  comptabiliser(job, r);

  const d = r.donnees || {};
  /* Ce que la recherche a trouvé alimente le reste de la chaîne. */
  if (job.prix == null && d.prixVenteConseille) job.prix = Number(d.prixVenteConseille);
  if (job.cout == null && d.coutAchatConstate) job.cout = Number(d.coutAchatConstate);
  if (job.type === "categorie" && Array.isArray(d.candidats) && d.candidats.length) {
    const meilleur = d.candidats[0];
    job.produitRetenu = meilleur.nom;
    if (job.prix == null) job.prix = Number(meilleur.prix);
    if (job.cout == null) job.cout = Number(meilleur.cout);
  }

  return Object.assign({ categorie, sources: r.sources, note: (r.sources || []).length + " sources consultées" }, d);
}

/* ===========================================================================
   2. VALIDATION
   ======================================================================== */
async function etapeValidation(job) {
  const rech = job.resultats.recherche || {};
  let criteres = null;

  /* En direct, Claude note les six critères de jugement ; le calcul lui-même
     reste celui de horsligne.js, identique aux deux modes. */
  if (job.mode === "live") {
    const nom = job.produitRetenu || job.cible;
    const prompt = `${CONTEXTE}

Note le produit « ${nom} » sur les six critères du produit gagnant COD marocain.
Voici ce que la recherche a trouvé : ${JSON.stringify({
      synthese: rech.synthese, demande: rech.demande, concurrence: rech.concurrence, risques: rech.risques
    }).slice(0, 6000)}

Chaque note va de 0 à 10. Sois sévère : une note de 8 doit se justifier.

Réponds en JSON :
{
  "wow": note (effet wow, se démontre en 3 secondes de vidéo),
  "pb": note (résout un vrai problème quotidien),
  "ads": note (preuve que ça se vend déjà en publicité au Maroc),
  "conc": note (SATURATION locale : 10 = marché rouge vif, 0 = personne),
  "log": note (léger, compact, incassable),
  "nouv": note (introuvable en magasin physique),
  "justifications": {"wow":"une phrase","pb":"...","ads":"...","conc":"...","log":"...","nouv":"..."},
  "risqueMajeur": "le seul risque qui peut tuer ce lancement, ou null"
}`;
    try {
      const r = await claude.demanderJson({ prompt, maxTokens: 8000, effort: "medium", modele: job.modele });
      comptabiliser(job, r);
      criteres = r.donnees;
    } catch (err) {
      criteres = null;   // on retombera sur les notes neutres
    }
  }

  const res = hl.validation({
    cible: job.cible, produitRetenu: job.produitRetenu,
    prix: job.prix, cout: job.cout,
    hypotheses: job.hypotheses, criteres, recherche: rech
  });

  /* La validation a pu suppléer prix et coût : la suite de la chaîne travaille
     avec ces valeurs-là. */
  job.prix = res.prix;
  job.cout = res.cout;
  job.economie = res.economie;
  job.scoreProduit = res.score;
  return res;
}

/* ===========================================================================
   3. FOURNISSEURS
   ======================================================================== */
async function etapeFournisseurs(job) {
  const nom = job.produitRetenu || job.cible;
  const base = hl.fournisseurs({
    cible: job.cible, produitRetenu: job.produitRetenu,
    cout: job.cout, recherche: job.resultats.recherche
  });
  const categorie = base.categorie;

  if (job.mode !== "live") return base;

  /* En direct, on remplace l'avertissement par de vrais contacts. */
  delete base.horsLigne;
  delete base.avertissement;

  const prompt = `${CONTEXTE}

Trouve des fournisseurs en gros réels pour « ${nom} » destinés à une boutique COD marocaine.

Cherche sur le web, dans cet ordre de priorité :
1. Marketplaces de gros marocaines : egro.ma, jemlamaroc.com, evollume.com, 3awninl9a.com
2. Annuaires professionnels marocains : kerix.net, ma.kompass.com, telecontact.ma, charika.ma, pages-maroc.com
3. Grossistes et importateurs marocains ayant un site ou une page
4. À défaut, sourcing international : alibaba.com, 1688.com, made-in-china.com

Pour chaque fournisseur trouvé, rapporte UNIQUEMENT ce qui est réellement publié sur la page.
N'invente aucun numéro, aucune adresse, aucun prix. Si un champ n'est pas publié, mets null.

Réponds en JSON :
{
  "contacts": [{
    "nom": "raison sociale",
    "type": "marketplace | grossiste | fabricant | importateur | annuaire",
    "ville": "... ou null",
    "adresse": "... ou null",
    "telephone": "... ou null",
    "whatsapp": "... ou null",
    "email": "... ou null",
    "siteWeb": "... ou null",
    "prixConstate": "prix vu, avec l'unité, ou null",
    "prixNombre": nombre en MAD ou null,
    "moq": "... ou null",
    "source": "l'URL exacte où l'information a été lue",
    "fiabilite": "haute | moyenne | à qualifier",
    "note": "ce qu'il faut savoir avant d'appeler"
  }],
  "meilleurPrixGros": nombre en MAD ou null,
  "synthese": "3 phrases : la filière de ce produit au Maroc, et par où commencer",
  "pieges": ["les sites qui se présentent comme grossistes mais vendent au détail, etc."]
}`;

  const r = await claude.demanderJson({ prompt, recherche: true, maxRecherches: 12, maxTokens: 24000, modele: job.modele });
  comptabiliser(job, r);
  const d = r.donnees || {};
  const contacts = Array.isArray(d.contacts) ? d.contacts : [];

  /* Les contacts trouvés entrent dans le carnet partagé : la prochaine
     campagne sur la même catégorie les retrouvera sans les rechercher. */
  contacts.forEach(c => {
    if (!c || !c.nom) return;
    store.fusionner("fournisseurs", "nom", {
      nom: c.nom, type: c.type || null, ville: c.ville || null, adresse: c.adresse || null,
      telephone: c.telephone || null, whatsapp: c.whatsapp || null, email: c.email || null,
      siteWeb: c.siteWeb || null, source: c.source || null, fiabilite: c.fiabilite || "à qualifier",
      categories: categorie ? [categorie] : [], note: c.note || null,
      vuLe: new Date().toISOString(), campagne: job.id
    });
  });

  /* Un meilleur prix de gros trouvé change l'économie : on revalide. */
  let revalidation = null;
  if (d.meilleurPrixGros && job.prix) {
    const nouveau = Number(d.meilleurPrixGros);
    if (nouveau > 0 && Math.abs(nouveau - job.cout) > 1) {
      const avant = job.economie ? job.economie.cpaMax : null;
      const apres = eco.economie({ prix: job.prix, cout: nouveau }, job.hypotheses);
      revalidation = {
        coutAvant: job.cout, coutApres: nouveau,
        cpaMaxAvant: avant, cpaMaxApres: apres.cpaMax,
        lancable: apres.lancable,
        message: nouveau > job.cout
          ? "Le prix de gros réel est plus élevé que l'estimation : le CPA maximum tombe de " +
            avant + " à " + apres.cpaMax + " DH."
          : "Le prix de gros réel est plus bas que l'estimation : le CPA maximum monte de " +
            avant + " à " + apres.cpaMax + " DH."
      };
      job.cout = nouveau;
      job.economie = apres;
    }
  }

  return Object.assign(base, {
    contacts,
    meilleurPrixGros: d.meilleurPrixGros || null,
    synthese: d.synthese || null,
    pieges: d.pieges || [],
    revalidation,
    sources: r.sources,
    note: contacts.length + " contacts trouvés · " + base.routes.length + " routes d'achat"
  });
}

/* ===========================================================================
   4. AD COPIES
   ======================================================================== */
async function etapeAdCopy(job) {
  const nom = job.produitRetenu || job.cible;
  const e = job.economie || eco.economie({ prix: job.prix, cout: job.cout }, job.hypotheses);
  const rech = job.resultats.recherche || {};

  if (job.mode !== "live") {
    return hl.adcopy({ cible: job.cible, produitRetenu: job.produitRetenu, prix: job.prix });
  }

  const prompt = `${CONTEXTE}

Écris les annonces publicitaires pour « ${nom} », vendu ${job.prix} MAD (coût d'achat ${job.cout} MAD).
Contexte marché : ${String(rech.synthese || "non recherché").slice(0, 1500)}

Produis TROIS angles distincts :
- "probleme" : on montre la douleur avant le produit. C'est l'angle du trafic froid.
- "preuve"   : démonstration, avant/après, chiffre vérifiable. Pour la deuxième vague.
- "offre"    : prix, pack, urgence honnête. Retargeting uniquement.

Pour chaque angle, le texte principal Meta fait 80 à 150 mots, en darija (caractères arabes),
structuré : accroche qui pique → agitation → bénéfices en puces avec émojis → prix → mention
paiement à la livraison → appel à l'action. Le hook fait une seule phrase courte.

Réponds en JSON :
{
  "angles": {
    "probleme": {
      "hookAr": "une phrase en darija", "hookFr": "sa traduction",
      "meta": {"texte": "le corps de l'annonce en darija", "titre": "≤40 car.", "description": "≤30 car."},
      "tiktok": {"legende": "en darija avec 2-3 émojis", "hashtags": "8 à 10 hashtags dont #المغرب #cod"},
      "pourquoi": "en une phrase, pourquoi cet angle marche pour ce produit"
    },
    "preuve": { … même structure … },
    "offre": { … même structure … }
  },
  "benefices": ["5 bénéfices en français, concrets, pas d'adjectifs creux"],
  "beneficesAr": ["les mêmes en darija"],
  "objections": [{"question":"l'objection telle que le client la formule","reponse":"la réponse, factuelle"}],
  "promesse": "une phrase française qui résume ce que le produit change",
  "promesseAr": "la même en darija",
  "titreProduit": "un titre de fiche produit qui vend, en français",
  "titreProduitAr": "le même en darija",
  "specs": [{"cle":"...","valeur":"..."}],
  "faq": [{"q":"...","r":"..."}]
}`;

  const r = await claude.demanderJson({ prompt, maxTokens: 24000, modele: job.modele });
  comptabiliser(job, r);
  const d = r.donnees || {};

  job.copy = d;
  return Object.assign({ cpaMax: e.cpaMax }, d, {
    note: Object.keys(d.angles || {}).length + " angles rédigés"
  });
}

/* ===========================================================================
   5. SCRIPTS VIDÉO
   ======================================================================== */
async function etapeScripts(job) {
  const nom = job.produitRetenu || job.cible;
  const copy = job.copy || {};

  if (job.mode !== "live") return hl.scripts();

  const prompt = `${CONTEXTE}

Écris trois scripts vidéo de 30 secondes pour « ${nom} », un par angle publicitaire
(problème, preuve, offre). Format vertical, tourné au téléphone, sans budget de production.

Chaque script est découpé en beats avec un minutage précis. Pour chaque beat :
- le temps (ex. "0-3 s")
- le nom du beat en majuscules (HOOK, AGITATION, DÉMO, PREUVE, LEVÉE D'OBJECTION, CTA)
- ce qu'on filme, concrètement — un cadreur doit pouvoir le tourner sans poser de question
- la voix off ou le texte à l'écran, en darija

Les trois premières secondes décident de tout : le premier beat doit montrer, pas expliquer.

Réponds en JSON :
{
  "scripts": {
    "probleme": {"titre":"...","duree":"30 s","beats":[{"temps":"0-3 s","beat":"HOOK","image":"...","voix":"en darija"}],"materiel":["ce qu'il faut pour tourner"]},
    "preuve": { … },
    "offre": { … }
  },
  "conseilTournage": ["3 à 5 conseils concrets pour ce produit précis"]
}`;

  const r = await claude.demanderJson({ prompt, maxTokens: 20000, modele: job.modele });
  comptabiliser(job, r);
  const d = r.donnees || {};
  return Object.assign(d, { note: Object.keys(d.scripts || {}).length + " scripts de 30 s" });
}

/* ===========================================================================
   6. VISUELS
   ======================================================================== */
async function etapeVisuels(job) {
  const nom = job.produitRetenu || job.cible;
  const copy = job.copy || {};

  const v = hl.visuels({
    cible: job.cible, produitRetenu: job.produitRetenu, copy: job.copy,
    boutique: job.boutique, prix: job.prix, devise: job.devise
  });
  v.jeu.forEach(c => store.ecrireLivrable(job.id, c.fichier, c.svg));

  const sortie = v.resume;
  const jeu = v.jeu;

  /* Higgsfield, quand il est branché : une photo par angle, en plus des créas.
     Les SVG portent le texte et restent corrigeables ; les photos portent le
     produit. Un échec de génération n'empêche pas la campagne d'aboutir. */
  const reglages = store.reglages();
  if (connecteurs.etat(reglages).higgsfield.actif) {
    const contexte = [
      copy.promesse || null,
      (job.resultats.recherche && job.resultats.recherche.synthese) || null
    ].filter(Boolean).join(" ").slice(0, 400);

    const photos = await connecteurs.visuelsProduit(reglages, {
      produit: copy.titreProduit || nom,
      contexte,
      format: "feed"
    });

    photos.forEach(p => {
      if (!p.ok) return;
      store.ecrireLivrable(job.id, p.fichier, p.octets);
    });

    sortie.photos = photos.map(p => ({
      angle: p.angle, ok: p.ok, fichier: p.ok ? p.fichier : null,
      octets: p.ok ? p.octets.length : null, erreur: p.erreur || null,
      largeur: p.ok ? p.dimensions.l : null, hauteur: p.ok ? p.dimensions.h : null
    }));

    const reussies = sortie.photos.filter(p => p.ok).length;
    sortie.note = jeu.length + " créas SVG + " + reussies + " photo" + (reussies > 1 ? "s" : "") + " Higgsfield";
    if (reussies < photos.length) {
      sortie.avertissementPhotos = (photos.length - reussies) + " génération(s) Higgsfield en échec — " +
        "les créas SVG sont là quand même.";
    }
  }

  return sortie;
}

/* ===========================================================================
   7. LANDING PAGE
   ======================================================================== */
async function etapeLanding(job) {
  const cnx = connecteurs.config(store.reglages());
  const r = hl.landingPage({
    cible: job.cible, produitRetenu: job.produitRetenu, copy: job.copy,
    visuels: job.resultats.visuels, prix: job.prix, devise: job.devise,
    boutique: job.boutique, whatsapp: job.whatsapp,
    webhookUrl: cnx.make.webhook || ""
  });
  const info = store.ecrireLivrable(job.id, "landing.html", r.html);
  return Object.assign({}, r.resume, { octets: info.octets });
}

/* ===========================================================================
   8. STRATÉGIE
   ======================================================================== */
async function etapeStrategie(job) {
  const socle = hl.strategie({
    prix: job.prix, cout: job.cout, hypotheses: job.hypotheses, economie: job.economie
  });
  if (job.mode !== "live") return socle;

  const e = socle.economie, budget = socle.budget;
  const nom = job.produitRetenu || job.cible;

  const prompt = `${CONTEXTE}

Bâtis le plan de lancement de « ${nom} » au Maroc.

Chiffres arrêtés, à ne pas recalculer :
- Prix de vente ${job.prix} MAD, coût d'achat ${job.cout} MAD
- CPA maximum (point mort) ${e.cpaMax} MAD, CPA cible ${e.cpaCible} MAD
- Marge nette par colis livré ${e.netParLivree} MAD
- Budget de test conseillé ${budget.budgetJourTest} MAD/jour sur 3 jours

Écris un plan en quatre phases (test d'angles, sélection, montée en budget, entretien),
avec pour chaque phase la durée, le budget, ce qu'on regarde et la décision qui suit.
Ajoute le ciblage Meta et TikTok, le calendrier de la semaine, et ce qu'il faut préparer
côté logistique et confirmation avant d'allumer la première publicité.

Réponds en JSON :
{
  "phases": [{"nom":"...","duree":"...","budget":"...","quoi":"...","onRegarde":["..."],"decision":"..."}],
  "ciblage": {"meta":"...","tiktok":"...","exclusions":"..."},
  "calendrier": [{"jour":"J1","quoi":"..."}],
  "avantLancement": ["ce qu'il faut avoir réglé avant la première publicité"],
  "risques": [{"risque":"...","parade":"..."}],
  "objectif": "une phrase : à quoi ressemble un lancement réussi pour ce produit"
}`;

  const r = await claude.demanderJson({ prompt, maxTokens: 20000, modele: job.modele });
  comptabiliser(job, r);

  /* Le plan rédigé remplace le plan standard ; l'économie et les règles de
     coupure, elles, restent celles du calcul. */
  return Object.assign(socle, r.donnees || {}, {
    horsLigne: false,
    note: "CPA cible " + Math.round(budget.seuilScaling) + " DH · budget test " + budget.budgetTest3Jours + " DH"
  });
}

/* ---------------------------------------------------------------------------
   Accès
   ------------------------------------------------------------------------ */
function etat(id) {
  const job = travaux.get(id);
  return job ? resume(job) : null;
}

function complet(id) {
  const job = travaux.get(id);
  if (job) {
    return { id: job.id, cible: job.cible, type: job.type, mode: job.mode, statut: job.statut,
      arret: job.arret || null, debut: job.debut, fin: job.fin || null, boutique: job.boutique,
      prix: job.prix, cout: job.cout, hypotheses: job.hypotheses,
      resultats: job.resultats, usage: job.usage, sources: job.sources,
      livrables: store.livrables(job.id) };
  }
  /* Le travail n'est plus en mémoire (redémarrage) : on relit le dossier. */
  const brut = store.lireLivrable(id, "campagne.json");
  if (!brut) return null;
  try {
    const d = JSON.parse(brut.toString("utf8"));
    d.livrables = store.livrables(id);
    return d;
  } catch (err) { return null; }
}

function lister() {
  const enMemoire = Array.from(travaux.values()).map(resume);
  const enregistrees = store.liste("campagnes");
  const vus = new Set(enMemoire.map(j => j.id));
  return enMemoire.concat(enregistrees.filter(c => !vus.has(c.id)));
}

module.exports = { ETAPES, lancer, etat, complet, lister, abonner };
