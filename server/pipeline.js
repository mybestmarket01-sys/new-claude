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
  diffuser(job.id, { type: "fin", job: resume(job) });
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

  if (job.mode !== "live") {
    /* Hors ligne : on ne prétend pas avoir cherché. On donne les liens à
       ouvrir soi-même, et les produits proches du catalogue Radar. */
    const proches = produitsProches(job.cible, categorie.id);
    return {
      horsLigne: true,
      categorie,
      note: "Mode hors ligne — liens de vérification fournis",
      aVerifier: src.plafondsPrix(job.cible),
      produitsProches: proches,
      synthese: "Aucune recherche web n'a été faite : l'application tourne sans clé API. " +
        "Les liens ci-dessus ouvrent les recherches à faire vous-même — Meta Ad Library " +
        "pour savoir qui fait déjà de la publicité, Jumia pour le plafond de prix, " +
        "Google Trends pour la tendance."
    };
  }

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

function produitsProches(cible, categorieId) {
  const t = String(cible).toLowerCase();
  const mots = t.split(/\s+/).filter(m => m.length > 3);
  return radar.produits
    .map(p => {
      const n = p.nom.toLowerCase();
      let s = mots.reduce((a, m) => a + (n.includes(m) ? 2 : 0), 0);
      if (categorieId && src.categoriser(p.nom).id === categorieId) s += 1;
      return { p, s };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map(x => ({ nom: x.p.nom, prix: x.p.prix, cout: x.p.cout, categorie: x.p.cat, note: x.p.note }));
}

/* ===========================================================================
   2. VALIDATION
   ======================================================================== */
async function etapeValidation(job) {
  const rech = job.resultats.recherche || {};

  /* Sans prix, on ne peut rien valider : on prend le milieu de la fenêtre COD
     et on le signale, plutôt que de refuser d'avancer. */
  let suppose = false;
  if (!job.prix) {
    const proche = (rech.produitsProches || [])[0];
    job.prix = proche ? proche.prix : 299;
    suppose = true;
  }
  if (!job.cout) {
    const proche = (rech.produitsProches || [])[0];
    job.cout = proche ? proche.cout : Math.round(job.prix * 0.35);
    suppose = true;
  }

  const nom = job.produitRetenu || job.cible;
  let criteres = null;

  if (job.mode === "live") {
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

  const produit = { nom, prix: job.prix, cout: job.cout, criteres: criteres || {} };
  const note = eco.scoreProduit(produit, job.hypotheses);
  job.economie = note.economie;
  job.scoreProduit = note.score;

  const alertes = [];
  if (suppose) {
    alertes.push({ niveau: "warn", texte: "Prix et coût partiellement supposés — remplacez-les par vos chiffres réels avant d'engager du budget." });
  }
  if (!note.economie.lancable) {
    alertes.push({
      niveau: "bad",
      texte: "CPA maximum de " + note.economie.cpaMax + " DH, sous le plancher de " +
        job.hypotheses.cplPlancher + " DH. Aucune campagne Meta ou TikTok au Maroc n'acquiert " +
        "une commande COD à ce prix de façon durable."
    });
  }
  if (!note.economie.dansLaFenetre) {
    alertes.push({ niveau: "warn", texte: "Prix hors de la fenêtre d'impulsion " + job.hypotheses.fenetreBasse + "–" + job.hypotheses.fenetreHaute + " DH." });
  }
  if (note.economie.multiple < 2) {
    alertes.push({ niveau: "warn", texte: "Multiple ×" + note.economie.multiple + " : sous ×2, le moindre imprévu efface la marge." });
  }
  if (criteres && criteres.risqueMajeur) {
    alertes.push({ niveau: "warn", texte: criteres.risqueMajeur });
  }

  const bloquant = !note.economie.lancable;

  /* Les deux sorties de secours quand l'économie ne passe pas. */
  const correctifs = bloquant ? {
    prixMinimum: eco.prixPourCpa(job.cout, job.hypotheses.cplPlancher + 20, job.hypotheses),
    coutMaximum: eco.coutMaxPour(job.prix, job.hypotheses.cplPlancher + 20, job.hypotheses)
  } : null;

  return {
    produit: nom, prix: job.prix, cout: job.cout, suppose,
    score: note.score, detail: note.parts, poids: note.poids,
    verdictScore: note.verdict,
    economie: note.economie,
    criteres: criteres || null,
    alertes,
    correctifs,
    verdict: bloquant ? "bloquant" : "poursuivre",
    raison: bloquant
      ? "À " + job.prix + " DH d'achat " + job.cout + " DH, il ne reste que " + note.economie.cpaMax +
        " DH de CPA maximum. Vendre à " + correctifs.prixMinimum + " DH, ou acheter à " +
        correctifs.coutMaximum + " DH — sinon la campagne perd de l'argent dès la première commande."
      : null,
    note: "Score " + note.score + "/100 · CPA max " + note.economie.cpaMax + " DH"
  };
}

/* ===========================================================================
   3. FOURNISSEURS
   ======================================================================== */
async function etapeFournisseurs(job) {
  const rech = job.resultats.recherche || {};
  const categorie = (rech.categorie && rech.categorie.id) || src.categoriser(job.cible).id;
  const nom = job.produitRetenu || job.cible;

  const routes = src.routesAchat({ nom, requete: nom }, { categorieId: categorie });
  const ancre = job.cout ? { sourceId: routes[0] && routes[0].id, cout: job.cout } : null;
  const chiffrees = src.estimerCouts(routes, ancre);

  const base = {
    categorie,
    routes: chiffrees.slice(0, 14),
    pistesContact: src.pistesContact(nom),
    annuaires: src.ANNUAIRES,
    plafonds: src.plafondsPrix(nom),
    methode: {
      coutRendu: "coût rendu = (prix unitaire × taux de change) + douane % + fret ÷ quantité + dédouanement ÷ quantité",
      cpaMax: "CPA max = [ livrées × (vente − coût rendu) − livrées × frais livraison − refusées × frais retour ] ÷ 100 commandes brutes",
      regles: [
        "Viser un multiple de ×2,5 minimum entre coût rendu et prix de vente.",
        "Demander toujours un échantillon payant avant le volume.",
        "Exiger une facture avec ICE — sans elle, aucun recours.",
        "Le MOQ n'est affiché nulle part : c'est la première question à poser.",
        "Vérifier l'existence légale sur Charika avant tout acompte."
      ]
    }
  };

  if (job.mode !== "live") {
    return Object.assign(base, {
      horsLigne: true,
      contacts: [],
      note: routes.length + " routes d'achat · contacts à qualifier vous-même",
      avertissement: "Sans clé API, aucun fournisseur n'a été cherché en direct. " +
        "Les liens de recherche ci-dessus ouvrent les annuaires où trouver les coordonnées réelles."
    });
  }

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
    note: contacts.length + " contacts trouvés · " + routes.length + " routes d'achat"
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
    return Object.assign(gabaritAdCopy(nom, job), {
      horsLigne: true,
      note: "Gabarits à remplir — sans clé API, le darija n'est pas rédigé"
    });
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

function gabaritAdCopy(nom, job) {
  const modele = {
    hookAr: "[hook darija — la douleur en une phrase]",
    hookFr: "[la même en français]",
    meta: {
      texte: "[accroche]\n\n[agitation : ce que ça coûte de ne rien faire]\n\n✅ [bénéfice 1]\n✅ [bénéfice 2]\n✅ [bénéfice 3]\n\nالثمن: " + job.prix + " درهم\n🚚 الدفع عند الاستلام\n📦 التوصيل ل جميع المدن\n\nسير دابا 👇",
      titre: nom.slice(0, 40) + " — " + job.prix + " DH",
      description: "Paiement à la livraison"
    },
    tiktok: { legende: "[légende darija]", hashtags: "#المغرب #cod #codmaroc #maroc" },
    pourquoi: "[à compléter]"
  };
  return {
    angles: { probleme: modele, preuve: modele, offre: modele },
    benefices: ["[bénéfice 1]", "[bénéfice 2]", "[bénéfice 3]"],
    beneficesAr: [],
    objections: [
      { question: "Je paie d'avance ?", reponse: "Non. Vous payez au livreur, après avoir ouvert le colis." },
      { question: "Et si ça ne me plaît pas ?", reponse: "Vous ouvrez, vous vérifiez, et vous ne payez que si ça vous convient." }
    ],
    promesse: "[promesse]", promesseAr: "",
    titreProduit: nom, titreProduitAr: "",
    specs: [], faq: []
  };
}

/* ===========================================================================
   5. SCRIPTS VIDÉO
   ======================================================================== */
async function etapeScripts(job) {
  const nom = job.produitRetenu || job.cible;
  const copy = job.copy || {};

  if (job.mode !== "live") {
    return { horsLigne: true, scripts: gabaritScripts(), note: "Trame de 6 beats à remplir" };
  }

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

function gabaritScripts() {
  const trame = {
    titre: "[titre]", duree: "30 s",
    beats: [
      { temps: "0-3 s", beat: "HOOK", image: "[ce qu'on filme — montrer, pas expliquer]", voix: "[darija]" },
      { temps: "3-8 s", beat: "AGITATION", image: "[ce que ça coûte de ne rien faire]", voix: "[darija]" },
      { temps: "8-16 s", beat: "DÉMO", image: "[le produit en action, plan serré]", voix: "[darija]" },
      { temps: "16-22 s", beat: "PREUVE", image: "[avant/après ou test]", voix: "[darija]" },
      { temps: "22-26 s", beat: "LEVÉE D'OBJECTION", image: "[la démonstration qui répond au doute]", voix: "[darija]" },
      { temps: "26-30 s", beat: "CTA", image: "[carton prix + badge paiement à la livraison]", voix: "الدفع عند الاستلام" }
    ],
    materiel: ["Téléphone", "Lumière naturelle", "Le produit"]
  };
  return { probleme: trame, preuve: trame, offre: trame };
}

/* ===========================================================================
   6. VISUELS
   ======================================================================== */
async function etapeVisuels(job) {
  const nom = job.produitRetenu || job.cible;
  const copy = job.copy || {};
  const angles = copy.angles || {};

  const brief = {
    produit: copy.titreProduit || nom,
    boutique: job.boutique,
    prix: job.prix,
    prixBarre: job.prix ? Math.round(job.prix * 1.8) : null,
    devise: job.devise,
    benefices: copy.benefices || [],
    badge: "الدفع عند الاستلام 🚚",
    hooks: {
      probleme: { ar: (angles.probleme || {}).hookAr, fr: (angles.probleme || {}).hookFr },
      preuve:   { ar: (angles.preuve   || {}).hookAr, fr: (angles.preuve   || {}).hookFr },
      offre:    { ar: (angles.offre    || {}).hookAr, fr: (angles.offre    || {}).hookFr }
    }
  };

  const jeu = visuals.jeuComplet(brief);
  jeu.forEach(c => store.ecrireLivrable(job.id, c.fichier, c.svg));

  return {
    creas: jeu.map(c => ({
      fichier: c.fichier, angle: c.angle, angleNom: c.angleNom, angleQuoi: c.angleQuoi,
      format: c.format, formatNom: c.formatNom, largeur: c.largeur, hauteur: c.hauteur
    })),
    note: jeu.length + " créas (3 angles × 3 formats)",
    conversion: "Les fichiers sont en SVG : le bouton « PNG » de l'interface les convertit aux dimensions exactes attendues par Meta et TikTok."
  };
}

/* ===========================================================================
   7. LANDING PAGE
   ======================================================================== */
async function etapeLanding(job) {
  const nom = job.produitRetenu || job.cible;
  const copy = job.copy || {};
  const creas = ((job.resultats.visuels || {}).creas || [])
    .filter(c => c.format === "feed")
    .map(c => ({ fichier: c.fichier, angle: c.angleNom }));

  const html = landing.page({
    titre: copy.titreProduit || nom,
    titreAr: copy.titreProduitAr || "",
    produit: nom,
    prix: job.prix,
    prixBarre: job.prix ? Math.round(job.prix * 1.8) : null,
    devise: job.devise,
    boutique: job.boutique,
    whatsapp: job.whatsapp,
    promesse: copy.promesse || "",
    promesseAr: copy.promesseAr || "",
    benefices: copy.benefices || [],
    beneficesAr: copy.beneficesAr || [],
    objections: copy.objections || [],
    specs: copy.specs || [],
    faq: copy.faq || [],
    creas
  });

  const info = store.ecrireLivrable(job.id, "landing.html", html);
  return {
    fichier: info.fichier, octets: info.octets,
    note: Math.round(info.octets / 1024) + " Ko, autonome",
    aFaire: job.whatsapp
      ? null
      : "Aucun numéro WhatsApp n'est configuré : la page enregistre les commandes dans le navigateur au lieu de les envoyer. Renseignez-le dans Réglages avant de lancer la campagne."
  };
}

/* ===========================================================================
   8. STRATÉGIE
   ======================================================================== */
async function etapeStrategie(job) {
  const e = job.economie || eco.economie({ prix: job.prix, cout: job.cout }, job.hypotheses);
  const budget = eco.planBudget(e);
  const nom = job.produitRetenu || job.cible;

  const socle = {
    economie: e,
    budget,
    regles: [
      { quand: "CPA réel ≤ " + budget.seuilScaling + " DH", alors: "Rentable — augmenter le budget de 20 % par jour, pas plus.", ton: "good" },
      { quand: "CPA réel entre " + budget.seuilScaling + " et " + budget.seuilCoupure + " DH", alors: "À l'équilibre — changer de créa avant de toucher au budget.", ton: "warn" },
      { quand: "CPA réel > " + budget.seuilCoupure + " DH", alors: "En perte — couper l'ensemble de publicités, garder l'angle qui a le meilleur taux de clic.", ton: "bad" },
      { quand: "Taux de confirmation < 70 %", alors: "Le problème est le délai de rappel, pas la publicité : viser un contact sous 2 h.", ton: "warn" },
      { quand: "Refus > 40 % sur une ville", alors: "Vérifier le transporteur et le délai sur cette ville avant d'y remettre du budget.", ton: "warn" }
    ]
  };

  if (job.mode !== "live") {
    return Object.assign(socle, {
      horsLigne: true,
      plan: planParDefaut(budget, e),
      note: "Plan standard · CPA cible " + budget.seuilScaling + " DH"
    });
  }

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

  return Object.assign(socle, r.donnees || {}, {
    note: "CPA cible " + budget.seuilScaling + " DH · budget test " + budget.budgetTest3Jours + " DH"
  });
}

function planParDefaut(budget, e) {
  return {
    phases: [
      { nom: "Test d'angles", duree: "3 jours", budget: budget.budgetJourTest + " DH/jour",
        quoi: "Trois ensembles de publicités, un par angle, même audience large.",
        onRegarde: ["Taux de clic sur le lien", "CPA par angle", "Taux de confirmation"],
        decision: "Garder l'angle sous " + budget.seuilScaling + " DH de CPA, couper les autres." },
      { nom: "Sélection", duree: "3 jours", budget: budget.budgetJourTest + " DH/jour",
        quoi: "Trois créas du même angle gagnant, formats différents.",
        onRegarde: ["CPA par créa", "Taux de livraison réel"],
        decision: "Garder les deux meilleures créas." },
      { nom: "Montée en budget", duree: "7 à 14 jours", budget: "+20 % par jour maximum",
        quoi: "On augmente lentement, on ne duplique pas la campagne qui marche.",
        onRegarde: ["CPA après montée", "Stock disponible", "Taux de refus par ville"],
        decision: "Couper dès que le CPA dépasse " + budget.seuilCoupure + " DH." },
      { nom: "Entretien", duree: "en continu", budget: "stable",
        quoi: "Une nouvelle créa par semaine pour retarder l'usure, retargeting sur les visiteurs.",
        onRegarde: ["Fréquence", "CPA sur 7 jours glissants"],
        decision: "Renouveler la créa dès que la fréquence dépasse 2,5." }
    ],
    ciblage: {
      meta: "Maroc, 25–55 ans, ciblage large (pas d'intérêt) — l'algorithme trouve mieux que nous sur un marché de cette taille. Placement automatique.",
      tiktok: "Maroc, 18–45 ans, large. Le contenu fait le ciblage.",
      exclusions: "Exclure les acheteurs des 30 derniers jours des campagnes d'acquisition."
    },
    calendrier: [
      { jour: "J-2", quoi: "Stock vérifié, échantillon reçu et testé, landing page en ligne" },
      { jour: "J-1", quoi: "Script de confirmation prêt, WhatsApp branché, transporteur confirmé" },
      { jour: "J1", quoi: "Lancement des 3 angles, on ne touche à rien pendant 48 h" },
      { jour: "J3", quoi: "Premier arbitrage : on coupe les angles au-dessus du CPA maximum" },
      { jour: "J7", quoi: "Premier bilan livraison réelle — c'est lui qui dit la vérité, pas le gestionnaire de publicités" }
    ],
    avantLancement: [
      "Échantillon reçu et testé soi-même",
      "Stock suffisant pour 3 jours au rythme espéré",
      "Script d'appel de confirmation écrit, en darija",
      "Transporteur confirmé sur les villes visées",
      "Landing page testée sur téléphone, pas sur ordinateur"
    ],
    risques: [
      { risque: "Rupture de stock pendant que la publicité tourne", parade: "Plafonner le budget au stock disponible, pas à l'ambition." },
      { risque: "Taux de refus qui explose sur une ville", parade: "Suivre le refus par ville dès la première semaine et couper la ville, pas la campagne." },
      { risque: "Le gestionnaire de publicités affiche un ROAS positif alors que la boutique perd", parade: "Ne juger que sur les commandes livrées et encaissées." }
    ],
    objectif: "Un angle validé sous " + budget.seuilScaling + " DH de CPA, avec un taux de livraison au-dessus de 70 %, et du stock pour tenir la montée."
  };
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
