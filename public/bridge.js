/* =============================================================================
   Passerelle — injectée dans les applications d'origine par le serveur.

   Elle ne modifie rien de leur code. Elle ajoute une pastille flottante qui
   fait deux choses : ramener à l'atelier, et envoyer un produit à
   l'orchestrateur. Le reste du lien entre applications passe par le
   localStorage, partagé puisque tout est servi depuis la même origine.
   ========================================================================== */
(function(){
"use strict";

var script = document.currentScript || document.querySelector('script[src*="bridge.js"]');
var APP = script ? (script.dataset.app || "") : "";
var NOM = script ? (script.dataset.nom || "") : "";
var DANS_ATELIER = window.parent !== window;

/* --------------------------------------------------------------------------
   Style — assez neutre pour ne heurter aucune des six chartes graphiques.
   ----------------------------------------------------------------------- */
var css = document.createElement("style");
css.textContent = [
  ".pcod-pont{position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;gap:7px;",
  "  align-items:center;background:#16211f;color:#f6f3ec;border-radius:99px;padding:7px 8px 7px 15px;",
  "  box-shadow:0 4px 24px rgba(0,0,0,.32);font:600 13px/1.2 'Archivo','Segoe UI',system-ui,sans-serif;",
  "  max-width:calc(100vw - 32px)}",
  ".pcod-pont .lbl{opacity:.62;letter-spacing:.06em;text-transform:uppercase;font-size:10px;",
  "  white-space:nowrap;padding-right:3px}",
  ".pcod-pont button{font:inherit;background:#f6f3ec;color:#16211f;border:0;border-radius:99px;",
  "  padding:8px 15px;cursor:pointer;white-space:nowrap}",
  ".pcod-pont button:hover{background:#fff}",
  ".pcod-pont button.g{background:transparent;color:#f6f3ec;border:1px solid rgba(246,243,236,.3)}",
  ".pcod-pont button.g:hover{background:rgba(246,243,236,.12)}",
  ".pcod-pont button:focus-visible{outline:2px solid #d0973f;outline-offset:2px}",
  "@media(max-width:520px){.pcod-pont .lbl{display:none}.pcod-pont{padding:7px 8px}}",
  "@media print{.pcod-pont{display:none}}"
].join("\n");
document.head.appendChild(css);

var pont = document.createElement("div");
pont.className = "pcod-pont";
pont.setAttribute("role", "toolbar");
pont.setAttribute("aria-label", "Passerelle Poste COD");
pont.innerHTML =
  '<span class="lbl">Poste COD</span>' +
  '<button type="button" id="pcod-lancer">🚀 Lancer une campagne</button>' +
  (DANS_ATELIER ? "" : '<button type="button" class="g" id="pcod-atelier">Atelier ↗</button>');
document.body.appendChild(pont);

/* --------------------------------------------------------------------------
   Trouver ce que l'utilisateur regarde.

   Dans l'ordre : le texte qu'il vient de sélectionner (le geste le plus
   explicite), puis la ligne de tableau ou la carte survolée en dernier, puis
   on demande. On ne devine jamais en silence.
   ----------------------------------------------------------------------- */
var dernierSurvol = null;
document.addEventListener("mouseover", function(ev){
  var el = ev.target;
  if(!el || !el.closest) return;
  var porteur = el.closest("tr, article, .card, .carte, .item, li");
  if(porteur) dernierSurvol = porteur;
}, { passive: true, capture: true });

function texteSelectionne(){
  try{
    var s = String(window.getSelection());
    s = s.replace(/\s+/g, " ").trim();
    return (s.length > 2 && s.length < 140) ? s : "";
  }catch(err){ return ""; }
}

function titreDuSurvol(){
  if(!dernierSurvol) return "";
  /* Le nom du produit est presque toujours le premier titre ou la première
     cellule de la ligne : on prend le texte le plus court qui ressemble à un nom. */
  var cible = dernierSurvol.querySelector("h1,h2,h3,h4,.nom,.pname,.tname,.card-title,td:first-child");
  var t = (cible ? cible.textContent : dernierSurvol.textContent) || "";
  t = t.replace(/\s+/g, " ").trim();
  return (t.length > 2 && t.length < 140) ? t : "";
}

function prix(){
  if(!dernierSurvol) return null;
  var m = (dernierSurvol.textContent || "").match(/(\d{2,5})\s*(?:DH|MAD|درهم)/i);
  return m ? Number(m[1]) : null;
}

document.getElementById("pcod-lancer").onclick = function(){
  var propose = texteSelectionne() || titreDuSurvol() || "";
  var nom = window.prompt(
    "Lancer la chaîne complète sur quel produit ?\n\n" +
    "Recherche marché, validation, fournisseurs, ad copies, scripts, visuels, landing page et stratégie.",
    propose
  );
  if(nom === null) return;
  nom = nom.trim();
  if(!nom) return;

  var charge = { source: NOM || APP, nom: nom, prix: prix() };

  if(DANS_ATELIER){
    window.parent.postMessage({ type:"poste-cod:lancer", produit: charge }, window.location.origin);
  }else{
    /* Hors atelier, on ouvre l'orchestrateur avec la cible dans l'URL. */
    window.open("/#orchestrateur", "_blank");
    try{ sessionStorage.setItem("poste-cod:cible", JSON.stringify(charge)); }catch(err){}
  }
};

var btnAtelier = document.getElementById("pcod-atelier");
if(btnAtelier) btnAtelier.onclick = function(){ window.location.href = "/"; };

})();
