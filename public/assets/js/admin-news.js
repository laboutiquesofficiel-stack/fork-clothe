"use strict";

/* Inscrits « prochaine collection » dans l'admin FORK : liste, copie des e-mails, export CSV. */
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
  let subs = [];

  async function load() {
    const box = $("#newsList");
    box.innerHTML = `<p class="muted">Chargement…</p>`;
    try {
      const res = await fetch("/api/admin/newsletter", { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Chargement impossible.");
      subs = Array.isArray(data.subscribers) ? data.subscribers : [];
    } catch (err) {
      box.innerHTML = `<p class="notice err">${esc(err.message)}</p>`;
      return;
    }
    if (!subs.length) {
      box.innerHTML = `<p class="muted">Aucun inscrit pour le moment.</p>`;
      return;
    }
    box.innerHTML = `
      <div class="actions"><b>${subs.length} inscrit${subs.length > 1 ? "s" : ""}</b>
        <button type="button" class="btn out" data-news-copy>Copier les e-mails</button>
        <button type="button" class="btn" data-news-csv>Télécharger (CSV)</button></div>
      <div class="table-scroll"><table class="news-table"><thead><tr><th>E-mail</th><th>Inscrit le</th><th>Depuis</th></tr></thead><tbody>${subs
        .map((s) => `<tr><td>${esc(s.email)}</td><td>${esc(new Date(s.consentAt).toLocaleDateString("fr-FR"))}</td><td>${esc(s.source || "")}</td></tr>`)
        .join("")}</tbody></table></div>`;
  }

  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.remove("err");
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3000);
  }

  document.addEventListener("fork:news", load);
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-news-copy]")) {
      try {
        await navigator.clipboard.writeText(subs.map((s) => s.email).join(", "));
        toast("E-mails copiés");
      } catch {
        window.prompt("Copie les e-mails :", subs.map((s) => s.email).join(", "));
      }
    }
    if (e.target.closest("[data-news-csv]")) {
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = ["email;inscrit_le;source", ...subs.map((s) => [s.email, s.consentAt, s.source].map(cell).join(";"))].join("\n");
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `fork-inscrits-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
})();
