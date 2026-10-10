"use strict";

/*
 * Avis clients dans l'admin FORK : liste, masquer/réafficher, répondre.
 * Même code d'accès que les commandes (sessionStorage « fork-admin-token »).
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  };
  const token = () => {
    try {
      return sessionStorage.getItem("fork-admin-token") || "";
    } catch {
      return "";
    }
  };
  const NAMES = { "fork-authentique": "L'Authentique", "fork-lou-faron": "Lou Faron", "fork-les-boutades": "Les Boutades", "fork-les-minots": "Les Minots" };
  let reviews = [];

  async function call(method, body) {
    try {
      const res = await fetch("/api/admin/reviews", {
        method,
        headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    } catch {
      return { ok: false, status: 0, data: { error: "Connexion impossible." } };
    }
  }

  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("err", isError);
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3500);
  }

  async function load() {
    const list = $("#reviewList");
    list.innerHTML = `<p class="muted">Chargement…</p>`;
    const { ok, data } = await call("GET");
    if (!ok) {
      list.innerHTML = `<p class="notice err">${esc(data.error || "Chargement impossible.")}</p>`;
      return;
    }
    reviews = Array.isArray(data.reviews) ? data.reviews : [];
    render();
  }

  function render() {
    const list = $("#reviewList");
    if (!reviews.length) {
      list.innerHTML = `<p class="muted">Aucun avis pour le moment.</p>`;
      return;
    }
    list.innerHTML = reviews
      .map((r) => {
        const hidden = r.status === "hidden";
        const photos = (r.photos || []).filter((u) => /^\/api\/review-photo\?id=\d+$/.test(u));
        return `<article class="card" data-review="${Number(r.id)}">
          <div class="card-head"><b>${esc(NAMES[r.sku] || r.sku)} · ${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</b><span class="muted">${esc(when(r.createdAt))}</span></div>
          <div class="actions"><span class="pill ${hidden ? "err" : "ok"}">${hidden ? "Masqué" : "Publié"}</span><span class="muted">${esc(r.authorName)} · taille ${esc(r.size || "—")} · ${esc(r.orderNumber)} · ${esc(r.customerEmail)}</span></div>
          ${r.title ? `<b>${esc(r.title)}</b>` : ""}
          <p class="review-body">${esc(r.body)}</p>
          ${
            photos.length
              ? `<div class="review-photos">${photos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt=""></a>`).join("")}</div>`
              : hidden && r.photos?.length
                ? `<p class="hint">${r.photos.length} photo(s), visibles une fois l'avis réaffiché.</p>`
                : ""
          }
          ${r.shopReply ? `<div class="shop-reply"><b>Ta réponse</b><p>${esc(r.shopReply)}</p></div>` : ""}
          <form class="stack" data-reply>
            <div class="field"><label for="reply-${r.id}">${r.shopReply ? "Modifier ta réponse" : "Répondre publiquement"}</label><textarea id="reply-${r.id}" name="reply" rows="3" maxlength="1500">${esc(r.shopReply || "")}</textarea></div>
            <div class="actions">
              <button type="submit" class="btn">Publier la réponse</button>
              ${r.shopReply ? `<button type="button" class="link" data-review-act="remove-reply">Supprimer la réponse</button>` : ""}
              <button type="button" class="link ${hidden ? "" : "danger"}" data-review-act="${hidden ? "show" : "hide"}">${hidden ? "Réafficher l'avis" : "Masquer l'avis"}</button>
            </div>
          </form>
        </article>`;
      })
      .join("");
  }

  async function act(card, body) {
    $$("button", card).forEach((b) => (b.disabled = true));
    const { ok, data } = await call("POST", { id: Number(card.dataset.review), ...body });
    toast(ok ? "Avis mis à jour" : data.error || "Action impossible.", !ok);
    load();
  }

  document.addEventListener("click", (e) => {
    const sw = e.target.closest(".switch");
    if (sw) {
      $$(".switch").forEach((x) => x.setAttribute("aria-selected", String(x === sw)));
      const view = sw.dataset.view;
      $("#ordersPane").hidden = view !== "orders";
      $("#reviewsPane").hidden = view !== "reviews";
      $("#newsPane").hidden = view !== "news";
      if (view === "reviews") load();
      if (view === "news") document.dispatchEvent(new CustomEvent("fork:news"));
      return;
    }
    const button = e.target.closest("[data-review-act]");
    if (button) act(button.closest("[data-review]"), { action: button.dataset.reviewAct });
  });

  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-reply]");
    if (!form) return;
    e.preventDefault();
    const reply = String(new FormData(form).get("reply") || "").trim();
    if (reply.length < 2) return toast("Écris ta réponse.", true);
    act(form.closest("[data-review]"), { action: "reply", reply });
  });
})();
