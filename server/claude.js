"use strict";
/* =============================================================================
   Accès à Claude — recherche web live et rédaction.

   Le SDK officiel est chargé paresseusement : sans `npm install` et sans clé
   API, l'application démarre quand même et l'orchestrateur bascule en mode
   hors ligne (base intégrée + gabarits). C'est ce qui permet de lancer
   `npm start` sur un poste neuf sans rien configurer.
   ========================================================================== */

const MODELE_DEFAUT = process.env.POSTE_COD_MODEL || "claude-opus-5";

/* Variante « dynamic filtering » de la recherche web : requiert Opus 5/4.8/4.7/4.6
   ou Sonnet 5/4.6. C'est le modèle par défaut de l'application, donc on la prend. */
const OUTIL_RECHERCHE = { type: "web_search_20260209", name: "web_search" };

let _sdk = null;
let _client = null;
let _erreurSdk = null;

function chargerSdk() {
  if (_sdk || _erreurSdk) return _sdk;
  try {
    _sdk = require("@anthropic-ai/sdk");
  } catch (err) {
    _erreurSdk = err;
  }
  return _sdk;
}

function client() {
  if (_client) return _client;
  const Anthropic = chargerSdk();
  if (!Anthropic) return null;
  const Ctor = Anthropic.default || Anthropic;
  _client = new Ctor();          // lit ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN ou le profil `ant auth login`
  return _client;
}

function etat() {
  const sdkPresent = !!chargerSdk();
  const cle = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  return {
    disponible: sdkPresent && cle,
    sdkInstalle: sdkPresent,
    cleConfiguree: cle,
    modele: MODELE_DEFAUT,
    raison: !sdkPresent
      ? "SDK absent — lancez `npm install` pour activer la recherche live."
      : !cle
        ? "ANTHROPIC_API_KEY absente — copiez .env.example en .env et renseignez-la."
        : null
  };
}

const disponible = () => etat().disponible;

/* ---------------------------------------------------------------------------
   Appel principal.

   `recherche: true` branche l'outil de recherche web côté serveur d'Anthropic.
   Un tour qui utilise un outil serveur peut s'arrêter en `pause_turn` : il faut
   renvoyer le tour assistant tel quel pour qu'il reprenne, sinon la réponse est
   silencieusement tronquée.
   ------------------------------------------------------------------------ */
async function demander(options) {
  const o = options || {};
  const cli = client();
  if (!cli) {
    const e = etat();
    throw new Error("Claude indisponible : " + (e.raison || "raison inconnue"));
  }

  const outils = [];
  if (o.recherche) {
    outils.push(Object.assign({}, OUTIL_RECHERCHE,
      o.maxRecherches ? { max_uses: o.maxRecherches } : {}));
  }

  const requete = {
    model: o.modele || MODELE_DEFAUT,
    max_tokens: o.maxTokens || 32000,
    messages: [{ role: "user", content: o.prompt }],
    thinking: { type: "adaptive" },
    output_config: { effort: o.effort || "high" }
  };
  if (o.system) requete.system = o.system;
  if (outils.length) requete.tools = outils;

  const messages = requete.messages;
  const blocs = [];
  const sources = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  let tours = 0;
  const TOURS_MAX = 8;

  while (tours < TOURS_MAX) {
    tours++;
    /* On diffuse : ces réponses sont longues (landing pages, dossiers) et
       une requête non diffusée avec un gros max_tokens finit en timeout HTTP. */
    const flux = await cli.messages.stream(Object.assign({}, requete, { messages }));
    const reponse = await flux.finalMessage();

    if (reponse.usage) {
      usage.input_tokens += reponse.usage.input_tokens || 0;
      usage.output_tokens += reponse.usage.output_tokens || 0;
    }

    collecter(reponse.content, blocs, sources);

    if (reponse.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: reponse.content });
      continue;
    }
    if (reponse.stop_reason === "refusal") {
      const d = reponse.stop_details || {};
      throw new Error("Claude a décliné la demande" + (d.category ? " (" + d.category + ")" : "") + ".");
    }
    break;
  }

  return {
    texte: blocs.join("\n").trim(),
    sources: dedoublonner(sources),
    usage,
    tours
  };
}

/* Extrait le texte et les résultats de recherche d'une réponse.
   Une erreur d'outil serveur arrive en HTTP 200 : `content` est alors un objet
   d'erreur et non une liste. On teste avant d'itérer. */
function collecter(contenu, blocs, sources) {
  (contenu || []).forEach(bloc => {
    if (bloc.type === "text" && bloc.text) {
      blocs.push(bloc.text);
    } else if (bloc.type === "web_search_tool_result") {
      const c = bloc.content;
      if (Array.isArray(c)) {
        c.forEach(r => {
          if (r && r.url) sources.push({ titre: r.title || r.url, url: r.url, age: r.page_age || null });
        });
      }
      /* `content` non-tableau = objet d'erreur (max_uses_exceeded, etc.) :
         la recherche est incomplète, ce n'est pas bloquant. */
    }
  });
}

function dedoublonner(sources) {
  const vus = new Set();
  return sources.filter(s => {
    if (vus.has(s.url)) return false;
    vus.add(s.url);
    return true;
  });
}

/* ---------------------------------------------------------------------------
   Réponse JSON.

   On demande le JSON dans le prompt plutôt que par `output_config.format` :
   la contrainte de format ne se marie pas avec les citations que la recherche
   web ramène, et la moitié des étapes de l'orchestrateur cherchent en même
   temps qu'elles rédigent. Extraction tolérante + une relance si besoin.
   ------------------------------------------------------------------------ */
async function demanderJson(options) {
  const o = Object.assign({}, options);
  const consigne = "\n\nRéponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, " +
    "sans bloc de code markdown. Les chaînes de caractères doivent être échappées correctement.";
  o.prompt = (o.prompt || "") + consigne;

  const r1 = await demander(o);
  const j1 = extraireJson(r1.texte);
  if (j1) return { donnees: j1, sources: r1.sources, usage: r1.usage, brut: r1.texte };

  /* Relance courte, sans recherche : on ne redemande que le reformatage. */
  const r2 = await demander({
    modele: o.modele,
    maxTokens: o.maxTokens || 32000,
    effort: "low",
    prompt: "Voici une réponse qui devait être du JSON valide mais ne l'est pas. " +
      "Renvoie exactement les mêmes données, en JSON strictement valide, sans rien d'autre :\n\n" +
      r1.texte.slice(0, 60000)
  });
  const j2 = extraireJson(r2.texte);
  if (j2) return { donnees: j2, sources: r1.sources, usage: r1.usage, brut: r1.texte };

  throw new Error("Réponse JSON illisible après relance.");
}

/* Trouve le premier objet JSON complet du texte, en ignorant les accolades
   qui se trouvent à l'intérieur des chaînes. */
function extraireJson(texte) {
  if (!texte) return null;
  let t = texte.trim();

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();

  try { return JSON.parse(t); } catch (err) { /* on tente l'extraction */ }

  const debut = t.indexOf("{");
  if (debut < 0) return null;

  let profondeur = 0, dansChaine = false, echappe = false;
  for (let i = debut; i < t.length; i++) {
    const c = t[i];
    if (dansChaine) {
      if (echappe) echappe = false;
      else if (c === "\\") echappe = true;
      else if (c === '"') dansChaine = false;
      continue;
    }
    if (c === '"') { dansChaine = true; continue; }
    if (c === "{") profondeur++;
    else if (c === "}") {
      profondeur--;
      if (profondeur === 0) {
        try { return JSON.parse(t.slice(debut, i + 1)); } catch (err) { return null; }
      }
    }
  }
  return null;
}

/* Traduit les erreurs du SDK en messages lisibles dans l'interface. */
function messageErreur(err) {
  const Anthropic = chargerSdk();
  if (Anthropic) {
    const A = Anthropic.default || Anthropic;
    if (A.AuthenticationError && err instanceof A.AuthenticationError) {
      return "Clé API refusée. Vérifiez ANTHROPIC_API_KEY dans votre .env.";
    }
    if (A.RateLimitError && err instanceof A.RateLimitError) {
      return "Limite de débit atteinte chez Anthropic. Réessayez dans une minute.";
    }
    if (A.BadRequestError && err instanceof A.BadRequestError) {
      return "Requête refusée par l'API : " + err.message;
    }
    if (A.APIConnectionError && err instanceof A.APIConnectionError) {
      return "Impossible de joindre l'API Anthropic. Vérifiez votre connexion.";
    }
    if (A.APIError && err instanceof A.APIError) {
      return "Erreur API " + (err.status || "") + " : " + err.message;
    }
  }
  return err && err.message ? err.message : String(err);
}

module.exports = {
  MODELE_DEFAUT, etat, disponible,
  demander, demanderJson, extraireJson, messageErreur
};
