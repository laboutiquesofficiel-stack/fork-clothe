/* FORK · « Installer l'appli » : bandeau d'accueil + fiche d'instructions (iPhone / Android). */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const KEY = "fork.appBanner.hidden";
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* stockage indisponible */ } },
  };
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let deferred = null; // invite d'installation native (Chrome / Android)

  const sheet = $("#appSheet");
  const banner = $("[data-app-banner]");
  let lastFocus = null;

  function openSheet() {
    if (!sheet) return;
    $("[data-app-ios]", sheet).hidden = isAndroid;
    $("[data-app-android]", sheet).hidden = !isAndroid;
    lastFocus = document.activeElement;
    sheet.hidden = false;
    document.body.classList.add("app-sheet-open");
    requestAnimationFrame(() => sheet.classList.add("open"));
    $(".app-sheet-ok", sheet)?.focus();
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove("open");
    document.body.classList.remove("app-sheet-open");
    setTimeout(() => { sheet.hidden = true; }, 200);
    lastFocus?.focus?.();
  }
  async function install() {
    if (deferred) {
      deferred.prompt();
      try { await deferred.userChoice; } catch { /* rien */ }
      deferred = null;
      return;
    }
    openSheet();
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
  });
  window.addEventListener("appinstalled", () => {
    if (banner) banner.hidden = true;
    store.set("installed");
  });

  // Déjà installée : on cache tout.
  if (installed) {
    $$("[data-app-install]").forEach((b) => { b.hidden = true; });
    return;
  }
  // Bandeau : visible sur téléphone et tablette, sauf s'il a été masqué.
  if (banner && !store.get() && (isIOS || isAndroid || window.matchMedia("(max-width: 900px)").matches)) banner.hidden = false;

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("[data-app-install]")) { e.preventDefault(); install(); }
    else if (t.closest("[data-app-close]")) closeSheet();
    else if (t.closest("[data-app-dismiss]")) { if (banner) banner.hidden = true; store.set("1"); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
})();
