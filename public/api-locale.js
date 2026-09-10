/* =============================================================================
   L'API locale — l'édition HTML autonome.

   Le même contrat que le serveur Node (`/api/…`), mais tout se passe dans le
   navigateur : les données vivent dans localStorage, la chaîne tourne dans
   l'onglet, les livrables sont gardés en mémoire et proposés au téléchargement.

   L'interface (app.js) ne sait pas laquelle des deux répond. C'est ce qui
   permet d'avoir une seule interface pour les deux éditions.
   ========================================================================== */
(function (global) {
  "use strict";

  /* Le bundle injecte les modules partagés — les mêmes fichiers que le serveur
     utilise, sans une ligne réécrite. */
  const eco = require("./economics");
  const src = require("./sources");
  const hl = require("./horsligne");
  const radar = require("./data/radar.json");

  const PREFIXE = "poste-cod:";
  const TABLES = ["produits", "boutiques", "fournisseurs", "campagnes", "captures", "commandes"];

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

  /* ---------------------------------------------------------------------------
     Stockage — localStorage, avec repli en mémoire.

     Un navigateur peut refuser localStorage (navigation privée, cookies
     bloqués, page ouverte depuis un chemin exotique). Dans ce cas l'atelier
     doit rester utilisable pour la session en cours, et le dire.
     ------------------------------------------------------------------------ */
  const memoire = {};
  let stockagePersistant = true;

  (function testerStockage() {
    try {
      localStorage.setItem(PREFIXE + "test", "1");
      localStorage.removeItem(PREFIXE + "test");
    } catch (err) {
      stockagePersistant = false;
    }
  })();

  function lire(cle, defaut) {
    if (!stockagePersistant) return cle in memoire ? memoire[cle] : defaut;
    try {
      const brut = localStorage.getItem(PREFIXE + cle);
      return brut == null ? defaut : JSON.parse(brut);
    } catch (err) {
      return defaut;
    }
  }

  function ecrire(cle, valeur) {
    memoire[cle] = valeur;
    if (!stockagePersistant) return valeur;
    try {
      localStorage.setItem(PREFIXE + cle, JSON.stringify(valeur));
    } catch (err) {
      /* Quota dépassé : on fait de la place en jetant les livrables des plus
         vieilles campagnes, puis on réessaie une fois. Les données métier
         (produits, fournisseurs, commandes) ne sont jamais sacrifiées. */
      if (libererPlace()) {
        try { localStorage.setItem(PREFIXE + cle, JSON.stringify(valeur)); }
        catch (err2) { stockagePersistant = false; }
      } else {
        stockagePersistant = false;
      }
    }
    return valeur;
  }

  function libererPlace() {
    const campagnes = liste("campagnes").slice().sort((a, b) => (a.debut || "") < (b.debut || "") ? -1 : 1);
    let libere = false;
    for (const c of campagnes) {
      try {
        if (localStorage.getItem(PREFIXE + "livrables:" + c.id)) {
          localStorage.removeItem(PREFIXE + "livrables:" + c.id);
          libere = true;
          if (libere) break;   // une campagne à la fois, on réessaie ensuite
        }
      } catch (err) { /* rien à faire */ }
    }
    return libere;
  }

  const liste = t => { const v = lire(t, []); return Array.isArray(v) ? v : []; };
  const uid = p => (p || "id") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------------------------------------------------------------------------
     Réglages
     ------------------------------------------------------------------------ */
  function reglagesParDefaut() {
    return {
      boutique: "Ma boutique COD",
      marche: "MA", devise: "MAD", symbole: "DH",
      hypotheses: Object.assign({}, eco.DEFAUT),
      modele: "claude-opus-5",
      connecteurs: { make: {}, higgsfield: {} },
      creeLe: new Date().toISOString()
    };
  }

  function reglages() {
    const r = lire("reglages", {});
    const d = reglagesParDefaut();
    const f = Object.assign({}, d, r);
    f.hypotheses = Object.assign({}, d.hypotheses, r.hypotheses || {});
    f.connecteurs = {
      make: Object.assign({}, (r.connecteurs || {}).make || {}),
      higgsfield: Object.assign({}, (r.connecteurs || {}).higgsfield || {})
    };
    return f;
  }

  function majReglages(champs) {
    const a = reglages();
    const s = Object.assign({}, a, champs);
    if (champs && champs.hypotheses) s.hypotheses = Object.assign({}, a.hypotheses, champs.hypotheses);
    if (champs && champs.connecteurs) {
      s.connecteurs = {
        make: Object.assign({}, a.connecteurs.make, champs.connecteurs.make || {}),
        higgsfield: Object.assign({}, a.connecteurs.higgsfield, champs.connecteurs.higgsfield || {})
      };
    }
    return ecrire("reglages", s);
  }

  /* ---------------------------------------------------------------------------
     Livrables — gardés par campagne, servis en blob:
     ------------------------------------------------------------------------ */
  const urlsBlob = {};   // "campagne/fichier" -> blob URL déjà créée

  function livrablesDe(id) { return lire("livrables:" + id, {}); }

  function ecrireLivrable(id, fichier, contenu) {
    const m = livrablesDe(id);
    m[fichier] = contenu;
    ecrire("livrables:" + id, m);
    return { fichier, octets: contenu.length };
  }

  function listerLivrables(id) {
    const m = livrablesDe(id);
    return Object.keys(m).map(f => ({ fichier: f, octets: m[f].length }));
  }

  const TYPES = { ".svg": "image/svg+xml", ".html": "text/html", ".json": "application/json", ".txt": "text/plain" };

  function urlFichier(id, fichier) {
    const cle = id + "/" + fichier;
    if (urlsBlob[cle]) return urlsBlob[cle];
    const contenu = livrablesDe(id)[fichier];
    if (contenu == null) return "";
    const ext = fichier.slice(fichier.lastIndexOf("."));
    const blob = new Blob([contenu], { type: (TYPES[ext] || "application/octet-stream") + ";charset=utf-8" });
    urlsBlob[cle] = URL.createObjectURL(blob);
    return urlsBlob[cle];
  }

  /* ---------------------------------------------------------------------------
     La chaîne, dans l'onglet.

     Elle est découpée en tours d'événement pour que l'interface puisse
     redessiner entre deux étapes : sans ça, les huit étapes s'exécuteraient
     dans le même tour et l'écran ne montrerait que le résultat final.
     ------------------------------------------------------------------------ */
  const travaux = {};
  const abonnes = {};

  function abonner(id, fn) {
    (abonnes[id] = abonnes[id] || []).push(fn);
    return () => { abonnes[id] = (abonnes[id] || []).filter(f => f !== fn); };
  }

  function diffuser(id, ev) {
    (abonnes[id] || []).forEach(fn => { try { fn(ev); } catch (err) { /* abonné parti */ } });
  }

  const souffler = () => new Promise(r => setTimeout(r, 0));

  function resume(job) {
    return {
      id: job.id, cible: job.cible, type: job.type, statut: job.statut,
      mode: job.mode, debut: job.debut, fin: job.fin || null, erreur: job.erreur || null,
      etapes: job.etapes.map(e => ({
        id: e.id, nom: e.nom, verbe: e.verbe, statut: e.statut,
        duree: e.duree || null, note: e.note || null, erreur: e.erreur || null
      })),
      livrables: listerLivrables(job.id)
    };
  }

  function lancer(demande) {
    const d = demande || {};
    const r = reglages();
    const cible = String(d.cible || "").trim();
    if (!cible) throw new Error("Indiquez un produit ou une catégorie.");

    const job = {
      id: uid("camp"), cible,
      type: d.type === "categorie" ? "categorie" : "produit",
      prix: d.prix != null ? Number(d.prix) : null,
      cout: d.cout != null ? Number(d.cout) : null,
      boutique: r.boutique,
      whatsapp: r.whatsapp || "",
      hypotheses: r.hypotheses,
      devise: r.symbole || "DH",
      mode: "hors-ligne",
      statut: "en-cours",
      debut: new Date().toISOString(),
      etapes: ETAPES.map(e => Object.assign({ statut: "attente" }, e)),
      resultats: {}
    };

    travaux[job.id] = job;
    executer(job).catch(err => {
      job.statut = "echec";
      job.erreur = err.message;
      job.fin = new Date().toISOString();
      diffuser(job.id, { type: "fin", job: resume(job) });
    });
    return resume(job);
  }

  async function executer(job) {
    const majEtape = (id, champs) => {
      const e = job.etapes.find(x => x.id === id);
      if (!e) return;
      Object.assign(e, champs);
      diffuser(job.id, { type: "etape", etape: e, job: resume(job) });
    };

    const ctx = () => ({
      cible: job.cible, produitRetenu: job.produitRetenu,
      prix: job.prix, cout: job.cout, hypotheses: job.hypotheses,
      boutique: job.boutique, whatsapp: job.whatsapp, devise: job.devise,
      copy: job.copy, recherche: job.resultats.recherche,
      visuels: job.resultats.visuels, economie: job.economie,
      webhookUrl: (reglages().connecteurs.make || {}).webhook || ""
    });

    const suite = [
      ["recherche",    () => hl.recherche(ctx())],
      ["validation",   () => {
        const res = hl.validation(ctx());
        job.prix = res.prix; job.cout = res.cout; job.economie = res.economie;
        return res;
      }],
      ["fournisseurs", () => hl.fournisseurs(ctx())],
      ["adcopy",       () => { job.copy = hl.adcopy(ctx()); return job.copy; }],
      ["scripts",      () => hl.scripts()],
      ["visuels",      () => {
        const v = hl.visuels(ctx());
        v.jeu.forEach(c => ecrireLivrable(job.id, c.fichier, c.svg));
        return v.resume;
      }],
      ["landing",      () => {
        const r = hl.landingPage(ctx());
        ecrireLivrable(job.id, "landing.html", r.html);
        return r.resume;
      }],
      ["strategie",    () => hl.strategie(ctx())]
    ];

    for (const [id, fn] of suite) {
      const t0 = Date.now();
      majEtape(id, { statut: "en-cours" });
      await souffler();          // laisse l'interface redessiner
      try {
        const res = fn();
        job.resultats[id] = res;
        majEtape(id, { statut: "fait", duree: Date.now() - t0, note: res && res.note ? res.note : null });

        if (id === "validation" && res.verdict === "bloquant") {
          job.statut = "arrete";
          job.arret = res.raison;
          job.fin = new Date().toISOString();
          job.etapes.filter(e => e.statut === "attente")
            .forEach(e => majEtape(e.id, { statut: "sautee", note: "Arrêté à la validation" }));
          terminer(job);
          return;
        }
      } catch (err) {
        majEtape(id, { statut: "echec", duree: Date.now() - t0, erreur: err.message });
        job.resultats[id] = { echec: true, erreur: err.message };
      }
    }

    job.statut = "fini";
    job.fin = new Date().toISOString();
    terminer(job);
  }

  function terminer(job) {
    const dossier = {
      id: job.id, cible: job.cible, type: job.type, mode: job.mode,
      debut: job.debut, fin: job.fin, statut: job.statut, arret: job.arret || null,
      boutique: job.boutique, prix: job.prix, cout: job.cout,
      hypotheses: job.hypotheses, resultats: job.resultats
    };
    ecrireLivrable(job.id, "campagne.json", JSON.stringify(dossier, null, 1));

    const campagnes = liste("campagnes");
    campagnes.push({
      id: job.id, cible: job.cible, type: job.type, statut: job.statut,
      mode: job.mode, debut: job.debut, fin: job.fin,
      score: (job.resultats.validation || {}).score || null,
      verdict: (job.resultats.validation || {}).verdict || null,
      prix: job.prix, cout: job.cout
    });
    ecrire("campagnes", campagnes);

    envoyerMake(job);
    diffuser(job.id, { type: "fin", job: resume(job) });
  }

  /* Depuis un navigateur, on ne peut pas lire la réponse d'un webhook Make :
     il ne renvoie pas d'en-tête CORS. On envoie donc en « no-cors », ce qui
     part bien mais ne dit pas si c'est arrivé. L'interface le précise. */
  function envoyerMake(job) {
    const w = (reglages().connecteurs.make || {}).webhook;
    if (!w) return;
    const v = job.resultats.validation || {};
    const e = v.economie || {};
    try {
      fetch(w, {
        method: "POST", mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
          source: "poste-cod", edition: "html",
          type: job.statut === "arrete" ? "campagne.arretee" : "campagne.terminee",
          le: new Date().toISOString(),
          campagne: job.id, cible: job.cible, boutique: job.boutique,
          prix: job.prix, cout: job.cout,
          score: v.score != null ? v.score : null,
          cpaMax: e.cpaMax != null ? e.cpaMax : null,
          raisonArret: job.arret || null
        })
      }).catch(function () {});
    } catch (err) { /* rien à faire, l'envoi est sans retour */ }
  }

  function complet(id) {
    const job = travaux[id];
    if (job) {
      return Object.assign({}, resume(job), {
        prix: job.prix, cout: job.cout, hypotheses: job.hypotheses,
        resultats: job.resultats, arret: job.arret || null, sources: []
      });
    }
    /* Campagne d'une session précédente : on relit son dossier. */
    const brut = livrablesDe(id)["campagne.json"];
    if (!brut) return null;
    try {
      const d = JSON.parse(brut);
      d.livrables = listerLivrables(id);
      return d;
    } catch (err) { return null; }
  }

  /* ---------------------------------------------------------------------------
     Le routeur — mêmes chemins que le serveur
     ------------------------------------------------------------------------ */
  async function appel(chemin, options) {
    const o = options || {};
    const methode = (o.method || "GET").toUpperCase();
    const corps = o.body ? JSON.parse(o.body) : {};
    const seg = chemin.split("?")[0].split("/").filter(Boolean);

    if (seg[0] === "etat") {
      const r = reglages();
      const c = r.connecteurs;
      return {
        edition: "html",
        stockagePersistant,
        claude: {
          disponible: false, sdkInstalle: false, cleConfiguree: false, modele: r.modele,
          raison: "Édition HTML : la recherche web et la rédaction en darija demandent " +
            "l'édition Node, qui garde la clé API hors du navigateur."
        },
        connecteurs: {
          make: {
            actif: !!(c.make && c.make.webhook), webhook: !!(c.make && c.make.webhook),
            api: false, zone: (c.make && c.make.zone) || "eu2", source: "réglages",
            raison: (c.make && c.make.webhook)
              ? null
              : "Aucun webhook Make. Créez un webhook « Custom webhook » dans un scénario et collez son URL."
          },
          higgsfield: {
            actif: false, profil: "v2",
            raison: "Édition HTML : Higgsfield demande l'édition Node — sa clé ne doit pas vivre dans une page web."
          }
        },
        reglages: r,
        apps: (global.POSTE_COD_APPS || []).map(a => ({ id: a.id, nom: a.nom, emoji: a.emoji, quoi: a.quoi, url: "" })),
        etapes: ETAPES,
        compteurs: {
          produits: liste("produits").length,
          boutiques: liste("boutiques").length,
          fournisseurs: liste("fournisseurs").length,
          campagnes: liste("campagnes").length,
          captures: liste("captures").length,
          commandes: liste("commandes").length,
          catalogueRadar: radar.produits.length,
          sourcesComptoir: src.SOURCES.length
        }
      };
    }

    if (seg[0] === "reglages") {
      if (methode === "GET") return reglages();
      return majReglages(corps);
    }

    if (seg[0] === "catalogue") return { produits: radar.produits, marches: radar.marches };

    if (seg[0] === "comptoir") {
      return { sources: src.SOURCES, categories: src.CATEGORIES, types: src.TYPES, annuaires: src.ANNUAIRES };
    }

    if (seg[0] === "economie" && methode === "POST") {
      const hyp = Object.assign({}, reglages().hypotheses, corps.hypotheses || {});
      const note = eco.scoreProduit({ nom: corps.nom, prix: Number(corps.prix), cout: Number(corps.cout), criteres: corps.criteres }, hyp);
      return {
        score: note.score, verdict: note.verdict, detail: note.parts,
        economie: note.economie, budget: eco.planBudget(note.economie),
        correctifs: {
          prixMinimum: eco.prixPourCpa(Number(corps.cout), hyp.cplPlancher + 20, hyp),
          coutMaximum: eco.coutMaxPour(Number(corps.prix), hyp.cplPlancher + 20, hyp)
        }
      };
    }

    if (seg[0] === "sourcing" && methode === "POST") {
      const nom = String(corps.nom || "");
      const cat = corps.categorieId || src.categoriser(nom).id;
      const routes = src.routesAchat({ nom, requete: nom }, { categorieId: cat, marche: corps.marche });
      return {
        categorie: src.categoriser(nom),
        routes: src.estimerCouts(routes, corps.cout ? { sourceId: routes[0] && routes[0].id, cout: Number(corps.cout) } : null),
        pistesContact: src.pistesContact(nom, corps.ville),
        plafonds: src.plafondsPrix(nom),
        annuaires: src.ANNUAIRES
      };
    }

    if (seg[0] === "campagnes") {
      if (methode === "GET" && !seg[1]) {
        const enMemoire = Object.keys(travaux).map(k => resume(travaux[k]));
        const vus = {};
        enMemoire.forEach(j => { vus[j.id] = true; });
        return enMemoire.concat(liste("campagnes").filter(c => !vus[c.id]));
      }
      if (methode === "POST" && !seg[1]) return lancer(corps);
      if (seg[1] && !seg[2] && methode === "GET") {
        const d = complet(seg[1]);
        if (!d) throw new Error("Campagne introuvable");
        return d;
      }
    }

    if (seg[0] === "commandes" && methode === "POST") {
      const tel = String(corps.telephone || corps.tel || "").replace(/\D/g, "");
      if (!corps.nom || !tel) throw new Error("Nom et téléphone sont obligatoires.");
      const items = liste("commandes");
      const c = {
        id: uid("com"), creeLe: new Date().toISOString(),
        produit: corps.produit || null, prix: corps.prix != null ? corps.prix : null,
        nom: String(corps.nom).slice(0, 120), telephone: tel, ville: corps.ville || null,
        statut: "nouvelle", origine: corps.origine || "landing"
      };
      items.push(c);
      ecrire("commandes", items);
      return { commande: c.id, make: { envoye: false, raison: "édition HTML : envoi sans retour" } };
    }

    if (TABLES.indexOf(seg[0]) >= 0) {
      const table = seg[0];
      if (methode === "GET" && !seg[1]) return liste(table);
      if (methode === "POST" && !seg[1]) {
        const items = liste(table);
        if (Array.isArray(corps)) {
          const cle = table === "boutiques" ? "domaine" : "nom";
          let ajoutes = 0, majs = 0;
          corps.forEach(x => {
            const i = x[cle] == null ? -1 : items.findIndex(y => y[cle] === x[cle]);
            if (i >= 0) { items[i] = Object.assign({}, items[i], x); majs++; }
            else { items.push(Object.assign({ id: uid(table.slice(0, 3)) }, x)); ajoutes++; }
          });
          ecrire(table, items);
          return { ajoutes, majs, total: corps.length };
        }
        const item = Object.assign({ id: uid(table.slice(0, 3)), creeLe: new Date().toISOString() }, corps);
        items.push(item);
        ecrire(table, items);
        return item;
      }
      if (methode === "DELETE" && seg[1]) {
        ecrire(table, liste(table).filter(x => x.id !== seg[1]));
        return { supprime: seg[1] };
      }
      if (methode === "PATCH" && seg[1]) {
        const items = liste(table);
        const i = items.findIndex(x => x.id === seg[1]);
        if (i < 0) throw new Error("Introuvable");
        items[i] = Object.assign({}, items[i], corps);
        ecrire(table, items);
        return items[i];
      }
    }

    if (seg[0] === "export") {
      const out = { version: 1, edition: "html", exporteLe: new Date().toISOString(), reglages: reglages() };
      TABLES.forEach(t => { out[t] = liste(t); });
      return out;
    }

    if (seg[0] === "import" && methode === "POST") {
      const faits = [];
      TABLES.forEach(t => { if (corps[t] !== undefined) { ecrire(t, corps[t]); faits.push(t); } });
      if (corps.reglages) { ecrire("reglages", corps.reglages); faits.push("reglages"); }
      return { importe: faits };
    }

    if (seg[0] === "connecteurs") {
      if (seg[1] === "make" && seg[2] === "test") {
        const w = (reglages().connecteurs.make || {}).webhook;
        if (!w) return { webhook: { envoye: false, raison: "aucun webhook configuré" }, api: { ok: false, raison: "édition HTML" } };
        try {
          await fetch(w, {
            method: "POST", mode: "no-cors",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: JSON.stringify({ source: "poste-cod", edition: "html", type: "test", le: new Date().toISOString() })
          });
          return {
            webhook: { envoye: true, reponse: "envoyé sans retour — vérifiez dans Make" },
            api: { ok: false, raison: "l'API Make demande l'édition Node" }
          };
        } catch (err) {
          return { webhook: { envoye: false, erreur: err.message }, api: { ok: false, raison: "édition HTML" } };
        }
      }
      if (seg[1] === "higgsfield" && seg[2] === "test") {
        return { ok: false, erreur: "Higgsfield demande l'édition Node — sa clé ne doit pas vivre dans une page web." };
      }
      return (await appel("/etat")).connecteurs;
    }

    throw new Error("Route inconnue : " + methode + " " + chemin);
  }

  global.POSTE_COD_LOCAL = {
    appel, urlFichier, listerLivrables, livrablesDe, abonner,
    stockagePersistant: () => stockagePersistant
  };
})(typeof window !== "undefined" ? window : this);
