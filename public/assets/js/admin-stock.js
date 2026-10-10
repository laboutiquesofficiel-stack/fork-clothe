"use strict";

/*
 * Stock dans l'admin FORK.
 * - En direct : quantités par t-shirt et par taille, corrections +1 / −1, historique.
 * - Vente sur place : saisie rapide des ventes d'un marché (retire du stock).
 * - Inventaire : saisie des quantités exactes comptées.
 * Toutes les données viennent de /api/admin/stock.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const token = () => {
    try {
      return sessionStorage.getItem("fork-admin-token") || "";
    } catch {
      return "";
    }
  };
  const REASONS = {
    order: "Vente en ligne",
    order_cancel: "Annulation (remis en stock)",
    market: "Vente sur place",
    count: "Inventaire",
    adjust: "Correction",
  };
  let data = { products: [], movements: [] };
  let mode = "view";
  const market = new Map(); // "sku|taille" → quantité vendue

  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("err", isError);
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3500);
  }

  async function call(method, body) {
    try {
      const res = await fetch("/api/admin/stock", {
        method,
        headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      return { ok: res.ok, data: await res.json().catch(() => ({})) };
    } catch {
      return { ok: false, data: { error: "Connexion impossible." } };
    }
  }

  async function load() {
    $("#stockBody").innerHTML = `<p class="muted">Chargement…</p>`;
    const { ok, data: d } = await call("GET");
    if (!ok) {
      $("#stockBody").innerHTML = `<p class="notice err">${esc(d.error || "Chargement impossible.")}</p>`;
      return;
    }
    data = d;
    render();
  }

  const qtyLabel = (q) => (q === null ? "—" : String(q));
  const qtyClass = (q) => (q === null ? "na" : q <= 0 ? "zero" : q <= 3 ? "low" : "");

  function renderView() {
    const notCounted = data.products.some((p) => p.sizes.some((s) => s.quantity === null));
    const totals = data.products.map((p) => p.sizes.reduce((n, s) => n + Math.max(0, s.quantity || 0), 0));
    return `
      ${notCounted ? `<p class="notice warn">Les tailles marquées « — » ne sont pas encore comptées : elles restent en vente sans limite. Fais ton inventaire dans l'onglet « Inventaire ».</p>` : ""}
      ${data.products
        .map(
          (p, i) => `<article class="card stock-card">
            <div class="card-head"><b>${esc(p.type)} ${esc(p.name)}</b><span class="muted">${esc(p.color)} · ${totals[i]} pièce${totals[i] > 1 ? "s" : ""}</span></div>
            <div class="stock-grid">${p.sizes
              .map(
                (s) => `<div class="stock-cell ${qtyClass(s.quantity)}">
                  <span class="sz">${esc(s.size)}</span>
                  <span class="q">${qtyLabel(s.quantity)}</span>
                  ${
                    s.quantity === null
                      ? ""
                      : `<span class="adj"><button type="button" aria-label="Retirer 1 ${esc(p.name)} ${esc(s.size)}" data-adjust="-1" data-sku="${esc(p.sku)}" data-size="${esc(s.size)}">−</button><button type="button" aria-label="Ajouter 1 ${esc(p.name)} ${esc(s.size)}" data-adjust="1" data-sku="${esc(p.sku)}" data-size="${esc(s.size)}">+</button></span>`
                  }
                </div>`,
              )
              .join("")}</div>
          </article>`,
        )
        .join("")}
      <p class="hint">Rouge : épuisé (taille bloquée sur le site). Orange : 3 ou moins (le site affiche « Plus que … »).</p>
      <h2 class="stock-h">Derniers mouvements</h2>
      ${
        data.movements.length
          ? `<div class="table-scroll"><table class="news-table"><thead><tr><th>Date</th><th>Article</th><th>Mouvement</th><th>Reste</th><th>Origine</th></tr></thead><tbody>${data.movements
              .map((m) => {
                const p = data.products.find((x) => x.sku === m.sku);
                return `<tr><td>${esc(new Date(m.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}</td><td>${esc(p ? p.name : m.sku)} · ${esc(m.size)}</td><td>${m.reason === "count" ? "=" : m.delta > 0 ? "+" + m.delta : m.delta}</td><td>${qtyLabel(m.quantityAfter)}</td><td>${esc(REASONS[m.reason] || m.reason)}${m.reference ? ` · ${esc(m.reference)}` : ""}${m.note ? ` · ${esc(m.note)}` : ""}</td></tr>`;
              })
              .join("")}</tbody></table></div>`
          : `<p class="muted">Aucun mouvement pour le moment.</p>`
      }`;
  }

  function renderMarket() {
    const lines = [...market.entries()].filter(([, q]) => q > 0);
    const total = lines.reduce((n, [, q]) => n + q, 0);
    return `
      <p class="hint">Touche une taille à chaque pièce vendue. Vérifie le récapitulatif puis enregistre : le stock baisse tout de suite.</p>
      ${data.products
        .map(
          (p) => `<article class="card stock-card">
            <div class="card-head"><b>${esc(p.type)} ${esc(p.name)}</b><span class="muted">${esc(p.color)}</span></div>
            <div class="stock-grid">${p.sizes
              .map((s) => {
                const k = `${p.sku}|${s.size}`;
                const sold = market.get(k) || 0;
                return `<button type="button" class="stock-cell pick ${sold ? "sel" : ""}" data-sell="${esc(k)}">
                  <span class="sz">${esc(s.size)}</span>
                  <span class="q">${sold ? "−" + sold : "+"}</span>
                  <span class="muted small">reste ${qtyLabel(s.quantity === null ? null : s.quantity - sold)}</span>
                </button>`;
              })
              .join("")}</div>
          </article>`,
        )
        .join("")}
      <div class="card market-sum">
        <b>${total} pièce${total > 1 ? "s" : ""} vendue${total > 1 ? "s" : ""}</b>
        ${lines.length ? `<ul class="items">${lines.map(([k, q]) => {
          const [sku, size] = k.split("|");
          const p = data.products.find((x) => x.sku === sku);
          return `<li>${q} × ${esc(p ? p.name : sku)} · ${esc(size)} <button type="button" class="link" data-unsell="${esc(k)}">retirer 1</button></li>`;
        }).join("")}</ul>` : ""}
        <div class="field"><label for="market-note">Note (facultatif)</label><input id="market-note" maxlength="200" placeholder="Ex. : Marché du cours Lafayette"></div>
        <button type="button" class="btn full" data-market-save ${total ? "" : "disabled"}>Enregistrer les ventes</button>
      </div>`;
  }

  function renderCount() {
    return `
      <p class="hint">Indique la quantité exacte que tu as en main pour chaque taille. Laisse vide une taille que tu ne veux pas suivre.</p>
      <form id="countForm" class="stack">
        ${data.products
          .map(
            (p) => `<article class="card stock-card">
              <div class="card-head"><b>${esc(p.type)} ${esc(p.name)}</b><span class="muted">${esc(p.color)}</span></div>
              <div class="stock-grid">${p.sizes
                .map(
                  (s) => `<label class="stock-cell"><span class="sz">${esc(s.size)}</span>
                    <input type="number" inputmode="numeric" min="0" max="100000" step="1" name="${esc(p.sku)}|${esc(s.size)}" value="${s.quantity === null ? "" : Math.max(0, s.quantity)}" aria-label="Quantité ${esc(p.name)} ${esc(s.size)}"></label>`,
                )
                .join("")}</div>
            </article>`,
          )
          .join("")}
        <button type="submit" class="btn full">Enregistrer l'inventaire</button>
      </form>`;
  }

  function render() {
    $$("[data-stock-mode]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.stockMode === mode)));
    $("#stockBody").innerHTML = mode === "market" ? renderMarket() : mode === "count" ? renderCount() : renderView();
  }

  async function post(body, okMessage) {
    const { ok, data: d } = await call("POST", body);
    if (!ok) return toast(d.error || "Enregistrement impossible.", true);
    data = d;
    toast(okMessage);
    return true;
  }

  document.addEventListener("fork:stock", load);
  document.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-stock-mode]");
    if (m) {
      mode = m.dataset.stockMode;
      return render();
    }
    const adj = e.target.closest("[data-adjust]");
    if (adj) {
      adj.disabled = true;
      await post({ action: "adjust", sku: adj.dataset.sku, size: adj.dataset.size, delta: Number(adj.dataset.adjust) }, "Stock corrigé");
      return render();
    }
    const sell = e.target.closest("[data-sell]");
    if (sell) {
      market.set(sell.dataset.sell, (market.get(sell.dataset.sell) || 0) + 1);
      return render();
    }
    const unsell = e.target.closest("[data-unsell]");
    if (unsell) {
      const k = unsell.dataset.unsell;
      market.set(k, Math.max(0, (market.get(k) || 0) - 1));
      return render();
    }
    if (e.target.closest("[data-market-save]")) {
      const sales = [...market.entries()].filter(([, q]) => q > 0).map(([k, q]) => {
        const [sku, size] = k.split("|");
        return { sku, size, quantity: q };
      });
      const note = $("#market-note")?.value.trim() || "";
      if (await post({ action: "market", sales, note }, "Ventes enregistrées, stock mis à jour")) {
        market.clear();
        mode = "view";
      }
      return render();
    }
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "countForm") return;
    e.preventDefault();
    const counts = [...new FormData(e.target).entries()]
      .filter(([, v]) => String(v).trim() !== "")
      .map(([k, v]) => {
        const [sku, size] = k.split("|");
        return { sku, size, quantity: Number(v) };
      });
    if (!counts.length) return toast("Indique au moins une quantité.", true);
    if (counts.some((c) => !Number.isInteger(c.quantity) || c.quantity < 0)) return toast("Quantités : nombres entiers, 0 ou plus.", true);
    if (await post({ action: "count", counts }, "Inventaire enregistré")) mode = "view";
    render();
  });
})();
