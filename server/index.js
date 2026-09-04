"use strict";
/* =============================================================================
   Serveur local — http natif, aucune dépendance.

   Sert trois choses depuis la même origine :
     /            l'atelier (le shell qui réunit tout)
     /apps/…      les six applications existantes, telles quelles
     /api/…       les données partagées et l'orchestrateur

   La même origine, ce n'est pas un détail : les applications d'origine
   enregistrent leur état dans localStorage. Servies toutes depuis
   http://localhost:4321, elles partagent ce stockage — c'est ce qui permet à
   l'atelier de lire l'inventaire de Rayon COD ou les produits du Radar sans
   qu'aucune d'elles n'ait été réécrite.
   ========================================================================== */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

/* Le .env doit être lu avant tout module qui regarde process.env — c'est le
   cas du client Claude, qui décide au chargement s'il a une clé. */
(function chargerEnv() {
  const fichier = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(fichier)) return;
  if (typeof process.loadEnvFile === "function") {
    try { process.loadEnvFile(fichier); return; } catch (err) { /* on tente à la main */ }
  }
  /* Node < 20.6 : analyse minimale, suffisante pour KEY=valeur. */
  fs.readFileSync(fichier, "utf8").split("\n").forEach(ligne => {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) return;
    const val = m[2].replace(/^["']|["']$/g, "");
    /* Une variable exportée mais vide ne doit pas bloquer le .env. */
    if (!process.env[m[1]]) process.env[m[1]] = val;
  });
})();

const store = require("./store");
const pipeline = require("./pipeline");
const claude = require("./claude");
const eco = require("./economics");
const src = require("./sources");
const radar = require("./data/radar.json");

const RACINE = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 4321;

/* Les applications réunies. `pont: true` = on y injecte la passerelle. */
const APPS = [
  { id: "espion",    fichier: "espion-cod.html",       nom: "Espion COD",        emoji: "🛰️",
    quoi: "Les boutiques COD marocaines sous surveillance, et les produits qui bougent chez elles.", pont: true },
  { id: "radar",     fichier: "radar-produit-cod.html", nom: "Radar Produit COD", emoji: "🎯",
    quoi: "45 candidats notés sur huit critères, chiffrés sur neuf marchés.", pont: true },
  { id: "comptoir",  fichier: "comptoir-cod.html",      nom: "Comptoir COD",      emoji: "🧭",
    quoi: "41 sources d'approvisionnement, du marché de Derb Omar à l'usine de Yiwu.", pont: true },
  { id: "pilote",    fichier: "pilote-cod.html",        nom: "Pilote COD",        emoji: "📊",
    quoi: "Commandes, campagnes, marges : ce que la boutique a réellement encaissé.", pont: true },
  { id: "rayon",     fichier: "rayon-cod.html",         nom: "Rayon COD",         emoji: "📦",
    quoi: "Stock, entrées, sorties, alertes de réapprovisionnement.", pont: true },
  { id: "registre",  fichier: "registre-whatsapp.html", nom: "Registre WhatsApp", emoji: "💬",
    quoi: "Les commandes qui arrivent en discussion, extraites en tableau.", pont: true },
  { id: "lancement", fichier: "lancement-cod.html",     nom: "Lancement COD",     emoji: "🚀",
    quoi: "Le dossier de campagne de septembre — cinq produits, cinq packs.", pont: false }
];

/* ---------------------------------------------------------------------------
   Utilitaires HTTP
   ------------------------------------------------------------------------ */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2", ".map": "application/json"
};

function envoyer(res, code, corps, type, entetes) {
  const t = type || "text/plain; charset=utf-8";
  const buf = Buffer.isBuffer(corps) ? corps : Buffer.from(String(corps), "utf8");
  res.writeHead(code, Object.assign({
    "Content-Type": t,
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }, entetes || {}));
  res.end(buf);
}

const json = (res, code, obj) => envoyer(res, code, JSON.stringify(obj), MIME[".json"]);

function corpsJson(req) {
  return new Promise((resolve, reject) => {
    const morceaux = [];
    let taille = 0;
    req.on("data", c => {
      taille += c.length;
      if (taille > 12 * 1024 * 1024) { reject(new Error("Corps de requête trop volumineux")); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on("end", () => {
      const t = Buffer.concat(morceaux).toString("utf8");
      if (!t) return resolve({});
      try { resolve(JSON.parse(t)); } catch (err) { reject(new Error("JSON invalide")); }
    });
    req.on("error", reject);
  });
}

/* Sert un fichier en refusant toute sortie du dossier autorisé. */
function servirFichier(res, base, relatif, transformer) {
  const cible = path.resolve(path.join(base, relatif));
  const racine = path.resolve(base);
  if (cible !== racine && !cible.startsWith(racine + path.sep)) {
    return envoyer(res, 403, "Accès refusé");
  }
  fs.readFile(cible, (err, data) => {
    if (err) return envoyer(res, 404, "Introuvable : " + relatif);
    const ext = path.extname(cible).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    if (transformer && ext === ".html") {
      return envoyer(res, 200, transformer(data.toString("utf8")), type);
    }
    envoyer(res, 200, data, type);
  });
}

/* ---------------------------------------------------------------------------
   La passerelle injectée dans les applications d'origine.

   Elle ne touche à rien de leur code : elle ajoute une barre en haut qui
   ramène à l'atelier et permet d'envoyer la sélection courante à
   l'orchestrateur. Le reste passe par le localStorage partagé.
   ------------------------------------------------------------------------ */
function injecterPont(html, app) {
  const balise = '<script src="/public/bridge.js" data-app="' + app.id +
    '" data-nom="' + app.nom.replace(/"/g, "&quot;") + '" defer></script>';
  if (html.includes("</body>")) return html.replace("</body>", balise + "\n</body>");
  return html + "\n" + balise;
}

/* ---------------------------------------------------------------------------
   API
   ------------------------------------------------------------------------ */
async function api(req, res, chemin, requete) {
  const seg = chemin.split("/").filter(Boolean);   // ["api", ...]
  const r = seg.slice(1);
  const methode = req.method;

  /* ---- état général ---- */
  if (r[0] === "etat" && methode === "GET") {
    return json(res, 200, {
      claude: claude.etat(),
      reglages: store.reglages(),
      apps: APPS.map(a => ({ id: a.id, nom: a.nom, emoji: a.emoji, quoi: a.quoi, url: "/apps/" + a.fichier })),
      etapes: pipeline.ETAPES,
      compteurs: {
        produits: store.liste("produits").length,
        boutiques: store.liste("boutiques").length,
        fournisseurs: store.liste("fournisseurs").length,
        campagnes: store.liste("campagnes").length,
        captures: store.liste("captures").length,
        catalogueRadar: radar.produits.length,
        sourcesComptoir: src.SOURCES.length
      }
    });
  }

  /* ---- réglages ---- */
  if (r[0] === "reglages") {
    if (methode === "GET") return json(res, 200, store.reglages());
    if (methode === "PUT" || methode === "POST") {
      const corps = await corpsJson(req);
      return json(res, 200, store.majReglages(corps));
    }
  }

  /* ---- collections génériques ---- */
  const COLLECTIONS = ["produits", "boutiques", "fournisseurs", "captures"];
  if (COLLECTIONS.includes(r[0])) {
    const table = r[0];
    if (methode === "GET" && !r[1]) return json(res, 200, store.liste(table));
    if (methode === "POST" && !r[1]) {
      const corps = await corpsJson(req);
      if (Array.isArray(corps)) {
        /* Import en lot : on fusionne sur le nom pour ne pas dupliquer. */
        const cle = table === "boutiques" ? "domaine" : "nom";
        const faits = corps.map(x => store.fusionner(table, cle, x));
        return json(res, 200, { ajoutes: faits.filter(f => f.nouveau).length, majs: faits.filter(f => !f.nouveau).length, total: faits.length });
      }
      return json(res, 201, store.ajouter(table, corps));
    }
    if (methode === "PATCH" && r[1]) {
      const corps = await corpsJson(req);
      const maj = store.majSur(table, r[1], corps);
      return maj ? json(res, 200, maj) : json(res, 404, { erreur: "Introuvable" });
    }
    if (methode === "DELETE" && r[1]) {
      return json(res, store.supprimer(table, r[1]) ? 200 : 404, { supprime: r[1] });
    }
  }

  /* ---- catalogue Radar (lecture seule) ---- */
  if (r[0] === "catalogue" && methode === "GET") {
    return json(res, 200, { produits: radar.produits, marches: radar.marches });
  }

  /* ---- base Comptoir ---- */
  if (r[0] === "comptoir" && methode === "GET") {
    return json(res, 200, { sources: src.SOURCES, categories: src.CATEGORIES, types: src.TYPES, annuaires: src.ANNUAIRES });
  }

  /* ---- calcul économique à la volée ---- */
  if (r[0] === "economie" && methode === "POST") {
    const c = await corpsJson(req);
    const hyp = Object.assign({}, store.reglages().hypotheses, c.hypotheses || {});
    const note = eco.scoreProduit({ nom: c.nom, prix: Number(c.prix), cout: Number(c.cout), criteres: c.criteres }, hyp);
    return json(res, 200, {
      score: note.score, verdict: note.verdict, detail: note.parts,
      economie: note.economie, budget: eco.planBudget(note.economie),
      correctifs: {
        prixMinimum: eco.prixPourCpa(Number(c.cout), hyp.cplPlancher + 20, hyp),
        coutMaximum: eco.coutMaxPour(Number(c.prix), hyp.cplPlancher + 20, hyp)
      }
    });
  }

  /* ---- routes d'achat pour une requête ---- */
  if (r[0] === "sourcing" && methode === "POST") {
    const c = await corpsJson(req);
    const nom = String(c.nom || "");
    const cat = c.categorieId || src.categoriser(nom).id;
    const routes = src.routesAchat({ nom, requete: nom }, { categorieId: cat, marche: c.marche });
    return json(res, 200, {
      categorie: src.categoriser(nom),
      routes: src.estimerCouts(routes, c.cout ? { sourceId: routes[0] && routes[0].id, cout: Number(c.cout) } : null),
      pistesContact: src.pistesContact(nom, c.ville),
      plafonds: src.plafondsPrix(nom),
      annuaires: src.ANNUAIRES
    });
  }

  /* ---- campagnes ---- */
  if (r[0] === "campagnes") {
    if (methode === "GET" && !r[1]) return json(res, 200, pipeline.lister());

    if (methode === "POST" && !r[1]) {
      const c = await corpsJson(req);
      try {
        return json(res, 202, pipeline.lancer(c));
      } catch (err) {
        return json(res, 400, { erreur: err.message });
      }
    }

    if (r[1] && r[2] === "flux" && methode === "GET") {
      return fluxSse(req, res, r[1]);
    }

    if (r[1] && r[2] === "fichier" && r[3] && methode === "GET") {
      const nom = decodeURIComponent(r.slice(3).join("/"));
      const data = store.lireLivrable(r[1], nom);
      if (!data) return envoyer(res, 404, "Livrable introuvable");
      const ext = path.extname(nom).toLowerCase();
      /* Les landing pages et les SVG sont servis pour être vus dans un iframe :
         pas de sniffing, et on ne les met pas en cache pendant qu'on itère. */
      return envoyer(res, 200, data, MIME[ext] || "application/octet-stream");
    }

    if (r[1] && !r[2] && methode === "GET") {
      const d = pipeline.complet(r[1]);
      return d ? json(res, 200, d) : json(res, 404, { erreur: "Campagne introuvable" });
    }
  }

  /* ---- sauvegarde / restauration ---- */
  if (r[0] === "export" && methode === "GET") {
    return envoyer(res, 200, JSON.stringify(store.exporterTout(), null, 1), MIME[".json"], {
      "Content-Disposition": 'attachment; filename="poste-cod-' + new Date().toISOString().slice(0, 10) + '.json"'
    });
  }
  if (r[0] === "import" && methode === "POST") {
    const c = await corpsJson(req);
    try {
      return json(res, 200, { importe: store.importerTout(c) });
    } catch (err) {
      return json(res, 400, { erreur: err.message });
    }
  }

  return json(res, 404, { erreur: "Route inconnue : " + methode + " " + chemin });
}

/* ---------------------------------------------------------------------------
   Flux d'avancement (Server-Sent Events)
   ------------------------------------------------------------------------ */
function fluxSse(req, res, jobId) {
  const etat = pipeline.etat(jobId);
  if (!etat) return json(res, 404, { erreur: "Campagne introuvable" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const pousser = ev => {
    try { res.write("data: " + JSON.stringify(ev) + "\n\n"); } catch (err) { /* client parti */ }
  };

  pousser({ type: "etat", job: etat });

  /* Une chaîne hors ligne dure une dizaine de millisecondes : elle peut être
     finie avant que le navigateur n'ait eu le temps de s'abonner. Sans ce
     rattrapage, l'événement de fin est déjà passé et l'interface reste sur
     l'écran de progression, résultats invisibles. */
  if (etat.statut !== "en-cours") {
    pousser({ type: "fin", job: etat });
    return res.end();
  }

  const desabonner = pipeline.abonner(jobId, ev => {
    pousser(ev);
    if (ev.type === "fin") { clearInterval(battement); desabonner(); res.end(); }
  });

  /* Un commentaire toutes les 20 s : garde la connexion ouverte derrière
     les proxys qui coupent les flux silencieux. */
  const battement = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 20000);

  req.on("close", () => { clearInterval(battement); desabonner(); });
}

/* ---------------------------------------------------------------------------
   Routage
   ------------------------------------------------------------------------ */
const serveur = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const chemin = decodeURIComponent(u.pathname);

  if (chemin === "/" || chemin === "/index.html") {
    return servirFichier(res, path.join(RACINE, "public"), "index.html");
  }

  if (chemin.startsWith("/public/")) {
    return servirFichier(res, path.join(RACINE, "public"), chemin.slice("/public/".length));
  }

  if (chemin.startsWith("/apps/")) {
    const nomFichier = chemin.slice("/apps/".length);
    const app = APPS.find(a => a.fichier === nomFichier);
    return servirFichier(res, path.join(RACINE, "apps"), nomFichier,
      app && app.pont ? (html => injecterPont(html, app)) : null);
  }

  if (chemin.startsWith("/api/")) {
    return api(req, res, chemin, u.query).catch(err => {
      console.error("[api]", err);
      json(res, 500, { erreur: err.message || "Erreur serveur" });
    });
  }

  if (chemin === "/sante") return json(res, 200, { ok: true, version: 1 });

  envoyer(res, 404, "Introuvable");
});

/* ---------------------------------------------------------------------------
   Démarrage
   ------------------------------------------------------------------------ */
function demarrer(port) {
  const p = port || PORT;
  serveur.listen(p, "127.0.0.1", () => {
    const e = claude.etat();
    console.log("");
    console.log("  Poste COD — l'atelier est ouvert");
    console.log("  → http://localhost:" + p);
    console.log("");
    console.log("  Applications réunies : " + APPS.map(a => a.nom).join(" · "));
    console.log("  Orchestrateur : " + (e.disponible
      ? "en direct (" + e.modele + ", recherche web active)"
      : "hors ligne — " + e.raison));
    console.log("  Données : " + store.RACINE);
    console.log("");
  });
  serveur.on("error", err => {
    if (err.code === "EADDRINUSE") {
      console.error("Le port " + p + " est déjà pris. Lancez : PORT=4322 npm start");
      process.exit(1);
    }
    throw err;
  });
  return serveur;
}

if (require.main === module) demarrer();

module.exports = { serveur, demarrer, APPS, PORT };
