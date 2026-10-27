"use strict";

/*
 * Onglet « Promos » de l'admin FORK : bandeau du site, pack, livraison
 * offerte, fenêtre -10 %, codes promo et cartes cadeaux.
 * Les changements apparaissent sur le site en une minute, sans republier.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const euros = (c) => `${(Number(c || 0) / 100).toFixed(2).replace(".", ",")} €`;
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
  const token = () => {
    try {
      return sessionStorage.getItem("fork-admin-token") || "";
    } catch {
      return "";
    }
  };
  const SOURCES = {
    "": "Inconnue (lien sans repère)",
    bio: "Instagram (lien bio)",
    insta: "Instagram",
    story: "Instagram (story)",
    dm: "Instagram (message privé)",
    pub: "Pub Instagram",
    carte: "Carte FORK (QR)",
    qr: "QR code",
    stand: "Stand / marché (QR)",
    tiktok: "TikTok",
    "email-bienvenue": "E-mail de bienvenue",
    "carte-cadeau": "Carte cadeau",
  };
  let data = null;

  function toast(message, isError = false) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("err", isError);
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), isError ? 7000 : 3000);
  }

  async function call(method, body) {
    const res = await fetch("/api/admin/promos", {
      method,
      headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Action impossible.");
    return d;
  }

  function render() {
    const box = $("#promosBody");
    const { settings: st, codes, giftCards, packs, sources } = data;
    const salesCodes = codes.reduce((n, c) => n + c.orders, 0);
    box.innerHTML = `
      <div class="vstats">
        <div class="card vstat"><span class="muted">Ventes avec le pack</span><b>${packs.orders}</b><span class="muted">${euros(packs.discountCents)} de remise</span></div>
        <div class="card vstat"><span class="muted">Ventes avec un code</span><b>${salesCodes}</b><span class="muted">depuis le début</span></div>
        <div class="card vstat"><span class="muted">Cartes cadeaux</span><b>${giftCards.length}</b><span class="muted">vendues</span></div>
      </div>

      <h2 class="stock-h">D'où viennent les ventes (3 mois)</h2>
      ${
        sources.length
          ? `<table class="news-table"><tbody>${sources
              .map((s) => `<tr><td>${esc(SOURCES[s.source] || `Lien « ${s.source} »`)}</td><td class="num">${s.orders} vente${s.orders > 1 ? "s" : ""}</td><td class="num muted">${euros(s.revenueCents)}</td></tr>`)
              .join("")}</tbody></table>`
          : `<p class="muted">Pas encore de vente enregistrée avec une provenance.</p>`
      }
      <p class="hint">Mets un repère à la fin de tes liens pour savoir ce qui fait vendre : bio Instagram <b>fork-clothe.com/?src=bio</b>, QR des cartes <b>?src=carte</b>, QR du stand <b>?src=stand</b>, pub <b>?src=pub</b>, TikTok <b>?src=tiktok</b>. Les mêmes repères apparaissent dans l'onglet Visites.</p>

      <form class="card stack" id="settingsForm">
        <h2 class="stock-h">Bandeau en haut du site</h2>
        <label class="check"><input type="checkbox" name="bannerActive" ${st.banner.active ? "checked" : ""}> Afficher le bandeau</label>
        <div class="field"><label for="p-banner">Texte</label><input id="p-banner" name="bannerText" maxlength="140" value="${esc(st.banner.text)}"></div>
        <p class="hint">Exemple pour Noël : « Commandé avant le 17 décembre = sous le sapin 🎄 ». Vérifie la date avec les délais Colissimo de fin d'année.</p>

        <h2 class="stock-h">Pack et livraison offerte</h2>
        <div class="mo-row">
          <div class="field"><label for="p-two">Remise dès 2 t-shirts (%)</label><input id="p-two" name="twoPercent" type="number" min="0" max="50" inputmode="numeric" value="${st.pack.twoPercent}"></div>
          <div class="field"><label for="p-three">Remise dès 3 t-shirts (%)</label><input id="p-three" name="threePercent" type="number" min="0" max="50" inputmode="numeric" value="${st.pack.threePercent}"></div>
          <div class="field"><label for="p-free">Livraison offerte dès (t-shirts)</label><input id="p-free" name="freeShippingMin" type="number" min="0" max="10" inputmode="numeric" value="${st.freeShippingMin}"></div>
        </div>
        <p class="hint">0 dans « dès 3 » = même remise que pour 2. 0 dans « livraison offerte » = désactivé. Pour le Black Friday : mets « dès 3 » à 25, puis remets 0 le lundi soir. Le pack ne se cumule pas avec un code : la meilleure remise s'applique.</p>

        <h2 class="stock-h">Fenêtre « -10 % » (inscription e-mail)</h2>
        <label class="check"><input type="checkbox" name="popupActive" ${st.popup.active ? "checked" : ""}> Afficher la fenêtre aux nouveaux visiteurs</label>
        <div class="field"><label for="p-code">Code envoyé par e-mail</label><input id="p-code" name="popupCode" maxlength="30" value="${esc(st.popup.code)}" autocapitalize="characters"></div>
        <p class="hint">Le pourcentage affiché est celui du code (ci-dessous). Le code est envoyé dans l'e-mail de bienvenue.</p>
        <button type="submit" class="btn full">Enregistrer (en ligne d'ici 1 minute)</button>
      </form>

      <h2 class="stock-h">Codes promo</h2>
      <div class="admin-list">${
        codes.length
          ? codes
              .map(
                (c) => `<article class="card">
          <div class="card-head"><b>${esc(c.code)}</b><span class="pill ${c.active ? "ok" : "warn"}">${c.active ? "Actif" : "Désactivé"}</span></div>
          <p>-${c.percent} % sur les t-shirts${c.firstOrderOnly ? " · première commande" : ""}${c.oncePerEmail ? " · 1 fois par client" : ""}${c.startsAt ? ` · dès le ${esc(day(c.startsAt))}` : ""}${c.endsAt ? ` · jusqu'au ${esc(day(c.endsAt))}` : ""}</p>
          ${c.note ? `<p class="hint">${esc(c.note)}</p>` : ""}
          <p><b>${c.orders}</b> vente${c.orders > 1 ? "s" : ""} · ${euros(c.revenueCents)} encaissés · ${euros(c.discountCents)} de remise</p>
          <button type="button" class="btn out" data-toggle-code="${c.id}" data-active="${c.active ? "0" : "1"}">${c.active ? "Désactiver" : "Réactiver"}</button>
        </article>`,
              )
              .join("")
          : `<p class="muted">Aucun code.</p>`
      }</div>

      <details class="card manual-order">
        <summary><b>+ Nouveau code promo</b></summary>
        <form class="stack" id="codeForm" novalidate>
          <div class="mo-row">
            <div class="field"><label for="c-code">Code</label><input id="c-code" name="code" required maxlength="30" autocapitalize="characters" placeholder="BLACKFRIDAY"></div>
            <div class="field"><label for="c-pct">Remise (%)</label><input id="c-pct" name="percent" type="number" min="1" max="50" inputmode="numeric" required value="10"></div>
          </div>
          <label class="check"><input type="checkbox" name="oncePerEmail" checked> Une seule fois par client (e-mail)</label>
          <label class="check"><input type="checkbox" name="firstOrderOnly"> Réservé à une première commande</label>
          <div class="mo-row">
            <div class="field"><label for="c-start">Début (facultatif)</label><input id="c-start" name="startsAt" type="datetime-local"></div>
            <div class="field"><label for="c-end">Fin (facultatif)</label><input id="c-end" name="endsAt" type="datetime-local"></div>
          </div>
          <div class="field"><label for="c-note">Note pour toi (facultatif)</label><input id="c-note" name="note" maxlength="200" placeholder="Ex. avant-première inscrits"></div>
          <button type="submit" class="btn full">Créer le code</button>
        </form>
      </details>

      <h2 class="stock-h">Cartes cadeaux vendues</h2>
      ${
        giftCards.length
          ? `<table class="news-table"><tbody>${giftCards
              .map(
                (g) => `<tr><td><b>${esc(g.code)}</b><br><span class="muted">${esc(g.recipientEmail || "")}</span></td><td class="num">${euros(g.balanceCents)} / ${euros(g.amountCents)}</td><td class="num muted">${g.endsAt ? `jusqu'au ${esc(day(g.endsAt))}` : ""}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : `<p class="muted">Aucune carte cadeau vendue pour l'instant.</p>`
      }`;
  }

  async function load() {
    const box = $("#promosBody");
    box.innerHTML = `<p class="muted">Chargement…</p>`;
    try {
      data = await call("GET");
      render();
    } catch (err) {
      box.innerHTML = `<p class="notice err">${esc(err.message)}</p>`;
    }
  }

  document.addEventListener("fork:promos", load);

  document.addEventListener("submit", async (e) => {
    const form = e.target;
    if (form.id === "settingsForm") {
      e.preventDefault();
      const f = form.elements;
      try {
        data = await call("POST", {
          action: "settings",
          settings: {
            banner: { active: f.bannerActive.checked, text: f.bannerText.value },
            pack: { twoPercent: Number(f.twoPercent.value), threePercent: Number(f.threePercent.value) },
            freeShippingMin: Number(f.freeShippingMin.value),
            popup: { active: f.popupActive.checked, code: f.popupCode.value },
          },
        });
        render();
        toast("Réglages enregistrés");
      } catch (err) {
        toast(err.message, true);
      }
    }
    if (form.id === "codeForm") {
      e.preventDefault();
      const f = form.elements;
      const iso = (v) => (v ? new Date(v).toISOString() : "");
      try {
        data = await call("POST", {
          action: "create",
          code: f.code.value,
          percent: Number(f.percent.value),
          oncePerEmail: f.oncePerEmail.checked,
          firstOrderOnly: f.firstOrderOnly.checked,
          startsAt: iso(f.startsAt.value),
          endsAt: iso(f.endsAt.value),
          note: f.note.value,
        });
        render();
        toast("Code créé");
      } catch (err) {
        toast(err.message, true);
      }
    }
  });

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-toggle-code]");
    if (!b) return;
    try {
      data = await call("POST", { action: "toggle", id: Number(b.dataset.toggleCode), active: b.dataset.active === "1" });
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });
})();
