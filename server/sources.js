"use strict";
/* =============================================================================
   Fournisseurs — la base du Comptoir COD, rendue interrogeable par la chaîne.

   41 sources d'approvisionnement (marchés physiques marocains, usines,
   marketplaces B2B, annuaires, filières internationales), chacune avec son
   indice de prix — un multiple du prix usine chinoise — sa qualité, son délai
   et son MOQ. C'est cette base qui transforme « je veux vendre X » en
   « voici où l'acheter, à quel prix approximatif, et qui appeler ».
   ========================================================================== */

const comptoir = require("./data/comptoir.json");
const eco = require("./economics");

const SOURCES = comptoir.sources;
const CATEGORIES = comptoir.cats;
const TYPES = comptoir.types;

const sansAccent = s => String(s || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/* ---------------------------------------------------------------------------
   Deviner la catégorie d'un produit à partir de son nom.
   Chaque catégorie porte ses mots-clés (fr, darija translittérée, anglais).
   ------------------------------------------------------------------------ */
function categoriser(texte) {
  const t = sansAccent(texte);
  let meilleur = null, meilleurScore = 0;

  CATEGORIES.forEach(cat => {
    let score = 0;
    cat.kw.forEach(mot => {
      const m = sansAccent(mot);
      if (!m) return;
      /* Un mot-clé long qui matche vaut plus qu'un mot court noyé dans le texte. */
      if (t.includes(m)) score += Math.max(1, m.length / 4);
    });
    if (score > meilleurScore) { meilleurScore = score; meilleur = cat; }
  });

  return meilleur ? { id: meilleur.id, nom: meilleur.n, confiance: Math.min(1, meilleurScore / 6) }
                  : { id: null, nom: "Non classé", confiance: 0 };
}

function categorieParId(id) {
  return CATEGORIES.find(c => c.id === id) || null;
}

/* ---------------------------------------------------------------------------
   Routes d'achat pour un produit — classées de la moins chère à la plus rapide.
   ------------------------------------------------------------------------ */
function routesAchat(produit, options) {
  const opt = options || {};
  const cat = opt.categorieId || categoriser(produit.nom || produit).id;
  const requete = produit.requete || produit.nom || String(produit);

  const pertinentes = SOURCES.filter(s => {
    if (opt.marche === "ma" && s.m !== "ma") return false;
    if (opt.marche === "intl" && s.m !== "intl") return false;
    if (!cat) return true;
    return s.cats.includes("tous") || s.cats.includes(cat);
  });

  const routes = pertinentes.map(s => {
    const type = TYPES.find(t => t.id === s.t);
    return {
      id: s.id,
      nom: s.n,
      type: type ? type.n : s.t,
      typeId: s.t,
      zone: s.m === "ma" ? "Maroc" : "International",
      ville: s.ville,
      pays: s.pays,
      indicePrix: s.idx,          // multiple du prix usine chinoise ; null = annuaire
      qualite: s.qual,            // 1 à 4
      delai: s.delai,
      moq: s.moq,
      description: s.d,
      forces: s.f || [],
      attention: s.a || [],
      domaine: s.dom || null,
      recherche: lienRecherche(s, requete),
      verification: s.av || null
    };
  });

  /* Tri : d'abord ce qui coûte le moins cher (indice bas), les annuaires
     — qui n'ont pas d'indice — passent après, ils servent à qualifier. */
  routes.sort((a, b) => {
    if (a.indicePrix == null && b.indicePrix == null) return 0;
    if (a.indicePrix == null) return 1;
    if (b.indicePrix == null) return -1;
    return a.indicePrix - b.indicePrix;
  });

  return routes;
}

function lienRecherche(source, requete) {
  const q = encodeURIComponent(requete);
  if (source.s) return source.s.replace("{q}", q);
  if (source.dom) return "https://www.google.com/search?q=" + q + "+site%3A" + source.dom;
  return "https://www.google.com/search?q=" + q + "+" + encodeURIComponent(source.n);
}

/* ---------------------------------------------------------------------------
   Estimation du coût rendu à partir de l'indice de prix.

   L'indice est un multiple du prix usine chinoise. Si on connaît le coût chez
   une source, on peut estimer le coût chez les autres. Ce sont des ordres de
   grandeur de filière, jamais des devis — l'interface le dit à chaque écran.
   ------------------------------------------------------------------------ */
function estimerCouts(routes, ancre) {
  /* ancre = { sourceId, cout } : un prix réellement constaté quelque part.
     Sans ancre, on ne chiffre rien plutôt que d'inventer. */
  if (!ancre || !ancre.cout) {
    return routes.map(r => Object.assign({}, r, { coutEstime: null, base: null }));
  }
  const src = routes.find(r => r.id === ancre.sourceId);
  const idxAncre = src && src.indicePrix ? src.indicePrix : 2.0;
  const prixUsine = ancre.cout / idxAncre;

  return routes.map(r => Object.assign({}, r, {
    coutEstime: r.indicePrix ? Math.round(prixUsine * r.indicePrix) : null,
    base: r.indicePrix ? { prixUsine: Math.round(prixUsine * 100) / 100, ancre: ancre.sourceId } : null
  }));
}

/* ---------------------------------------------------------------------------
   Annuaires de vérification — à consulter avant tout acompte.
   ------------------------------------------------------------------------ */
const ANNUAIRES = [
  { nom: "Charika", url: "https://www.charika.ma/", role: "Forme juridique, capital, objet social, dirigeants. À consulter avant tout virement à une société inconnue." },
  { nom: "Kompass Maroc", url: "https://ma.kompass.com/", role: "Classement par activité très fin — c'est là qu'on trouve les fabricants plutôt que les revendeurs." },
  { nom: "Kerix", url: "https://www.kerix.net/", role: "Fiches avec RC, ICE et effectif." },
  { nom: "Telecontact", url: "https://www.telecontact.ma/", role: "Les pages jaunes marocaines : les petites maisons de Derb Omar qui n'ont pas de site." },
  { nom: "ODCO", url: "http://www.odco.gov.ma/", role: "Registre des coopératives — argan, safran, ghassoul, miel." },
  { nom: "ONSSA", url: "https://www.onssa.gov.ma/", role: "Agrément obligatoire pour tout ce qui se mange ou s'applique sur la peau." }
];

/* Recherches d'annuaire prêtes à ouvrir, pour trouver un contact réel. */
function pistesContact(requete, ville) {
  const q = encodeURIComponent(requete);
  const v = encodeURIComponent(ville || "Casablanca");
  return [
    { source: "Kerix", url: "https://www.google.com/search?q=" + q + "+grossiste+site%3Akerix.net", quoi: "Fabricants et importateurs, avec RC et ICE" },
    { source: "Telecontact", url: "https://www.google.com/search?q=" + q + "+gros+site%3Atelecontact.ma", quoi: "Numéros fixes vérifiables, y compris petites villes" },
    { source: "Charika", url: "https://www.google.com/search?q=" + q + "+site%3Acharika.ma", quoi: "Existence légale et dirigeants" },
    { source: "Google Maps", url: "https://www.google.com/maps/search/" + q + "+gros+" + v, quoi: "Adresse, horaires, avis — et le numéro affiché sur la fiche" },
    { source: "Groupes Facebook", url: "https://www.facebook.com/search/groups/?q=" + q + "%20gros%20maroc", quoi: "Arrivages et retours d'autres vendeurs sur un fournisseur" },
    { source: "Instagram", url: "https://www.instagram.com/explore/search/keyword/?q=" + q + "%20gros%20maroc", quoi: "Beaucoup de grossistes n'ont qu'un compte Insta et un WhatsApp en bio" }
  ];
}

/* ---------------------------------------------------------------------------
   Plafond de prix : ce que le client peut trouver ailleurs.
   Si le prix COD dépasse celui de Jumia, le client compare et annule.
   ------------------------------------------------------------------------ */
function plafondsPrix(requete) {
  const q = encodeURIComponent(requete);
  return [
    { nom: "Jumia MA", url: "https://www.jumia.ma/catalog/?q=" + q, role: "Le plafond de prix public. Au-dessus, le client compare et annule." },
    { nom: "Avito MA", url: "https://www.avito.ma/fr/maroc/à_vendre?q=" + q, role: "Prix du marché de l'occasion et du destockage" },
    { nom: "AliExpress", url: "https://www.aliexpress.com/wholesale?SearchText=" + q, role: "Comparateur mondial de détail, et source d'échantillon à l'unité" },
    { nom: "Meta Ad Library", url: "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=MA&media_type=all&q=" + q, role: "Qui fait déjà de la publicité sur ce produit au Maroc, et depuis quand" },
    { nom: "Google Trends MA", url: "https://trends.google.com/trends/explore?geo=MA&q=" + q, role: "La demande monte-t-elle ou redescend-elle ?" },
    { nom: "TikTok", url: "https://www.tiktok.com/search?q=" + q, role: "Le format vidéo qui marche déjà sur ce produit" }
  ];
}

/* ---------------------------------------------------------------------------
   Contrôle de cohérence d'une offre fournisseur.
   ------------------------------------------------------------------------ */
function verifierOffre(offre, prixVente, hypotheses) {
  const cout = Number(offre.cout) || 0;
  const e = eco.economie({ prix: prixVente, cout }, hypotheses);
  const alertes = [];

  if (e.multiple < 2) {
    alertes.push({
      niveau: "bad",
      texte: "Multiple ×" + e.multiple + " entre coût et prix. En dessous de ×2, un lot défectueux ou une hausse du fret efface la marge."
    });
  }
  if (!e.lancable) {
    alertes.push({
      niveau: "bad",
      texte: "CPA maximum de " + e.cpaMax + " DH. Sous " + e.hypotheses.cplPlancher +
        " DH, aucune campagne Meta ou TikTok au Maroc n'acquiert une commande COD de façon durable. " +
        "Il faut vendre à " + eco.prixPourCpa(cout, e.hypotheses.cplPlancher + 15, hypotheses) +
        " DH, ou acheter à " + eco.coutMaxPour(prixVente, e.hypotheses.cplPlancher + 15, hypotheses) + " DH."
    });
  }
  if (!e.dansLaFenetre) {
    alertes.push({
      niveau: "warn",
      texte: "Prix de " + prixVente + " DH hors de la fenêtre COD marocaine (" +
        e.hypotheses.fenetreBasse + "–" + e.hypotheses.fenetreHaute + " DH)."
    });
  }
  if (!offre.facture) {
    alertes.push({ niveau: "warn", texte: "Exiger une facture avec ICE. Sans elle, pas de comptabilité propre et aucun recours." });
  }
  if (!offre.moq) {
    alertes.push({ niveau: "warn", texte: "MOQ inconnu. C'est la première question à poser — aucune marketplace ne l'affiche." });
  }
  if (!offre.echantillon) {
    alertes.push({ niveau: "warn", texte: "Commander un échantillon payant avant le volume, systématiquement." });
  }

  return { economie: e, alertes, verdict: alertes.some(a => a.niveau === "bad") ? "bloquant" : alertes.length ? "à qualifier" : "propre" };
}

module.exports = {
  SOURCES, CATEGORIES, TYPES, ANNUAIRES,
  categoriser, categorieParId, routesAchat, estimerCouts,
  pistesContact, plafondsPrix, verifierOffre, lienRecherche
};
