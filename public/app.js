/* =============================================================================
   Poste COD — l'atelier.

   Un shell qui réunit les applications existantes et pilote l'orchestrateur.
   Les applications d'origine ne sont pas réécrites : elles sont servies dans
   un cadre, depuis la même origine, et une passerelle leur ajoute juste de
   quoi envoyer un produit à l'orchestrateur.
   ========================================================================== */
(function(){
"use strict";

var ETAT = null;              // /api/etat
var vue = "orchestrateur";
var campagne = null;          // campagne affichée
var ongletResultat = "validation";
var flux = null;              // EventSource en cours

/* ---------------------------------------------------------------------------
   Utilitaires
   ------------------------------------------------------------------------ */
function $(id){ return document.getElementById(id); }
function ech(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c];
  });
}
function nb(v){ return Number(v || 0).toLocaleString("fr-FR"); }
function dh(v){ return nb(Math.round(v || 0)) + " DH"; }
function pct(v){ return Math.round((v || 0) * 100) + " %"; }
function duree(ms){
  if(!ms) return "";
  if(ms < 1000) return ms + " ms";
  if(ms < 60000) return (ms / 1000).toFixed(1).replace(".", ",") + " s";
  return Math.round(ms / 60000) + " min " + Math.round((ms % 60000) / 1000) + " s";
}
function frDate(iso){
  if(!iso) return "—";
  try{
    return new Intl.DateTimeFormat("fr-FR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })
      .format(new Date(iso));
  }catch(e){ return String(iso).slice(0, 16).replace("T", " "); }
}

function toast(msg){
  var t = document.querySelector(".toast");
  if(t) t.remove();
  t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ if(t.parentNode) t.remove(); }, 3600);
}

function api(chemin, options){
  return fetch("/api" + chemin, Object.assign({ headers: { "Content-Type":"application/json" } }, options || {}))
    .then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(d){
        if(!r.ok) throw new Error(d.erreur || ("Erreur " + r.status));
        return d;
      });
    });
}

/* ---------------------------------------------------------------------------
   Thème
   ------------------------------------------------------------------------ */
(function theme(){
  try{
    var t = localStorage.getItem("poste-cod-theme");
    if(t) document.documentElement.setAttribute("data-theme", t);
  }catch(e){}
})();

/* ---------------------------------------------------------------------------
   Démarrage
   ------------------------------------------------------------------------ */
function demarrer(){
  api("/etat").then(function(d){
    ETAT = d;
    $("nomBoutique").textContent = d.reglages.boutique || "";
    majMode();
    rendreRail();
    aller(location.hash.slice(1) || "orchestrateur");
  }).catch(function(err){
    $("vue").innerHTML = '<div class="vide"><strong>Le serveur ne répond pas</strong>' +
      ech(err.message) + '</div>';
  });
}

function majMode(){
  var c = ETAT.claude;
  var el = $("mode");
  el.className = "mode " + (c.disponible ? "live" : "hors");
  el.innerHTML = '<i></i><span>' + (c.disponible
    ? "En direct · " + ech(c.modele)
    : "Hors ligne") + '</span>';
  el.title = c.disponible
    ? "Recherche web active. L'orchestrateur cherche et rédige en direct."
    : c.raison || "";
}

$("btnTheme").onclick = function(){
  var actuel = document.documentElement.getAttribute("data-theme");
  var suivant = actuel === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", suivant);
  try{ localStorage.setItem("poste-cod-theme", suivant); }catch(e){}
};

/* ---------------------------------------------------------------------------
   Navigation
   ------------------------------------------------------------------------ */
function rendreRail(){
  var c = ETAT.compteurs;
  var h = '<div class="groupe">Lancer</div>' +
    bouton("orchestrateur", "🚀", "Orchestrateur", null) +
    bouton("campagnes", "🗂️", "Campagnes", c.campagnes || null) +
    '<div class="groupe">Applications</div>' +
    ETAT.apps.map(function(a){
      return bouton("app:" + a.id, a.emoji, a.nom, null);
    }).join("") +
    '<div class="groupe">Atelier</div>' +
    bouton("carnet", "📇", "Carnet fournisseurs", c.fournisseurs || null) +
    bouton("reglages", "⚙️", "Réglages", null);
  $("rail").innerHTML = h;

  $("rail").querySelectorAll("button[data-aller]").forEach(function(b){
    b.onclick = function(){ aller(b.dataset.aller); };
  });
}
function bouton(id, ico, nom, compteur){
  return '<button data-aller="' + ech(id) + '" aria-current="' + (vue === id) + '">' +
    '<span class="ico" aria-hidden="true">' + ico + '</span>' +
    '<span>' + ech(nom) + '</span>' +
    (compteur ? '<span class="pt">' + compteur + '</span>' : '') + '</button>';
}

function aller(cible){
  vue = cible;
  location.hash = cible;
  $("rail").querySelectorAll("button[data-aller]").forEach(function(b){
    b.setAttribute("aria-current", String(b.dataset.aller === cible));
  });
  var main = $("vue");
  main.scrollTop = 0;

  if(cible.indexOf("app:") === 0){
    main.className = "vue plein";
    return vueApp(cible.slice(4));
  }
  main.className = "vue";
  if(cible === "campagnes") return vueCampagnes();
  if(cible === "carnet") return vueCarnet();
  if(cible === "reglages") return vueReglages();
  return vueOrchestrateur();
}
window.addEventListener("hashchange", function(){
  var h = location.hash.slice(1);
  if(h && h !== vue) aller(h);
});

/* ===========================================================================
   VUE — applications réunies
   ======================================================================== */
function vueApp(id){
  var app = ETAT.apps.filter(function(a){ return a.id === id; })[0];
  if(!app) return aller("orchestrateur");
  $("vue").innerHTML =
    '<div class="barre-app">' +
      '<b>' + app.emoji + ' ' + ech(app.nom) + '</b>' +
      '<span class="q">' + ech(app.quoi) + '</span>' +
      '<a class="btn sm" href="' + ech(app.url) + '" target="_blank" rel="noopener">Ouvrir dans un onglet ↗</a>' +
    '</div>' +
    '<iframe class="cadre" src="' + ech(app.url) + '" title="' + ech(app.nom) + '"></iframe>';
}

/* ===========================================================================
   VUE — orchestrateur
   ======================================================================== */
function vueOrchestrateur(){
  if(campagne) return rendreCampagne();

  var horsLigne = !ETAT.claude.disponible;

  $("vue").innerHTML =
    '<div class="tete">' +
      '<p class="kick">Une cible, huit livrables</p>' +
      '<h1>Donnez un produit. Récupérez la campagne.</h1>' +
      '<p>Recherche marché, validation économique, fournisseurs en gros avec leurs contacts, ' +
      'annonces Meta et TikTok en darija, scripts vidéo, créas aux formats des régies, ' +
      'landing page bilingue et plan de lancement chiffré. Dans cet ordre, sans intervention.</p>' +
    '</div>' +

    (horsLigne ? '<div class="alerte warn"><span class="ic">⚠</span><div>' +
      '<b>Mode hors ligne.</b> ' + ech(ETAT.claude.raison) + ' L\'orchestrateur tourne quand même : ' +
      'il produit les visuels, la landing page, le modèle économique, les 41 routes d\'achat et le plan ' +
      'de lancement à partir de la base intégrée. Ce qui manque, ce sont la recherche web et la rédaction ' +
      'en darija.</div></div>' : '') +

    '<div class="carte"><div class="pad">' +
      '<form id="f-lancer">' +
        '<div class="champs">' +
          '<div class="champ large">' +
            '<label for="cible">Produit ou catégorie</label>' +
            '<input id="cible" name="cible" class="gros" required autocomplete="off" ' +
              'placeholder="Ex. tapis chauffant pliable pour plats — ou : rangement cuisine">' +
            '<span class="aide">Un produit précis donne une campagne prête à lancer. ' +
            'Une catégorie fait d\'abord chercher les meilleurs candidats, puis lance la campagne sur le premier.</span>' +
          '</div>' +
          '<div class="champ">' +
            '<label for="prix">Prix de vente visé (DH)</label>' +
            '<input id="prix" name="prix" type="number" step="1" inputmode="numeric" placeholder="laisser vide = à trouver">' +
          '</div>' +
          '<div class="champ">' +
            '<label for="cout">Coût d\'achat connu (DH)</label>' +
            '<input id="cout" name="cout" type="number" step="1" inputmode="numeric" placeholder="laisser vide = à chercher">' +
          '</div>' +
        '</div>' +
        '<div class="puces" id="exemples"></div>' +
        '<div class="actions">' +
          '<button class="btn pri gros" type="submit">Lancer la chaîne</button>' +
          '<span class="aide" style="color:var(--encre3)">' +
            (horsLigne ? "≈ 5 secondes, sans recherche web" : "≈ 3 à 6 minutes selon le produit") + '</span>' +
        '</div>' +
      '</form>' +
    '</div></div>' +

    '<div class="carte"><div class="pad">' +
      '<h2>Ce que la chaîne enchaîne</h2>' +
      '<p class="sous">Chaque étape se sert de ce que la précédente a trouvé. ' +
      'La validation peut arrêter la chaîne : un produit dont le CPA maximum est sous le plancher ' +
      'ne mérite pas qu\'on lui fabrique des visuels.</p>' +
      '<div class="chaine">' +
        ETAT.etapes.map(function(e, i){
          return '<div class="etape"><span class="pastille">' + (i + 1) + '</span>' +
            '<div><div class="nom">' + ech(e.nom) + '</div>' +
            '<div class="note">' + ech(descriptionEtape(e.id)) + '</div></div><span></span></div>';
        }).join("") +
      '</div>' +
    '</div></div>' +

    '<div class="tuiles">' +
      tuile("Sources fournisseurs", nb(ETAT.compteurs.sourcesComptoir), "base Comptoir COD") +
      tuile("Catalogue produits", nb(ETAT.compteurs.catalogueRadar), "base Radar COD") +
      tuile("Campagnes produites", nb(ETAT.compteurs.campagnes), "dans data/") +
      tuile("Contacts au carnet", nb(ETAT.compteurs.fournisseurs), "trouvés par la chaîne") +
    '</div>';

  var exemples = ["Tapis chauffant pliable pour plats", "Brosse vaporisateur cheveux 2-en-1",
    "Gants chauffants pour deux-roues", "Rangement cuisine", "Appareils de beauté"];
  $("exemples").innerHTML = exemples.map(function(x){
    return '<button type="button" class="puce" data-ex="' + ech(x) + '">' + ech(x) + '</button>';
  }).join("");
  $("exemples").querySelectorAll("[data-ex]").forEach(function(b){
    b.onclick = function(){ $("cible").value = b.dataset.ex; $("cible").focus(); };
  });

  $("f-lancer").onsubmit = function(ev){
    ev.preventDefault();
    var f = ev.target;
    var cible = f.cible.value.trim();
    if(!cible) return toast("Indiquez un produit ou une catégorie.");

    var charge = {
      cible: cible,
      type: devinerType(cible),
      prix: f.prix.value ? Number(f.prix.value) : null,
      cout: f.cout.value ? Number(f.cout.value) : null
    };
    f.querySelector("button[type=submit]").disabled = true;

    api("/campagnes", { method:"POST", body: JSON.stringify(charge) })
      .then(function(job){
        campagne = job;
        ongletResultat = "progression";
        rendreCampagne();
        suivre(job.id);
      })
      .catch(function(err){
        toast(err.message);
        f.querySelector("button[type=submit]").disabled = false;
      });
  };
}

/* Une cible courte et générique se comporte comme une catégorie ; un nom
   long et précis comme un produit. On peut se tromper sans conséquence :
   l'étape de recherche s'adapte. */
function devinerType(cible){
  var mots = cible.trim().split(/\s+/).length;
  var generique = /^(rangement|beaut[ée]|maison|cuisine|auto|b[ée]b[ée]|tech|fitness|sant[ée]|mode|bijou|jouet|d[ée]co|animal|outil)/i;
  return (mots <= 3 && generique.test(cible)) ? "categorie" : "produit";
}

function descriptionEtape(id){
  return {
    recherche: "Demande, concurrence, plafond de prix, prix de gros — cherché sur le web",
    validation: "Score sur 8 critères + CPA maximum. Peut arrêter la chaîne",
    fournisseurs: "Marketplaces B2B, annuaires, grossistes — avec leurs contacts publiés",
    adcopy: "3 angles × (Meta + TikTok), en darija, avec bénéfices et objections",
    scripts: "3 storyboards de 30 secondes, seconde par seconde",
    visuels: "9 créas SVG : 3 angles × Feed, Portrait, Story",
    landing: "Page COD bilingue, formulaire 3 champs, sortie WhatsApp",
    strategie: "Budget, plafonds d'enchère, 4 phases, règles de coupure"
  }[id] || "";
}

function tuile(k, v, s, cls){
  return '<div class="tuile"><div class="k">' + ech(k) + '</div>' +
    '<div class="v ' + (cls || "") + '">' + ech(v) + '</div>' +
    (s ? '<div class="s">' + ech(s) + '</div>' : '') + '</div>';
}

/* ---------------------------------------------------------------------------
   Suivi en direct
   ------------------------------------------------------------------------ */
function suivre(id){
  if(flux) { flux.close(); flux = null; }
  flux = new EventSource("/api/campagnes/" + id + "/flux");

  flux.onmessage = function(ev){
    var d = JSON.parse(ev.data);
    if(d.job) campagne = d.job;
    if(d.type === "fin"){
      flux.close(); flux = null;
      /* On recharge le dossier complet : le résumé SSE ne porte pas les
         résultats, seulement l'avancement. */
      api("/campagnes/" + id).then(function(complet){
        campagne = Object.assign({}, campagne, complet);
        ongletResultat = campagne.statut === "arrete" ? "validation" : "validation";
        rendreCampagne();
        api("/etat").then(function(e){ ETAT = e; rendreRail(); });
      });
      return;
    }
    if(vue === "orchestrateur") majProgression();
  };
  flux.onerror = function(){
    /* La connexion peut tomber sur un flux long : on repasse en interrogation. */
    if(flux){ flux.close(); flux = null; }
    var minuteur = setInterval(function(){
      api("/campagnes/" + campagne.id).then(function(c){
        campagne = Object.assign({}, campagne, c);
        if(c.statut !== "en-cours"){ clearInterval(minuteur); rendreCampagne(); }
        else majProgression();
      }).catch(function(){ clearInterval(minuteur); });
    }, 4000);
  };
}

function majProgression(){
  var box = $("progression");
  if(!box) return rendreCampagne();
  box.innerHTML = htmlChaine(campagne);
}

/* ---------------------------------------------------------------------------
   Rendu d'une campagne
   ------------------------------------------------------------------------ */
function rendreCampagne(){
  var c = campagne;
  var enCours = c.statut === "en-cours";
  var r = c.resultats || {};

  var onglets = [
    { id:"progression", nom:"Progression" },
    { id:"validation", nom:"Validation" },
    { id:"recherche", nom:"Recherche" },
    { id:"fournisseurs", nom:"Fournisseurs" },
    { id:"adcopy", nom:"Ad copies" },
    { id:"scripts", nom:"Scripts vidéo" },
    { id:"visuels", nom:"Visuels" },
    { id:"landing", nom:"Landing page" },
    { id:"strategie", nom:"Stratégie" }
  ].filter(function(o){ return o.id === "progression" || enCours || r[o.id]; });

  if(!onglets.some(function(o){ return o.id === ongletResultat; })) ongletResultat = "progression";

  $("vue").innerHTML =
    '<div class="tete">' +
      '<p class="kick">Campagne · ' + ech(frDate(c.debut)) + ' · ' +
        (c.mode === "live" ? "recherche en direct" : "mode hors ligne") + '</p>' +
      '<h1>' + ech(c.cible) + '</h1>' +
      '<div class="actions" style="margin-top:14px">' +
        '<button class="btn" id="b-retour">← Nouvelle campagne</button>' +
        (enCours ? '' : '<a class="btn" href="/api/campagnes/' + ech(c.id) + '/fichier/campagne.json" download>Dossier JSON</a>') +
      '</div>' +
    '</div>' +

    (c.statut === "arrete" ? htmlArret(c) : "") +
    (enCours ? "" : htmlBandeau(c)) +

    '<div class="onglets" id="onglets">' +
      onglets.map(function(o){
        return '<button data-onglet="' + o.id + '" aria-selected="' + (ongletResultat === o.id) + '">' +
          ech(o.nom) + '</button>';
      }).join("") +
    '</div>' +
    '<div id="corps"></div>';

  $("b-retour").onclick = function(){
    if(flux){ flux.close(); flux = null; }
    campagne = null; aller("orchestrateur");
  };
  $("onglets").querySelectorAll("[data-onglet]").forEach(function(b){
    b.onclick = function(){ ongletResultat = b.dataset.onglet; rendreCampagne(); };
  });

  $("corps").innerHTML = corpsOnglet(ongletResultat, c);
  brancherCorps();
}

function htmlArret(c){
  var v = (c.resultats && c.resultats.validation) || {};
  return '<div class="alerte bad"><span class="ic">✕</span><div>' +
    '<b>Chaîne arrêtée à la validation.</b> ' + ech(v.raison || c.arret || "") +
    '</div></div>';
}

function htmlBandeau(c){
  var v = (c.resultats && c.resultats.validation) || {};
  var e = v.economie;
  if(!e) return "";
  return '<div class="tuiles">' +
    tuile("Score produit", (v.score != null ? v.score + "/100" : "—"),
      v.verdictScore ? v.verdictScore.texte : "",
      v.score >= 75 ? "bien" : v.score >= 60 ? "" : v.score >= 45 ? "alerte" : "mal") +
    tuile("Prix / coût", nb(c.prix) + " / " + nb(c.cout), "DH · ×" + e.multiple) +
    tuile("CPA maximum", dh(e.cpaMax), "plafond d'enchère", e.lancable ? "bien" : "mal") +
    tuile("CPA cible", dh(e.cpaCible), "seuil de scaling") +
    tuile("Net par colis livré", dh(e.netParLivree), "après refus et pub", e.netParLivree > 0 ? "bien" : "mal") +
  '</div>';
}

function htmlChaine(c){
  return '<div class="chaine">' + (c.etapes || []).map(function(e, i){
    var ico = e.statut === "fait" ? "✓" : e.statut === "echec" ? "✕" :
              e.statut === "sautee" ? "–" : (i + 1);
    return '<div class="etape" data-statut="' + ech(e.statut) + '">' +
      '<span class="pastille">' + ico + '</span>' +
      '<div><div class="nom">' + ech(e.nom) + '</div>' +
      '<div class="note">' + ech(
        e.erreur ? e.erreur :
        e.note ? e.note :
        e.statut === "en-cours" ? e.verbe + "…" :
        e.statut === "attente" ? descriptionEtape(e.id) :
        e.statut === "sautee" ? "Non exécutée" : ""
      ) + '</div></div>' +
      '<span class="duree">' + ech(duree(e.duree)) + '</span></div>';
  }).join("") + '</div>';
}

/* ---------------------------------------------------------------------------
   Contenu par onglet
   ------------------------------------------------------------------------ */
function corpsOnglet(id, c){
  var r = c.resultats || {};
  if(id === "progression") return '<div id="progression">' + htmlChaine(c) + '</div>' + htmlSources(c);
  var d = r[id];
  if(!d) return '<div class="vide"><strong>Pas encore</strong>Cette étape n\'a pas encore tourné.</div>';
  if(d.echec) return '<div class="alerte bad"><span class="ic">✕</span><div><b>Étape en échec.</b> ' + ech(d.erreur) + '</div></div>';

  if(id === "validation")   return htmlValidation(d, c);
  if(id === "recherche")    return htmlRecherche(d);
  if(id === "fournisseurs") return htmlFournisseurs(d);
  if(id === "adcopy")       return htmlAdCopy(d);
  if(id === "scripts")      return htmlScripts(d);
  if(id === "visuels")      return htmlVisuels(d, c);
  if(id === "landing")      return htmlLanding(d, c);
  if(id === "strategie")    return htmlStrategie(d);
  return "<pre class='bloc'>" + ech(JSON.stringify(d, null, 2)) + "</pre>";
}

function htmlSources(c){
  if(!c.sources || !c.sources.length) return "";
  return '<div class="carte"><div class="pad"><h3>Sources consultées</h3>' +
    '<p class="sous">' + c.sources.length + ' pages lues pendant la chaîne.</p><ul style="margin:0;padding-left:18px">' +
    c.sources.map(function(s){
      return '<li style="margin-bottom:5px"><a href="' + ech(s.url) + '" target="_blank" rel="noopener">' +
        ech(s.titre) + '</a></li>';
    }).join("") + '</ul></div></div>';
}

/* ---- validation ---- */
function htmlValidation(d, c){
  var e = d.economie || {};
  var h = "";

  (d.alertes || []).forEach(function(a){
    h += '<div class="alerte ' + (a.niveau === "bad" ? "bad" : "warn") + '">' +
      '<span class="ic">' + (a.niveau === "bad" ? "✕" : "⚠") + '</span><div>' + ech(a.texte) + '</div></div>';
  });
  if(!(d.alertes || []).length){
    h += '<div class="alerte good"><span class="ic">✓</span><div>' +
      '<b>Le produit passe.</b> CPA maximum de ' + dh(e.cpaMax) + ', dans la fenêtre de prix, multiple ×' + e.multiple + '.</div></div>';
  }

  if(d.correctifs){
    h += '<div class="note"><b>Les deux sorties possibles.</b> Vendre à <b>' + nb(d.correctifs.prixMinimum) +
      ' DH</b> au lieu de ' + nb(d.prix) + ', ou acheter à <b>' + nb(d.correctifs.coutMaximum) +
      ' DH</b> au lieu de ' + nb(d.cout) + '. Les deux ramènent le CPA maximum au-dessus du plancher.</div>';
  }

  h += '<div class="carte"><div class="pad"><h2>Le détail du score</h2>' +
    '<p class="sous">Huit critères pondérés. La marge pèse le plus lourd — c\'est elle qui décide ' +
    'si la publicité est payable.</p><div class="tw"><table><thead><tr>' +
    '<th>Critère</th><th class="r">Note</th><th class="r">Poids</th><th>Ce que ça vaut</th>' +
    '</tr></thead><tbody>' +
    Object.keys(d.detail || {}).map(function(k){
      var v = Math.round(d.detail[k]);
      var just = d.criteres && d.criteres.justifications ? d.criteres.justifications[k] : null;
      return '<tr><td><span class="nom">' + ech(libelleCritere(k)) + '</span></td>' +
        '<td class="r num">' + v + '</td>' +
        '<td class="r num">' + (d.poids ? d.poids[k] : "") + ' %</td>' +
        '<td style="color:var(--encre2);font-size:13.5px">' + ech(just || "") + '</td></tr>';
    }).join("") + '</tbody></table></div></div></div>';

  h += '<div class="carte"><div class="pad"><h2>L\'économie, sur 100 commandes brutes</h2>' +
    '<p class="sous">Hypothèses : ' + pct(e.hypotheses.confirmation) + ' de confirmées, ' +
    pct(e.hypotheses.livraison) + ' de livrées, ' + nb(e.hypotheses.fraisLivraison) + ' DH de livraison, ' +
    nb(e.hypotheses.fraisRetour) + ' DH par refus. Modifiables dans Réglages.</p>' +
    '<div class="tw"><table><tbody>' +
    ligne("Commandes brutes", nb(e.brutes)) +
    ligne("Confirmées", nb(e.confirmees)) +
    ligne("Livrées et encaissées", nb(e.livrees)) +
    ligne("Refusées à la livraison", nb(e.refusees)) +
    ligne("Chiffre d'affaires encaissé", dh(e.ca)) +
    ligne("Coût des marchandises", "− " + dh(e.achats)) +
    ligne("Logistique (livraison + retours)", "− " + dh(e.logistique)) +
    ligne("<b>Budget publicitaire maximum</b>", "<b>" + dh(e.cpaMax * 100) + "</b>") +
    ligne("CPA maximum par commande brute", dh(e.cpaMax)) +
    ligne("ROAS affiché au point mort", e.roasMini ? e.roasMini : "—") +
    '</tbody></table></div>' +
    '<div class="note"><b>Le ROAS de la plateforme ne décide de rien.</b> ' +
    'Au point mort, le gestionnaire de publicités affichera ' + (e.roasMini || "—") +
    ' — au-dessous, la campagne perd de l\'argent même si le chiffre paraît bon.</div>' +
    '</div></div>';
  return h;
}
function ligne(k, v){
  return '<tr><td>' + k + '</td><td class="r num">' + v + '</td></tr>';
}
function libelleCritere(k){
  return { marge:"Marge nette après refus", ads:"Preuve de demande publicitaire",
    wow:"Effet wow / démo vidéo", pb:"Résout un vrai problème",
    conc:"Concurrence locale faible", log:"Léger, compact, incassable",
    prix:"Dans la zone d'impulsion", nouv:"Introuvable en magasin" }[k] || k;
}

/* ---- recherche ---- */
function htmlRecherche(d){
  var h = "";
  if(d.horsLigne){
    h += '<div class="alerte warn"><span class="ic">⚠</span><div>' +
      '<b>Aucune recherche web n\'a été faite.</b> ' + ech(d.synthese || "") + '</div></div>';
  }else if(d.synthese){
    h += '<div class="carte"><div class="pad"><h2>Ce qu\'il faut retenir</h2>' +
      '<p style="font-size:16.5px;color:var(--encre2);margin:0">' + ech(d.synthese) + '</p></div></div>';
  }

  if(d.demande){
    h += '<div class="carte"><div class="pad"><h3>La demande</h3><div class="tw"><table><tbody>' +
      ligne("Tendance", ech(d.demande.tendance || "—")) +
      ligne("Saison", ech(d.demande.saison || "—")) +
      ligne("Qui achète", ech(d.demande.cible || "—")) +
      '</tbody></table></div></div></div>';
  }

  if(d.concurrence && d.concurrence.length){
    h += '<div class="carte"><div class="pad"><h3>Qui vend déjà</h3><div class="tw"><table><thead><tr>' +
      '<th>Acteur</th><th>Prix public</th><th>Source</th></tr></thead><tbody>' +
      d.concurrence.map(function(x){
        return '<tr><td class="nom">' + ech(x.acteur) + '</td><td class="num">' + ech(x.prix) + '</td>' +
          '<td>' + (x.source ? '<a href="' + ech(x.source) + '" target="_blank" rel="noopener">voir ↗</a>' : "—") + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.prixGros && d.prixGros.length){
    h += '<div class="carte"><div class="pad"><h3>Prix de gros relevés</h3>' +
      '<p class="sous">Prix affichés, pas prix négociés. Ils servent d\'ancre pour savoir si une offre est bonne.</p>' +
      '<div class="tw"><table><thead><tr><th>Source</th><th>Prix</th><th>Note</th><th></th></tr></thead><tbody>' +
      d.prixGros.map(function(x){
        return '<tr><td class="nom">' + ech(x.source) + '</td><td class="num">' + ech(x.prix) + '</td>' +
          '<td style="color:var(--encre2);font-size:13.5px">' + ech(x.note || "") + '</td>' +
          '<td>' + (x.url ? '<a href="' + ech(x.url) + '" target="_blank" rel="noopener">voir ↗</a>' : "") + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.candidats && d.candidats.length){
    h += '<div class="carte"><div class="pad"><h3>Candidats de la catégorie</h3><div class="tw"><table><thead><tr>' +
      '<th>Produit</th><th class="r">Prix</th><th class="r">Coût</th><th>Pourquoi</th></tr></thead><tbody>' +
      d.candidats.map(function(x){
        return '<tr><td class="nom">' + ech(x.nom) + '</td><td class="r num">' + nb(x.prix) + '</td>' +
          '<td class="r num">' + nb(x.cout) + '</td>' +
          '<td style="color:var(--encre2);font-size:13.5px">' + ech(x.pourquoi || "") + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.produitsProches && d.produitsProches.length){
    h += '<div class="carte"><div class="pad"><h3>Produits proches du catalogue Radar</h3>' +
      '<div class="tw"><table><thead><tr><th>Produit</th><th class="r">Prix</th><th class="r">Coût</th><th>Note</th></tr></thead><tbody>' +
      d.produitsProches.map(function(x){
        return '<tr><td class="nom">' + ech(x.nom) + '</td><td class="r num">' + nb(x.prix) + '</td>' +
          '<td class="r num">' + nb(x.cout) + '</td>' +
          '<td style="color:var(--encre2);font-size:13.5px">' + ech(x.note || "") + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.risques && d.risques.length){
    h += '<div class="carte"><div class="pad"><h3>Risques</h3>' +
      d.risques.map(function(x){
        return '<div class="alerte warn"><span class="ic">⚠</span><div>' + ech(x) + '</div></div>';
      }).join("") + '</div></div>';
  }

  if(d.aVerifier && d.aVerifier.length){
    h += htmlLiens("À vérifier vous-même", "Ouvrez ces six recherches : elles disent le plafond de prix, qui fait déjà de la publicité, et si la demande monte.", d.aVerifier);
  }
  return h || '<div class="vide">Rien à afficher.</div>';
}

function htmlLiens(titre, sous, liens){
  return '<div class="carte"><div class="pad"><h3>' + ech(titre) + '</h3>' +
    '<p class="sous">' + ech(sous) + '</p><div class="tw"><table><tbody>' +
    liens.map(function(l){
      return '<tr><td><a href="' + ech(l.url) + '" target="_blank" rel="noopener"><b>' +
        ech(l.nom || l.source) + '</b> ↗</a></td>' +
        '<td style="color:var(--encre2);font-size:13.5px">' + ech(l.role || l.quoi || "") + '</td></tr>';
    }).join("") + '</tbody></table></div></div></div>';
}

/* ---- fournisseurs ---- */
function htmlFournisseurs(d){
  var h = "";
  if(d.avertissement){
    h += '<div class="alerte warn"><span class="ic">⚠</span><div>' + ech(d.avertissement) + '</div></div>';
  }
  if(d.revalidation){
    h += '<div class="alerte ' + (d.revalidation.lancable ? "good" : "bad") + '">' +
      '<span class="ic">' + (d.revalidation.lancable ? "✓" : "✕") + '</span><div>' +
      '<b>Le prix de gros réel change l\'économie.</b> ' + ech(d.revalidation.message) + '</div></div>';
  }
  if(d.synthese){
    h += '<div class="carte"><div class="pad"><h2>La filière</h2>' +
      '<p style="font-size:16px;color:var(--encre2);margin:0">' + ech(d.synthese) + '</p></div></div>';
  }

  if(d.contacts && d.contacts.length){
    h += '<div class="carte"><div class="pad"><h2>Contacts trouvés</h2>' +
      '<p class="sous">Coordonnées telles qu\'elles sont publiées sur les pages consultées. ' +
      '<b>Aucune de ces maisons n\'a été appelée</b> — traitez-les comme des pistes à qualifier, ' +
      'pas comme des fournisseurs validés.</p><div class="tw"><table><thead><tr>' +
      '<th>Fournisseur</th><th>Où</th><th>Contact</th><th class="r">Prix vu</th><th>MOQ</th><th>Fiabilité</th>' +
      '</tr></thead><tbody>' +
      d.contacts.map(function(c){
        var contacts = [];
        if(c.telephone) contacts.push('<a href="tel:' + ech(String(c.telephone).replace(/\s/g,"")) + '">' + ech(c.telephone) + '</a>');
        if(c.whatsapp) contacts.push('<a href="https://wa.me/' + ech(String(c.whatsapp).replace(/\D/g,"")) + '" target="_blank" rel="noopener">WhatsApp</a>');
        if(c.email) contacts.push('<a href="mailto:' + ech(c.email) + '">' + ech(c.email) + '</a>');
        if(c.siteWeb) contacts.push('<a href="' + ech(c.siteWeb) + '" target="_blank" rel="noopener">site ↗</a>');
        var fi = c.fiabilite === "haute" ? "good" : c.fiabilite === "moyenne" ? "accent" : "creuse";
        return '<tr><td><span class="nom">' + ech(c.nom) + '</span>' +
          '<span class="meta">' + ech(c.type || "") + '</span>' +
          (c.note ? '<span class="meta" style="font-family:var(--f-corps);font-size:12.5px;color:var(--encre2)">' + ech(c.note) + '</span>' : '') + '</td>' +
          '<td>' + ech(c.ville || "—") + (c.adresse ? '<span class="meta">' + ech(c.adresse) + '</span>' : '') + '</td>' +
          '<td style="font-size:13px">' + (contacts.length ? contacts.join("<br>") : '<span class="pilule creuse">non publié</span>') +
            (c.source ? '<span class="meta"><a href="' + ech(c.source) + '" target="_blank" rel="noopener">source ↗</a></span>' : '') + '</td>' +
          '<td class="r num">' + ech(c.prixConstate || "—") + '</td>' +
          '<td class="num" style="font-size:12.5px">' + ech(c.moq || "—") + '</td>' +
          '<td><span class="pilule ' + fi + '">' + ech(c.fiabilite || "à qualifier") + '</span></td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.pieges && d.pieges.length){
    h += '<div class="carte"><div class="pad"><h3>Les pièges de cette filière</h3>' +
      d.pieges.map(function(p){
        return '<div class="alerte warn"><span class="ic">⚠</span><div>' + ech(p) + '</div></div>';
      }).join("") + '</div></div>';
  }

  if(d.routes && d.routes.length){
    h += '<div class="carte"><div class="pad"><h2>Routes d\'achat</h2>' +
      '<p class="sous">Classées de la moins chère à la plus rapide. L\'indice est un multiple du prix ' +
      'usine chinoise : 1,00 = prix usine, 1,80 = Derb Omar, 3,20 = prix public Jumia. ' +
      'Ce sont des ordres de grandeur de filière, pas des devis.</p>' +
      '<div class="tw"><table><thead><tr><th>Source</th><th>Type</th><th class="r">Indice</th>' +
      '<th class="r">Coût estimé</th><th>Délai</th><th>MOQ</th><th></th></tr></thead><tbody>' +
      d.routes.map(function(r){
        return '<tr><td><span class="nom">' + ech(r.nom) + '</span>' +
          '<span class="meta">' + ech(r.ville || r.pays || "") + '</span></td>' +
          '<td style="font-size:13px">' + ech(r.type) + '</td>' +
          '<td class="r num">' + (r.indicePrix ? r.indicePrix.toFixed(2).replace(".", ",") : "—") + '</td>' +
          '<td class="r num">' + (r.coutEstime ? nb(r.coutEstime) + " DH" : "—") + '</td>' +
          '<td style="font-size:12.5px">' + ech(r.delai) + '</td>' +
          '<td style="font-size:12.5px">' + ech(r.moq) + '</td>' +
          '<td><a class="btn sm" href="' + ech(r.recherche) + '" target="_blank" rel="noopener">chercher ↗</a></td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.pistesContact) h += htmlLiens("Où trouver d'autres contacts", "Les annuaires où les grossistes marocains sans site sont référencés.", d.pistesContact);
  if(d.plafonds) h += htmlLiens("Le plafond de prix", "Si votre prix COD dépasse ces prix publics, le client compare et annule.", d.plafonds);

  if(d.methode){
    h += '<div class="carte"><div class="pad"><h3>Comment chiffrer une offre</h3>' +
      '<pre class="bloc" style="font-family:var(--f-num);font-size:13px">' + ech(d.methode.coutRendu) + '\n\n' + ech(d.methode.cpaMax) + '</pre>' +
      '<ul style="margin:16px 0 0;padding-left:19px;color:var(--encre2)">' +
      d.methode.regles.map(function(r){ return '<li style="margin-bottom:7px">' + ech(r) + '</li>'; }).join("") +
      '</ul></div></div>';
  }
  return h || '<div class="vide">Rien à afficher.</div>';
}

/* ---- ad copies ---- */
function htmlAdCopy(d){
  var angles = d.angles || {};
  var noms = { probleme:"Angle problème", preuve:"Angle preuve", offre:"Angle offre" };
  var h = "";

  if(d.horsLigne){
    h += '<div class="alerte warn"><span class="ic">⚠</span><div>' +
      '<b>Gabarits, pas de rédaction.</b> Sans clé API, le darija n\'est pas écrit : ' +
      'la structure est là, les crochets sont à remplir.</div></div>';
  }

  Object.keys(angles).forEach(function(cle){
    var a = angles[cle];
    if(!a) return;
    h += '<div class="carte"><div class="pad">' +
      '<h2>' + ech(noms[cle] || cle) + '</h2>' +
      (a.pourquoi ? '<p class="sous">' + ech(a.pourquoi) + '</p>' : '') +
      (a.hookAr ? '<div class="ligne-champ"><label>Hook</label>' + boutonCopie("hook-" + cle) + '</div>' +
        '<p class="bloc ar" id="hook-' + cle + '">' + ech(a.hookAr) + '</p>' +
        (a.hookFr ? '<p style="color:var(--encre3);font-size:13.5px;margin:7px 0 0">' + ech(a.hookFr) + '</p>' : '') : '') +
      (a.meta ? '<div class="ligne-champ"><label>Texte principal Meta</label>' + boutonCopie("meta-" + cle) + '</div>' +
        '<p class="bloc ar" id="meta-' + cle + '">' + ech(a.meta.texte) + '</p>' +
        '<div class="tw" style="margin-top:14px"><table><tbody>' +
        ligne("Titre", ech(a.meta.titre || "")) + ligne("Description", ech(a.meta.description || "")) +
        '</tbody></table></div>' : '') +
      (a.tiktok ? '<div class="ligne-champ"><label>Légende TikTok</label>' + boutonCopie("tk-" + cle) + '</div>' +
        '<p class="bloc ar" id="tk-' + cle + '">' + ech(a.tiktok.legende) + '</p>' +
        '<div class="ligne-champ"><label>Hashtags</label>' + boutonCopie("hs-" + cle) + '</div>' +
        '<p class="bloc ar" id="hs-' + cle + '">' + ech(a.tiktok.hashtags) + '</p>' : '') +
      '</div></div>';
  });

  if(d.benefices && d.benefices.length){
    h += '<div class="carte"><div class="pad"><h3>Bénéfices</h3><div class="tw"><table><tbody>' +
      d.benefices.map(function(b, i){
        return '<tr><td>' + ech(b) + '</td><td class="ar" style="font-size:15.5px">' +
          ech((d.beneficesAr || [])[i] || "") + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.objections && d.objections.length){
    h += '<div class="carte"><div class="pad"><h3>Objections traitées</h3>' +
      '<p class="sous">Ce sont elles qui font annuler à l\'appel de confirmation. Elles sont dans la landing page.</p>' +
      d.objections.map(function(o){
        return '<div style="border-left:3px solid var(--sauge);padding:3px 0 3px 15px;margin-bottom:16px">' +
          '<p style="font-weight:700;color:var(--ocre);margin:0 0 4px">« ' + ech(o.question) + ' »</p>' +
          '<p style="margin:0;color:var(--encre2)">' + ech(o.reponse) + '</p></div>';
      }).join("") + '</div></div>';
  }
  return h || '<div class="vide">Rien à afficher.</div>';
}

function boutonCopie(id){
  return '<button class="cp" data-copier="' + id + '">Copier</button>';
}

/* ---- scripts ---- */
function htmlScripts(d){
  var s = d.scripts || {};
  var noms = { probleme:"Angle problème", preuve:"Angle preuve", offre:"Angle offre" };
  var h = "";
  Object.keys(s).forEach(function(cle){
    var sc = s[cle];
    if(!sc || !sc.beats) return;
    h += '<div class="carte"><div class="pad">' +
      '<h2>' + ech(noms[cle] || cle) + (sc.duree ? ' · ' + ech(sc.duree) : "") + '</h2>' +
      (sc.titre ? '<p class="sous">' + ech(sc.titre) + '</p>' : '') +
      '<div class="tw"><table class="beats"><thead><tr><th>Temps</th><th>Beat</th><th>Ce qu\'on filme</th><th>Voix</th></tr></thead><tbody>' +
      sc.beats.map(function(b){
        return '<tr><td class="t">' + ech(b.temps) + '</td><td class="b">' + ech(b.beat) + '</td>' +
          '<td>' + ech(b.image) + '</td>' +
          '<td class="ar" style="font-size:15px">' + ech(b.voix || "") + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      (sc.materiel && sc.materiel.length
        ? '<p style="margin:14px 0 0;color:var(--encre3);font-size:13.5px"><b>Matériel :</b> ' +
          ech(sc.materiel.join(" · ")) + '</p>' : '') +
      '</div></div>';
  });
  if(d.conseilTournage && d.conseilTournage.length){
    h += '<div class="carte"><div class="pad"><h3>Conseils de tournage</h3><ul style="margin:0;padding-left:19px;color:var(--encre2)">' +
      d.conseilTournage.map(function(c){ return '<li style="margin-bottom:7px">' + ech(c) + '</li>'; }).join("") +
      '</ul></div></div>';
  }
  return h || '<div class="vide">Rien à afficher.</div>';
}

/* ---- visuels ---- */
function nomAngle(cle){
  return { probleme:"Angle problème", preuve:"Angle preuve", offre:"Angle offre" }[cle] || cle;
}

function htmlVisuels(d, c){
  var creas = d.creas || [];
  if(!creas.length && !(d.photos || []).length) return '<div class="vide">Aucune créa.</div>';

  var parAngle = {};
  creas.forEach(function(x){ (parAngle[x.angle] = parAngle[x.angle] || []).push(x); });

  var h = "";

  var photos = (d.photos || []).filter(function(p){ return p.ok; });
  if (d.avertissementPhotos) {
    h += '<div class="alerte warn"><span class="ic">⚠</span><div>' + ech(d.avertissementPhotos) + '</div></div>';
  }
  if (photos.length) {
    h += '<div class="carte"><div class="pad">' +
      '<h2>Photos produit</h2>' +
      '<p class="sous">Générées par Higgsfield, une par angle, sans texte incrusté. ' +
      'Elles servent la galerie de la landing page ; le prix et le hook restent sur les créas SVG, ' +
      'où ils se corrigent sans regénérer l\'image.</p>' +
      '<div class="creas">' +
      photos.map(function(p){
        var url = "/api/campagnes/" + c.id + "/fichier/" + encodeURIComponent(p.fichier);
        return '<figure class="crea" style="margin:0">' +
          '<div class="apercu"><img src="' + url + '" alt="Photo produit — angle ' + ech(p.angle) + '" loading="lazy"></div>' +
          '<figcaption class="bas"><span class="t">' + ech(nomAngle(p.angle)) +
            '<span class="d">' + Math.round((p.octets || 0) / 1024) + ' Ko</span></span>' +
          '<a class="btn sm" href="' + url + '" download="' + ech(p.fichier) + '">Télécharger</a>' +
          '</figcaption></figure>';
      }).join("") +
      '</div></div></div>';
  }

  h += '<div class="note"><b>Les fichiers sont en SVG.</b> ' +
    'Le bouton « PNG » les convertit aux dimensions exactes attendues par Meta et TikTok. ' +
    'Le texte reste vectoriel : vous pouvez ouvrir le SVG dans n\'importe quel éditeur ' +
    'pour changer un mot sans tout refaire.</div>';

  Object.keys(parAngle).forEach(function(angle){
    var lot = parAngle[angle];
    h += '<div class="carte"><div class="pad">' +
      '<h2>' + ech(lot[0].angleNom) + '</h2>' +
      '<p class="sous">' + ech(lot[0].angleQuoi) + '</p>' +
      '<div class="creas">' +
      lot.map(function(x){
        var url = "/api/campagnes/" + c.id + "/fichier/" + encodeURIComponent(x.fichier);
        return '<figure class="crea" style="margin:0">' +
          '<div class="apercu"><img src="' + url + '" alt="' + ech(x.angleNom + " " + x.formatNom) + '" loading="lazy"></div>' +
          '<figcaption class="bas"><span class="t">' + ech(x.formatNom) +
            '<span class="d">' + x.largeur + " × " + x.hauteur + '</span></span>' +
          '<button class="btn sm" data-png="' + ech(url) + '" data-nom="' + ech(x.fichier.replace(".svg", ".png")) +
            '" data-l="' + x.largeur + '" data-h="' + x.hauteur + '">PNG</button>' +
          '<a class="btn sm" href="' + url + '" download="' + ech(x.fichier) + '">SVG</a>' +
          '</figcaption></figure>';
      }).join("") +
      '</div></div></div>';
  });
  return h;
}

/* ---- landing ---- */
function htmlLanding(d, c){
  var url = "/api/campagnes/" + c.id + "/fichier/" + encodeURIComponent(d.fichier || "landing.html");
  return (d.aFaire ? '<div class="alerte warn"><span class="ic">⚠</span><div>' + ech(d.aFaire) + '</div></div>' : "") +
    '<div class="carte"><div class="pad">' +
      '<h2>Landing page</h2>' +
      '<p class="sous">Fichier autonome de ' + ech(d.note || "") + '. Formulaire à trois champs, ' +
      'validation du numéro marocain avant envoi, sortie WhatsApp pré-remplie. ' +
      'Aucune dépendance : déposez-le tel quel chez n\'importe quel hébergeur.</p>' +
      '<div class="actions" style="margin-top:0">' +
        '<a class="btn pri" href="' + url + '" target="_blank" rel="noopener">Ouvrir en grand ↗</a>' +
        '<a class="btn" href="' + url + '" download="landing.html">Télécharger</a>' +
      '</div>' +
    '</div></div>' +
    '<div class="carte" style="overflow:hidden">' +
      '<iframe src="' + url + '" style="width:100%;height:760px;border:0;display:block" title="Aperçu de la landing page"></iframe>' +
    '</div>';
}

/* ---- stratégie ---- */
function htmlStrategie(d){
  var b = d.budget || {};
  var h = '<div class="tuiles">' +
    tuile("Budget de test", dh(b.budgetJourTest), "par jour, 3 jours") +
    tuile("Enveloppe de test", dh(b.budgetTest3Jours), "avant premier arbitrage") +
    tuile("Commandes attendues", nb(b.commandesBrutesAttendues), "dont " + nb(b.livreesAttendues) + " livrées") +
    tuile("Seuil de coupure", dh(b.seuilCoupure), "CPA maximum", "mal") +
    tuile("Seuil de scaling", dh(b.seuilScaling), "CPA cible", "bien") +
    '</div>';

  if(d.objectif){
    h += '<div class="alerte good"><span class="ic">◎</span><div><b>Objectif.</b> ' + ech(d.objectif) + '</div></div>';
  }

  if(d.regles && d.regles.length){
    h += '<div class="carte"><div class="pad"><h2>Les règles de décision</h2>' +
      '<p class="sous">À appliquer sans discuter : c\'est ce qui empêche de laisser tourner ' +
      'une campagne qui perd de l\'argent parce que le ROAS affiché paraît bon.</p>' +
      '<div class="tw"><table><thead><tr><th>Quand</th><th>Alors</th></tr></thead><tbody>' +
      d.regles.map(function(r){
        return '<tr><td><span class="pilule ' + ech(r.ton) + '">' + ech(r.quand) + '</span></td>' +
          '<td>' + ech(r.alors) + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.phases && d.phases.length){
    h += '<div class="carte"><div class="pad"><h2>Les quatre phases</h2><div class="tw"><table><thead><tr>' +
      '<th>Phase</th><th>Durée</th><th>Budget</th><th>Ce qu\'on fait</th><th>On regarde</th><th>Décision</th>' +
      '</tr></thead><tbody>' +
      d.phases.map(function(p){
        return '<tr><td class="nom">' + ech(p.nom) + '</td>' +
          '<td class="num" style="font-size:12.5px">' + ech(p.duree) + '</td>' +
          '<td class="num" style="font-size:12.5px">' + ech(p.budget) + '</td>' +
          '<td style="font-size:13.5px">' + ech(p.quoi) + '</td>' +
          '<td style="font-size:13px;color:var(--encre2)">' + ech((p.onRegarde || []).join(" · ")) + '</td>' +
          '<td style="font-size:13.5px">' + ech(p.decision) + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.ciblage){
    h += '<div class="carte"><div class="pad"><h3>Ciblage</h3><div class="tw"><table><tbody>' +
      ligne("Meta", ech(d.ciblage.meta || "")) +
      ligne("TikTok", ech(d.ciblage.tiktok || "")) +
      ligne("Exclusions", ech(d.ciblage.exclusions || "")) +
      '</tbody></table></div></div></div>';
  }

  if(d.calendrier && d.calendrier.length){
    h += '<div class="carte"><div class="pad"><h3>Calendrier</h3><div class="tw"><table><tbody>' +
      d.calendrier.map(function(j){
        return '<tr><td class="num" style="width:80px;color:var(--ocre);font-weight:600">' + ech(j.jour) + '</td>' +
          '<td>' + ech(j.quoi) + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }

  if(d.avantLancement && d.avantLancement.length){
    h += '<div class="carte"><div class="pad"><h3>À régler avant la première publicité</h3>' +
      '<ul style="margin:0;padding-left:19px;color:var(--encre2)">' +
      d.avantLancement.map(function(x){ return '<li style="margin-bottom:7px">' + ech(x) + '</li>'; }).join("") +
      '</ul></div></div>';
  }

  if(d.risques && d.risques.length){
    h += '<div class="carte"><div class="pad"><h3>Risques et parades</h3><div class="tw"><table><thead><tr>' +
      '<th>Risque</th><th>Parade</th></tr></thead><tbody>' +
      d.risques.map(function(r){
        return '<tr><td class="nom">' + ech(r.risque) + '</td><td>' + ech(r.parade) + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';
  }
  return h;
}

/* ---------------------------------------------------------------------------
   Interactions du corps
   ------------------------------------------------------------------------ */
function brancherCorps(){
  document.querySelectorAll("[data-copier]").forEach(function(b){
    b.onclick = function(){
      var el = document.getElementById(b.dataset.copier);
      if(!el) return;
      navigator.clipboard.writeText(el.textContent).then(function(){
        b.textContent = "Copié ✓"; b.classList.add("ok");
        setTimeout(function(){ b.textContent = "Copier"; b.classList.remove("ok"); }, 1800);
      }).catch(function(){ toast("Copie refusée par le navigateur."); });
    };
  });

  document.querySelectorAll("[data-png]").forEach(function(b){
    b.onclick = function(){ svgVersPng(b.dataset.png, b.dataset.nom, +b.dataset.l, +b.dataset.h, b); };
  });
}

/* Conversion SVG → PNG dans le navigateur, aux dimensions exactes attendues
   par Meta et TikTok. Pas de bibliothèque : un canvas suffit. */
function svgVersPng(url, nom, largeur, hauteur, bouton){
  var avant = bouton.textContent;
  bouton.textContent = "…"; bouton.disabled = true;

  fetch(url).then(function(r){ return r.text(); }).then(function(svg){
    var blob = new Blob([svg], { type:"image/svg+xml;charset=utf-8" });
    var src = URL.createObjectURL(blob);
    var img = new Image();
    img.onload = function(){
      var cv = document.createElement("canvas");
      cv.width = largeur; cv.height = hauteur;
      var cx = cv.getContext("2d");
      cx.drawImage(img, 0, 0, largeur, hauteur);
      URL.revokeObjectURL(src);
      cv.toBlob(function(png){
        var a = document.createElement("a");
        a.href = URL.createObjectURL(png);
        a.download = nom;
        a.click();
        setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1500);
        bouton.textContent = avant; bouton.disabled = false;
      }, "image/png");
    };
    img.onerror = function(){
      URL.revokeObjectURL(src);
      bouton.textContent = avant; bouton.disabled = false;
      toast("Conversion impossible. Téléchargez le SVG et convertissez-le dans votre éditeur.");
    };
    img.src = src;
  }).catch(function(){
    bouton.textContent = avant; bouton.disabled = false;
    toast("Fichier introuvable.");
  });
}

/* ===========================================================================
   VUE — campagnes
   ======================================================================== */
function vueCampagnes(){
  api("/campagnes").then(function(liste){
    var h = '<div class="tete"><p class="kick">Historique</p><h1>Campagnes produites</h1>' +
      '<p>Chaque campagne garde son dossier complet dans <span class="num">data/campagnes/</span> : ' +
      'le JSON de la chaîne, les neuf créas et la landing page.</p></div>';

    if(!liste.length){
      h += '<div class="vide"><strong>Aucune campagne</strong>Lancez la première depuis l\'orchestrateur.</div>';
    }else{
      h += '<div class="carte"><div class="pad"><div class="tw"><table><thead><tr>' +
        '<th>Cible</th><th>Lancée</th><th>Mode</th><th class="r">Score</th><th class="r">Prix / coût</th><th>Statut</th><th></th>' +
        '</tr></thead><tbody>' +
        liste.sort(function(a,b){ return (b.debut||"") < (a.debut||"") ? -1 : 1; }).map(function(c){
          var statut = c.statut === "fini" ? ["good","Terminée"] :
                       c.statut === "arrete" ? ["bad","Arrêtée"] :
                       c.statut === "en-cours" ? ["warn","En cours"] : ["creuse", c.statut];
          return '<tr><td><span class="nom">' + ech(c.cible) + '</span>' +
            '<span class="meta">' + ech(c.type) + '</span></td>' +
            '<td class="num" style="font-size:12.5px">' + ech(frDate(c.debut)) + '</td>' +
            '<td style="font-size:13px">' + (c.mode === "live" ? "direct" : "hors ligne") + '</td>' +
            '<td class="r num">' + (c.score != null ? c.score : "—") + '</td>' +
            '<td class="r num">' + (c.prix ? nb(c.prix) + " / " + nb(c.cout) : "—") + '</td>' +
            '<td><span class="pilule ' + statut[0] + '">' + ech(statut[1]) + '</span></td>' +
            '<td class="r"><button class="btn sm" data-ouvrir="' + ech(c.id) + '">Ouvrir</button></td></tr>';
        }).join("") + '</tbody></table></div></div></div>';
    }
    $("vue").innerHTML = h;
    $("vue").querySelectorAll("[data-ouvrir]").forEach(function(b){
      b.onclick = function(){
        api("/campagnes/" + b.dataset.ouvrir).then(function(c){
          campagne = c;
          if(!campagne.etapes){
            /* Campagne relue du disque : on reconstruit l'avancement à partir
               des résultats présents, il n'y a plus de suivi en mémoire. */
            campagne.etapes = ETAT.etapes.map(function(e){
              return Object.assign({}, e, {
                statut: (c.resultats && c.resultats[e.id]) ? (c.resultats[e.id].echec ? "echec" : "fait") : "sautee",
                note: (c.resultats && c.resultats[e.id] && c.resultats[e.id].note) || null
              });
            });
          }
          ongletResultat = "validation";
          vue = "orchestrateur";
          rendreCampagne();
        }).catch(function(err){ toast(err.message); });
      };
    });
  });
}

/* ===========================================================================
   VUE — carnet fournisseurs
   ======================================================================== */
function vueCarnet(){
  Promise.all([api("/fournisseurs"), api("/comptoir")]).then(function(res){
    var carnet = res[0], comptoir = res[1];
    var h = '<div class="tete"><p class="kick">Carnet d\'adresses</p><h1>Fournisseurs</h1>' +
      '<p>Ce que les campagnes ont trouvé s\'accumule ici : la prochaine campagne sur la même ' +
      'catégorie retrouve ces contacts sans les rechercher.</p></div>';

    if(!carnet.length){
      h += '<div class="vide"><strong>Carnet vide</strong>' +
        'Lancez une campagne : les contacts trouvés pendant l\'étape fournisseurs viennent se ranger ici.</div>';
    }else{
      h += '<div class="carte"><div class="pad"><h2>' + carnet.length + ' contacts</h2>' +
        '<p class="sous">Coordonnées publiées, jamais appelées. À qualifier avant tout acompte.</p>' +
        '<div class="tw"><table><thead><tr><th>Fournisseur</th><th>Type</th><th>Où</th><th>Contact</th><th>Fiabilité</th><th></th></tr></thead><tbody>' +
        carnet.map(function(c){
          var liens = [];
          if(c.telephone) liens.push('<a href="tel:' + ech(String(c.telephone).replace(/\s/g,"")) + '">' + ech(c.telephone) + '</a>');
          if(c.whatsapp) liens.push('<a href="https://wa.me/' + ech(String(c.whatsapp).replace(/\D/g,"")) + '" target="_blank" rel="noopener">WhatsApp</a>');
          if(c.siteWeb) liens.push('<a href="' + ech(c.siteWeb) + '" target="_blank" rel="noopener">site ↗</a>');
          var fi = c.fiabilite === "haute" ? "good" : c.fiabilite === "moyenne" ? "accent" : "creuse";
          return '<tr><td><span class="nom">' + ech(c.nom) + '</span>' +
            (c.note ? '<span class="meta" style="font-family:var(--f-corps);font-size:12.5px;color:var(--encre2)">' + ech(c.note) + '</span>' : '') + '</td>' +
            '<td style="font-size:13px">' + ech(c.type || "—") + '</td>' +
            '<td>' + ech(c.ville || "—") + '</td>' +
            '<td style="font-size:13px">' + (liens.join("<br>") || '<span class="pilule creuse">non publié</span>') + '</td>' +
            '<td><span class="pilule ' + fi + '">' + ech(c.fiabilite || "à qualifier") + '</span></td>' +
            '<td class="r"><button class="btn sm dgr" data-suppr="' + ech(c.id) + '">×</button></td></tr>';
        }).join("") + '</tbody></table></div></div></div>';
    }

    h += '<div class="carte"><div class="pad"><h2>Les ' + comptoir.sources.length + ' sources du Comptoir</h2>' +
      '<p class="sous">La base de référence, toujours disponible : marchés physiques, usines, ' +
      'marketplaces B2B, annuaires, filières internationales. L\'indice est un multiple du prix usine chinoise.</p>' +
      '<div class="tw"><table><thead><tr><th>Source</th><th>Type</th><th>Où</th><th class="r">Indice</th><th>Délai</th><th>MOQ</th></tr></thead><tbody>' +
      comptoir.sources.map(function(s){
        var type = (comptoir.types.filter(function(t){ return t.id === s.t; })[0] || {}).n || s.t;
        return '<tr><td><span class="nom">' + ech(s.n) + '</span>' +
          '<span class="meta">' + ech((s.d || "").slice(0, 90)) + '…</span></td>' +
          '<td style="font-size:13px">' + ech(type) + '</td>' +
          '<td style="font-size:13px">' + ech(s.ville || s.pays || "") + '</td>' +
          '<td class="r num">' + (s.idx ? s.idx.toFixed(2).replace(".", ",") : "—") + '</td>' +
          '<td style="font-size:12.5px">' + ech(s.delai) + '</td>' +
          '<td style="font-size:12.5px">' + ech(s.moq) + '</td></tr>';
      }).join("") + '</tbody></table></div></div></div>';

    $("vue").innerHTML = h;
    $("vue").querySelectorAll("[data-suppr]").forEach(function(b){
      b.onclick = function(){
        api("/fournisseurs/" + b.dataset.suppr, { method:"DELETE" }).then(function(){ vueCarnet(); });
      };
    });
  });
}

/* ===========================================================================
   VUE — réglages
   ======================================================================== */
function vueReglages(){
  api("/reglages").then(function(r){
    var hyp = r.hypotheses;
    $("vue").innerHTML =
      '<div class="tete"><p class="kick">Atelier</p><h1>Réglages</h1>' +
      '<p>Ces chiffres pilotent tout le reste : le score des produits, le CPA maximum, ' +
      'les budgets de campagne, les verdicts. Mettez vos vrais chiffres dès que vous les connaissez.</p></div>' +

      '<form id="f-reglages">' +
      '<div class="carte"><div class="pad"><h2>Boutique</h2>' +
        '<div class="champs">' +
          champ("boutique", "Nom de la boutique", "text", r.boutique) +
          champ("whatsapp", "WhatsApp des commandes", "text", r.whatsapp || "", "Format international sans +, ex. 212612345678. Utilisé par les landing pages.") +
        '</div></div></div>' +

      '<div class="carte"><div class="pad"><h2>Modèle économique COD</h2>' +
        '<p class="sous">Les valeurs par défaut viennent du marché marocain : 85 % de confirmées, ' +
        '70 % de livrées. Dès que Pilote COD a plus de dix commandes terminées, remplacez-les par vos taux réels.</p>' +
        '<div class="champs">' +
          champ("confirmation", "Taux de confirmation", "number", hyp.confirmation, "entre 0 et 1", "0.01") +
          champ("livraison", "Taux de livraison", "number", hyp.livraison, "part des confirmées effectivement livrées", "0.01") +
          champ("fraisLivraison", "Frais de livraison (DH)", "number", hyp.fraisLivraison, "par colis livré") +
          champ("fraisRetour", "Frais par refus (DH)", "number", hyp.fraisRetour, "aller-retour + manutention") +
          champ("fenetreBasse", "Bas de la fenêtre COD (DH)", "number", hyp.fenetreBasse) +
          champ("fenetreHaute", "Haut de la fenêtre COD (DH)", "number", hyp.fenetreHaute) +
          champ("cplPlancher", "Plancher de CPA (DH)", "number", hyp.cplPlancher, "sous ce CPA maximum, la chaîne refuse de lancer") +
        '</div></div></div>' +

      '<div class="carte"><div class="pad"><h2>Claude</h2>' +
        '<p class="sous">' + (ETAT.claude.disponible
          ? "Recherche web active. L'orchestrateur cherche et rédige en direct."
          : ech(ETAT.claude.raison)) + '</p>' +
        '<div class="champs">' + champ("modele", "Modèle", "text", r.modele) + '</div>' +
        (ETAT.claude.disponible ? '' :
          '<div class="note"><b>Pour activer le mode direct.</b> Lancez <span class="num">npm install</span>, ' +
          'copiez <span class="num">.env.example</span> en <span class="num">.env</span>, ' +
          'renseignez <span class="num">ANTHROPIC_API_KEY</span>, puis redémarrez avec ' +
          '<span class="num">npm start</span>.</div>') +
      '</div></div>' +

      carteConnecteurs(r) +

      '<div class="actions"><button class="btn pri" type="submit">Enregistrer</button>' +
        '<a class="btn" href="/api/export">Exporter toutes les données</a></div>' +
      '</form>';

    brancherConnecteurs();

    $("f-reglages").onsubmit = function(ev){
      ev.preventDefault();
      var f = ev.target;
      var charge = {
        boutique: f.boutique.value.trim(),
        whatsapp: f.whatsapp.value.replace(/\D/g, ""),
        modele: f.modele.value.trim(),
        connecteurs: {
          make: {
            webhook: f.makeWebhook.value.trim(),
            token: f.makeToken.value.trim(),
            zone: f.makeZone.value.trim() || "eu2",
            equipe: f.makeEquipe.value.trim()
          },
          higgsfield: {
            cleId: f.hfId.value.trim(),
            cleSecret: f.hfSecret.value.trim(),
            profil: f.hfProfil.value,
            modele: f.hfModele.value.trim()
          }
        },
        hypotheses: {
          confirmation: Number(f.confirmation.value),
          livraison: Number(f.livraison.value),
          fraisLivraison: Number(f.fraisLivraison.value),
          fraisRetour: Number(f.fraisRetour.value),
          fenetreBasse: Number(f.fenetreBasse.value),
          fenetreHaute: Number(f.fenetreHaute.value),
          cplPlancher: Number(f.cplPlancher.value)
        }
      };
      api("/reglages", { method:"PUT", body: JSON.stringify(charge) }).then(function(){
        toast("Réglages enregistrés.");
        return api("/etat");
      }).then(function(e){
        ETAT = e;
        $("nomBoutique").textContent = e.reglages.boutique || "";
      }).catch(function(err){ toast(err.message); });
    };
  });
}

/* ---------------------------------------------------------------------------
   Connecteurs
   ------------------------------------------------------------------------ */
function carteConnecteurs(r){
  var e = ETAT.connecteurs || { make:{}, higgsfield:{} };
  var cm = (r.connecteurs || {}).make || {};
  var ch = (r.connecteurs || {}).higgsfield || {};

  return '<div class="carte"><div class="pad">' +
    '<h2>Connecteurs</h2>' +
    '<p class="sous">Deux liens vers l\'extérieur, tous les deux facultatifs. ' +
    'L\'application marche entièrement sans eux.</p>' +

    '<h3 style="margin-top:22px">Make ' + pastilleConnecteur(e.make.actif) + '</h3>' +
    '<p class="sous">Le webhook reçoit chaque campagne terminée et chaque commande passée ' +
    'depuis une landing page — y compris quand la page est hébergée ailleurs. ' +
    'Créez un scénario Make démarrant par « Webhooks → Custom webhook » et collez son URL. ' +
    'Aucune authentification n\'est nécessaire pour un webhook standard.</p>' +
    '<div class="champs">' +
      champ("makeWebhook", "URL du webhook", "text", cm.webhook || "", "https://hook.eu2.make.com/…") +
      champ("makeToken", "Jeton d\'API (facultatif)", "password", cm.token || "", "Permet de lister et déclencher vos scénarios") +
      champ("makeZone", "Zone", "text", cm.zone || "eu2", "eu1, eu2, us1…") +
      champ("makeEquipe", "ID d\'équipe (facultatif)", "text", cm.equipe || "") +
    '</div>' +
    '<div class="actions"><button class="btn" type="button" id="test-make">Tester Make</button>' +
      '<span id="res-make" class="aide"></span></div>' +

    '<h3 style="margin-top:26px">Higgsfield ' + pastilleConnecteur(e.higgsfield.actif) + '</h3>' +
    '<p class="sous">Produit une photo produit par angle, en plus des neuf créas SVG. ' +
    'Il faut deux valeurs : un identifiant de clé et son secret. ' +
    'La documentation Higgsfield décrit deux contrats — si vos identifiants sont anciens ' +
    '(en-têtes <span class="num">hf-api-key</span> / <span class="num">hf-secret</span>), ' +
    'choisissez le profil v1.</p>' +
    '<div class="champs">' +
      champ("hfId", "Identifiant de clé", "password", ch.cleId || "") +
      champ("hfSecret", "Secret", "password", ch.cleSecret || "") +
      '<div class="champ"><label for="r-hfProfil">Profil d\'API</label>' +
        '<select id="r-hfProfil" name="hfProfil">' +
        ['v2','v1'].map(function(v){
          return '<option value="' + v + '"' + ((ch.profil || "v2") === v ? " selected" : "") + '>' +
            (v === "v2" ? "v2 — api.higgsfield.ai (courant)" : "v1 — platform.higgsfield.ai (ancien)") +
            '</option>'; }).join("") +
        '</select></div>' +
      champ("hfModele", "Modèle", "text", ch.modele || "higgsfield-ai/soul/v2/standard", "profil v2 uniquement") +
    '</div>' +
    '<div class="actions"><button class="btn" type="button" id="test-hf">Tester Higgsfield</button>' +
      '<span id="res-hf" class="aide"></span></div>' +

    '<div class="note"><b>Où sont rangées ces clés.</b> Enregistrées ici, elles vont dans ' +
    '<span class="num">data/reglages.json</span>, en clair sur votre disque — ce fichier est hors ' +
    'du dépôt Git, mais il part avec un export de données. Pour les garder à l\'écart, mettez-les ' +
    'plutôt dans <span class="num">.env</span> : ' +
    '<span class="num">MAKE_WEBHOOK_URL</span>, <span class="num">MAKE_API_TOKEN</span>, ' +
    '<span class="num">HIGGSFIELD_KEY_ID</span>, <span class="num">HIGGSFIELD_KEY_SECRET</span>. ' +
    'L\'environnement l\'emporte toujours sur les réglages.</div>' +
    '</div></div>';
}

function pastilleConnecteur(actif){
  return '<span class="pilule ' + (actif ? "good" : "creuse") + '" style="margin-left:8px;vertical-align:middle">' +
    (actif ? "branché" : "non configuré") + '</span>';
}

function brancherConnecteurs(){
  var bm = $("test-make");
  if(bm) bm.onclick = function(){
    testerConnecteur(bm, "res-make", "/connecteurs/make/test", function(d){
      var bouts = [];
      if(d.webhook) bouts.push(d.webhook.envoye
        ? "webhook : évènement envoyé ✓"
        : "webhook : " + (d.webhook.erreur || d.webhook.raison));
      if(d.api) bouts.push(d.api.ok
        ? "API : " + d.api.scenarios + " scénarios (" + d.api.actifs + " actifs) ✓"
        : "API : " + (d.api.erreur || d.api.raison));
      return bouts.join(" · ");
    });
  };

  var bh = $("test-hf");
  if(bh) bh.onclick = function(){
    testerConnecteur(bh, "res-hf", "/connecteurs/higgsfield/test", function(d){
      return d.ok
        ? "image reçue, " + Math.round(d.octets / 1024) + " Ko ✓"
        : "échec : " + d.erreur;
    });
  };
}

/* Un test se fait sur les réglages ENREGISTRÉS, pas sur ce qui est à l'écran :
   on enregistre d'abord, sinon le bouton testerait l'ancienne configuration. */
function testerConnecteur(bouton, cibleId, chemin, formater){
  var avant = bouton.textContent;
  var sortie = $(cibleId);
  bouton.disabled = true;
  bouton.textContent = "Test en cours…";
  sortie.textContent = "";

  var f = $("f-reglages");
  var enregistrer = f
    ? new Promise(function(res){ f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", {cancelable:true})); setTimeout(res, 350); })
    : Promise.resolve();

  enregistrer
    .then(function(){ return api(chemin, { method: "POST", body: "{}" }); })
    .then(function(d){ sortie.textContent = formater(d); })
    .catch(function(err){ sortie.textContent = "échec : " + err.message; })
    .then(function(){
      bouton.disabled = false;
      bouton.textContent = avant;
      return api("/etat");
    })
    .then(function(e){ if(e) ETAT = e; });
}

function champ(nom, label, type, val, aide, pas){
  return '<div class="champ"><label for="r-' + nom + '">' + ech(label) + '</label>' +
    '<input id="r-' + nom + '" name="' + nom + '" type="' + type + '"' +
    (type === "number" ? ' step="' + (pas || "1") + '" inputmode="decimal"' : '') +
    ' value="' + ech(val == null ? "" : val) + '">' +
    (aide ? '<span class="aide">' + ech(aide) + '</span>' : '') + '</div>';
}

/* ===========================================================================
   Messages venus des applications (passerelle)
   ======================================================================== */
window.addEventListener("message", function(ev){
  var d = ev.data;
  if(!d || d.type !== "poste-cod:lancer" || !d.produit) return;
  campagne = null;
  aller("orchestrateur");
  setTimeout(function(){
    var c = $("cible");
    if(!c) return;
    c.value = d.produit.nom || "";
    if(d.produit.prix && $("prix")) $("prix").value = d.produit.prix;
    if(d.produit.cout && $("cout")) $("cout").value = d.produit.cout;
    c.scrollIntoView({ block:"center", behavior:"smooth" });
    c.focus();
    toast("Produit reçu de " + (d.produit.source || "l'application") + ". Vérifiez les chiffres puis lancez.");
  }, 60);
});

demarrer();
})();
