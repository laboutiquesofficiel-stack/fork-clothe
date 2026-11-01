"use strict";

/*
 * Onglet « Studio » de l'admin FORK : réglages du FORK Custom Studio,
 * créations commandées à vérifier, récap de la commande groupée et
 * fichiers imprimeur (PNG transparent 300 dpi, aux vraies dimensions).
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const L = window.ForkStudioLib;
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const euros = (c) => `${(Number(c || 0) / 100).toFixed(2).replace(".", ",")} €`;
  const token = () => {
    try {
      return sessionStorage.getItem("fork-admin-token") || "";
    } catch {
      return "";
    }
  };
  const LABELS = {
    to_review: ["Création à vérifier", "warn"],
    approved: ["Création validée", "ok"],
    in_production: ["En fabrication", "info"],
    rejected: ["Refusée", "err"],
  };
  const SIZES = ["S", "M", "L", "XL", "XXL", "3XL"];
  let data = null;
  let filter = "to_review";

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
    const res = await fetch("/api/admin/studio", {
      method,
      headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Action impossible.");
    return d;
  }

  function summary(list) {
    const ok = list.filter((d) => d.status === "approved" || d.status === "in_production");
    const counts = {};
    for (const d of ok) {
      const key = `${d.design.color === "noir" ? "Noir" : "Blanc"} ${d.size || "?"}`;
      counts[key] = (counts[key] || 0) + (d.quantity || 1);
    }
    const rows = Object.entries(counts).sort(([a], [b]) => {
      const [ca, sa] = a.split(" ");
      const [cb, sb] = b.split(" ");
      return ca.localeCompare(cb) || SIZES.indexOf(sa) - SIZES.indexOf(sb);
    });
    const total = rows.reduce((n, [, c]) => n + c, 0);
    return `<div class="card stack">
      <h2 class="stock-h">Commande groupée (créations validées)</h2>
      ${rows.length ? `<table class="news-table"><tbody>${rows.map(([k, c]) => `<tr><td>T-shirt ${esc(k)}</td><td class="num"><b>${c}</b></td></tr>`).join("")}<tr><td><b>Total</b></td><td class="num"><b>${total}</b></td></tr></tbody></table>` : `<p class="muted">Aucune création validée pour l'instant.</p>`}
      <p class="hint">Fichiers imprimeur : PNG transparents en 300 dpi, aux dimensions réelles. Dos : centré, haut du visuel à environ 4,5 cm sous le col. Devant : haut du fichier à environ 3 cm sous le col, logo côté cœur (11 cm à droite du milieu sur la photo, donc côté gauche de la personne). Positions pensées pour un M : ton imprimeur peut les ajuster selon la taille.</p>
    </div>`;
  }

  function designCard(d) {
    const [label, tone] = LABELS[d.status] || [d.status, "info"];
    const s = data.settings;
    const all = [...d.design.front, ...d.design.back];
    const texts = all.filter((e) => e.t === "text");
    const imgs = all.filter((e) => e.t === "image");
    const imgHtml = imgs
      .map((e) => {
        const info = data.images[e.img];
        const dpi = info ? Math.round(info.width / (e.w / 25.4)) : null;
        const flag = info?.verdict?.thirdPartyRights ? `<b class="danger">⚠ Peut contenir un visuel protégé (marque, personnage, célébrité).</b> ` : "";
        return `<li><a class="link" href="${esc(L.imageUrl(e))}" target="_blank" rel="noopener">Image importée</a> · ${dpi ? `${dpi} dpi à l'impression${dpi < 150 ? " (risque de flou)" : ""}` : ""}<br>${flag}<span class="muted">${esc(info?.note || "")}</span></li>`;
      })
      .join("");
    return `<article class="card" data-design="${esc(d.id)}">
      <div class="card-head"><b>${d.order ? esc(d.order.number) : "Sans commande"}</b><span class="pill ${tone}">${esc(label)}</span></div>
      ${d.contest ? `<p class="pill ok">🏆 Participe au concours${d.design.front.concat(d.design.back).some((e) => e.t === "image") ? " · contient une image importée : à exclure sauf preuve qu'elle est à lui" : ""}</p>` : ""}
      <div class="st-recap-views">
        <figure>${L.renderSide(d.design, "front", { settings: s, imageHref: L.imageUrl })}<figcaption>Devant</figcaption></figure>
        <figure>${L.renderSide(d.design, "back", { settings: s, imageHref: L.imageUrl })}<figcaption>Dos</figcaption></figure>
      </div>
      <p><b>${esc(d.order?.name || "")}</b> · ${esc(d.order?.email || "")}<br>
        T-shirt <b>${d.design.color === "noir" ? "noir" : "blanc"}</b> · taille <b>${esc(d.size || "?")}</b> · quantité <b>${d.quantity || 1}</b> · ${esc(L.TIERS[d.tier]?.name || d.tier)} · ${euros(d.priceCents)}<br>
        Logo FORK : <span class="st-sw st-sw-mini" data-swatch="${esc(d.design.logoColor)}"></span> ${esc(d.design.logoColor)}</p>
      ${texts.length ? `<p class="hint">Textes : ${texts.map((t) => `« ${esc(t.text.replace(/\n/g, " / "))} »`).join(", ")}</p>` : ""}
      ${imgHtml ? `<ul class="hint">${imgHtml}</ul>` : ""}
      ${d.adminNote ? `<p class="notice">${esc(d.adminNote)}</p>` : ""}
      <div class="actions">
        ${d.status !== "approved" ? `<button type="button" class="btn" data-sact="approved">Valider</button>` : ""}
        ${d.status === "approved" ? `<button type="button" class="btn" data-sact="in_production">Envoyée en fabrication</button>` : ""}
        ${d.status !== "rejected" ? `<button type="button" class="btn out" data-sact="rejected">Refuser</button>` : ""}
        ${d.status === "rejected" || d.status === "in_production" ? `<button type="button" class="btn out" data-sact="to_review">Remettre à vérifier</button>` : ""}
      </div>
      <div class="actions">
        <button type="button" class="btn out" data-file="front">Fichier devant (PNG)</button>
        ${d.design.back.length ? `<button type="button" class="btn out" data-file="back">Fichier dos (PNG)</button>` : ""}
      </div>
      ${d.status === "rejected" && d.order ? `<p class="hint">Pense à rembourser le client depuis SumUp. <a class="link" href="mailto:${esc(d.order.email)}?subject=${encodeURIComponent(`Ta création FORK Studio (${d.order.number})`)}">Écrire au client</a></p>` : ""}
    </article>`;
  }

  function render() {
    const box = $("#studioBody");
    const s = data.settings;
    const list = data.designs.filter((d) => d.order?.paid !== false);
    const shown = filter === "all" ? list : filter === "contest" ? list.filter((d) => d.contest) : list.filter((d) => d.status === filter);
    const count = (st) => list.filter((d) => d.status === st).length;
    box.innerHTML = `
      <form class="card stack" id="studioSettings">
        <label class="check"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> <span><b>Studio ouvert</b> (visible dans le menu et commandable jusqu'à la date limite)</span></label>
        <div class="mo-row">
          <div class="field"><label for="ss-deadline">Dernier jour de commande</label><input id="ss-deadline" name="deadline" type="date" value="${esc(s.deadline)}"></div>
          <div class="field"><label for="ss-logo">Largeur du logo (cm)</label><input id="ss-logo" name="logoWidth" type="number" step="0.5" min="4" max="14" inputmode="decimal" value="${s.logoWidth / 10}"></div>
        </div>
        <div class="field"><label for="ss-delivery">Phrase de livraison</label><input id="ss-delivery" name="deliveryText" maxlength="140" value="${esc(s.deliveryText)}"></div>
        <div class="mo-row">
          <div class="field"><label for="ss-basic">Basic (€)</label><input id="ss-basic" name="basic" inputmode="decimal" value="${(s.prices.basic / 100).toFixed(2).replace(".", ",")}"></div>
          <div class="field"><label for="ss-custom">Custom (€)</label><input id="ss-custom" name="custom" inputmode="decimal" value="${(s.prices.custom / 100).toFixed(2).replace(".", ",")}"></div>
          <div class="field"><label for="ss-unl">Unlimited (€)</label><input id="ss-unl" name="unlimited" inputmode="decimal" value="${(s.prices.unlimited / 100).toFixed(2).replace(".", ",")}"></div>
          <div class="field"><label for="ss-both">Devant + dos (+€)</label><input id="ss-both" name="bothSides" inputmode="decimal" value="${(s.prices.bothSides / 100).toFixed(2).replace(".", ",")}"></div>
        </div>
        <div class="mo-row">
          <div class="field"><label for="ss-bw">Zone dos : largeur (cm)</label><input id="ss-bw" name="backW" type="number" step="0.5" inputmode="decimal" value="${s.zones.back.w / 10}"></div>
          <div class="field"><label for="ss-bh">hauteur (cm)</label><input id="ss-bh" name="backH" type="number" step="0.5" inputmode="decimal" value="${s.zones.back.h / 10}"></div>
          <div class="field"><label for="ss-fw">Zone devant : largeur (cm)</label><input id="ss-fw" name="frontW" type="number" step="0.5" inputmode="decimal" value="${s.zones.front.w / 10}"></div>
          <div class="field"><label for="ss-fh">hauteur (cm)</label><input id="ss-fh" name="frontH" type="number" step="0.5" inputmode="decimal" value="${s.zones.front.h / 10}"></div>
        </div>
        <p class="hint">Le niveau dépend de la création : Basic (motifs), Custom (avec du texte), Unlimited (avec une image importée). Pas de pack ni de code promo sur les créations.</p>
        <button type="submit" class="btn full">Enregistrer les réglages</button>
      </form>
      ${summary(list)}
      <div class="stock-modes" role="tablist" aria-label="Filtre">
        ${[["to_review", `À vérifier (${count("to_review")})`], ["approved", `Validées (${count("approved")})`], ["in_production", `En fabrication (${count("in_production")})`], ["rejected", `Refusées (${count("rejected")})`], ["contest", `Concours (${list.filter((d) => d.contest).length})`], ["all", "Toutes"]]
          .map(([id, name]) => `<button type="button" class="tab" data-sfilter="${id}" aria-selected="${filter === id}">${name}</button>`)
          .join("")}
      </div>
      <div class="admin-list">${shown.length ? shown.map(designCard).join("") : `<p class="muted">Aucune création dans cette catégorie.</p>`}</div>`;
    $$("[data-swatch]", box).forEach((el) => (el.style.background = el.dataset.swatch));
  }

  async function load() {
    const box = $("#studioBody");
    box.innerHTML = `<p class="muted">Chargement…</p>`;
    try {
      data = await call("GET");
      render();
    } catch (err) {
      box.innerHTML = `<p class="notice err">${esc(err.message)}</p>`;
    }
  }
  document.addEventListener("fork:studio", load);

  const eur = (v) => Math.round(Number(String(v).replace(",", ".")) * 100);
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "studioSettings") return;
    e.preventDefault();
    const f = e.target.elements;
    try {
      data = await call("POST", {
        action: "settings",
        settings: {
          enabled: f.enabled.checked,
          deadline: f.deadline.value,
          deliveryText: f.deliveryText.value,
          logoWidth: Number(f.logoWidth.value) * 10,
          prices: { basic: eur(f.basic.value), custom: eur(f.custom.value), unlimited: eur(f.unlimited.value), bothSides: eur(f.bothSides.value) },
          zones: { back: { w: Number(f.backW.value) * 10, h: Number(f.backH.value) * 10 }, front: { w: Number(f.frontW.value) * 10, h: Number(f.frontH.value) * 10 } },
        },
      });
      render();
      toast("Réglages du Studio enregistrés (en ligne d'ici 1 minute)");
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.addEventListener("click", async (e) => {
    const fb = e.target.closest("[data-sfilter]");
    if (fb) {
      filter = fb.dataset.sfilter;
      return render();
    }
    const card = e.target.closest("[data-design]");
    if (!card || !data) return;
    const d = data.designs.find((x) => x.id === card.dataset.design);
    if (!d) return;
    const act = e.target.closest("[data-sact]")?.dataset.sact;
    if (act) {
      let note = "";
      if (act === "rejected") {
        note = window.prompt("Pourquoi refuser cette création ? (gardé pour toi, n'est pas envoyé au client)", "") ?? null;
        if (note === null) return;
      }
      try {
        data = await call("POST", { action: "status", id: d.id, status: act, note });
        render();
        toast("Statut mis à jour");
      } catch (err) {
        toast(err.message, true);
      }
      return;
    }
    const side = e.target.closest("[data-file]")?.dataset.file;
    if (side) {
      const btn = e.target.closest("[data-file]");
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Préparation…";
      try {
        const file = await L.printFiles(d.design, side, data.settings, 300);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file.png);
        a.download = `FORK-${d.order?.number || d.id}-${d.design.color}-${d.size || ""}-${side === "front" ? "devant" : "dos"}-${(file.box.w / 10).toFixed(1)}x${(file.box.h / 10).toFixed(1)}cm-300dpi.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
        toast(`Fichier ${side === "front" ? "devant" : "dos"} : ${(file.box.w / 10).toFixed(1)} × ${(file.box.h / 10).toFixed(1)} cm, ${file.widthPx} × ${file.heightPx} px`);
      } catch (err) {
        toast(`Fichier impossible : ${err.message}`, true);
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    }
  });
})();
