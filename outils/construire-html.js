"use strict";
/* =============================================================================
   Construit l'édition HTML autonome : un seul fichier, ouvert au double-clic.

     node outils/construire-html.js        →  dist/poste-cod.html

   Le principe : ne rien réécrire. Les modules métier (economics, sources,
   visuals, landing, horsligne) et l'interface (app.js, style.css) sont les
   MÊMES fichiers que ceux du serveur. On les emballe avec un `require` minimal
   et on colle les sept applications dedans.

   Si un module devient dépendant de Node — fs, http, un chemin disque — la
   construction échoue ici plutôt que de produire une page qui plante à
   l'ouverture. C'est vérifié explicitement plus bas.
   ========================================================================== */

const fs = require("fs");
const path = require("path");

const RACINE = path.join(__dirname, "..");
const lire = p => fs.readFileSync(path.join(RACINE, p), "utf8");

/* Les modules partagés, dans l'ordre où ils se demandent les uns les autres.
   Les clés sont les chemins tels qu'ils sont écrits dans les `require`. */
const MODULES = [
  ["./data/comptoir.json", "server/data/comptoir.json", "json"],
  ["./data/radar.json",    "server/data/radar.json",    "json"],
  ["./economics",          "server/economics.js",       "js"],
  ["./sources",            "server/sources.js",         "js"],
  ["./visuals",            "server/visuals.js",         "js"],
  ["./landing",            "server/landing.js",         "js"],
  ["./horsligne",          "server/horsligne.js",       "js"]
];

/* Interdits dans un module embarqué : ils n'existent pas dans un navigateur. */
const INTERDITS = [
  { motif: /require\(["']fs["']\)/,      quoi: "le module fs" },
  { motif: /require\(["']path["']\)/,    quoi: "le module path" },
  { motif: /require\(["']https?["']\)/,  quoi: "les modules http/https" },
  { motif: /process\.env/,               quoi: "process.env" }
];

function verifier(chemin, source) {
  INTERDITS.forEach(i => {
    if (i.motif.test(source)) {
      throw new Error("Le module " + chemin + " utilise " + i.quoi +
        " : il ne peut pas tourner dans un navigateur. " +
        "Sortez cette partie du module partagé avant de reconstruire.");
    }
  });
}

/* Coller du JavaScript dans une balise <script> demande une précaution : une
   séquence « </script » dans le source ferme la balise, même à l'intérieur
   d'une chaîne. landing.js en contient — il fabrique une page qui a ses
   propres scripts. Échapper la barre oblique règle le problème sans rien
   changer au programme : dans une chaîne comme dans une expression
   régulière, « <\/script » vaut exactement « </script ». */
const enligneJs = source => source.replace(/<\/script/gi, "<\\/script");

/* Une valeur JS sûre à coller dans une balise <script> : JSON.stringify laisse
   passer « </script> » et les séparateurs de ligne Unicode, qui cassent la page. */
const js = v => JSON.stringify(v)
  .replace(/</g, "\\u003c")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

/* ---------------------------------------------------------------------------
   Le petit require du navigateur
   ------------------------------------------------------------------------ */
function emballer() {
  const parts = [];
  parts.push('(function(){\n"use strict";\nvar __mods = {}, __cache = {};\n' +
    'function require(nom){\n' +
    '  if(__cache[nom]) return __cache[nom].exports;\n' +
    '  var f = __mods[nom];\n' +
    '  if(!f) throw new Error("Module absent du bundle : " + nom);\n' +
    '  var m = __cache[nom] = { exports:{} };\n' +
    '  f(m, m.exports, require);\n' +
    '  return m.exports;\n' +
    '}\nwindow.require = require;\n');

  MODULES.forEach(([nom, fichier, genre]) => {
    const source = lire(fichier);
    if (genre === "json") {
      parts.push('__mods[' + js(nom) + '] = function(module){ module.exports = ' +
        source.replace(/</g, "\\u003c") + '; };\n');
    } else {
      verifier(fichier, source);
      parts.push('__mods[' + js(nom) + '] = function(module, exports, require){\n' + enligneJs(source) + '\n};\n');
    }
  });

  parts.push('})();\n');
  return parts.join("");
}

/* ---------------------------------------------------------------------------
   Les applications embarquées
   ------------------------------------------------------------------------ */
const APPS = [
  { id: "espion",    fichier: "espion-cod.html",        nom: "Espion COD",        emoji: "🛰️",
    quoi: "Les boutiques COD marocaines sous surveillance, et les produits qui bougent chez elles." },
  { id: "radar",     fichier: "radar-produit-cod.html", nom: "Radar Produit COD", emoji: "🎯",
    quoi: "45 candidats notés sur huit critères, chiffrés sur neuf marchés." },
  { id: "comptoir",  fichier: "comptoir-cod.html",      nom: "Comptoir COD",      emoji: "🧭",
    quoi: "41 sources d'approvisionnement, du marché de Derb Omar à l'usine de Yiwu." },
  { id: "pilote",    fichier: "pilote-cod.html",        nom: "Pilote COD",        emoji: "📊",
    quoi: "Commandes, campagnes, marges : ce que la boutique a réellement encaissé." },
  { id: "rayon",     fichier: "rayon-cod.html",         nom: "Rayon COD",         emoji: "📦",
    quoi: "Stock, entrées, sorties, alertes de réapprovisionnement." },
  { id: "registre",  fichier: "registre-whatsapp.html", nom: "Registre WhatsApp", emoji: "💬",
    quoi: "Les commandes qui arrivent en discussion, extraites en tableau." },
  { id: "lancement", fichier: "lancement-cod.html",     nom: "Lancement COD",     emoji: "🚀",
    quoi: "Le dossier de campagne de septembre — cinq produits, cinq packs.", pont: false }
];

function applications() {
  return APPS.map(a => ({
    id: a.id, nom: a.nom, emoji: a.emoji, quoi: a.quoi,
    pont: a.pont !== false,
    html: lire(path.join("apps", a.fichier))
  }));
}

/* ---------------------------------------------------------------------------
   Assemblage
   ------------------------------------------------------------------------ */
function construire() {
  const apps = applications();
  const css = lire("public/style.css");
  const apiLocale = enligneJs(lire("public/api-locale.js"));
  const atelier = enligneJs(lire("public/app.js"));

  const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Poste COD — l'atelier</title>
<meta name="description" content="Atelier COD autonome : de la validation d'un produit à la campagne complète, sans installation.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Cairo:wght@400;600;700&display=swap">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧭</text></svg>">
<style>
${css}
</style>
</head>
<body>

<div class="app">
  <header class="entete">
    <div class="marque">
      <b>Poste COD</b>
      <span id="nomBoutique">—</span>
    </div>
    <span class="mode" id="mode"><i></i><span>…</span></span>
    <button class="btn sm" id="btnTheme" title="Basculer clair / sombre">◐</button>
  </header>

  <nav class="rail" id="rail"></nav>

  <main class="vue" id="vue">
    <div class="vide"><strong>Chargement de l'atelier…</strong></div>
  </main>
</div>

<!-- Les modules métier, identiques à ceux du serveur -->
<script>
${emballer()}
</script>

<!-- Les sept applications, embarquées telles quelles -->
<script>
window.POSTE_COD_APPS = ${js(apps)};
</script>

<!-- Le moteur local : même contrat d'API que le serveur Node -->
<script>
${apiLocale}
</script>

<!-- L'atelier : la même interface que l'édition Node -->
<script>
${atelier}
</script>
</body>
</html>
`;

  const dossier = path.join(RACINE, "dist");
  fs.mkdirSync(dossier, { recursive: true });
  const sortie = path.join(dossier, "poste-cod.html");
  fs.writeFileSync(sortie, page);
  return { chemin: sortie, octets: Buffer.byteLength(page), apps: apps.length };
}

if (require.main === module) {
  try {
    const r = construire();
    console.log("");
    console.log("  dist/poste-cod.html — " + (r.octets / 1024).toFixed(0) + " Ko");
    console.log("  " + r.apps + " applications embarquées, aucune dépendance.");
    console.log("  Ouvrez-le d'un double-clic, ou déposez-le dans un navigateur.");
    console.log("");
  } catch (err) {
    console.error("\n  Construction impossible : " + err.message + "\n");
    process.exit(1);
  }
}

module.exports = { construire, MODULES, APPS };
