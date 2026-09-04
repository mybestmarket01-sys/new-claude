"use strict";
/* =============================================================================
   Visuels publicitaires — SVG produit localement, sans API ni dépendance.

   Trois formats, aux dimensions attendues par les régies :
     feed   1080 × 1080  (Facebook / Instagram fil)
     story  1080 × 1920  (Stories, Reels, TikTok)
     carre  1080 × 1350  (Instagram portrait, le format qui prend le plus de place)

   Le SVG part en PNG côté navigateur (canvas), donc rien à installer ici.
   Le texte arabe est posé en RTL ; les polices sont des piles système pour que
   le rendu tienne même sans connexion.
   ========================================================================== */

const FORMATS = {
  feed:  { l: 1080, h: 1080, nom: "Feed 1:1" },
  carre: { l: 1080, h: 1350, nom: "Portrait 4:5" },
  story: { l: 1080, h: 1920, nom: "Story 9:16" }
};

/* Trois palettes, une par angle publicitaire. Contraste vérifié sur fond clair
   comme sur fond sombre : le texte reste lisible dans les deux cas. */
const PALETTES = {
  probleme: { fond: "#0E1513", fond2: "#16211E", encre: "#F2F5F2", accent: "#43C2A0", second: "#D3A73F", ombre: "rgba(0,0,0,.45)" },
  preuve:   { fond: "#F0F1EC", fond2: "#FFFFFF", encre: "#141B18", accent: "#0E5A48", second: "#8C6A14", ombre: "rgba(20,27,24,.16)" },
  offre:    { fond: "#2B1410", fond2: "#3A1D17", encre: "#FDF6F2", accent: "#E8734F", second: "#F2C94C", ombre: "rgba(0,0,0,.5)" }
};

const PILE_AR = "'Cairo','IBM Plex Sans Arabic','Noto Naskh Arabic','Segoe UI',Tahoma,sans-serif";
const PILE_FR = "'Archivo','Bricolage Grotesque','Segoe UI',system-ui,sans-serif";
const PILE_NUM = "'JetBrains Mono','IBM Plex Mono',ui-monospace,monospace";

const ech = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* Découpe un texte en lignes d'au plus `max` caractères, sans couper les mots.
   L'arabe et le latin ont des largeurs de glyphe différentes : `max` est
   calibré plus court pour l'arabe, qui prend plus de place à taille égale. */
function lignes(texte, max) {
  const mots = String(texte || "").split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  mots.forEach(m => {
    if (!cur) { cur = m; return; }
    if ((cur + " " + m).length <= max) cur += " " + m;
    else { out.push(cur); cur = m; }
  });
  if (cur) out.push(cur);
  return out;
}

function blocTexte(opts) {
  const o = opts;
  const ls = lignes(o.texte, o.max || 26);
  const rtl = !!o.rtl;
  const x = rtl ? o.x : o.x;
  const ancre = rtl ? "end" : "start";
  return ls.map((ligne, i) =>
    '<text x="' + x + '" y="' + (o.y + i * o.interligne) + '"' +
    ' font-family="' + (rtl ? PILE_AR : PILE_FR) + '"' +
    ' font-size="' + o.taille + '" font-weight="' + (o.gras || 700) + '"' +
    ' fill="' + o.couleur + '" text-anchor="' + ancre + '"' +
    (rtl ? ' direction="rtl"' : "") +
    (o.opacite ? ' opacity="' + o.opacite + '"' : "") +
    '>' + ech(ligne) + "</text>"
  ).join("\n  ");
}

/* ---------------------------------------------------------------------------
   Une créa.
   brief = {
     produit, prixBarre, prix, devise,
     hookAr, hookFr, benefices[], angle, badge
   }
   ------------------------------------------------------------------------ */
function crea(brief, format, angle) {
  const f = FORMATS[format] || FORMATS.feed;
  const p = PALETTES[angle] || PALETTES.probleme;
  const b = brief || {};
  const L = f.l, H = f.h;
  const marge = Math.round(L * 0.083);          // 90 px sur 1080
  const story = format === "story";

  const prix = b.prix != null ? String(b.prix) : "";
  const devise = b.devise || "DH";
  const benefices = (b.benefices || []).slice(0, story ? 4 : 3);

  /* Sans hook rédigé — c'est le cas en mode hors ligne — la créa serait un
     cadre vide avec un prix. On met le nom du produit à la place : ce n'est
     pas un hook, mais c'est une créa qu'on peut regarder et corriger. */
  const hookAr = b.hookAr || "";
  const hookFr = b.hookFr || (hookAr ? "" : (b.produit || ""));

  /* Répartition verticale : le hook occupe le tiers haut, l'offre le bas.
     En story on écarte davantage, l'espace du milieu accueille la vidéo. */
  const yHook = story ? Math.round(H * 0.20) : Math.round(H * 0.20);
  const yBenef = story ? Math.round(H * 0.46) : Math.round(H * 0.48);
  const yPrix = story ? Math.round(H * 0.74) : Math.round(H * 0.72);

  const parts = [];

  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + L + '" height="' + H + '"' +
    ' viewBox="0 0 ' + L + ' ' + H + '" role="img" aria-label="' + ech(b.produit || "Créa publicitaire") + '">');

  /* fond dégradé + grain léger pour éviter le fond plat qui « sent le gabarit » */
  parts.push('<defs>' +
    '<linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">' +
    '<stop offset="0" stop-color="' + p.fond2 + '"/><stop offset="1" stop-color="' + p.fond + '"/></linearGradient>' +
    '<linearGradient id="acc" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="' + p.accent + '"/><stop offset="1" stop-color="' + p.second + '"/></linearGradient>' +
    '</defs>');
  parts.push('<rect width="' + L + '" height="' + H + '" fill="url(#g)"/>');

  /* filet d'accent en haut */
  parts.push('<rect x="0" y="0" width="' + L + '" height="10" fill="url(#acc)"/>');

  /* bandeau marque */
  if (b.boutique) {
    parts.push('<text x="' + marge + '" y="' + (marge + 20) + '" font-family="' + PILE_FR +
      '" font-size="26" font-weight="600" letter-spacing="4" fill="' + p.accent + '">' +
      ech(String(b.boutique).toUpperCase()) + "</text>");
  }

  /* hook darija — c'est lui qui arrête le pouce, il prend la plus grosse taille */
  if (hookAr) {
    parts.push(blocTexte({
      texte: hookAr, x: L - marge, y: yHook, rtl: true,
      taille: story ? 74 : 68, interligne: story ? 96 : 88,
      couleur: p.encre, max: 22
    }));
  }
  if (hookFr) {
    /* Sans hook darija au-dessus, le texte français prend sa place et sa taille :
       il devient l'accroche, pas un sous-titre. */
    const seul = !hookAr;
    const yFr = yHook + (hookAr ? lignes(hookAr, 22).length * (story ? 96 : 88) + 24 : 0);
    parts.push(blocTexte({
      texte: hookFr, x: marge, y: yFr,
      taille: seul ? (story ? 62 : 56) : (story ? 40 : 36),
      interligne: seul ? (story ? 78 : 70) : (story ? 54 : 48),
      gras: seul ? 700 : 500,
      couleur: p.encre, opacite: seul ? null : "0.72", max: seul ? 22 : 40
    }));
  }

  /* bénéfices, cochés */
  benefices.forEach((ben, i) => {
    const y = yBenef + i * (story ? 82 : 72);
    parts.push('<circle cx="' + (marge + 16) + '" cy="' + (y - 12) + '" r="16" fill="none" stroke="' + p.accent + '" stroke-width="3"/>');
    parts.push('<path d="M' + (marge + 8) + ' ' + (y - 12) + ' l6 7 l12 -14" fill="none" stroke="' + p.accent + '" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>');
    const ar = /[\u0600-\u06FF]/.test(ben);
    parts.push('<text x="' + (marge + 48) + '" y="' + y + '" font-family="' + (ar ? PILE_AR : PILE_FR) +
      '" font-size="' + (story ? 38 : 34) + '" font-weight="500" fill="' + p.encre + '" opacity="0.92">' +
      ech(ben.length > 44 ? ben.slice(0, 43) + "…" : ben) + "</text>");
  });

  /* bloc prix */
  if (prix) {
    parts.push('<text x="' + marge + '" y="' + yPrix + '" font-family="' + PILE_NUM +
      '" font-size="' + (story ? 150 : 132) + '" font-weight="700" fill="' + p.second + '">' +
      ech(prix) + '<tspan font-size="' + (story ? 60 : 52) + '" dx="12">' + ech(devise) + "</tspan></text>");

    if (b.prixBarre) {
      const xb = marge + String(prix).length * (story ? 88 : 78) + 130;
      parts.push('<text x="' + xb + '" y="' + (yPrix - 60) + '" font-family="' + PILE_NUM +
        '" font-size="' + (story ? 48 : 42) + '" fill="' + p.encre + '" opacity="0.45"' +
        ' text-decoration="line-through">' + ech(b.prixBarre) + " " + ech(devise) + "</text>");
    }
  }

  /* badge paiement à la livraison — l'argument qui lève l'objection COD */
  const yBadge = yPrix + (story ? 70 : 60);
  const largeurBadge = story ? 620 : 580;
  parts.push('<rect x="' + marge + '" y="' + yBadge + '" width="' + largeurBadge + '" height="' + (story ? 96 : 86) +
    '" rx="' + (story ? 48 : 43) + '" fill="' + p.accent + '"/>');
  parts.push('<text x="' + (marge + largeurBadge / 2) + '" y="' + (yBadge + (story ? 62 : 56)) +
    '" font-family="' + PILE_AR + '" font-size="' + (story ? 42 : 38) +
    '" font-weight="700" fill="' + p.fond + '" text-anchor="middle" direction="rtl">' +
    ech(b.badge || "الدفع عند الاستلام 🚚") + "</text>");

  /* pied : nom du produit, discret */
  if (b.produit) {
    parts.push('<text x="' + marge + '" y="' + (H - marge + 8) + '" font-family="' + PILE_FR +
      '" font-size="26" font-weight="500" fill="' + p.encre + '" opacity="0.5">' +
      ech(b.produit.length > 58 ? b.produit.slice(0, 57) + "…" : b.produit) + "</text>");
  }
  parts.push('<text x="' + (L - marge) + '" y="' + (H - marge + 8) + '" font-family="' + PILE_FR +
    '" font-size="24" fill="' + p.encre + '" opacity="0.35" text-anchor="end">' + ech(f.nom) + "</text>");

  parts.push("</svg>");
  return parts.join("\n  ");
}

/* ---------------------------------------------------------------------------
   Un jeu complet : 3 angles × 3 formats = 9 créas prêtes à tester.
   Trois angles, parce qu'une campagne qui n'en teste qu'un ne sait pas
   si c'est le produit ou le message qui n'a pas marché.
   ------------------------------------------------------------------------ */
const ANGLES = [
  { cle: "probleme", nom: "Problème", quoi: "On montre la douleur avant le produit. Le format qui convertit le mieux à froid." },
  { cle: "preuve",   nom: "Preuve",   quoi: "Démonstration, avant/après, chiffre. Pour la deuxième vague et le retargeting." },
  { cle: "offre",    nom: "Offre",    quoi: "Prix barré, urgence, pack. À réserver au retargeting — brûle vite à froid." }
];

function jeuComplet(brief) {
  const sorties = [];
  ANGLES.forEach(angle => {
    const b = Object.assign({}, brief, {
      hookAr: (brief.hooks && brief.hooks[angle.cle] && brief.hooks[angle.cle].ar) || brief.hookAr,
      hookFr: (brief.hooks && brief.hooks[angle.cle] && brief.hooks[angle.cle].fr) || brief.hookFr
    });
    Object.keys(FORMATS).forEach(fmt => {
      sorties.push({
        angle: angle.cle,
        angleNom: angle.nom,
        angleQuoi: angle.quoi,
        format: fmt,
        formatNom: FORMATS[fmt].nom,
        largeur: FORMATS[fmt].l,
        hauteur: FORMATS[fmt].h,
        fichier: "crea-" + angle.cle + "-" + fmt + ".svg",
        svg: crea(b, fmt, angle.cle)
      });
    });
  });
  return sorties;
}

module.exports = { FORMATS, PALETTES, ANGLES, crea, jeuComplet, lignes };
