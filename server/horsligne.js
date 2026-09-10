"use strict";
/* =============================================================================
   La chaîne hors ligne — sans réseau, sans disque, sans Node.

   Chaque étape est une fonction pure : elle reçoit un contexte, elle rend un
   résultat. Rien n'écrit de fichier, rien n'appelle personne. C'est ce qui
   permet à ce module de tourner aux deux endroits sans être écrit deux fois :

     - dans le serveur Node, où l'orchestrateur enchaîne les étapes et range
       les livrables dans data/campagnes/ ;
     - dans l'édition HTML autonome, où le navigateur enchaîne les mêmes
       étapes et propose les mêmes livrables au téléchargement.

   Si un jour ces deux chaînes divergent, ce sera visible ici, pas dans deux
   fichiers qui se ressemblent.
   ========================================================================== */

const eco = require("./economics");
const src = require("./sources");
const visuals = require("./visuals");
const landing = require("./landing");
const radar = require("./data/radar.json");

/* ---------------------------------------------------------------------------
   1. Recherche — sans clé API, on ne prétend pas avoir cherché.
   On donne les liens à ouvrir soi-même et les produits proches du catalogue.
   ------------------------------------------------------------------------ */
function recherche(ctx) {
  const categorie = src.categoriser(ctx.cible);
  return {
    horsLigne: true,
    categorie,
    note: "Mode hors ligne — liens de vérification fournis",
    aVerifier: src.plafondsPrix(ctx.cible),
    produitsProches: produitsProches(ctx.cible, categorie.id),
    synthese: "Aucune recherche web n'a été faite : l'application tourne sans clé API. " +
      "Les liens ci-dessus ouvrent les recherches à faire vous-même — Meta Ad Library " +
      "pour savoir qui fait déjà de la publicité, Jumia pour le plafond de prix, " +
      "Google Trends pour la tendance."
  };
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

/* ---------------------------------------------------------------------------
   2. Validation — le seul endroit qui peut arrêter la chaîne.

   Rend aussi `prix` et `cout` : sans chiffres fournis, l'étape les suppose et
   le dit, plutôt que de refuser d'avancer.
   ------------------------------------------------------------------------ */
function validation(ctx) {
  const rech = ctx.recherche || {};
  let prix = ctx.prix, cout = ctx.cout, suppose = false;

  if (!prix) {
    const proche = (rech.produitsProches || [])[0];
    prix = proche ? proche.prix : 299;
    suppose = true;
  }
  if (!cout) {
    const proche = (rech.produitsProches || [])[0];
    cout = proche ? proche.cout : Math.round(prix * 0.35);
    suppose = true;
  }

  const nom = ctx.produitRetenu || ctx.cible;
  const note = eco.scoreProduit({ nom, prix, cout, criteres: ctx.criteres || {} }, ctx.hypotheses);
  const e = note.economie;

  const alertes = [];
  if (suppose) {
    alertes.push({ niveau: "warn", texte: "Prix et coût partiellement supposés — remplacez-les par vos chiffres réels avant d'engager du budget." });
  }
  if (!e.lancable) {
    alertes.push({
      niveau: "bad",
      texte: "CPA maximum de " + e.cpaMax + " DH, sous le plancher de " +
        e.hypotheses.cplPlancher + " DH. Aucune campagne Meta ou TikTok au Maroc n'acquiert " +
        "une commande COD à ce prix de façon durable."
    });
  }
  if (!e.dansLaFenetre) {
    alertes.push({ niveau: "warn", texte: "Prix hors de la fenêtre d'impulsion " + e.hypotheses.fenetreBasse + "–" + e.hypotheses.fenetreHaute + " DH." });
  }
  if (e.multiple < 2) {
    alertes.push({ niveau: "warn", texte: "Multiple ×" + e.multiple + " : sous ×2, le moindre imprévu efface la marge." });
  }
  if (ctx.criteres && ctx.criteres.risqueMajeur) {
    alertes.push({ niveau: "warn", texte: ctx.criteres.risqueMajeur });
  }

  const bloquant = !e.lancable;
  const correctifs = bloquant ? {
    prixMinimum: eco.prixPourCpa(cout, e.hypotheses.cplPlancher + 20, ctx.hypotheses),
    coutMaximum: eco.coutMaxPour(prix, e.hypotheses.cplPlancher + 20, ctx.hypotheses)
  } : null;

  return {
    produit: nom, prix, cout, suppose,
    score: note.score, detail: note.parts, poids: note.poids,
    verdictScore: note.verdict,
    economie: e,
    criteres: ctx.criteres || null,
    alertes, correctifs,
    verdict: bloquant ? "bloquant" : "poursuivre",
    raison: bloquant
      ? "À " + prix + " DH d'achat " + cout + " DH, il ne reste que " + e.cpaMax +
        " DH de CPA maximum. Vendre à " + correctifs.prixMinimum + " DH, ou acheter à " +
        correctifs.coutMaximum + " DH — sinon la campagne perd de l'argent dès la première commande."
      : null,
    note: "Score " + note.score + "/100 · CPA max " + e.cpaMax + " DH"
  };
}

/* ---------------------------------------------------------------------------
   3. Fournisseurs — les 41 routes du Comptoir, classées et chiffrées.
   ------------------------------------------------------------------------ */
function fournisseurs(ctx) {
  const rech = ctx.recherche || {};
  const categorie = (rech.categorie && rech.categorie.id) || src.categoriser(ctx.cible).id;
  const nom = ctx.produitRetenu || ctx.cible;

  const routes = src.routesAchat({ nom, requete: nom }, { categorieId: categorie });
  const ancre = ctx.cout ? { sourceId: routes[0] && routes[0].id, cout: ctx.cout } : null;

  return {
    categorie,
    routes: src.estimerCouts(routes, ancre).slice(0, 14),
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
    },
    horsLigne: true,
    contacts: [],
    note: routes.length + " routes d'achat · contacts à qualifier vous-même",
    avertissement: "Sans clé API, aucun fournisseur n'a été cherché en direct. " +
      "Les liens de recherche ci-dessus ouvrent les annuaires où trouver les coordonnées réelles."
  };
}

/* ---------------------------------------------------------------------------
   4. Ad copies — la structure, pas la rédaction.
   ------------------------------------------------------------------------ */
function adcopy(ctx) {
  const nom = ctx.produitRetenu || ctx.cible;
  const prix = ctx.prix;

  const modele = {
    hookAr: "[hook darija — la douleur en une phrase]",
    hookFr: "[la même en français]",
    meta: {
      texte: "[accroche]\n\n[agitation : ce que ça coûte de ne rien faire]\n\n" +
        "✅ [bénéfice 1]\n✅ [bénéfice 2]\n✅ [bénéfice 3]\n\n" +
        "الثمن: " + prix + " درهم\n🚚 الدفع عند الاستلام\n📦 التوصيل ل جميع المدن\n\nسير دابا 👇",
      titre: String(nom).slice(0, 40) + " — " + prix + " DH",
      description: "Paiement à la livraison"
    },
    tiktok: { legende: "[légende darija]", hashtags: "#المغرب #cod #codmaroc #maroc" },
    pourquoi: "[à compléter]"
  };

  return {
    horsLigne: true,
    angles: { probleme: modele, preuve: modele, offre: modele },
    benefices: ["[bénéfice 1]", "[bénéfice 2]", "[bénéfice 3]"],
    beneficesAr: [],
    objections: [
      { question: "Je paie d'avance ?", reponse: "Non. Vous payez au livreur, après avoir ouvert le colis." },
      { question: "Et si ça ne me plaît pas ?", reponse: "Vous ouvrez, vous vérifiez, et vous ne payez que si ça vous convient." }
    ],
    promesse: "[promesse]", promesseAr: "",
    titreProduit: nom, titreProduitAr: "",
    specs: [], faq: [],
    note: "Gabarits à remplir — sans clé API, le darija n'est pas rédigé"
  };
}

/* ---------------------------------------------------------------------------
   5. Scripts vidéo — la trame en six beats.
   ------------------------------------------------------------------------ */
function scripts() {
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
  return {
    horsLigne: true,
    scripts: { probleme: trame, preuve: trame, offre: trame },
    note: "Trame de 6 beats à remplir"
  };
}

/* ---------------------------------------------------------------------------
   6. Visuels — 9 créas. Rend les fichiers, ne les écrit pas.
   ------------------------------------------------------------------------ */
function visuels(ctx) {
  const nom = ctx.produitRetenu || ctx.cible;
  const copy = ctx.copy || {};
  const angles = copy.angles || {};

  const jeu = visuals.jeuComplet({
    produit: copy.titreProduit || nom,
    boutique: ctx.boutique,
    prix: ctx.prix,
    prixBarre: ctx.prix ? Math.round(ctx.prix * 1.8) : null,
    devise: ctx.devise || "DH",
    benefices: copy.benefices || [],
    badge: "الدفع عند الاستلام 🚚",
    hooks: {
      probleme: { ar: (angles.probleme || {}).hookAr, fr: (angles.probleme || {}).hookFr },
      preuve:   { ar: (angles.preuve   || {}).hookAr, fr: (angles.preuve   || {}).hookFr },
      offre:    { ar: (angles.offre    || {}).hookAr, fr: (angles.offre    || {}).hookFr }
    }
  });

  return {
    jeu,   // { fichier, svg, … } — l'appelant décide où ça va
    resume: {
      creas: jeu.map(c => ({
        fichier: c.fichier, angle: c.angle, angleNom: c.angleNom, angleQuoi: c.angleQuoi,
        format: c.format, formatNom: c.formatNom, largeur: c.largeur, hauteur: c.hauteur
      })),
      photos: [],
      note: jeu.length + " créas (3 angles × 3 formats)",
      conversion: "Les fichiers sont en SVG : le bouton « PNG » de l'interface les convertit aux dimensions exactes attendues par Meta et TikTok."
    }
  };
}

/* ---------------------------------------------------------------------------
   7. Landing page — rend le HTML, ne l'écrit pas.
   ------------------------------------------------------------------------ */
function landingPage(ctx) {
  const nom = ctx.produitRetenu || ctx.cible;
  const copy = ctx.copy || {};
  const vis = ctx.visuels || {};
  const photos = (vis.photos || []).filter(p => p.ok);

  const creas = photos.length
    ? photos.map(p => ({ fichier: p.fichier, angle: p.angle }))
    : (vis.creas || []).filter(c => c.format === "feed")
        .map(c => ({ fichier: c.fichier, angle: c.angleNom }));

  const html = landing.page({
    webhookUrl: ctx.webhookUrl || "",
    titre: copy.titreProduit || nom,
    titreAr: copy.titreProduitAr || "",
    produit: nom,
    prix: ctx.prix,
    prixBarre: ctx.prix ? Math.round(ctx.prix * 1.8) : null,
    devise: ctx.devise || "DH",
    boutique: ctx.boutique,
    whatsapp: ctx.whatsapp,
    promesse: copy.promesse || "",
    promesseAr: copy.promesseAr || "",
    benefices: copy.benefices || [],
    beneficesAr: copy.beneficesAr || [],
    objections: copy.objections || [],
    specs: copy.specs || [],
    faq: copy.faq || [],
    creas
  });

  return {
    html,
    resume: {
      fichier: "landing.html",
      octets: typeof Buffer !== "undefined" ? Buffer.byteLength(html) : new Blob([html]).size,
      note: Math.round(html.length / 1024) + " Ko, autonome",
      aFaire: ctx.whatsapp
        ? null
        : "Aucun numéro WhatsApp n'est configuré : la page enregistre les commandes dans le navigateur au lieu de les envoyer. Renseignez-le dans Réglages avant de lancer la campagne."
    }
  };
}

/* ---------------------------------------------------------------------------
   8. Stratégie — le plan standard, chiffré sur l'économie du produit.
   ------------------------------------------------------------------------ */
function strategie(ctx) {
  const e = ctx.economie || eco.economie({ prix: ctx.prix, cout: ctx.cout }, ctx.hypotheses);
  const budget = eco.planBudget(e);

  return Object.assign({
    economie: e,
    budget,
    regles: reglesDecision(budget),
    horsLigne: true,
    note: "Plan standard · CPA cible " + dh(budget.seuilScaling)
  }, planParDefaut(budget));
}

/* Les seuils apparaissent dans des phrases : on les arrondit au dirham.
   « 72.83 DH » dans une règle de décision se lit mal et n'ajoute rien —
   personne ne règle une enchère au centime. */
const dh = v => Math.round(v || 0) + " DH";

function reglesDecision(budget) {
  return [
    { quand: "CPA réel ≤ " + dh(budget.seuilScaling), alors: "Rentable — augmenter le budget de 20 % par jour, pas plus.", ton: "good" },
    { quand: "CPA réel entre " + Math.round(budget.seuilScaling) + " et " + dh(budget.seuilCoupure), alors: "À l'équilibre — changer de créa avant de toucher au budget.", ton: "warn" },
    { quand: "CPA réel > " + dh(budget.seuilCoupure), alors: "En perte — couper l'ensemble de publicités, garder l'angle qui a le meilleur taux de clic.", ton: "bad" },
    { quand: "Taux de confirmation < 70 %", alors: "Le problème est le délai de rappel, pas la publicité : viser un contact sous 2 h.", ton: "warn" },
    { quand: "Refus > 40 % sur une ville", alors: "Vérifier le transporteur et le délai sur cette ville avant d'y remettre du budget.", ton: "warn" }
  ];
}

function planParDefaut(budget) {
  return {
    phases: [
      { nom: "Test d'angles", duree: "3 jours", budget: budget.budgetJourTest + " DH/jour",
        quoi: "Trois ensembles de publicités, un par angle, même audience large.",
        onRegarde: ["Taux de clic sur le lien", "CPA par angle", "Taux de confirmation"],
        decision: "Garder l'angle sous " + dh(budget.seuilScaling) + " de CPA, couper les autres." },
      { nom: "Sélection", duree: "3 jours", budget: budget.budgetJourTest + " DH/jour",
        quoi: "Trois créas du même angle gagnant, formats différents.",
        onRegarde: ["CPA par créa", "Taux de livraison réel"],
        decision: "Garder les deux meilleures créas." },
      { nom: "Montée en budget", duree: "7 à 14 jours", budget: "+20 % par jour maximum",
        quoi: "On augmente lentement, on ne duplique pas la campagne qui marche.",
        onRegarde: ["CPA après montée", "Stock disponible", "Taux de refus par ville"],
        decision: "Couper dès que le CPA dépasse " + dh(budget.seuilCoupure) + "." },
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
    objectif: "Un angle validé sous " + dh(budget.seuilScaling) + " de CPA, avec un taux de livraison au-dessus de 70 %, et du stock pour tenir la montée."
  };
}

module.exports = {
  recherche, produitsProches, validation, fournisseurs,
  adcopy, scripts, visuels, landingPage, strategie,
  reglesDecision, planParDefaut
};
