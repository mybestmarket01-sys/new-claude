"use strict";
/* =============================================================================
   Tests — `npm test`. Aucune dépendance, aucun appel réseau.

   Le mode direct est testé avec un faux client Claude : on vérifie que la
   chaîne sait lire les réponses, gérer un `pause_turn`, rattraper un JSON mal
   formé et faire circuler ce qu'une étape a trouvé vers la suivante — sans
   dépenser un jeton ni exiger une clé.
   ========================================================================== */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

/* Chaque exécution travaille dans son propre dossier de données : les tests
   ne doivent jamais écraser l'atelier de quelqu'un. */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), "poste-cod-test-"));
process.env.POSTE_COD_DATA = bacASable;

let reussis = 0, echoues = 0;
const groupes = [];

function groupe(nom, fn){ groupes.push({ nom, fn }); }
function test(nom, fn){
  try { fn(); console.log("    ✓ " + nom); reussis++; }
  catch (err) { console.log("    ✗ " + nom + "\n        " + err.message); echoues++; }
}
async function testAsync(nom, fn){
  try { await fn(); console.log("    ✓ " + nom); reussis++; }
  catch (err) { console.log("    ✗ " + nom + "\n        " + err.message); echoues++; }
}

/* ===========================================================================
   Modèle économique — la régression qui compte le plus.

   Ces cinq produits ont des chiffres publiés dans le dossier Lancement COD
   du 4 septembre 2026. Si le modèle dérive, ces tests le disent avant qu'une
   campagne ne parte sur de faux plafonds d'enchère.
   ======================================================================== */
groupe("Modèle économique COD", () => {
  const eco = require("../server/economics");

  const publies = [
    { nom: "Bocaux 1700 ml",     prix: 249, cout: 135, cpaMax: 51.5,  net: 73.6,  multiple: 1.84 },
    { nom: "Pots à épices",      prix: 199, cout: 150, cpaMax: 6.0,   net: 8.6,   multiple: 1.33 },
    { nom: "Pistolet de massage",prix: 349, cout: 180, cpaMax: 90.0,  net: 128.6, multiple: 1.94 },
    { nom: "Appareil photo",     prix: 329, cout: 140, cpaMax: 104.0, net: 148.6, multiple: 2.35 },
    { nom: "Tondeuse lame T",    prix: 229, cout: 100, cpaMax: 62.0,  net: 88.6,  multiple: 2.29 }
  ];

  publies.forEach(p => {
    test("reproduit les chiffres publiés — " + p.nom, () => {
      const e = eco.economie(p);
      assert.ok(Math.abs(e.cpaMax - p.cpaMax) < 0.1, "CPA max " + e.cpaMax + " ≠ " + p.cpaMax);
      assert.ok(Math.abs(e.netParLivree - p.net) < 0.1, "net/livrée " + e.netParLivree + " ≠ " + p.net);
      assert.ok(Math.abs(e.multiple - p.multiple) < 0.02, "multiple " + e.multiple + " ≠ " + p.multiple);
    });
  });

  test("sur 100 commandes : 85 confirmées, 70 livrées, 15 refusées", () => {
    const e = eco.economie({ prix: 249, cout: 135 });
    assert.strictEqual(e.confirmees, 85);
    assert.strictEqual(e.livrees, 70);
    assert.strictEqual(e.refusees, 15);
  });

  test("un taux de livraison aberrant ne produit pas de refus négatifs", () => {
    const e = eco.economie({ prix: 249, cout: 135 }, { confirmation: 0.60, livraison: 0.90 });
    assert.ok(e.refusees >= 0, "refus négatifs : " + e.refusees);
    assert.ok(e.livrees <= e.confirmees, "plus de livrées que de confirmées");
  });

  test("prixPourCpa et coutMaxPour sont l'inverse l'un de l'autre", () => {
    const cible = 55;
    const prix = eco.prixPourCpa(150, cible);
    const e = eco.economie({ prix, cout: 150 });
    assert.ok(e.cpaMax >= cible, "prix " + prix + " donne un CPA max de " + e.cpaMax + ", visé " + cible);

    const cout = eco.coutMaxPour(299, cible);
    const e2 = eco.economie({ prix: 299, cout });
    assert.ok(e2.cpaMax >= cible, "coût " + cout + " donne un CPA max de " + e2.cpaMax);
  });

  test("le pot à épices est bien déclaré non lançable", () => {
    const e = eco.economie({ prix: 199, cout: 150 });
    assert.strictEqual(e.lancable, false, "un CPA max de 6 DH ne devrait pas être lançable");
  });

  test("le score reste borné entre 0 et 100", () => {
    const bas = eco.scoreProduit({ prix: 50, cout: 45, criteres: { wow:0, pb:0, ads:0, conc:10, log:0, nouv:0 } });
    const haut = eco.scoreProduit({ prix: 349, cout: 80, criteres: { wow:10, pb:10, ads:10, conc:0, log:10, nouv:10 } });
    assert.ok(bas.score >= 0 && bas.score <= 100, "score bas hors bornes : " + bas.score);
    assert.ok(haut.score >= 0 && haut.score <= 100, "score haut hors bornes : " + haut.score);
    assert.ok(haut.score > bas.score, "le bon produit devrait mieux noter");
  });

  test("le budget de test découle du CPA cible", () => {
    const e = eco.economie({ prix: 349, cout: 85 });
    const b = eco.planBudget(e);
    assert.ok(b.budgetJourTest > 0);
    assert.strictEqual(b.budgetTest3Jours, b.budgetJourTest * 3);
    assert.strictEqual(b.seuilCoupure, e.cpaMax);
  });
});

/* ===========================================================================
   Base fournisseurs
   ======================================================================== */
groupe("Base fournisseurs (Comptoir COD)", () => {
  const src = require("../server/sources");

  test("les 41 sources et 22 catégories sont chargées", () => {
    assert.strictEqual(src.SOURCES.length, 41);
    assert.strictEqual(src.CATEGORIES.length, 22);
  });

  test("catégorise un produit de cuisine", () => {
    const c = src.categoriser("Set 12 bocaux carrés pour la cuisine, rangement placard");
    assert.ok(["maison", "rangement"].includes(c.id), "catégorie inattendue : " + c.id);
  });

  test("catégorise un produit de beauté", () => {
    const c = src.categoriser("Brosse vaporisateur cheveux 2-en-1");
    assert.ok(["beaute", "appareils"].includes(c.id), "catégorie inattendue : " + c.id);
  });

  test("les routes d'achat vont du moins cher au plus cher", () => {
    const routes = src.routesAchat({ nom: "bocaux hermétiques" });
    assert.ok(routes.length > 5, "trop peu de routes : " + routes.length);
    const indices = routes.map(r => r.indicePrix).filter(x => x != null);
    for (let i = 1; i < indices.length; i++) {
      assert.ok(indices[i] >= indices[i - 1], "tri cassé à l'indice " + i);
    }
  });

  test("chaque route porte un lien de recherche exploitable", () => {
    const routes = src.routesAchat({ nom: "tapis chauffant" });
    routes.forEach(r => {
      assert.ok(/^https?:\/\//.test(r.recherche), r.nom + " : lien invalide « " + r.recherche + " »");
      assert.ok(!r.recherche.includes("{q}"), r.nom + " : le gabarit {q} n'a pas été remplacé");
    });
  });

  test("sans prix constaté, aucun coût n'est inventé", () => {
    const routes = src.routesAchat({ nom: "tondeuse" });
    const sansAncre = src.estimerCouts(routes, null);
    assert.ok(sansAncre.every(r => r.coutEstime === null), "des coûts sortis de nulle part");
  });

  test("avec un prix constaté, les autres routes sont estimées par l'indice", () => {
    const routes = src.routesAchat({ nom: "tondeuse" });
    const avec = src.estimerCouts(routes, { sourceId: routes[0].id, cout: 100 });
    const chiffrees = avec.filter(r => r.coutEstime != null);
    assert.ok(chiffrees.length > 3, "trop peu de routes chiffrées");
    assert.ok(chiffrees.every(r => r.coutEstime > 0));
  });

  test("une offre trop chère est signalée comme bloquante", () => {
    const v = src.verifierOffre({ cout: 150 }, 199);
    assert.strictEqual(v.verdict, "bloquant");
    assert.ok(v.alertes.some(a => a.niveau === "bad"));
  });
});

/* ===========================================================================
   Visuels
   ======================================================================== */
groupe("Visuels publicitaires", () => {
  const visuals = require("../server/visuals");

  const brief = {
    produit: "Set 12 Bocaux Carrés", boutique: "Assala Home", prix: 249, prixBarre: 448, devise: "DH",
    hooks: {
      probleme: { ar: "واش كتحشم تحل البلاكار ديالك قدام الضياف؟", fr: "La honte du placard ouvert" },
      preuve:   { ar: "ثلث البلاصة ربحتيها", fr: "Un tiers de place gagnée" },
      offre:    { ar: "249 درهم بدل 448", fr: "249 DH au lieu de 448" }
    },
    benefices: ["12 bocaux empilables", "Couvercle à joint", "Lave-vaisselle"]
  };

  test("produit 9 créas : 3 angles × 3 formats", () => {
    const jeu = visuals.jeuComplet(brief);
    assert.strictEqual(jeu.length, 9);
    assert.strictEqual(new Set(jeu.map(c => c.angle)).size, 3);
    assert.strictEqual(new Set(jeu.map(c => c.format)).size, 3);
    assert.strictEqual(new Set(jeu.map(c => c.fichier)).size, 9, "noms de fichiers en double");
  });

  test("les dimensions sont celles attendues par les régies", () => {
    const jeu = visuals.jeuComplet(brief);
    const attendu = { feed: [1080, 1080], carre: [1080, 1350], story: [1080, 1920] };
    jeu.forEach(c => {
      assert.deepStrictEqual([c.largeur, c.hauteur], attendu[c.format], c.fichier);
      assert.ok(c.svg.includes('width="' + c.largeur + '"'), c.fichier + " : largeur absente du SVG");
    });
  });

  test("le SVG est bien formé et échappe le texte", () => {
    const jeu = visuals.jeuComplet(Object.assign({}, brief, {
      produit: 'Produit <script>alert("x")</script> & Cie'
    }));
    jeu.forEach(c => {
      assert.ok(c.svg.startsWith("<svg"), "ne commence pas par <svg>");
      assert.ok(c.svg.trim().endsWith("</svg>"), "ne finit pas par </svg>");
      assert.ok(!c.svg.includes("<script>"), "balise script non échappée dans " + c.fichier);
      assert.ok(c.svg.includes("&amp;"), "esperluette non échappée");
      /* Un décompte de balises déséquilibré signalerait un SVG cassé. */
      const ouvrants = (c.svg.match(/<(?!\/)[a-zA-Z]/g) || []).length;
      assert.ok(ouvrants > 8, "SVG suspicieusement pauvre : " + ouvrants + " balises");
    });
  });

  test("le texte arabe reste posé en RTL", () => {
    const jeu = visuals.jeuComplet(brief);
    const feed = jeu.find(c => c.angle === "probleme" && c.format === "feed");
    assert.ok(feed.svg.includes('direction="rtl"'), "le hook darija n'est pas en RTL");
  });

  test("un brief vide ne fait pas planter la génération", () => {
    const jeu = visuals.jeuComplet({});
    assert.strictEqual(jeu.length, 9);
    jeu.forEach(c => assert.ok(c.svg.includes("</svg>")));
  });

  test("les lignes ne coupent pas les mots", () => {
    const ls = visuals.lignes("un texte assez long pour devoir être découpé en plusieurs lignes", 20);
    assert.ok(ls.length > 1);
    ls.forEach(l => assert.ok(l.length <= 24, "ligne trop longue : « " + l + " »"));
    assert.strictEqual(ls.join(" ").split(/\s+/).length,
      "un texte assez long pour devoir être découpé en plusieurs lignes".split(/\s+/).length,
      "des mots ont été perdus au découpage");
  });
});

/* ===========================================================================
   Landing page
   ======================================================================== */
groupe("Landing page", () => {
  const landing = require("../server/landing");

  const brief = {
    titre: "Set 12 Bocaux", titreAr: "طقم 12 بوكال", prix: 249, prixBarre: 448,
    boutique: "Assala Home", whatsapp: "212600112233",
    promesse: "Un tiers de place gagnée.", benefices: ["Empilables"], beneficesAr: ["كيتراكبو"],
    objections: [{ question: "Je paie d'avance ?", reponse: "Non, à la livraison." }],
    specs: [{ cle: "Contenance", valeur: "1700 ml × 12" }],
    creas: [{ fichier: "crea-probleme-feed.svg", angle: "Problème" }]
  };

  test("produit un document HTML complet", () => {
    const h = landing.page(brief);
    assert.ok(h.startsWith("<!doctype html>"));
    assert.ok(h.includes("</html>"));
    assert.ok(h.includes("Set 12 Bocaux"));
  });

  test("le script embarqué est syntaxiquement valide", () => {
    const h = landing.page(brief);
    const m = h.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(m, "aucun script trouvé");
    new Function(m[1]);   // lève si la syntaxe est cassée
  });

  test("le paiement à la livraison est répété, pas mentionné une fois", () => {
    const h = landing.page(brief);
    const occurrences = (h.match(/الدفع عند الاستلام|à la livraison/gi) || []).length;
    assert.ok(occurrences >= 4, "seulement " + occurrences + " mentions du paiement à la livraison");
  });

  test("échappe le contenu hostile", () => {
    const h = landing.page(Object.assign({}, brief, { titre: '<script>alert(1)</script>' }));
    assert.ok(!h.includes("<script>alert(1)</script>"), "injection non échappée");
    assert.ok(h.includes("&lt;script&gt;"));
  });

  test("le numéro WhatsApp est réduit à ses chiffres", () => {
    const h = landing.page(Object.assign({}, brief, { whatsapp: "+212 600-11.22 33" }));
    assert.ok(h.includes('"212600112233"'), "le numéro n'a pas été normalisé");
  });

  test("sans WhatsApp, la page garde quand même la commande", () => {
    const h = landing.page(Object.assign({}, brief, { whatsapp: "" }));
    assert.ok(h.includes("commandes-cod"), "aucune sauvegarde de secours");
  });

  test("le formulaire ne demande que trois champs", () => {
    const h = landing.page(brief);
    const champs = (h.match(/<input id="(nom|tel|ville)"|<select id="ville"/g) || []).length;
    assert.ok(champs <= 3, "le formulaire demande trop de champs : " + champs);
  });
});

/* ===========================================================================
   Lecture des réponses de Claude
   ======================================================================== */
groupe("Lecture des réponses JSON", () => {
  const claude = require("../server/claude");
  const ex = claude.extraireJson;

  test("lit un JSON nu", () => {
    assert.deepStrictEqual(ex('{"a":1}'), { a: 1 });
  });
  test("lit un JSON dans un bloc de code", () => {
    assert.deepStrictEqual(ex('```json\n{"a":1}\n```'), { a: 1 });
  });
  test("lit un JSON précédé de bavardage", () => {
    assert.deepStrictEqual(ex('Voici le résultat :\n\n{"a":1}\n\nVoilà.'), { a: 1 });
  });
  test("ne se laisse pas piéger par une accolade dans une chaîne", () => {
    const r = ex('{"texte":"une } accolade dans le texte","n":2}');
    assert.strictEqual(r.n, 2);
    assert.strictEqual(r.texte, "une } accolade dans le texte");
  });
  test("gère les guillemets échappés", () => {
    const r = ex('{"t":"il a dit \\"bonjour\\" puis }"}');
    assert.strictEqual(r.t, 'il a dit "bonjour" puis }');
  });
  test("gère les objets imbriqués", () => {
    const r = ex('{"a":{"b":{"c":[1,2,{"d":3}]}}}');
    assert.strictEqual(r.a.b.c[2].d, 3);
  });
  test("rend null sur du texte sans JSON", () => {
    assert.strictEqual(ex("désolé, je ne peux pas"), null);
    assert.strictEqual(ex(""), null);
    assert.strictEqual(ex(null), null);
  });
  test("rend null sur un JSON tronqué", () => {
    assert.strictEqual(ex('{"a":1,"b":'), null);
  });

  test("l'état dit pourquoi le mode direct n'est pas actif", () => {
    const e = claude.etat();
    assert.strictEqual(typeof e.disponible, "boolean");
    if (!e.disponible) assert.ok(e.raison && e.raison.length > 10, "raison absente ou trop vague");
  });
});

/* ===========================================================================
   Magasin de données
   ======================================================================== */
groupe("Magasin de données", () => {
  const store = require("../server/store");

  test("ajoute, retrouve, modifie et supprime", () => {
    const p = store.ajouter("produits", { nom: "Test " + Date.now(), prix: 249 });
    assert.ok(p.id);
    assert.strictEqual(store.trouver("produits", p.id).prix, 249);
    store.majSur("produits", p.id, { prix: 299 });
    assert.strictEqual(store.trouver("produits", p.id).prix, 299);
    assert.strictEqual(store.supprimer("produits", p.id), true);
    assert.strictEqual(store.trouver("produits", p.id), null);
  });

  test("fusionne sur une clé métier au lieu de dupliquer", () => {
    const nom = "Fournisseur " + Date.now();
    const a = store.fusionner("fournisseurs", "nom", { nom, ville: "Casablanca" });
    const b = store.fusionner("fournisseurs", "nom", { nom, telephone: "0522000000" });
    assert.strictEqual(a.nouveau, true);
    assert.strictEqual(b.nouveau, false);
    assert.strictEqual(b.item.ville, "Casablanca", "la fusion a perdu un champ");
    assert.strictEqual(b.item.telephone, "0522000000");
    store.supprimer("fournisseurs", b.item.id);
  });

  test("refuse d'écrire un livrable hors de son dossier", () => {
    const id = "test-" + Date.now();
    const info = store.ecrireLivrable(id, "../../evasion.txt", "contenu");
    const attendu = path.resolve(path.join(store.RACINE, "campagnes", id));
    assert.ok(path.resolve(info.chemin).startsWith(attendu + path.sep),
      "le fichier est sorti du dossier de campagne : " + info.chemin);
    assert.ok(!info.fichier.includes("/") && !info.fichier.includes(".."),
      "le nom de fichier a gardé une remontée : " + info.fichier);
  });

  test("refuse de lire un livrable hors de son dossier", () => {
    assert.strictEqual(store.lireLivrable("camp-x", "../../../etc/passwd"), null);
  });

  test("les réglages ont toujours des hypothèses complètes", () => {
    const r = store.reglages();
    ["confirmation", "livraison", "fraisLivraison", "fraisRetour", "fenetreBasse", "fenetreHaute", "cplPlancher"]
      .forEach(k => assert.ok(typeof r.hypotheses[k] === "number", "hypothèse manquante : " + k));
  });
});

/* ===========================================================================
   Orchestrateur — les deux modes
   ======================================================================== */
groupe("Orchestrateur", async () => {
  const pipeline = require("../server/pipeline");
  const store = require("../server/store");

  function attendreFin(id, limiteMs) {
    return new Promise((resolve, reject) => {
      const debut = Date.now();
      const t = setInterval(() => {
        const e = pipeline.etat(id);
        if (e && e.statut !== "en-cours") { clearInterval(t); resolve(e); }
        else if (Date.now() - debut > (limiteMs || 20000)) { clearInterval(t); reject(new Error("délai dépassé")); }
      }, 60);
    });
  }

  await testAsync("mode hors ligne : les 8 étapes produisent des livrables", async () => {
    const job = pipeline.lancer({ cible: "Tapis chauffant pliable pour plats", prix: 349, cout: 85 });
    const fin = await attendreFin(job.id);
    assert.strictEqual(fin.statut, "fini", "statut " + fin.statut);
    assert.strictEqual(fin.etapes.filter(e => e.statut === "fait").length, 8,
      "étapes réussies : " + fin.etapes.filter(e => e.statut === "fait").map(e => e.id).join(","));

    const fichiers = store.livrables(job.id).map(f => f.fichier);
    assert.ok(fichiers.includes("landing.html"), "landing.html absente");
    assert.ok(fichiers.includes("campagne.json"), "campagne.json absent");
    assert.strictEqual(fichiers.filter(f => f.endsWith(".svg")).length, 9, "il devrait y avoir 9 créas");
  });

  await testAsync("la validation arrête la chaîne sur un produit non lançable", async () => {
    const job = pipeline.lancer({ cible: "Set 12 pots à épices", prix: 199, cout: 150 });
    const fin = await attendreFin(job.id);
    assert.strictEqual(fin.statut, "arrete", "la chaîne aurait dû s'arrêter");

    const d = pipeline.complet(job.id);
    assert.strictEqual(d.resultats.validation.verdict, "bloquant");
    /* Le prix de sortie est calculé, pas codé en dur : on vérifie qu'il est
       proposé et qu'il ramène bien le produit au-dessus du plancher. */
    const correctifs = d.resultats.validation.correctifs;
    assert.ok(correctifs && correctifs.prixMinimum > 199,
      "aucun prix de sortie proposé");
    const eco = require("../server/economics");
    assert.ok(eco.economie({ prix: correctifs.prixMinimum, cout: 150 }).lancable,
      "le prix de sortie proposé ne rend pas le produit lançable");
    assert.ok(d.resultats.validation.raison.includes(String(correctifs.prixMinimum)),
      "le prix de sortie n'apparaît pas dans l'explication");
    assert.ok(!d.resultats.visuels, "des visuels ont été produits malgré l'arrêt");
  });

  await testAsync("refuse une cible vide", async () => {
    assert.throws(() => pipeline.lancer({ cible: "   " }), /produit ou une catégorie/);
  });

  await testAsync("une campagne relue du disque garde ses résultats", async () => {
    const job = pipeline.lancer({ cible: "Gants chauffants pour deux-roues", prix: 249, cout: 60 });
    await attendreFin(job.id);
    const d = pipeline.complet(job.id);
    assert.ok(d.resultats.strategie, "stratégie absente du dossier relu");
    assert.ok(d.livrables.length >= 11, "livrables incomplets : " + d.livrables.length);
  });
});

/* ===========================================================================
   Orchestrateur en mode direct — avec un faux Claude
   ======================================================================== */
groupe("Orchestrateur en mode direct (Claude simulé)", async () => {
  /* On remplace le module claude dans le cache de require AVANT de charger
     une copie neuve du pipeline. Le vrai module n'est jamais appelé. */
  const cheminClaude = require.resolve("../server/claude");
  const cheminPipeline = require.resolve("../server/pipeline");
  const vraiClaude = require.cache[cheminClaude];

  const appels = [];
  const faux = {
    MODELE_DEFAUT: "claude-opus-5",
    etat: () => ({ disponible: true, sdkInstalle: true, cleConfiguree: true, modele: "claude-opus-5", raison: null }),
    disponible: () => true,
    messageErreur: e => (e && e.message) || String(e),
    extraireJson: require("../server/claude").extraireJson,
    demander: async () => ({ texte: "", sources: [], usage: {}, tours: 1 }),
    demanderJson: async (o) => {
      appels.push(o.prompt.slice(0, 60));
      return { donnees: reponsePour(o.prompt), sources: [{ titre: "Source de test", url: "https://exemple.ma/x" }],
               usage: { input_tokens: 100, output_tokens: 200 } };
    }
  };

  function reponsePour(prompt) {
    if (prompt.includes("Recherche sur le web l'état du marché")) {
      return { synthese: "Produit d'hiver, demande prouvée.", demande: { tendance: "montante" },
        concurrence: [{ acteur: "Jumia", prix: "399 DH", source: "https://jumia.ma/x" }],
        plafondPrix: { valeur: 399 }, prixGros: [{ source: "eGRO", prix: "120 DH" }],
        risques: ["Produit électrique : vérifier la conformité"],
        prixVenteConseille: 349, coutAchatConstate: 120, candidats: [] };
    }
    if (prompt.includes("Note le produit")) {
      return { wow: 8, pb: 9, ads: 8, conc: 3, log: 7, nouv: 8,
        justifications: { wow: "Effet visible en 3 s" }, risqueMajeur: null };
    }
    if (prompt.includes("Trouve des fournisseurs")) {
      return { contacts: [{ nom: "Grossiste Test", type: "grossiste", ville: "Casablanca",
        telephone: "0522000000", source: "https://exemple.ma/f", fiabilite: "moyenne", prixNombre: 110 }],
        meilleurPrixGros: 110, synthese: "Filière Derb Omar.", pieges: [] };
    }
    if (prompt.includes("Écris les annonces publicitaires")) {
      return { angles: {
          probleme: { hookAr: "هوك", hookFr: "hook", meta: { texte: "نص", titre: "T", description: "D" },
            tiktok: { legende: "L", hashtags: "#المغرب" }, pourquoi: "parce que" },
          preuve: { hookAr: "هوك2", meta: { texte: "نص2" }, tiktok: { legende: "L2", hashtags: "#cod" } },
          offre: { hookAr: "هوك3", meta: { texte: "نص3" }, tiktok: { legende: "L3", hashtags: "#maroc" } }
        },
        benefices: ["Chauffe en 3 minutes", "Se plie"], beneficesAr: ["كيسخن", "كينطوى"],
        objections: [{ question: "Ça consomme ?", reponse: "60 W." }],
        promesse: "Le repas reste chaud.", promesseAr: "الماكلة كتبقى سخونة",
        titreProduit: "Tapis chauffant pliable", titreProduitAr: "طبق سخون",
        specs: [{ cle: "Puissance", valeur: "60 W" }], faq: [{ q: "Livraison ?", r: "24-72 h" }] };
    }
    if (prompt.includes("Écris trois scripts vidéo")) {
      return { scripts: { probleme: { titre: "S1", duree: "30 s",
        beats: [{ temps: "0-3 s", beat: "HOOK", image: "plan", voix: "صوت" }], materiel: ["Téléphone"] } },
        conseilTournage: ["Filmer à la lumière du jour"] };
    }
    if (prompt.includes("Bâtis le plan de lancement")) {
      return { phases: [{ nom: "Test", duree: "3 j", budget: "300 DH/j", quoi: "3 angles",
        onRegarde: ["CPA"], decision: "garder le meilleur" }],
        ciblage: { meta: "large", tiktok: "large", exclusions: "acheteurs 30 j" },
        calendrier: [{ jour: "J1", quoi: "lancement" }], avantLancement: ["Stock vérifié"],
        risques: [{ risque: "rupture", parade: "plafonner" }], objectif: "un angle validé" };
    }
    return {};
  }

  await testAsync("la chaîne complète tourne et fait circuler les trouvailles", async () => {
    require.cache[cheminClaude] = { id: cheminClaude, filename: cheminClaude, loaded: true, exports: faux };
    delete require.cache[cheminPipeline];
    const pipe = require(cheminPipeline);

    try {
      const job = pipe.lancer({ cible: "Tapis chauffant pliable pour plats" });
      const fin = await new Promise((resolve, reject) => {
        const debut = Date.now();
        const t = setInterval(() => {
          const e = pipe.etat(job.id);
          if (e && e.statut !== "en-cours") { clearInterval(t); resolve(e); }
          else if (Date.now() - debut > 20000) { clearInterval(t); reject(new Error("délai dépassé")); }
        }, 60);
      });

      assert.strictEqual(fin.statut, "fini", "statut " + fin.statut);
      assert.strictEqual(fin.etapes.filter(e => e.statut === "fait").length, 8);

      const d = pipe.complet(job.id);

      /* Ce que la recherche a trouvé doit être repris par la validation. */
      assert.strictEqual(d.prix, 349, "le prix conseillé par la recherche n'a pas été repris");

      /* Le meilleur prix de gros trouvé à l'étape fournisseurs doit avoir
         écrasé le coût et déclenché une revalidation. */
      assert.strictEqual(d.cout, 110, "le prix de gros réel n'a pas remplacé l'estimation");
      assert.ok(d.resultats.fournisseurs.revalidation, "aucune revalidation après le prix de gros réel");

      /* Le copywriting doit avoir alimenté les créas et la landing page. */
      const landing = require("../server/store").lireLivrable(job.id, "landing.html").toString("utf8");
      assert.ok(landing.includes("Tapis chauffant pliable"), "le titre rédigé n'est pas dans la landing");
      assert.ok(landing.includes("Chauffe en 3 minutes"), "les bénéfices ne sont pas dans la landing");
      assert.ok(landing.includes("Ça consomme ?"), "les objections ne sont pas dans la landing");

      const crea = require("../server/store").lireLivrable(job.id, "crea-probleme-feed.svg").toString("utf8");
      assert.ok(crea.includes("هوك"), "le hook darija n'est pas dans la créa");

      /* Les contacts doivent être rangés au carnet partagé. */
      const carnet = require("../server/store").liste("fournisseurs");
      assert.ok(carnet.some(f => f.nom === "Grossiste Test"), "contact absent du carnet");

      /* Les sources consultées doivent remonter jusqu'au dossier. */
      assert.ok(d.sources.length > 0, "aucune source enregistrée");
    } finally {
      if (vraiClaude) require.cache[cheminClaude] = vraiClaude;
      else delete require.cache[cheminClaude];
      delete require.cache[cheminPipeline];
    }
  });

  await testAsync("une étape en échec ne fait pas tomber les suivantes", async () => {
    const cassé = Object.assign({}, faux, {
      demanderJson: async (o) => {
        if (o.prompt.includes("Écris les annonces")) throw new Error("panne simulée");
        return { donnees: reponsePour(o.prompt), sources: [], usage: {} };
      }
    });
    require.cache[cheminClaude] = { id: cheminClaude, filename: cheminClaude, loaded: true, exports: cassé };
    delete require.cache[cheminPipeline];
    const pipe = require(cheminPipeline);

    try {
      const job = pipe.lancer({ cible: "Aspirateur de voiture sans fil", prix: 259, cout: 70 });
      const fin = await new Promise((resolve, reject) => {
        const debut = Date.now();
        const t = setInterval(() => {
          const e = pipe.etat(job.id);
          if (e && e.statut !== "en-cours") { clearInterval(t); resolve(e); }
          else if (Date.now() - debut > 20000) { clearInterval(t); reject(new Error("délai dépassé")); }
        }, 60);
      });
      assert.strictEqual(fin.statut, "fini");
      const parId = {};
      fin.etapes.forEach(e => { parId[e.id] = e.statut; });
      assert.strictEqual(parId.adcopy, "echec", "l'étape cassée aurait dû être marquée en échec");
      assert.strictEqual(parId.visuels, "fait", "les visuels auraient dû être produits quand même");
      assert.strictEqual(parId.landing, "fait", "la landing aurait dû être produite quand même");
      assert.strictEqual(parId.strategie, "fait");
    } finally {
      if (vraiClaude) require.cache[cheminClaude] = vraiClaude;
      else delete require.cache[cheminClaude];
      delete require.cache[cheminPipeline];
    }
  });
});

/* ===========================================================================
   Serveur HTTP
   ======================================================================== */
groupe("Serveur HTTP", async () => {
  const { serveur } = require("../server/index");

  function requete(chemin, options) {
    return new Promise((resolve, reject) => {
      const port = serveur.address().port;
      const req = require("http").request(
        { host: "127.0.0.1", port, path: chemin, method: (options && options.methode) || "GET",
          headers: { "Content-Type": "application/json" } },
        res => {
          let corps = "";
          res.on("data", c => corps += c);
          res.on("end", () => resolve({ code: res.statusCode, type: res.headers["content-type"], corps }));
        });
      req.on("error", reject);
      if (options && options.corps) req.write(JSON.stringify(options.corps));
      req.end();
    });
  }

  await testAsync("répond sur /api/etat", async () => {
    await new Promise(r => serveur.listen(0, "127.0.0.1", r));
    const r = await requete("/api/etat");
    assert.strictEqual(r.code, 200);
    const d = JSON.parse(r.corps);
    assert.strictEqual(d.apps.length, 7);
    assert.strictEqual(d.etapes.length, 8);
    assert.strictEqual(d.compteurs.sourcesComptoir, 41);
  });

  await testAsync("sert l'atelier", async () => {
    const r = await requete("/");
    assert.strictEqual(r.code, 200);
    assert.ok(r.corps.includes("Poste COD"));
  });

  await testAsync("injecte la passerelle dans les applications", async () => {
    const r = await requete("/apps/radar-produit-cod.html");
    assert.strictEqual(r.code, 200);
    assert.ok(r.corps.includes("bridge.js"), "passerelle non injectée");
    assert.ok(r.corps.includes("Radar Produit COD"), "l'application d'origine a été abîmée");
  });

  await testAsync("refuse de sortir du dossier des applications", async () => {
    const r = await requete("/apps/..%2f..%2fpackage.json");
    assert.ok(r.code === 403 || r.code === 404, "code " + r.code + " — une remontée d'arborescence a abouti");
  });

  await testAsync("refuse de sortir du dossier public", async () => {
    const r = await requete("/public/../../package.json");
    assert.ok(r.code === 403 || r.code === 404, "code " + r.code);
  });

  await testAsync("le calcul économique est exposé", async () => {
    const r = await requete("/api/economie", { methode: "POST", corps: { nom: "X", prix: 249, cout: 135 } });
    assert.strictEqual(r.code, 200);
    const d = JSON.parse(r.corps);
    assert.ok(Math.abs(d.economie.cpaMax - 51.55) < 0.1, "CPA max " + d.economie.cpaMax);
  });

  await testAsync("le sourcing rend des routes classées", async () => {
    const r = await requete("/api/sourcing", { methode: "POST", corps: { nom: "bocaux hermétiques" } });
    assert.strictEqual(r.code, 200);
    const d = JSON.parse(r.corps);
    assert.ok(d.routes.length > 5);
    assert.ok(d.pistesContact.length >= 6);
  });

  await testAsync("une route inconnue rend un 404 lisible", async () => {
    const r = await requete("/api/nimportequoi");
    assert.strictEqual(r.code, 404);
    assert.ok(JSON.parse(r.corps).erreur.includes("Route inconnue"));
  });
});

/* ===========================================================================
   Exécution
   ======================================================================== */
(async () => {
  console.log("\n  Poste COD — tests\n");
  for (const g of groupes) {
    console.log("  " + g.nom);
    await g.fn();
    console.log("");
  }
  console.log("  " + reussis + " réussis, " + echoues + " échoués\n");

  try { fs.rmSync(bacASable, { recursive: true, force: true }); } catch (e) {}
  process.exit(echoues ? 1 : 0);
})();
