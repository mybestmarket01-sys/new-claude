"use strict";
/* =============================================================================
   Modèle économique COD — le calcul commun à toutes les applications.

   Il vient de Pilote COD (CPA max par commande brute) et du Radar Produit COD
   (score sur huit critères). Les deux applications faisaient le même calcul
   chacune dans leur coin ; ici il n'existe qu'une fois, et c'est cette version
   qui décide dans toute la chaîne.
   ========================================================================== */

/* Hypothèses par défaut du marché marocain, reprises de Lancement COD :
   85 % de confirmées, 70 % de livrées, 35 DH de livraison, 25 DH par refus.

   Les deux taux se comptent sur les commandes BRUTES, pas l'un sur l'autre :
   sur 100 commandes, 85 sont confirmées, 70 sont livrées et encaissées, et
   les 15 qui restent partent puis reviennent. C'est la lecture des dossiers
   Lancement COD et Sourcing Maroc, et c'est elle qui redonne leurs chiffres
   au dirham près. */
const DEFAUT = {
  confirmation: 0.85,   // part des commandes brutes qui passent la confirmation
  livraison: 0.70,      // part des commandes brutes livrées et encaissées
  fraisLivraison: 35,   // DH par colis livré
  fraisRetour: 25,      // DH par colis refusé (aller-retour + manutention)
  fenetreBasse: 149,    // zone d'impulsion COD marocaine
  fenetreHaute: 499,
  cplPlancher: 35       // sous ce CPA max, aucune campagne Meta/TikTok ne tient
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = v => Math.round(v * 100) / 100;

/**
 * Économie d'un produit sur 100 commandes brutes.
 * @param {{prix:number, cout:number}} produit
 * @param {object} [hyp] hypothèses (voir DEFAUT)
 */
function economie(produit, hyp) {
  const h = Object.assign({}, DEFAUT, hyp || {});
  const prix = Number(produit.prix) || 0;
  const cout = Number(produit.cout) || 0;

  const brutes = 100;
  const confirmees = brutes * h.confirmation;
  /* Un colis ne peut pas être livré s'il n'a pas été confirmé : si quelqu'un
     saisit un taux de livraison supérieur au taux de confirmation, on plafonne
     plutôt que de sortir un nombre de refus négatif. */
  const livrees = Math.min(brutes * h.livraison, confirmees);
  const refusees = confirmees - livrees;

  const ca = livrees * prix;
  const achats = livrees * cout;
  const logistique = livrees * h.fraisLivraison + refusees * h.fraisRetour;

  /* CPA maximum = ce qui reste à dépenser en publicité par commande brute
     avant que le produit ne perde de l'argent. C'est un plafond, pas un objectif. */
  const cpaMax = (ca - achats - logistique) / brutes;
  const cpaCible = cpaMax * 0.7;

  const margeUnitaire = prix - cout;
  const multiple = cout > 0 ? prix / cout : 0;
  const netParLivree = livrees > 0 ? (ca - achats - logistique) / livrees : 0;

  return {
    hypotheses: h,
    prix, cout,
    brutes, confirmees: round2(confirmees), livrees: round2(livrees), refusees: round2(refusees),
    ca: round2(ca), achats: round2(achats), logistique: round2(logistique),
    margeUnitaire: round2(margeUnitaire),
    multiple: round2(multiple),
    cpaMax: round2(cpaMax),
    cpaCible: round2(cpaCible),
    netParLivree: round2(netParLivree),
    /* ROAS que la plateforme affichera au point mort : au-dessous, la campagne
       perd de l'argent même si le gestionnaire de publicités affiche > 1. */
    roasMini: cpaMax > 0 ? round2(prix / cpaMax) : null,
    dansLaFenetre: prix >= h.fenetreBasse && prix <= h.fenetreHaute,
    lancable: cpaMax >= h.cplPlancher
  };
}

/* Prix de vente minimum pour atteindre un CPA maximum visé, à coût donné.
   Sert à répondre « à combien faut-il vendre pour que ce produit tienne ? ». */
function volumes(h) {
  const confirmees = 100 * h.confirmation;
  const livrees = Math.min(100 * h.livraison, confirmees);
  return { livrees, refusees: confirmees - livrees };
}

function prixPourCpa(cout, cpaVise, hyp) {
  const h = Object.assign({}, DEFAUT, hyp || {});
  const v = volumes(h);
  const besoin = cpaVise * 100 + v.livrees * cout + v.livrees * h.fraisLivraison + v.refusees * h.fraisRetour;
  return Math.ceil(besoin / v.livrees);
}

/* Coût d'achat maximum acceptable pour un prix de vente donné. */
function coutMaxPour(prix, cpaVise, hyp) {
  const h = Object.assign({}, DEFAUT, hyp || {});
  const v = volumes(h);
  const reste = v.livrees * prix - v.livrees * h.fraisLivraison - v.refusees * h.fraisRetour - cpaVise * 100;
  return Math.floor(reste / v.livrees);
}

/* -----------------------------------------------------------------------------
   Score produit gagnant — huit critères, notes sur 10, pondérés.
   Repris du Radar Produit COD. `criteres` accepte des notes partielles ;
   ce qui manque prend 5/10, la valeur neutre.
   -------------------------------------------------------------------------- */
const POIDS = { marge: 25, ads: 15, wow: 15, pb: 12, conc: 12, log: 10, prix: 6, nouv: 5 };

const LIBELLE_CRITERES = {
  marge: "Marge nette après refus",
  ads: "Preuve de demande publicitaire",
  wow: "Effet wow / démo vidéo",
  pb: "Résout un vrai problème",
  conc: "Concurrence locale faible",
  log: "Léger, compact, incassable",
  prix: "Dans la zone d'impulsion",
  nouv: "Introuvable en magasin"
};

function scoreProduit(produit, hyp, poids) {
  const w = Object.assign({}, POIDS, poids || {});
  const eco = economie(produit, hyp);
  const c = produit.criteres || produit;
  const note = k => (typeof c[k] === "number" ? clamp(c[k], 0, 10) : 5);

  /* Le seuil de bonne marge : ~150 DH de net par colis livré vaut 100/100. */
  const parts = {
    marge: clamp((eco.netParLivree / 150) * 100, 0, 100),
    ads: note("ads") * 10,
    wow: note("wow") * 10,
    pb: note("pb") * 10,
    conc: (10 - note("conc")) * 10,     // conc = saturation : 10 = rouge vif
    log: note("log") * 10,
    prix: scorePrix(eco.prix, eco.hypotheses),
    nouv: note("nouv") * 10
  };

  const somme = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const total = Object.keys(parts).reduce((a, k) => a + parts[k] * w[k], 0) / somme;
  const score = Math.round(total);

  return { score, verdict: verdictDe(score), parts, poids: w, economie: eco };
}

function scorePrix(prix, h) {
  if (prix >= h.fenetreBasse && prix <= h.fenetreHaute) return 100;
  if (prix < h.fenetreBasse) return clamp((prix / h.fenetreBasse) * 100, 0, 100);
  return clamp(100 - ((prix - h.fenetreHaute) / h.fenetreHaute) * 140, 0, 100);
}

function verdictDe(score) {
  if (score >= 75) return { cle: "lancer", texte: "À lancer", ton: "good" };
  if (score >= 60) return { cle: "tester", texte: "À tester", ton: "accent" };
  if (score >= 45) return { cle: "surveiller", texte: "Surveiller", ton: "warn" };
  return { cle: "ecarter", texte: "Écarter", ton: "bad" };
}

/* -----------------------------------------------------------------------------
   Budget de campagne dérivé du CPA maximum.
   -------------------------------------------------------------------------- */
function planBudget(eco, ambition) {
  const cpaCible = eco.cpaCible > 0 ? eco.cpaCible : 0;
  const parJour = ambition && ambition.budgetJour ? ambition.budgetJour : Math.max(150, Math.round(cpaCible * 5));
  const test = Math.round(parJour * 3);            // 3 jours de test d'angle
  const commandesTest = cpaCible > 0 ? Math.floor(test / cpaCible) : 0;

  return {
    budgetJourTest: parJour,
    budgetTest3Jours: test,
    commandesBrutesAttendues: commandesTest,
    livreesAttendues: Math.round(commandesTest * eco.hypotheses.confirmation * eco.hypotheses.livraison),
    seuilCoupure: eco.cpaMax,
    seuilScaling: cpaCible,
    profitSiCible: Math.round(commandesTest * (eco.cpaMax - cpaCible))
  };
}

module.exports = {
  DEFAUT, POIDS, LIBELLE_CRITERES,
  economie, scoreProduit, verdictDe, planBudget,
  prixPourCpa, coutMaxPour
};
