"use strict";
/* =============================================================================
   Landing page COD — un fichier HTML autonome, bilingue FR / Darija.

   Ce qui la distingue d'une page produit ordinaire :
     - le formulaire demande trois champs et rien d'autre (nom, téléphone,
       ville) ; chaque champ supplémentaire coûte des commandes ;
     - le paiement à la livraison est répété à chaque écran, c'est la première
       objection du marché marocain ;
     - le téléphone est validé au format marocain (06/07 + 8 chiffres) avant
       envoi, parce qu'un numéro faux est une commande perdue ET du budget pub
       dépensé ;
     - la page fonctionne sans serveur : la commande part en WhatsApp
       pré-rempli, ce qui est le canal réel de confirmation au Maroc.
   ========================================================================== */

const ech = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* Une valeur injectée dans un <script> ne peut pas passer par ech() : elle doit
   rester du JavaScript valide. Mais un « </script> » dans une chaîne referme la
   balise et le reste de la page part en texte — c'est le nom du produit qui
   arrive de la recherche, on ne le contrôle pas. On échappe donc « < » et les
   séparateurs de ligne Unicode, que JSON laisse passer et que JS refuse. */
const js = v => JSON.stringify(v == null ? "" : v)
  .replace(/</g, "\\u003c")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

const VILLES = ["Casablanca", "Rabat", "Salé", "Marrakech", "Fès", "Tanger", "Agadir",
  "Meknès", "Oujda", "Kénitra", "Tétouan", "Témara", "Safi", "Mohammedia", "Khouribga",
  "Béni Mellal", "El Jadida", "Nador", "Settat", "Berrechid", "Laâyoune", "Autre ville"];

function page(brief) {
  const b = brief || {};
  const titre = b.titre || b.produit || "Produit";
  const titreAr = b.titreAr || "";
  const prix = b.prix != null ? b.prix : "";
  const prixBarre = b.prixBarre || null;
  const devise = b.devise || "DH";
  const boutique = b.boutique || "Ma boutique";
  const whatsapp = (b.whatsapp || "").replace(/\D/g, "");
  const webhookUrl = b.webhookUrl || "";
  const promesse = b.promesse || "";
  const promesseAr = b.promesseAr || "";
  const benefices = b.benefices || [];
  const beneficesAr = b.beneficesAr || [];
  const objections = b.objections || [];
  const faq = b.faq || [];
  const specs = b.specs || [];
  const creas = b.creas || [];       // { fichier, angle } — visuels servis à côté

  const economie = prixBarre && prix ? Math.round(prixBarre - prix) : null;

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ech(titre)} — ${ech(prix)} ${ech(devise)} · Paiement à la livraison</title>
<meta name="description" content="${ech(promesse.slice(0, 155))}">
<meta property="og:title" content="${ech(titre)} — ${ech(prix)} ${ech(devise)}">
<meta property="og:description" content="${ech(promesse.slice(0, 155))}">
<meta property="og:type" content="product">
<style>
:root{
  --fond:#F6F3EC; --surface:#FFFDF8; --surface2:#EFEAE0;
  --encre:#16211F; --encre2:#4A5754; --encre3:#7B8785;
  --trait:#DED7C9; --trait2:#EAE4D8;
  --accent:#0E5A48; --accent-clair:#DCEBE4; --or:#8D530D; --or-clair:#F3E7C6;
  --bien:#4A7C59; --alerte:#A8761B;
  --ombre:0 1px 2px rgba(22,33,31,.05),0 8px 28px rgba(22,33,31,.07);
  --r:12px;
  --f-titre:'Fraunces',Georgia,'Times New Roman',serif;
  --f-corps:'Archivo','Segoe UI',system-ui,-apple-system,sans-serif;
  --f-ar:'Cairo','IBM Plex Sans Arabic','Noto Naskh Arabic','Segoe UI',Tahoma,sans-serif;
  --f-num:'JetBrains Mono','IBM Plex Mono',ui-monospace,monospace;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --fond:#121A19; --surface:#1A2423; --surface2:#222D2C;
    --encre:#EAE5DB; --encre2:#A8B2AF; --encre3:#7D8785;
    --trait:#2C3937; --trait2:#243130;
    --accent:#43C2A0; --accent-clair:#12302A; --or:#D0973F; --or-clair:#2C2413;
    --bien:#6FA87C; --alerte:#D8A94A;
    --ombre:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.35);
    color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --fond:#121A19; --surface:#1A2423; --surface2:#222D2C;
  --encre:#EAE5DB; --encre2:#A8B2AF; --encre3:#7D8785;
  --trait:#2C3937; --trait2:#243130;
  --accent:#43C2A0; --accent-clair:#12302A; --or:#D0973F; --or-clair:#2C2413;
  --bien:#6FA87C; --alerte:#D8A94A;
  --ombre:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.35);
  color-scheme:dark;
}
*{box-sizing:border-box}
body{margin:0;background:var(--fond);color:var(--encre);font-family:var(--f-corps);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;height:auto;display:block}
.ar{font-family:var(--f-ar);direction:rtl;text-align:right;unicode-bidi:plaintext}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
h1,h2,h3{font-family:var(--f-titre);font-weight:600;margin:0;letter-spacing:-.018em;text-wrap:balance}

/* --- bandeau confiance, collé en haut --- */
.confiance{background:var(--accent);color:#fff;font-size:13.5px;font-weight:600;
  padding:9px 20px;text-align:center;letter-spacing:.01em}
:root[data-theme="dark"] .confiance,:root:not([data-theme="light"]) .confiance{color:#08201A}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) .confiance{color:#fff}}

/* --- héros --- */
.heros{padding:38px 0 30px}
.eyebrow{font-family:var(--f-num);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;
  color:var(--or);font-weight:600;margin:0 0 14px}
.heros h1{font-size:clamp(30px,5.4vw,50px);line-height:1.06;margin-bottom:12px}
.heros .ar-t{font-size:clamp(21px,3.6vw,30px);color:var(--encre2);margin:0 0 18px;font-weight:600}
.promesse{font-size:18px;color:var(--encre2);max-width:56ch;margin:0 0 26px}

/* --- prix --- */
.prixbloc{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:22px}
.prix{font-family:var(--f-num);font-size:clamp(42px,8vw,62px);font-weight:700;
  line-height:1;letter-spacing:-.03em;color:var(--or)}
.prix small{font-size:.42em;margin-left:6px;font-weight:600}
.barre{font-family:var(--f-num);font-size:22px;color:var(--encre3);text-decoration:line-through}
.eco{background:var(--or-clair);color:var(--or);font-weight:700;font-size:14px;
  padding:5px 13px;border-radius:99px;white-space:nowrap}

/* --- boutons --- */
.cta{display:inline-flex;align-items:center;justify-content:center;gap:10px;
  background:var(--accent);color:#fff;font-family:var(--f-corps);font-size:19px;font-weight:700;
  border:0;border-radius:var(--r);padding:18px 34px;cursor:pointer;width:100%;
  text-decoration:none;box-shadow:var(--ombre);transition:filter .15s ease}
:root[data-theme="dark"] .cta,:root:not([data-theme="light"]) .cta{color:#08201A}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]) .cta{color:#fff}}
.cta:hover{filter:brightness(1.08)}
.cta:focus-visible{outline:3px solid var(--or);outline-offset:3px}
.cta.ar{font-family:var(--f-ar);font-size:20px}

/* --- galerie --- */
.galerie{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:26px 0}
.galerie figure{margin:0;border:1px solid var(--trait);border-radius:var(--r);overflow:hidden;
  background:var(--surface)}

/* --- sections --- */
section{padding:34px 0;border-top:1px solid var(--trait)}
section h2{font-size:clamp(23px,4vw,31px);margin-bottom:6px}
section h2 + .sous{color:var(--encre2);margin:0 0 22px;max-width:58ch}

/* --- bénéfices --- */
.benefs{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.benefs li{display:flex;gap:13px;align-items:flex-start;background:var(--surface);
  border:1px solid var(--trait);border-radius:var(--r);padding:15px 17px}
.benefs .coche{flex:none;width:24px;height:24px;border-radius:50%;background:var(--accent-clair);
  color:var(--accent);display:grid;place-items:center;font-weight:700;font-size:14px;margin-top:1px}
.benefs b{display:block;font-weight:600;margin-bottom:2px}
.benefs .ar{font-size:15.5px;color:var(--encre2);margin-top:4px}

/* --- objections --- */
.obj{border-left:3px solid var(--accent);padding:4px 0 4px 16px;margin-bottom:18px}
.obj .q{font-weight:700;color:var(--or);margin:0 0 4px}
.obj p{margin:0;color:var(--encre2)}

/* --- specs --- */
table{width:100%;border-collapse:collapse;font-size:15px;background:var(--surface);
  border:1px solid var(--trait);border-radius:var(--r);overflow:hidden}
td{padding:12px 16px;border-bottom:1px solid var(--trait2)}
tr:last-child td{border-bottom:0}
td:first-child{font-weight:600;width:42%;color:var(--encre2)}

/* --- FAQ --- */
details{background:var(--surface);border:1px solid var(--trait);border-radius:var(--r);
  margin-bottom:9px;overflow:hidden}
summary{padding:15px 18px;cursor:pointer;font-weight:600;list-style:none;
  display:flex;justify-content:space-between;gap:12px}
summary::-webkit-details-marker{display:none}
summary::after{content:"+";color:var(--encre3);font-family:var(--f-num);flex:none}
details[open] summary::after{content:"–"}
details .rep{padding:0 18px 16px;color:var(--encre2)}

/* --- formulaire --- */
.commande{background:var(--surface);border:2px solid var(--accent);border-radius:var(--r);
  padding:26px 24px;box-shadow:var(--ombre)}
.commande h2{margin-bottom:4px}
.champs{display:grid;gap:15px;margin:20px 0}
label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;
  letter-spacing:.05em;text-transform:uppercase;color:var(--encre3)}
input,select{font-family:var(--f-corps);font-size:17px;color:var(--encre);background:var(--fond);
  border:1.5px solid var(--trait);border-radius:9px;padding:14px 14px;width:100%;
  text-transform:none;letter-spacing:0;font-weight:400}
input:focus,select:focus{outline:none;border-color:var(--accent);
  box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
input[aria-invalid="true"]{border-color:#A8362A}
.err{color:#A8362A;font-size:13px;font-weight:600;text-transform:none;letter-spacing:0;min-height:1.2em}
.recap{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
  padding:14px 0;border-top:1px dashed var(--trait);border-bottom:1px dashed var(--trait);
  margin-bottom:18px;font-size:15px}
.recap b{font-family:var(--f-num);font-size:22px;color:var(--or)}
.rassure{display:flex;gap:9px;flex-wrap:wrap;margin-top:16px;font-size:13px;color:var(--encre3)}
.rassure span{background:var(--surface2);border-radius:99px;padding:5px 12px}

/* --- barre collante mobile --- */
.sticky{position:fixed;left:0;right:0;bottom:0;z-index:50;background:var(--surface);
  border-top:1px solid var(--trait);padding:11px 16px calc(11px + env(safe-area-inset-bottom));
  display:flex;align-items:center;gap:14px;box-shadow:0 -6px 24px -18px rgba(0,0,0,.5)}
.sticky .p{font-family:var(--f-num);font-size:23px;font-weight:700;color:var(--or);flex:none}
.sticky .cta{padding:14px 20px;font-size:16px;flex:1}
@media(min-width:760px){.sticky{display:none}}
body{padding-bottom:86px}
@media(min-width:760px){body{padding-bottom:0}}

footer{padding:30px 0 40px;border-top:1px solid var(--trait);color:var(--encre3);font-size:13.5px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>

<div class="confiance">🚚 الدفع عند الاستلام — Paiement à la livraison · Livraison partout au Maroc</div>

<div class="wrap">

  <header class="heros">
    <p class="eyebrow">${ech(boutique)}</p>
    <h1>${ech(titre)}</h1>
    ${titreAr ? `<p class="ar-t ar">${ech(titreAr)}</p>` : ""}
    ${promesse ? `<p class="promesse">${ech(promesse)}</p>` : ""}
    ${promesseAr ? `<p class="promesse ar">${ech(promesseAr)}</p>` : ""}

    <div class="prixbloc">
      <span class="prix">${ech(prix)}<small>${ech(devise)}</small></span>
      ${prixBarre ? `<span class="barre">${ech(prixBarre)} ${ech(devise)}</span>` : ""}
      ${economie ? `<span class="eco">Vous économisez ${economie} ${ech(devise)}</span>` : ""}
    </div>

    <a class="cta ar" href="#commander">اطلب دابا — الدفع عند الاستلام</a>
  </header>

  ${creas.length ? `<div class="galerie">
    ${creas.map(c => `<figure><img src="${ech(c.fichier)}" alt="${ech(titre)} — visuel ${ech(c.angle || "")}" loading="lazy" width="1080" height="1080"></figure>`).join("\n    ")}
  </div>` : ""}

  ${benefices.length ? `<section>
    <h2>Ce que ça change</h2>
    <p class="sous">Cinq raisons concrètes, pas des adjectifs.</p>
    <ul class="benefs">
      ${benefices.map((ben, i) => `<li>
        <span class="coche" aria-hidden="true">✓</span>
        <span><b>${ech(ben)}</b>${beneficesAr[i] ? `<span class="ar">${ech(beneficesAr[i])}</span>` : ""}</span>
      </li>`).join("\n      ")}
    </ul>
  </section>` : ""}

  ${objections.length ? `<section>
    <h2>Ce que vous vous demandez</h2>
    <p class="sous">Les objections qui font annuler une commande COD, traitées avant l'appel de confirmation.</p>
    ${objections.map(o => `<div class="obj">
      <p class="q">« ${ech(o.question)} »</p>
      <p>${ech(o.reponse)}</p>
    </div>`).join("\n    ")}
  </section>` : ""}

  ${specs.length ? `<section>
    <h2>Caractéristiques</h2>
    <table>${specs.map(s => `<tr><td>${ech(s.cle)}</td><td>${ech(s.valeur)}</td></tr>`).join("")}</table>
  </section>` : ""}

  <section id="commander">
    <div class="commande">
      <h2>Commander</h2>
      <p class="sous">Trois champs. Nous vous appelons pour confirmer, puis le livreur passe. <b>Vous payez à la livraison, après avoir ouvert le colis.</b></p>
      <p class="ar" style="color:var(--encre2);margin:0 0 6px">عمر غير 3 خانات. كنعيطو ليك باش نأكدو، و من بعد كيوصلك الطلب. <b>كتخلص منين توصلك.</b></p>

      <form id="f" novalidate>
        <div class="champs">
          <label>Nom complet · الاسم الكامل
            <input id="nom" name="nom" type="text" autocomplete="name" required placeholder="Ex. Fatima El Amrani">
            <span class="err" id="e-nom"></span>
          </label>
          <label>Téléphone · رقم الهاتف
            <input id="tel" name="tel" type="tel" inputmode="numeric" autocomplete="tel" required placeholder="06XXXXXXXX">
            <span class="err" id="e-tel"></span>
          </label>
          <label>Ville · المدينة
            <select id="ville" name="ville" required>
              <option value="">— Choisir —</option>
              ${VILLES.map(v => `<option>${ech(v)}</option>`).join("")}
            </select>
            <span class="err" id="e-ville"></span>
          </label>
        </div>

        <div class="recap">
          <span>${ech(titre)}</span>
          <b>${ech(prix)} ${ech(devise)}</b>
        </div>

        <button class="cta" type="submit">Confirmer ma commande · أكد الطلب</button>
        <div class="rassure">
          <span>✓ Paiement à la livraison</span>
          <span>✓ Vous ouvrez avant de payer</span>
          <span>✓ Livraison 24–72 h</span>
        </div>
      </form>
    </div>
  </section>

  <footer>
    <p><b>${ech(boutique)}</b> · Paiement à la livraison partout au Maroc. Livraison 24 à 48 h à Casablanca et Rabat, 48 à 72 h ailleurs.</p>
    <p>Page produite par Poste COD. Les prix et délais sont ceux du jour de la mise en ligne : vérifiez-les avant de lancer la campagne.</p>
  </footer>
</div>

<div class="sticky">
  <span class="p">${ech(prix)} ${ech(devise)}</span>
  <a class="cta" href="#commander">Commander</a>
</div>

<script>
(function(){
  "use strict";
  var WHATSAPP = ${js(whatsapp)};
  var WEBHOOK  = ${js(webhookUrl)};
  var PRODUIT = ${js(titre)};
  var PRIX = ${js(String(prix) + " " + devise)};

  var f = document.getElementById("f");
  var champs = {
    nom:   { el: document.getElementById("nom"),   err: document.getElementById("e-nom") },
    tel:   { el: document.getElementById("tel"),   err: document.getElementById("e-tel") },
    ville: { el: document.getElementById("ville"), err: document.getElementById("e-ville") }
  };

  /* Un numéro marocain mobile : 06 ou 07 puis 8 chiffres. On accepte les
     préfixes +212 / 00212 et on normalise, parce que les clients tapent les
     trois formes indifféremment. Un numéro faux, c'est une commande perdue
     ET du budget publicitaire déjà dépensé. */
  function normaliserTel(v){
    var d = String(v || "").replace(/\\D/g, "");
    if (d.indexOf("00212") === 0) d = "0" + d.slice(5);
    else if (d.indexOf("212") === 0 && d.length === 12) d = "0" + d.slice(3);
    return d;
  }
  function telValide(d){ return /^0[67]\\d{8}$/.test(d); }

  function poser(cle, message){
    var c = champs[cle];
    c.err.textContent = message || "";
    c.el.setAttribute("aria-invalid", message ? "true" : "false");
    return !message;
  }

  champs.tel.el.addEventListener("blur", function(){
    var d = normaliserTel(champs.tel.el.value);
    if (d) champs.tel.el.value = d;
    if (d && !telValide(d)) poser("tel", "Numéro marocain attendu : 06 ou 07 suivi de 8 chiffres.");
    else poser("tel", "");
  });

  f.addEventListener("submit", function(ev){
    ev.preventDefault();
    var nom = champs.nom.el.value.trim();
    var tel = normaliserTel(champs.tel.el.value);
    var ville = champs.ville.el.value;

    var ok = true;
    ok = poser("nom", nom.length < 3 ? "Merci d'indiquer votre nom complet." : "") && ok;
    ok = poser("tel", !telValide(tel) ? "Numéro marocain attendu : 06 ou 07 suivi de 8 chiffres." : "") && ok;
    ok = poser("ville", !ville ? "Choisissez votre ville." : "") && ok;
    if (!ok) {
      var premier = f.querySelector('[aria-invalid="true"]');
      if (premier) premier.focus();
      return;
    }

    var texte = "طلب جديد / Nouvelle commande\\n" +
      "———\\n" +
      "Produit : " + PRODUIT + "\\n" +
      "Prix : " + PRIX + "\\n" +
      "Nom : " + nom + "\\n" +
      "Tél : " + tel + "\\n" +
      "Ville : " + ville;

    /* La commande part d'abord vers l'automatisation, ensuite seulement on
       ouvre WhatsApp. L'option keepalive est indispensable : sans elle, la navigation
       vers wa.me annule la requête en vol et la commande est perdue. */
    if (WEBHOOK) {
      try {
        fetch(WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            source: "landing", type: "commande.recue",
            le: new Date().toISOString(),
            produit: PRODUIT, prix: PRIX,
            nom: nom, telephone: tel, ville: ville,
            page: window.location.href
          })
        }).catch(function(){});
      } catch (e) {}
    }

    if (WHATSAPP) {
      window.location.href = "https://wa.me/" + WHATSAPP + "?text=" + encodeURIComponent(texte);
    } else if (WEBHOOK) {
      f.innerHTML = '<p style="font-size:18px;font-weight:600;color:var(--bien)">✓ Commande enregistrée.</p>' +
        '<p style="color:var(--encre2)">Nous vous appelons pour confirmer. Vous payez au livreur, ' +
        'après avoir ouvert le colis.</p>';
    } else {
      /* Sans numéro WhatsApp configuré, la commande ne doit pas disparaître :
         on la garde dans le navigateur et on le dit clairement. */
      try {
        var q = JSON.parse(localStorage.getItem("commandes-cod") || "[]");
        q.push({ produit: PRODUIT, prix: PRIX, nom: nom, tel: tel, ville: ville, le: new Date().toISOString() });
        localStorage.setItem("commandes-cod", JSON.stringify(q));
      } catch (e) {}
      f.innerHTML = '<p style="font-size:18px;font-weight:600;color:var(--bien)">✓ Commande enregistrée.</p>' +
        '<p style="color:var(--encre2)">Aucun numéro WhatsApp n\\'est configuré sur cette page : ' +
        'la commande est stockée dans ce navigateur. Renseignez le WhatsApp de la boutique avant de lancer la campagne.</p>';
    }
  });
})();
</script>
</body>
</html>`;
}

module.exports = { page, VILLES };
