"use strict";

/* « Vos moments » dans l'admin FORK : photos à valider, publiées et masquées. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const token = () => {
    try {
      return sessionStorage.getItem("fork-admin-token") || "";
    } catch {
      return "";
    }
  };
  const LABELS = { pending: ["À valider", "warn"], published: ["En ligne", "ok"], hidden: ["Masquée", "err"] };

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
      const res = await fetch("/api/admin/moments", {
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

  function render(list) {
    const box = $("#momentsList");
    if (!list.length) {
      box.innerHTML = `<p class="muted">Aucune photo pour le moment. Elles apparaîtront ici dès que des clients partageront leur moment.</p>`;
      return;
    }
    const order = { pending: 0, published: 1, hidden: 2 };
    const sorted = [...list].sort((a, b) => order[a.status] - order[b.status] || b.id - a.id);
    const pending = list.filter((m) => m.status === "pending").length;
    box.innerHTML =
      (pending ? `<p class="notice warn">${pending} photo${pending > 1 ? "s" : ""} à valider.</p>` : "") +
      sorted
        .map((m) => {
          const [label, cls] = LABELS[m.status] || [m.status, ""];
          return `<article class="card moment-admin" data-moment="${m.id}">
            <img src="${esc(m.image)}" alt="Photo de ${esc(m.firstName)}">
            <div class="col">
              <div class="actions"><span class="pill ${cls}">${label}</span><span class="muted">${esc(new Date(m.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }))}</span></div>
              <b>${esc(m.firstName)}${m.place ? ` · ${esc(m.place)}` : ""}</b>
              <span class="muted">${esc(m.product || "Modèle non reconnu")} · ${esc(m.email)}</span>
              ${m.aiNote ? `<p class="hint">Vérification : ${esc(m.aiNote)}</p>` : ""}
              <div class="actions">
                ${m.status !== "published" ? `<button type="button" class="btn" data-moment-act="publish">Publier</button>` : ""}
                ${m.status !== "hidden" ? `<button type="button" class="btn out" data-moment-act="hide">${m.status === "pending" ? "Refuser" : "Masquer"}</button>` : ""}
                <button type="button" class="link danger" data-moment-act="delete">Supprimer définitivement</button>
              </div>
            </div>
          </article>`;
        })
        .join("");
  }

  async function load() {
    $("#momentsList").innerHTML = `<p class="muted">Chargement…</p>`;
    const { ok, data } = await call("GET");
    if (!ok) {
      $("#momentsList").innerHTML = `<p class="notice err">${esc(data.error || "Chargement impossible.")}</p>`;
      return;
    }
    render(data.moments || []);
  }

  document.addEventListener("fork:moments", load);
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-moment-act]");
    if (!btn) return;
    const id = Number(btn.closest("[data-moment]").dataset.moment);
    const action = btn.dataset.momentAct;
    if (action === "delete" && !confirm("Supprimer définitivement cette photo ? Elle ne pourra pas être récupérée.")) return;
    btn.disabled = true;
    const { ok, data } = await call("POST", { id, action });
    if (!ok) {
      btn.disabled = false;
      return toast(data.error || "Action impossible.", true);
    }
    toast(action === "publish" ? "Photo publiée, la personne est prévenue" : action === "hide" ? "Photo retirée du site" : "Photo supprimée");
    render(data.moments || []);
  });
})();
