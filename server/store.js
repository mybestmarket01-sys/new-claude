"use strict";
/* =============================================================================
   Magasin de données local — un fichier JSON par table, dans data/.

   C'est ce qui relie les applications entre elles : un produit repéré dans
   Espion COD devient un candidat du Radar, qui devient une campagne du Pilote,
   qui consomme un fournisseur du Comptoir. Tout passe par ici.
   ========================================================================== */

const fs = require("fs");
const path = require("path");

/* POSTE_COD_DATA permet aux tests (et à un second poste) de travailler dans
   leur propre dossier sans toucher à l'atelier en place. */
const RACINE = process.env.POSTE_COD_DATA
  ? path.resolve(process.env.POSTE_COD_DATA)
  : path.join(__dirname, "..", "data");
const TABLES = ["produits", "boutiques", "fournisseurs", "campagnes", "reglages", "captures"];

function chemin(table) {
  return path.join(RACINE, table + ".json");
}

function assurerRacine() {
  fs.mkdirSync(RACINE, { recursive: true });
  fs.mkdirSync(path.join(RACINE, "campagnes"), { recursive: true });
}

function lire(table) {
  assurerRacine();
  try {
    const brut = fs.readFileSync(chemin(table), "utf8");
    const val = JSON.parse(brut);
    return val;
  } catch (err) {
    if (err.code === "ENOENT") return table === "reglages" ? reglagesParDefaut() : [];
    /* Un JSON corrompu ne doit pas faire disparaître les données en silence :
       on met le fichier de côté et on repart propre, en le disant. */
    if (err instanceof SyntaxError) {
      const secours = chemin(table) + ".corrompu-" + Date.now();
      try { fs.renameSync(chemin(table), secours); } catch (e) { /* rien à sauver */ }
      console.warn("[store] " + table + ".json illisible, mis de côté dans " + path.basename(secours));
      return table === "reglages" ? reglagesParDefaut() : [];
    }
    throw err;
  }
}

function ecrire(table, valeur) {
  assurerRacine();
  const tmp = chemin(table) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 1));
  fs.renameSync(tmp, chemin(table));   // remplacement atomique
  return valeur;
}

function reglagesParDefaut() {
  const eco = require("./economics");
  return {
    boutique: "Ma boutique COD",
    marche: "MA",
    devise: "MAD",
    symbole: "DH",
    hypotheses: Object.assign({}, eco.DEFAUT),
    modele: process.env.POSTE_COD_MODEL || "claude-opus-5",
    creeLe: new Date().toISOString()
  };
}

/* ---------------------------------------------------------------------------
   Opérations de collection
   ------------------------------------------------------------------------ */

function uid(prefixe) {
  return (prefixe || "id") + "-" +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 7);
}

function liste(table) {
  const v = lire(table);
  return Array.isArray(v) ? v : [];
}

function trouver(table, id) {
  return liste(table).find(x => x.id === id) || null;
}

function ajouter(table, objet) {
  const items = liste(table);
  const item = Object.assign({ id: uid(table.slice(0, 3)), creeLe: new Date().toISOString() }, objet);
  items.push(item);
  ecrire(table, items);
  return item;
}

function majSur(table, id, champs) {
  const items = liste(table);
  const i = items.findIndex(x => x.id === id);
  if (i < 0) return null;
  items[i] = Object.assign({}, items[i], champs, { majLe: new Date().toISOString() });
  ecrire(table, items);
  return items[i];
}

function supprimer(table, id) {
  const items = liste(table);
  const reste = items.filter(x => x.id !== id);
  if (reste.length === items.length) return false;
  ecrire(table, reste);
  return true;
}

/* Insère ou met à jour selon une clé métier (SKU, domaine…) plutôt que l'id. */
function fusionner(table, cle, objet) {
  const items = liste(table);
  const valeur = objet[cle];
  const i = valeur == null ? -1 : items.findIndex(x => x[cle] === valeur);
  if (i >= 0) {
    items[i] = Object.assign({}, items[i], objet, { majLe: new Date().toISOString() });
    ecrire(table, items);
    return { item: items[i], nouveau: false };
  }
  const item = Object.assign({ id: uid(table.slice(0, 3)), creeLe: new Date().toISOString() }, objet);
  items.push(item);
  ecrire(table, items);
  return { item, nouveau: true };
}

/* ---------------------------------------------------------------------------
   Réglages
   ------------------------------------------------------------------------ */

function reglages() {
  const r = lire("reglages");
  const def = reglagesParDefaut();
  const fusion = Object.assign({}, def, r);
  fusion.hypotheses = Object.assign({}, def.hypotheses, r.hypotheses || {});
  return fusion;
}

function majReglages(champs) {
  const actuel = reglages();
  const suivant = Object.assign({}, actuel, champs);
  if (champs && champs.hypotheses) {
    suivant.hypotheses = Object.assign({}, actuel.hypotheses, champs.hypotheses);
  }
  return ecrire("reglages", suivant);
}

/* ---------------------------------------------------------------------------
   Campagnes produites par l'orchestrateur — un dossier par campagne
   ------------------------------------------------------------------------ */

function dossierCampagne(id) {
  const d = path.join(RACINE, "campagnes", id);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function ecrireLivrable(campagneId, nomFichier, contenu) {
  const d = dossierCampagne(campagneId);
  /* Le nom vient de l'orchestrateur, jamais de l'utilisateur, mais on le
     verrouille quand même : rien ne doit pouvoir sortir du dossier. */
  const sur = path.basename(nomFichier).replace(/[^\w.\-]/g, "_");
  const p = path.join(d, sur);
  fs.writeFileSync(p, contenu);
  return { fichier: sur, chemin: p, octets: Buffer.byteLength(contenu) };
}

function livrables(campagneId) {
  const d = path.join(RACINE, "campagnes", campagneId);
  try {
    return fs.readdirSync(d).map(f => {
      const st = fs.statSync(path.join(d, f));
      return { fichier: f, octets: st.size, majLe: st.mtime.toISOString() };
    });
  } catch (err) {
    return [];
  }
}

function lireLivrable(campagneId, nomFichier) {
  const sur = path.basename(nomFichier);
  const p = path.join(RACINE, "campagnes", campagneId, sur);
  const resolu = path.resolve(p);
  const base = path.resolve(path.join(RACINE, "campagnes", campagneId));
  if (!resolu.startsWith(base + path.sep)) return null;
  try { return fs.readFileSync(resolu); } catch (err) { return null; }
}

/* ---------------------------------------------------------------------------
   Export / import complet — pour sauvegarder ou déménager l'atelier
   ------------------------------------------------------------------------ */

function exporterTout() {
  const out = { version: 1, exporteLe: new Date().toISOString() };
  TABLES.forEach(t => { out[t] = lire(t); });
  return out;
}

function importerTout(paquet) {
  if (!paquet || typeof paquet !== "object") throw new Error("Paquet d'import invalide");
  const faits = [];
  TABLES.forEach(t => {
    if (paquet[t] === undefined) return;
    ecrire(t, paquet[t]);
    faits.push(t);
  });
  return faits;
}

module.exports = {
  RACINE, TABLES,
  liste, trouver, ajouter, majSur, supprimer, fusionner, uid,
  reglages, majReglages,
  dossierCampagne, ecrireLivrable, livrables, lireLivrable,
  exporterTout, importerTout
};
