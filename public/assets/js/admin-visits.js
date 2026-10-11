"use strict";

/*
 * Visites du site dans l'admin FORK (mesure d'audience maison, sans cookie).
 * Les chiffres viennent de /api/admin/visits.
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
  const nf = new Intl.NumberFormat("fr-FR");
  const dayLabel = (d, long = false) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", long ? { weekday: "short", day: "numeric", month: "long" } : { day: "numeric", month: "short" });
  let days = 30;
  let data = null;

  // Cet appareil sert à gérer la boutique : ses visites ne sont pas comptées.
  try {
    localStorage.setItem("fork-no-count", "1");
  } catch {
    /* stockage indisponible */
  }

  function chart(series) {
    const max = Math.max(1, ...series.map((d) => d.visitors));
    const w = 10;
    const bars = series
      .map((d, i) => {
        const h = d.visitors ? Math.max(2, (d.visitors / max) * 96) : 0;
        return `<rect class="vbar${d.visitors ? "" : " empty"}" x="${i * w + 1.5}" y="${100 - (h || 1)}" width="${w - 3}" height="${h || 1}" data-day="${esc(d.day)}"><title>${esc(dayLabel(d.day, true))} : ${d.visitors} visiteur${d.visitors > 1 ? "s" : ""}</title></rect>`;
      })
      .join("");
    return `<div class="vchart">
      <svg viewBox="0 0 ${series.length * w} 100" preserveAspectRatio="none" role="img" aria-label="Visiteurs par jour">${bars}</svg>
      <div class="vaxis"><span>${esc(dayLabel(series[0].day))}</span><span>max ${nf.format(max)} / jour</span><span>${esc(dayLabel(series[series.length - 1].day))}</span></div>
      <p class="hint" id="vDetail">Touche une barre pour voir le détail du jour.</p>
    </div>`;
  }

  function list(rows, total, unit) {
    if (!rows.length) return `<p class="muted">Pas encore de données.</p>`;
    return `<table class="news-table"><tbody>${rows
      .map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${nf.format(r.count)} ${unit}</td><td class="num muted">${total ? Math.round((r.count / total) * 100) : 0} %</td></tr>`)
      .join("")}</tbody></table>`;
  }

  function render() {
    $$("[data-visits-days]").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.visitsDays) === days)));
    const box = $("#visitsBody");
    if (!data) return;
    const { today, total, series, pages, sources } = data;
    const empty = !total.views;
    box.innerHTML = `
      <div class="vstats">
        <div class="card vstat"><span class="muted">Aujourd'hui</span><b>${nf.format(today.visitors)}</b><span class="muted">visiteur${today.visitors > 1 ? "s" : ""}</span></div>
        <div class="card vstat"><span class="muted">Sur la période</span><b>${nf.format(total.visitors)}</b><span class="muted">visites</span></div>
        <div class="card vstat"><span class="muted">Pages vues</span><b>${nf.format(total.views)}</b><span class="muted">sur la période</span></div>
      </div>
      ${empty ? `<p class="notice">Le compteur vient d'être mis en place : les premières visites apparaîtront ici dès que des gens passeront sur le site. Tes propres visites depuis cet appareil ne sont pas comptées.</p>` : ""}
      <h2 class="stock-h">Visiteurs par jour</h2>
      ${chart(series)}
      <h2 class="stock-h">D'où viennent les visiteurs</h2>
      ${list(sources, total.visitors, "")}
      <h2 class="stock-h">Pages les plus vues</h2>
      ${list(pages, total.views, "")}
      <p class="hint">Un visiteur = une personne (un appareil) sur une journée : quelqu'un qui revient 3 jours compte 3 visites. Comptage sans cookie, robots exclus. Les visites depuis un appareil où tu as ouvert l'admin ne sont pas comptées.</p>`;
  }

  async function load() {
    const box = $("#visitsBody");
    box.innerHTML = `<p class="muted">Chargement…</p>`;
    try {
      const res = await fetch(`/api/admin/visits?days=${days}`, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Chargement impossible.");
      data = d;
      render();
    } catch (err) {
      box.innerHTML = `<p class="notice err">${esc(err.message)}</p>`;
    }
  }

  document.addEventListener("fork:visits", load);
  document.addEventListener("click", (e) => {
    const p = e.target.closest("[data-visits-days]");
    if (p) {
      days = Number(p.dataset.visitsDays);
      return load();
    }
    const bar = e.target.closest("rect[data-day]");
    if (bar && data) {
      const d = data.series.find((x) => x.day === bar.dataset.day);
      if (!d) return;
      $$("rect.sel").forEach((r) => r.classList.remove("sel"));
      bar.classList.add("sel");
      $("#vDetail").textContent = `${dayLabel(d.day, true)} : ${d.visitors} visiteur${d.visitors > 1 ? "s" : ""} · ${d.views} page${d.views > 1 ? "s" : ""} vue${d.views > 1 ? "s" : ""}`;
    }
  });
})();
