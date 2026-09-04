"use strict";
/* =============================================================================
   Connecteurs — les liens vers l'extérieur.

   Deux, tous les deux facultatifs. L'application marche entièrement sans eux ;
   quand ils sont configurés, elle s'en sert et le dit.

     Make        pousse les évènements de l'atelier (campagne terminée, commande
                 reçue) vers vos scénarios existants, et peut en déclencher un.
     Higgsfield  produit des visuels produit photoréalistes en plus des créas SVG.

   Les identifiants viennent d'abord de l'environnement, sinon des réglages.
   L'environnement gagne toujours : une clé dans un .env ne traîne pas dans un
   fichier de données qu'on exporte ou qu'on envoie par WhatsApp.
   ========================================================================== */

const https = require("https");
const http = require("http");
const { URL } = require("url");

const DELAI = 30000;          // délai d'une requête, en ms
const DELAI_IMAGE = 180000;   // une génération d'image peut prendre 2 à 3 minutes

/* ---------------------------------------------------------------------------
   Requête HTTP — sans dépendance, avec délai ferme.

   `fetch` global ferait l'affaire, mais on veut un contrôle explicite du délai
   et un message d'erreur lisible dans l'interface plutôt qu'un AbortError nu.
   ------------------------------------------------------------------------ */
function requete(url, options) {
  const o = options || {};
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (err) { return reject(new Error("URL invalide : " + url)); }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return reject(new Error("Protocole refusé : " + u.protocol));
    }
    const transport = u.protocol === "https:" ? https : http;
    const corps = o.corps ? Buffer.from(JSON.stringify(o.corps), "utf8") : null;

    const req = transport.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method: o.methode || "GET",
      headers: Object.assign(
        { "Accept": "application/json", "User-Agent": "Poste-COD/1.0" },
        corps ? { "Content-Type": "application/json", "Content-Length": corps.length } : {},
        o.entetes || {}
      )
    }, res => {
      const morceaux = [];
      let taille = 0;
      res.on("data", c => {
        taille += c.length;
        /* Une réponse d'API qui dépasse 24 Mo n'est pas une réponse d'API. */
        if (taille > 24 * 1024 * 1024) { req.destroy(new Error("Réponse trop volumineuse")); return; }
        morceaux.push(c);
      });
      res.on("end", () => {
        const brut = Buffer.concat(morceaux);
        const texte = brut.toString("utf8");
        let donnees = null;
        try { donnees = JSON.parse(texte); } catch (err) { /* pas du JSON, on garde le texte */ }
        if (res.statusCode >= 400) {
          const detail = (donnees && (donnees.message || donnees.error || donnees.detail)) ||
            texte.slice(0, 300) || "sans détail";
          return reject(new Error("HTTP " + res.statusCode + " — " + detail));
        }
        resolve({ code: res.statusCode, donnees, texte, brut, entetes: res.headers });
      });
    });

    req.setTimeout(o.delai || DELAI, () => {
      req.destroy(new Error("Délai dépassé après " + Math.round((o.delai || DELAI) / 1000) + " s"));
    });
    req.on("error", err => reject(err));
    if (corps) req.write(corps);
    req.end();
  });
}

/* Télécharge un binaire (une image générée). */
function telecharger(url, delai) {
  return requete(url, { delai: delai || DELAI }).then(r => r.brut);
}

/* ---------------------------------------------------------------------------
   Configuration
   ------------------------------------------------------------------------ */
function config(reglages) {
  const c = (reglages && reglages.connecteurs) || {};
  const m = c.make || {};
  const h = c.higgsfield || {};
  return {
    make: {
      webhook: process.env.MAKE_WEBHOOK_URL || m.webhook || "",
      token: process.env.MAKE_API_TOKEN || m.token || "",
      zone: process.env.MAKE_ZONE || m.zone || "eu2",
      equipe: process.env.MAKE_TEAM_ID || m.equipe || "",
      base: process.env.MAKE_API_BASE || ""
    },
    higgsfield: {
      /* Les hôtes sont surchargeables : la documentation Higgsfield en cite deux
         selon la page, et les tests ont besoin de viser un serveur local. */
      baseV2: process.env.HIGGSFIELD_BASE_V2 || "https://api.higgsfield.ai",
      baseV1: process.env.HIGGSFIELD_BASE_V1 || "https://platform.higgsfield.ai",
      cleId: process.env.HIGGSFIELD_KEY_ID || h.cleId || "",
      cleSecret: process.env.HIGGSFIELD_KEY_SECRET || h.cleSecret || "",
      /* La documentation Higgsfield décrit deux contrats concurrents.
         « v2 » est celui présenté comme courant ; « v1 » est l'ancien, dont la
         forme de réponse est en revanche entièrement documentée. */
      profil: process.env.HIGGSFIELD_PROFIL || h.profil || "v2",
      modele: process.env.HIGGSFIELD_MODEL || h.modele || "higgsfield-ai/soul/v2/standard"
    }
  };
}

function etat(reglages) {
  const c = config(reglages);
  const parEnv = k => process.env[k] ? "environnement" : "réglages";
  return {
    make: {
      actif: !!c.make.webhook || !!c.make.token,
      webhook: !!c.make.webhook,
      api: !!c.make.token,
      zone: c.make.zone,
      source: c.make.webhook ? parEnv("MAKE_WEBHOOK_URL") : (c.make.token ? parEnv("MAKE_API_TOKEN") : null),
      raison: (!c.make.webhook && !c.make.token)
        ? "Aucun webhook Make ni jeton d'API. Créez un webhook « Custom webhook » dans un scénario Make et collez son URL."
        : null
    },
    higgsfield: {
      actif: !!(c.higgsfield.cleId && c.higgsfield.cleSecret),
      profil: c.higgsfield.profil,
      modele: c.higgsfield.modele,
      source: c.higgsfield.cleId ? parEnv("HIGGSFIELD_KEY_ID") : null,
      raison: !(c.higgsfield.cleId && c.higgsfield.cleSecret)
        ? "Identifiants Higgsfield absents. Il en faut deux : un identifiant de clé et son secret."
        : null
    }
  };
}

/* ===========================================================================
   MAKE
   ======================================================================== */

/* Un évènement poussé vers le webhook. La forme est stable et plate : les
   modules Make lisent mal les objets profondément imbriqués. */
function evenement(type, donnees) {
  return Object.assign({
    source: "poste-cod",
    type: type,
    le: new Date().toISOString()
  }, donnees || {});
}

async function pousserMake(reglages, type, donnees) {
  const c = config(reglages);
  if (!c.make.webhook) return { envoye: false, raison: "aucun webhook configuré" };

  try {
    const r = await requete(c.make.webhook, {
      methode: "POST",
      corps: evenement(type, donnees),
      delai: 15000
    });
    /* Un webhook Make répond « Accepted » en texte brut, pas en JSON. */
    return { envoye: true, reponse: (r.texte || "").slice(0, 120) };
  } catch (err) {
    return { envoye: false, erreur: err.message };
  }
}

function baseMake(c) {
  if (c.make.base) return c.make.base.replace(/\/+$/, "");
  /* La zone fait partie du nom d'hôte : eu1, eu2, us1… On la nettoie pour
     qu'une saisie du genre « https://eu2.make.com/ » ne casse pas l'URL. */
  const zone = String(c.make.zone || "eu2").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return "https://" + zone + ".make.com/api/v2";
}

async function scenariosMake(reglages) {
  const c = config(reglages);
  if (!c.make.token) throw new Error("Aucun jeton d'API Make configuré.");
  const url = baseMake(c) + "/scenarios" + (c.make.equipe ? "?teamId=" + encodeURIComponent(c.make.equipe) : "");
  const r = await requete(url, { entetes: { Authorization: "Token " + c.make.token } });
  const liste = (r.donnees && r.donnees.scenarios) || [];
  return liste.map(s => ({
    id: s.id, nom: s.name, actif: !!s.isActive,
    derniereEdition: s.lastEdit || null, dossier: s.folderId || null
  }));
}

async function lancerScenarioMake(reglages, scenarioId, donnees) {
  const c = config(reglages);
  if (!c.make.token) throw new Error("Aucun jeton d'API Make configuré.");
  const url = baseMake(c) + "/scenarios/" + encodeURIComponent(scenarioId) + "/run";
  const r = await requete(url, {
    methode: "POST",
    entetes: { Authorization: "Token " + c.make.token },
    corps: { data: donnees || {}, responsive: false },
    delai: 60000
  });
  return r.donnees || { lance: true };
}

async function testerMake(reglages) {
  const c = config(reglages);
  const out = { webhook: null, api: null };

  if (c.make.webhook) {
    out.webhook = await pousserMake(reglages, "test", {
      message: "Test depuis Poste COD. Si vous voyez cet évènement dans Make, le lien fonctionne."
    });
  } else {
    out.webhook = { envoye: false, raison: "aucun webhook configuré" };
  }

  if (c.make.token) {
    try {
      const s = await scenariosMake(reglages);
      out.api = { ok: true, scenarios: s.length, actifs: s.filter(x => x.actif).length };
    } catch (err) {
      out.api = { ok: false, erreur: err.message };
    }
  } else {
    out.api = { ok: false, raison: "aucun jeton d'API configuré" };
  }
  return out;
}

/* ===========================================================================
   HIGGSFIELD
   ======================================================================== */

/* Formats des régies → ce que chaque contrat attend. */
const FORMATS_IMAGE = {
  feed:  { ratio: "1:1",  taille: "1080x1080", l: 1080, h: 1080 },
  carre: { ratio: "4:5",  taille: "1080x1350", l: 1080, h: 1350 },
  story: { ratio: "9:16", taille: "1080x1920", l: 1080, h: 1920 }
};

/* Cherche une URL d'image n'importe où dans une réponse JSON.

   La documentation Higgsfield ne fixe pas la même forme de réponse selon la
   page consultée, et elle bouge. Plutôt que de parier sur un chemin précis et
   de casser au prochain changement, on parcourt la réponse et on prend la
   première URL qui ressemble à une image. */
function trouverImage(valeur, profondeur) {
  const p = profondeur || 0;
  if (p > 8 || valeur == null) return null;

  if (typeof valeur === "string") {
    if (/^https?:\/\//.test(valeur) &&
        (/\.(png|jpe?g|webp|avif)(\?|$)/i.test(valeur) || /image|media|cdn|result|output/i.test(valeur))) {
      return valeur;
    }
    return null;
  }
  if (Array.isArray(valeur)) {
    for (const v of valeur) {
      const t = trouverImage(v, p + 1);
      if (t) return t;
    }
    return null;
  }
  if (typeof valeur === "object") {
    /* On regarde d'abord les clés qui portent habituellement le résultat,
       pour ne pas ramener une URL de vignette ou de documentation. */
    const prioritaires = ["raw", "url", "image_url", "output", "result", "results", "min"];
    for (const k of prioritaires) {
      if (k in valeur) {
        const t = trouverImage(valeur[k], p + 1);
        if (t) return t;
      }
    }
    for (const k of Object.keys(valeur)) {
      if (prioritaires.includes(k)) continue;
      const t = trouverImage(valeur[k], p + 1);
      if (t) return t;
    }
  }
  return null;
}

/* Lit un statut de tâche, quel que soit le vocabulaire du contrat. */
function statutDe(donnees) {
  if (!donnees || typeof donnees !== "object") return "inconnu";
  const brut = donnees.status || donnees.state ||
    (Array.isArray(donnees.jobs) && donnees.jobs[0] && donnees.jobs[0].status) || "";
  const s = String(brut).toLowerCase();
  if (["completed", "succeeded", "success", "done", "finished", "ready"].includes(s)) return "fini";
  if (["failed", "error", "canceled", "cancelled", "rejected"].includes(s)) return "echec";
  if (["queued", "pending", "processing", "running", "in_progress", "started"].includes(s)) return "en-cours";
  return s ? "en-cours" : "inconnu";
}

function identifiantTache(donnees) {
  if (!donnees || typeof donnees !== "object") return null;
  return donnees.request_id || donnees.id || donnees.job_set_id || donnees.jobSetId || null;
}

async function genererImage(reglages, options) {
  const c = config(reglages);
  const o = options || {};
  if (!c.higgsfield.cleId || !c.higgsfield.cleSecret) {
    throw new Error("Identifiants Higgsfield absents.");
  }
  const format = FORMATS_IMAGE[o.format] || FORMATS_IMAGE.feed;
  const v1 = c.higgsfield.profil === "v1";

  /* --- soumission --- */
  const soumission = v1
    ? {
        url: c.higgsfield.baseV1 + "/v1/text2image/soul",
        entetes: { "hf-api-key": c.higgsfield.cleId, "hf-secret": c.higgsfield.cleSecret },
        corps: { params: { prompt: o.prompt, width_and_height: format.taille, quality: "1080p", batch_size: 1 } }
      }
    : {
        url: c.higgsfield.baseV2 + "/" + String(c.higgsfield.modele).replace(/^\/+/, ""),
        entetes: { Authorization: "Key " + c.higgsfield.cleId + ":" + c.higgsfield.cleSecret },
        corps: { prompt: o.prompt, aspect_ratio: format.ratio, resolution: "1080p" }
      };

  const depart = await requete(soumission.url, {
    methode: "POST", entetes: soumission.entetes, corps: soumission.corps, delai: 45000
  });

  /* Certaines réponses portent déjà l'image : inutile d'attendre. */
  let image = trouverImage(depart.donnees);
  const tache = identifiantTache(depart.donnees);

  /* --- attente --- */
  if (!image) {
    if (!tache) throw new Error("Higgsfield n'a renvoyé ni image ni identifiant de tâche.");
    const urlStatut = v1
      ? c.higgsfield.baseV1 + "/v1/job-sets/" + encodeURIComponent(tache)
      : c.higgsfield.baseV2 + "/requests/" + encodeURIComponent(tache) + "/status";

    const limite = Date.now() + (o.delai || DELAI_IMAGE);
    let attente = 3000;
    while (Date.now() < limite) {
      await pause(attente);
      attente = Math.min(attente * 1.35, 12000);   // on espace les vérifications

      const r = await requete(urlStatut, { entetes: soumission.entetes, delai: 20000 });
      const st = statutDe(r.donnees);
      if (st === "echec") {
        const d = r.donnees || {};
        throw new Error("Génération refusée par Higgsfield" + (d.error ? " : " + d.error : "") + ".");
      }
      image = trouverImage(r.donnees);
      if (image) break;
      if (st === "fini" && !image) {
        throw new Error("Higgsfield annonce la tâche terminée sans URL d'image exploitable.");
      }
    }
    if (!image) throw new Error("Higgsfield n'a pas rendu l'image dans le délai imparti.");
  }

  const binaire = await telecharger(image, 60000);
  return { url: image, octets: binaire, tache: tache, format: o.format, dimensions: format };
}

const pause = ms => new Promise(r => setTimeout(r, ms));

async function testerHiggsfield(reglages) {
  try {
    const r = await genererImage(reglages, {
      prompt: "Un simple carré de couleur unie sur fond blanc, photographie de studio",
      format: "feed",
      delai: 90000
    });
    return { ok: true, octets: r.octets.length, url: r.url };
  } catch (err) {
    return { ok: false, erreur: err.message };
  }
}

/* ---------------------------------------------------------------------------
   Prompts de visuel produit.

   Un visuel COD n'est pas une photo de catalogue : il doit se lire sur un
   téléphone, en défilement, en une demi-seconde. D'où le cadrage serré, le
   fond simple et l'absence de texte incrusté — le texte, c'est la créa SVG
   qui le porte, et on peut le corriger sans regénérer l'image.
   ------------------------------------------------------------------------ */
function promptProduit(produit, angle, contexte) {
  const base = "Photographie produit publicitaire de « " + produit + " ». " +
    "Éclairage naturel doux, fond épuré, cadrage serré, très haute définition. " +
    "AUCUN texte, AUCUN logo, AUCUN filigrane dans l'image. " +
    "Cadre domestique marocain contemporain et crédible.";

  const angles = {
    probleme: " Mise en scène du problème que le produit résout, avant utilisation : " +
      "la situation agaçante du quotidien, désordre réaliste, lumière un peu terne.",
    preuve: " Le produit en cours d'utilisation, résultat visible et net. " +
      "Gestes de la main, angle de démonstration, lumière franche.",
    offre: " Le produit seul, présenté comme un objet désirable, avec son emballage. " +
      "Fond de couleur chaude, ombre portée nette, allure de photo d'offre."
  };

  return base + (angles[angle] || "") + (contexte ? " Contexte : " + contexte : "");
}

/* Produit un visuel par angle. Un échec ne fait pas tomber les autres :
   on rapporte ce qui a marché et ce qui n'a pas marché. */
async function visuelsProduit(reglages, options) {
  const o = options || {};
  const angles = o.angles || ["probleme", "preuve", "offre"];
  const sorties = [];

  for (const angle of angles) {
    try {
      const r = await genererImage(reglages, {
        prompt: promptProduit(o.produit, angle, o.contexte),
        format: o.format || "feed",
        delai: o.delai
      });
      sorties.push({
        angle, ok: true, url: r.url, octets: r.octets,
        fichier: "photo-" + angle + "-" + (o.format || "feed") + ".jpg",
        dimensions: r.dimensions
      });
    } catch (err) {
      sorties.push({ angle, ok: false, erreur: err.message });
    }
  }
  return sorties;
}

module.exports = {
  config, etat,
  evenement, pousserMake, scenariosMake, lancerScenarioMake, testerMake,
  genererImage, visuelsProduit, promptProduit, testerHiggsfield,
  trouverImage, statutDe, identifiantTache, FORMATS_IMAGE,
  requete
};
