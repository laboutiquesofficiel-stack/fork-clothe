"use strict";

/*
 * FORK — boutique.
 *
 * Toute la logique de confiance est côté serveur :
 * - les prix, la livraison et le total sont recalculés par /api/orders ;
 * - le paiement n'est considéré comme réglé que si le serveur le dit
 *   (/api/order-status, alimenté par le webhook SumUp) ;
 * - le compte client repose sur un cookie de session HttpOnly.
 * Le navigateur ne garde que le panier, le jeton de commande et des
 * préférences d'affichage.
 */
(() => {
  // ---------------------------------------------------------------------------
  // Catalogue : doit rester identique au catalogue serveur (netlify/functions/orders.mts).
  // ---------------------------------------------------------------------------
  const PRODUCTS = [
    {
      id: "les-minots",
      type: "T-shirt",
      sku: "fork-les-minots",
      name: "Les Minots",
      color: "Noir",
      category: "homme",
      priceCents: 3000,
      sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
      available: true,
      isNew: true,
      aiVisuals: true,
      keywords: ["minots", "rugby", "ballon", "pecheur", "marche", "telepherique", "faron", "port", "bateau", "plage", "petanque", "provence", "noir"],
      description: "Un concentré de Toulon et de Provence, signé FORK. Au dos, neuf vignettes racontent le Sud : le rugby, le pêcheur du port, les marchés, le téléphérique du Faron, la mer et les bateaux, la plage et la pétanque, réunis autour du logo FORK dans un visuel unique aux couleurs de chez nous. ☀",
      images: [
        { src: "assets/products/les-minots/les-minots-face-port.jpg", alt: "Les Minots noir porté de face sur le port" },
        { src: "assets/products/les-minots/les-minots-dos-faron.jpg", alt: "Dos des Minots : rugby, pêcheur, marché, téléphérique, port, plage, cargo et pétanque autour du logo FORK" },
        { src: "assets/products/les-minots/les-minots-dos-cintre.jpg", alt: "Dos des Minots sur cintre face au port de Toulon" },
        { src: "assets/products/les-minots/les-minots-face-marche.jpg", alt: "Les Minots porté au marché" },
        { src: "assets/products/les-minots/les-minots-face-rue.jpg", alt: "Les Minots porté de face dans une rue de Toulon" },
        { src: "assets/products/les-minots/les-minots-dos-rue.jpg", alt: "Les Minots porté de dos dans une rue de Toulon" },
      ],
    },
    {
      id: "authentique",
      type: "T-shirt",
      keywords: ["rugby", "rct", "ballon", "ovale", "degun", "match", "blanc", "rouge", "noir", "vibe"],
      sku: "fork-authentique",
      name: "L'Authentique",
      color: "Rouge & noir",
      category: "homme",
      priceCents: 3000,
      sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
      available: true,
      isNew: false,
      description: "Le classique FORK. Au dos, un ballon ovale rouge et noir porte la devise « Chez nous à Toulon on craint degun ». Devant, le logo FORK. Un t-shirt blanc pour les jours de match comme pour tous les jours.",
      images: [
        { src: "assets/products/authentique/authentique-face-porte.jpg", alt: "L'Authentique rouge et noir porté de face devant la mer" },
        { src: "assets/products/authentique/authentique-dos-ancre.jpg", alt: "Dos de L'Authentique rouge et noir suspendu face à la rade" },
        { src: "assets/products/authentique/authentique-dos-mer.jpg", alt: "Dos de L'Authentique rouge et noir tenu face à la mer" },
        { src: "assets/products/authentique/authentique-detail-ballon.jpg", alt: "Détail du logo vibe toulonnaise de L'Authentique avec un ballon de rugby" },
        { src: "assets/products/authentique/authentique-face-cintre-mer.jpg", alt: "Face de L'Authentique sur cintre au bord de l'eau" },
        { src: "assets/products/authentique/authentique-porte-sentier.jpg", alt: "L'Authentique porté sur le sentier du littoral" },
        { src: "assets/products/authentique/authentique-imprime-detail.jpg", alt: "Gros plan sur l'impression « Chez nous à Toulon on craint degun »" },
      ],
    },
    {
      id: "lou-faron",
      type: "T-shirt",
      keywords: ["leopard", "faron", "telepherique", "montagne", "584", "blanc", "femme"],
      sku: "fork-lou-faron",
      name: "Lou Faron",
      color: "Léopard",
      category: "femme",
      priceCents: 3000,
      sizes: ["S", "M", "L"],
      available: true,
      isNew: false,
      description: "Le Faron revisité en léopard, avec son téléphérique rouge et son altitude : 584 m. Devant, le logo FORK en motif léopard. Une pièce forte, imprimée sur un t-shirt blanc.",
      images: [
        { src: "assets/products/lou-faron/lou-faron-face-maison-bleue.jpg", alt: "Lou Faron porté de face devant une maison aux volets bleus" },
        { src: "assets/products/lou-faron/lou-faron-dos-faron.jpg", alt: "Dos du Lou Faron : le Faron en léopard, le téléphérique et « Alt. 584m »" },
        { src: "assets/products/lou-faron/lou-faron-dos-ancre.jpg", alt: "Dos du Lou Faron suspendu face à la rade" },
        { src: "assets/products/lou-faron/lou-faron-face-mer.jpg", alt: "Lou Faron porté face à la mer" },
        { src: "assets/products/lou-faron/lou-faron-imprime-detail.jpg", alt: "Gros plan sur l'impression Faron léopard" },
        { src: "assets/products/lou-faron/lou-faron-face-calanque.jpg", alt: "Lou Faron porté de face au-dessus de la calanque" },
        { src: "assets/products/lou-faron/lou-faron-face-rochers.jpg", alt: "Lou Faron porté sur le sentier au bord de l'eau" },
        { src: "assets/products/lou-faron/lou-faron-face-rocher-mer.jpg", alt: "Face du Lou Faron posé sur un rocher face à la mer" },
        { src: "assets/products/lou-faron/lou-faron-statue.jpg", alt: "Statue blanche sur le ciel bleu" },
      ],
    },
    {
      id: "les-boutades",
      type: "T-shirt",
      keywords: ["calanque", "fada", "mistral", "cigale", "jaune", "rade", "petanque", "provence", "noir", "mots"],
      sku: "fork-les-boutades",
      name: "Les Boutades",
      color: "Noir",
      category: "homme",
      priceCents: 3000,
      sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
      available: true,
      isNew: false,
      description: "Calanque, fada, mistral, cigale, jaune, rade, pétanque : les mots du Sud, imprimés en blanc dans le dos d'un t-shirt noir. Devant, le logo FORK.",
      images: [
        { src: "assets/products/les-boutades/les-boutades-face-calanque.jpg", alt: "Les Boutades noir porté de face au-dessus de la calanque" },
        { src: "assets/products/les-boutades/les-boutades-dos-calanque.jpg", alt: "Dos des Boutades : Calanque, Fada, Mistral, Cigale, Jaune, Rade, Pétanque" },
        { src: "assets/products/les-boutades/les-boutades-face-cintre.jpg", alt: "Les Boutades noir sur cintre devant un mur blanc aux fenêtres bleues" },
        { src: "assets/products/les-boutades/les-boutades-dos-ancre.jpg", alt: "Dos des Boutades noir suspendu face à la rade" },
        { src: "assets/products/les-boutades/les-boutades-dos-rugby.jpg", alt: "Les Boutades porté de dos, ballon de rugby en main" },
        { src: "assets/products/les-boutades/les-boutades-face-sourire.jpg", alt: "Les Boutades noir porté de face, mains sur les hanches" },
        { src: "assets/products/les-boutades/les-boutades-dos-chapelle.jpg", alt: "Les Boutades porté de dos face à la mer et à la chapelle" },
        { src: "assets/products/les-boutades/les-boutades-clocher.jpg", alt: "Le clocher de la chapelle face à la mer" },
      ],
    },
  ];
  const bySku = new Map(PRODUCTS.filter((p) => p.sku).map((p) => [p.sku, p]));
  // Page dédiée d'un t-shirt (/t-shirt/<id>/) : la fiche s'affiche dans la page au lieu du tiroir.
  const PAGE_PRODUCT = document.body.dataset.productPage || null;
  // Mesures des t-shirts (à plat, en cm) : [largeur aisselle à aisselle, longueur].
  const SIZE_CHART = { S: [46, 71], M: [50, 73], L: [55, 76], XL: [59, 76], XXL: [63, 79], "3XL": [65, 82] };
  const productPath = (id) => `/t-shirt/${encodeURIComponent(id)}/`;
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const MAX_QTY = 20;

  // Carte cadeau : vendue en ligne, envoyée par e-mail (pas de stock, pas de livraison).
  const GIFT_SKU = "fork-carte-cadeau";
  const GIFT_IMG = "assets/carte-cadeau.svg";
  const isGiftLine = (l) => l.sku === GIFT_SKU;

  // Réglages modifiables depuis l'admin (bandeau, pack, livraison offerte, fenêtre -10 %).
  let shop = { banner: null, pack: { twoPercent: 10, threePercent: 0 }, freeShippingMin: 2, popup: { active: false, percent: 0 }, giftCardAmounts: [30, 50, 60] };

  // Provenance (?src=bio, ?src=carte…) : gardée 30 jours pour savoir d'où viennent les ventes.
  const SRC_KEY = "fork-src";
  const urlSrc = (() => {
    const q = new URLSearchParams(location.search);
    const v = (q.get("src") || q.get("utm_source") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 30);
    return v || null;
  })();

  // Stock public : par t-shirt et par taille, "in" | "out" | nombre restant (≤ 3).
  // Une taille absente n'est pas suivie et reste en vente.
  let stock = {};
  const stockOf = (sku, size) => stock[sku]?.[size];
  const isOut = (sku, size) => stockOf(sku, size) === "out";
  const maxFor = (sku, size) => {
    const v = stockOf(sku, size);
    return typeof v === "number" ? Math.min(v, MAX_QTY) : v === "out" ? 0 : MAX_QTY;
  };
  async function loadStockInfo() {
    try {
      const r = await fetch("/api/stock", { credentials: "same-origin" });
      const data = await r.json();
      stock = data && typeof data.stock === "object" ? data.stock : {};
    } catch {
      stock = {};
    }
    if (sheet.product) {
      if (sheet.size && isOut(sheet.product.sku, sheet.size)) sheet.size = null;
      renderProduct();
    }
  }

  const STATUS = {
    pending_payment: ["En attente de paiement", "warn"],
    paid: ["Payée", "ok"],
    preparing: ["En préparation", "info"],
    shipped: ["Expédiée", "info"],
    delivered: ["Livrée", "ok"],
    cancelled: ["Annulée", "err"],
  };
  const PAYMENT = { pending: ["Paiement en attente", "warn"], paid: ["Payé", "ok"] };

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const euros = (cents) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const formatDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  };
  const pill = (map, key) => {
    const [label, tone] = map[key] ?? [key, "info"];
    return `<span class="pill ${tone}">${esc(label)}</span>`;
  };
  const isHttps = (url) => typeof url === "string" && /^https:\/\//i.test(url);

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* stockage indisponible : le panier vit en mémoire */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* rien */
      }
    },
  };

  function uuidV4() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  async function api(path, { method = "GET", body } = {}) {
    try {
      const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: "Connexion impossible. Vérifie ton réseau et réessaie." } };
    }
  }

  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("err", isError);
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (el.hidden = true), isError ? 9000 : 3200);
  }

  // ---------------------------------------------------------------------------
  // Tiroirs
  // ---------------------------------------------------------------------------
  let lastFocus = null;
  function openDrawer(id) {
    closeDrawers(false);
    lastFocus = document.activeElement;
    $("#overlay").hidden = false;
    const drawer = $(`#${id}`);
    drawer.hidden = false;
    document.body.classList.add("locked");
    const focusable = drawer.querySelector("[data-close]");
    focusable?.focus();
  }
  function closeDrawers(restoreFocus = true) {
    $$(".drawer").forEach((d) => (d.hidden = true));
    $("#overlay").hidden = true;
    document.body.classList.remove("locked");
    if (restoreFocus && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("#overlay").addEventListener("click", () => closeDrawers());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawers();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeDrawers();
  });
  $("#menuOpen").addEventListener("click", () => openDrawer("menuDrawer"));

  // ---------------------------------------------------------------------------
  // Catalogue et filtres
  // ---------------------------------------------------------------------------
  let filter = "all";
  function setFilter(next) {
    filter = next;
    $$(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === next)));
    renderGrid();
  }
  function renderGrid() {
    if (!$("#productGrid")) return;
    const list = PRODUCTS.filter((p) => {
      if (filter === "out") return !p.available;
      if (filter === "homme" || filter === "femme") return p.category === filter;
      return true;
    }).sort((a, b) => Number(b.available) - Number(a.available));

    $("#productGrid").innerHTML = list
      .map((p) => {
        const badge = !p.available ? `<span class="pbadge out">Épuisé</span>` : p.isNew ? `<span class="pbadge">Nouveau</span>` : "";
        const back = p.images[1] ? `<img class="back" src="${esc(p.images[1].src)}" alt="" loading="lazy">` : "";
        return `<a class="pcard" href="${esc(productPath(p.id))}" data-product="${esc(p.id)}" aria-label="${esc(`${p.name} ${p.color}, ${euros(p.priceCents)}${p.available ? "" : ", épuisé"}`)}">
          <div class="pimg">${badge}<img src="${esc(p.images[0].src)}" alt="${esc(p.images[0].alt)}" loading="lazy">${back}</div>
          <span class="pname">T-shirt ${esc(p.name)}</span>
          <span class="pmeta">${esc(p.color)} · ${p.category === "femme" ? "Femme" : "Homme"}</span>
          ${ratingLine(p.sku)}
          <span class="price">${p.available ? euros(p.priceCents) : `<s>${euros(p.priceCents)}</s> · Épuisé`}</span>
        </a>`;
      })
      .join("");
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => setFilter(t.dataset.tab)));
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-filter]");
    if (link) {
      setFilter(link.dataset.filter);
      closeDrawers(false);
    }
    const card = e.target.closest("[data-product]");
    if (card && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      openProduct(card.dataset.product);
    }
    if (e.target.closest("[data-open-account]")) openAccount();
  });

  // ---------------------------------------------------------------------------
  // Recherche : suggestions à chaque lettre tapée (sans accents ni majuscules)
  // ---------------------------------------------------------------------------
  const norm = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const searchIndex = PRODUCTS.map((p) => ({
    p,
    name: norm(`t-shirt ${p.name}`),
    text: norm([p.name, p.color, p.category === "femme" ? "femme" : "homme", p.description, ...(p.keywords ?? [])].join(" ")),
  }));
  function renderSearch() {
    const raw = $("#searchInput").value.trim();
    const terms = norm(raw).split(/\s+/).filter(Boolean);
    const list = terms.length
      ? searchIndex
          .filter((e) => terms.every((t) => e.text.includes(t)))
          .map((e) => ({ p: e.p, score: terms.reduce((n, t) => n + (e.name.includes(t) ? 2 : 1), 0) }))
          .sort((a, b) => b.score - a.score || Number(b.p.available) - Number(a.p.available))
          .map((e) => e.p)
      : PRODUCTS.filter((p) => p.available);
    $("#searchHint").textContent = !terms.length
      ? "Suggestions"
      : list.length
        ? `${list.length} article${list.length > 1 ? "s" : ""}`
        : `Aucun article ne correspond à « ${raw} ».`;
    $("#searchResults").innerHTML = list
      .map(
        (p) => `<button type="button" class="sresult" data-product="${esc(p.id)}">
          <img src="${esc(p.images[0].src)}" alt="" loading="lazy">
          <span><b>T-shirt ${esc(p.name)}</b><span class="pmeta">${esc(p.color)} · ${p.category === "femme" ? "Femme" : "Homme"}</span><span>${p.available ? euros(p.priceCents) : "Épuisé"}</span></span>
        </button>`,
      )
      .join("");
  }
  $("#searchInput").addEventListener("input", renderSearch);
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = $("#searchResults .sresult");
      if (first) openProduct(first.dataset.product);
    }
  });
  $("#searchOpen").addEventListener("click", () => {
    openDrawer("searchDrawer");
    renderSearch();
    $("#searchInput").focus();
  });

  // ---------------------------------------------------------------------------
  // Avis clients (acheteurs vérifiés uniquement, contrôlé côté serveur)
  // ---------------------------------------------------------------------------
  let reviewSummary = {};
  const reviewCache = new Map();
  const starIcons = (value) => {
    const v = Math.round((Number(value) || 0) * 2) / 2; // arrondi à la demi-étoile
    const full = Math.floor(v);
    const half = v - full === 0.5;
    return `<span class="stars" aria-hidden="true">${"★".repeat(full)}${half ? '<span class="half">★</span>' : ""}<span class="off">${"★".repeat(5 - full - (half ? 1 : 0))}</span></span>`;
  };
  const decimal = (n) => String(n).replace(".", ",");
  function ratingLine(sku, long = false) {
    const s = sku && reviewSummary[sku];
    if (!s || !s.count) return "";
    const label = `${decimal(s.average)} sur 5, ${s.count} avis`;
    return `<span class="rating" aria-label="${label}">${starIcons(s.average)}<span>${decimal(s.average)}${long ? "/5" : ""} · ${s.count} avis</span></span>`;
  }
  async function loadReviewSummary() {
    const { ok, data } = await api("/api/reviews");
    if (!ok || !data.summary) return;
    reviewSummary = data.summary;
    renderGrid();
    if (PAGE_PRODUCT && sheet.product?.sku) {
      renderProduct();
      loadReviews(sheet.product.sku, true);
    }
  }
  async function loadReviews(sku, force = false) {
    if (!force && reviewCache.has(sku)) return;
    const { ok, data } = await api(`/api/reviews?sku=${encodeURIComponent(sku)}`);
    reviewCache.set(sku, ok && Array.isArray(data.reviews) ? data.reviews : []);
    if (ok && data.summary) reviewSummary = data.summary;
    if (sheet.product?.sku === sku) {
      const box = $("#reviewsBox");
      if (box) box.innerHTML = reviewsHtml(sheet.product);
    }
  }
  function reviewsHtml(p) {
    const list = reviewCache.get(p.sku);
    const s = reviewSummary[p.sku];
    const head = `<div class="reviews-head"><h3>Avis clients</h3>${
      s && s.count ? `<p class="rating big">${starIcons(s.average)}<b>${decimal(s.average)}/5</b><span class="muted">· ${s.count} avis</span></p>` : ""
    }<button type="button" class="btn out full" data-write-review="${esc(p.sku)}">Donner mon avis</button></div>`;
    const policy = `<details class="review-policy"><summary>Comment fonctionnent les avis ?</summary><p>Seuls les clients ayant commandé ce t-shirt sur fork-clothe.com peuvent laisser un avis, une fois leur commande expédiée : l'achat est vérifié avec leur commande. Les avis ne sont pas rémunérés. Ils sont publiés sans délai, du plus récent au plus ancien, avec le prénom et l'initiale du nom de leur auteur. FORK peut masquer un avis injurieux, hors sujet ou contenant des données personnelles, mais jamais parce qu'il est négatif, et peut y répondre publiquement.</p></details>`;
    if (!list) return `${head}<p class="muted">Chargement des avis…</p>${policy}`;
    if (!list.length) return `${head}<p class="muted">Pas encore d'avis sur ce t-shirt. Tu l'as reçu ? Sois le premier à donner ton avis.</p>${policy}`;
    const items = list
      .map(
        (r) => `<article class="review">
          <div class="review-top">${starIcons(r.rating)}<span class="muted">${esc(formatDate(r.createdAt))}</span></div>
          <p class="review-author"><b>${esc(r.authorName)}</b>${r.verified ? `<span class="verified">✓ Achat vérifié</span>` : ""}${r.size ? `<span class="muted">Taille ${esc(r.size)}</span>` : ""}</p>
          ${r.title ? `<h4>${esc(r.title)}</h4>` : ""}
          <p class="review-body">${esc(r.body)}</p>
          ${
            Array.isArray(r.photos) && r.photos.length
              ? `<div class="review-photos">${r.photos
                  .filter((u) => /^\/api\/review-photo\?id=\d+$/.test(u))
                  .map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Photo jointe à l'avis de ${esc(r.authorName)}" loading="lazy"></a>`)
                  .join("")}</div>`
              : ""
          }
          ${r.shopReply ? `<div class="shop-reply"><b>Réponse de FORK</b><p>${esc(r.shopReply)}</p></div>` : ""}
        </article>`,
      )
      .join("");
    return `${head}<div class="review-list">${items}</div>${policy}`;
  }

  // Formulaire d'avis
  const review = { sku: null, orderNumber: "", email: "", step: "identify", items: [], item: null, rating: 0, title: "", body: "", photos: [], error: "", busy: false };
  const REVIEW_PENDING_KEY = "fork_review_pending";
  function openReview(sku, orderNumber) {
    Object.assign(review, { sku: sku || null, orderNumber: orderNumber || "", step: "identify", items: [], item: null, rating: 0, title: "", body: "", photos: [], error: "", busy: false });
    openDrawer("reviewDrawer");
    if (me) checkEligibility();
    else renderReview();
  }
  async function checkEligibility() {
    review.busy = true;
    review.error = "";
    renderReview();
    const body = { action: "eligibility" };
    if (!me) Object.assign(body, { orderNumber: review.orderNumber.trim().toUpperCase(), email: review.email.trim() });
    else if (review.orderNumber) body.orderNumber = review.orderNumber.trim().toUpperCase();
    const { ok, data } = await api("/api/reviews", { method: "POST", body });
    review.busy = false;
    if (!ok) {
      review.error = data.error || "Vérification impossible.";
      review.step = "identify";
      return renderReview();
    }
    const open = (data.items || []).filter((i) => !i.reviewed && bySku.has(i.sku));
    review.items = open;
    const match = open.filter((i) => !review.sku || i.sku === review.sku);
    if (match.length === 1) {
      review.item = match[0];
      review.step = "form";
    } else if (open.length) {
      review.step = "pick";
    } else {
      review.step = "none";
      review.allDone = (data.items || []).length > 0;
    }
    renderReview();
  }
  function renderReview() {
    const body = $("#reviewBody");
    const err = review.error ? `<p class="notice err">${esc(review.error)}</p>` : "";
    if (review.busy) {
      body.innerHTML = `<p class="muted">Vérification de ta commande…</p>`;
      return;
    }
    if (review.step === "identify") {
      body.innerHTML = `
        <p>Les avis sont réservés aux clients qui ont reçu leur t-shirt. Retrouve ta commande :</p>
        <a class="google" href="/.netlify/functions/auth-google" data-review-google><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"/></svg>Continuer avec Google</a>
        <p class="muted center">ou, sans compte</p>
        <form id="reviewIdentify" class="stack">
          <div class="field"><label for="r-order">Numéro de commande</label><input id="r-order" required maxlength="80" placeholder="FORK-20261010-ABC123" value="${esc(review.orderNumber)}" autocapitalize="characters"></div>
          <div class="field"><label for="r-email">E-mail utilisé pour commander</label><input id="r-email" type="email" required maxlength="254" autocomplete="email" value="${esc(review.email)}"></div>
          ${err}
          <button class="btn full" type="submit">Retrouver ma commande</button>
          <p class="hint">Le numéro de commande figure dans ton e-mail de confirmation.</p>
        </form>`;
      $("#reviewIdentify").addEventListener("submit", (e) => {
        e.preventDefault();
        review.orderNumber = $("#r-order").value;
        review.email = $("#r-email").value;
        checkEligibility();
      });
      $("[data-review-google]").addEventListener("click", () => {
        try {
          sessionStorage.setItem(REVIEW_PENDING_KEY, JSON.stringify({ sku: review.sku, orderNumber: review.orderNumber }));
        } catch {}
      });
      return;
    }
    if (review.step === "none") {
      body.innerHTML = `${err}<div class="empty"><h4>${review.allDone ? "Merci, tu as déjà donné ton avis 🙌" : "Aucun t-shirt à noter pour le moment"}</h4><p class="muted">${
        review.allDone ? "Tu as déjà noté tous les t-shirts de tes commandes expédiées." : "Tu pourras donner ton avis dès que ta commande aura été expédiée."
      }</p><button type="button" class="btn out" data-close>Fermer</button></div>`;
      return;
    }
    if (review.step === "pick") {
      body.innerHTML = `<p>Quel t-shirt veux-tu noter ?</p><div class="search-results">${review.items
        .map((i, n) => {
          const p = bySku.get(i.sku);
          return `<button type="button" class="sresult" data-pick="${n}"><img src="${esc(p.images[0].src)}" alt=""><span><b>T-shirt ${esc(i.name)}</b><span class="pmeta">${esc(i.color)} · Taille ${esc(i.size)}</span><span class="muted">${esc(i.orderNumber)}</span></span></button>`;
        })
        .join("")}</div>`;
      $$("[data-pick]").forEach((b) =>
        b.addEventListener("click", () => {
          review.item = review.items[Number(b.dataset.pick)];
          review.step = "form";
          renderReview();
        }),
      );
      return;
    }
    if (review.step === "done") {
      body.innerHTML = `<div class="empty"><h4>Merci pour ton avis !</h4><p class="muted">Il est publié sur la fiche du t-shirt.</p><button type="button" class="btn" data-show-product="${esc(bySku.get(review.item.sku)?.id || "")}">Voir mon avis</button></div>`;
      return;
    }
    // Formulaire
    const p = bySku.get(review.item.sku);
    body.innerHTML = `
      <div class="sresult static"><img src="${esc(p.images[0].src)}" alt=""><span><b>T-shirt ${esc(review.item.name)}</b><span class="pmeta">${esc(review.item.color)} · Taille ${esc(review.item.size)}</span></span></div>
      <form id="reviewForm" class="stack">
        <div class="field"><span class="up">Ta note</span>
          <div class="star-pick" role="radiogroup" aria-label="Note sur 5">${[1, 2, 3, 4, 5]
            .map((n) => `<button type="button" role="radio" aria-checked="${review.rating === n}" aria-label="${n} étoile${n > 1 ? "s" : ""}" data-rate="${n}" class="${review.rating >= n ? "on" : ""}">★</button>`)
            .join("")}</div>
        </div>
        <div class="field"><label for="r-title">Titre (facultatif)</label><input id="r-title" maxlength="80" value="${esc(review.title)}" placeholder="Ex. : Super qualité d'impression"></div>
        <div class="field"><label for="r-body">Ton avis</label><textarea id="r-body" rows="5" maxlength="2000" required placeholder="Qualité, taille, confort, impression… et si un souci, dis-le nous.">${esc(review.body)}</textarea><p class="hint" id="r-count">${review.body.length}/2000 · 10 caractères minimum</p></div>
        <div class="field"><span class="up">Photos (facultatif, 3 maximum)</span>
          <div class="photo-pick">${review.photos
            .map((src, n) => `<div class="photo-thumb"><img src="${esc(src)}" alt="Photo ${n + 1}"><button type="button" aria-label="Retirer la photo ${n + 1}" data-remove-photo="${n}">✕</button></div>`)
            .join("")}${review.photos.length < 3 ? `<label class="photo-add">+ Ajouter<input type="file" id="r-photos" accept="image/*" multiple hidden></label>` : ""}</div>
        </div>
        ${err}
        <p class="hint">Ton avis sera publié avec ton prénom et l'initiale de ton nom, la taille commandée et la date. Évite d'y mettre des informations personnelles (adresse, téléphone…).</p>
        <button class="btn full" type="submit" id="r-submit">Publier mon avis</button>
      </form>`;
    $$("[data-rate]").forEach((b) =>
      b.addEventListener("click", () => {
        review.rating = Number(b.dataset.rate);
        saveReviewFields();
        renderReview();
      }),
    );
    $("#r-body").addEventListener("input", (e) => {
      review.body = e.target.value;
      $("#r-count").textContent = `${review.body.length}/2000 · 10 caractères minimum`;
    });
    $("#r-title").addEventListener("input", (e) => (review.title = e.target.value));
    $("#r-photos")?.addEventListener("change", async (e) => {
      saveReviewFields();
      const files = [...e.target.files].slice(0, 3 - review.photos.length);
      for (const file of files) {
        try {
          review.photos.push(await shrinkPhoto(file));
        } catch {
          review.error = "Une photo n'a pas pu être lue. Essaie avec une autre.";
        }
      }
      renderReview();
    });
    $$("[data-remove-photo]").forEach((b) =>
      b.addEventListener("click", () => {
        saveReviewFields();
        review.photos.splice(Number(b.dataset.removePhoto), 1);
        renderReview();
      }),
    );
    $("#reviewForm").addEventListener("submit", submitReview);
  }
  function saveReviewFields() {
    const t = $("#r-title");
    const b = $("#r-body");
    if (t) review.title = t.value;
    if (b) review.body = b.value;
  }
  // Réduit la photo (1400 px max, JPEG) avant l'envoi : plus rapide et plus léger.
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      img.src = url;
    });
  }
  async function submitReview(e) {
    e.preventDefault();
    saveReviewFields();
    review.error = "";
    if (!review.rating) review.error = "Choisis une note de 1 à 5 étoiles.";
    else if (review.body.trim().length < 10) review.error = "Ton avis doit faire au moins 10 caractères.";
    if (review.error) return renderReview();
    const button = $("#r-submit");
    button.disabled = true;
    button.textContent = "Publication…";
    const { ok, data } = await api("/api/reviews", {
      method: "POST",
      body: {
        action: "submit",
        orderNumber: review.item.orderNumber,
        email: me ? undefined : review.email.trim(),
        sku: review.item.sku,
        rating: review.rating,
        title: review.title.trim(),
        body: review.body.trim(),
        photos: review.photos,
      },
    });
    if (!ok) {
      review.error = data.error || "Impossible de publier ton avis. Réessaie.";
      return renderReview();
    }
    review.step = "done";
    reviewCache.delete(review.item.sku);
    renderReview();
    loadReviewSummary();
  }
  document.addEventListener("click", (e) => {
    const write = e.target.closest("[data-write-review]");
    if (write) openReview(write.dataset.writeReview);
    const fromOrder = e.target.closest("[data-review-order]");
    if (fromOrder) openReview(null, fromOrder.dataset.reviewOrder);
    const show = e.target.closest("[data-show-product]");
    if (show && show.dataset.showProduct) openProduct(show.dataset.showProduct);
    if (e.target.closest("[data-scroll-reviews]")) {
      e.preventDefault();
      $("#reviewsBox")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // Partage d'un t-shirt : menu de partage du téléphone, sinon lien copié.
  async function shareProduct(id) {
    const p = byId.get(id);
    if (!p) return;
    const url = `${window.location.origin}${productPath(p.id)}`;
    const data = { title: `T-shirt ${p.name} · FORK`, text: `Le t-shirt ${p.name} de FORK, la vibe de Toulon 🔥`, url };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Lien copié, tu peux le coller où tu veux");
    } catch {
      window.prompt("Copie ce lien :", url);
    }
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-share]");
    if (b) shareProduct(b.dataset.share);
  });

  // Inscription « Préviens-moi de la prochaine collection »
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-news]");
    if (!form) return;
    e.preventDefault();
    const msg = $(".news-msg", form);
    const email = form.elements.email.value.trim();
    msg.textContent = "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = "Indique une adresse e-mail valide.";
      return form.elements.email.focus();
    }
    if (!form.elements.consent.checked) {
      msg.textContent = "Coche la case pour accepter de recevoir nos e-mails.";
      return;
    }
    const button = $("button[type=submit]", form);
    button.disabled = true;
    const { ok, data } = await api("/api/newsletter", {
      method: "POST",
      body: { email, consent: true, website: form.elements.website.value, source: PAGE_PRODUCT ? `page:${PAGE_PRODUCT}` : "accueil" },
    });
    button.disabled = false;
    if (!ok) {
      msg.textContent = data.error || "Inscription impossible pour le moment. Réessaie.";
      return;
    }
    form.reset();
    msg.textContent = "C'est noté ! Tu recevras un e-mail de confirmation, puis on te prévient dès la prochaine sortie. 🔥";
  });

  // ---------------------------------------------------------------------------
  // Fiche produit
  // ---------------------------------------------------------------------------
  const sheet = { product: null, size: null, qty: 1 };
  function openProduct(id) {
    const product = byId.get(id);
    if (!product) return;
    if (PAGE_PRODUCT) {
      // Sur une page t-shirt : même t-shirt → on remonte à la fiche, sinon on ouvre sa page.
      if (id === PAGE_PRODUCT) {
        closeDrawers(false);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        window.location.href = productPath(id);
      }
      return;
    }
    sheet.product = product;
    sheet.size = null;
    sheet.qty = 1;
    renderProduct();
    openDrawer("productDrawer");
    if (product.sku) loadReviews(product.sku);
  }
  /** Encart pack + 3 lignes de réassurance sous le bouton d'achat. */
  function productPerks() {
    const two = shop.pack.twoPercent;
    const free = shop.freeShippingMin === 2;
    const pack =
      two > 0 || free
        ? `<div class="pack-box"><b>Pack 2 t-shirts : ${[two > 0 ? `-${two} %` : "", free ? "livraison offerte" : ""].filter(Boolean).join(" + ")}</b><span>Un pour toi, un à offrir. Appliqué tout seul dans le panier.</span></div>`
        : "";
    return `${pack}<ul class="perks">
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3a4 4 0 0 1-8 0Z"/></svg>100 % coton 220 g, imprimé à La Farlède (Var)</li>
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>Expédié depuis Toulon sous 48 h, Colissimo suivi</li>
      <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/></svg>Retour possible sous 14 jours</li>
    </ul>`;
  }

  function renderProduct() {
    const p = sheet.product;
    const target = PAGE_PRODUCT ? $("#pageSheet") : $("#productSheet");
    if (!PAGE_PRODUCT) $("#productTitle").textContent = `${p.name} · ${p.color}`;
    const H = PAGE_PRODUCT ? "h1" : "h2";
    const canBuy = p.available && sheet.size;
    target.innerHTML = `
      <div class="gallery" id="gallery">${p.images.map((img, i) => `<img src="${esc(img.src)}" alt="${esc(img.alt)}" ${i ? 'loading="lazy"' : ""} data-index="${i}">`).join("")}</div>
      <div class="sheet-info">
        <div class="thumbs">${p.images.map((img, i) => `<button type="button" data-thumb="${i}" aria-label="Photo ${i + 1}" aria-current="${i === 0}"><img src="${esc(img.src)}" alt="" loading="lazy"></button>`).join("")}</div>
        ${p.aiVisuals ? `<p class="hint ai-note">Visuels générés par IA en attendant notre shooting photo. L'impression est fidèle au t-shirt réel.</p>` : ""}
        <div>
          ${p.available ? (p.isNew ? '<span class="pill info">Nouveau</span>' : "") : '<span class="pill err">Épuisé</span>'}
          <${H}>T-shirt ${esc(p.name)}</${H}>
          <p class="pmeta">${esc(p.color)} · ${p.category === "femme" ? "Femme" : "Homme"}</p>
          ${p.sku && reviewSummary[p.sku]?.count ? `<a href="#reviewsBox" class="rating-link" data-scroll-reviews>${ratingLine(p.sku, true)}</a>` : ""}
        </div>
        <div class="price-row"><p class="price">${euros(p.priceCents)}</p><button type="button" class="share" data-share="${esc(p.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/></svg>Partager</button></div>
        <p class="muted">${esc(p.description)}</p>
        ${
          p.available
            ? `<div class="field"><span class="up">Taille</span><div class="sizes">${p.sizes
                .map((s) =>
                  isOut(p.sku, s)
                    ? `<button type="button" class="size out" disabled aria-label="${esc(s)}, épuisée">${esc(s)}</button>`
                    : `<button type="button" class="size" data-size="${esc(s)}" aria-pressed="${sheet.size === s}">${esc(s)}</button>`,
                )
                .join("")}</div>${
                sheet.size && typeof stockOf(p.sku, sheet.size) === "number"
                  ? `<p class="low-stock">Plus que ${stockOf(p.sku, sheet.size)} en taille ${esc(sheet.size)} !</p>`
                  : p.sizes.some((s) => isOut(p.sku, s))
                    ? `<p class="hint">Les tailles barrées sont épuisées.</p>`
                    : ""
              }</div>
              <div class="field"><span class="up">Quantité</span><div class="qty"><button type="button" data-qty="-1" aria-label="Diminuer">−</button><span>${sheet.qty}</span><button type="button" data-qty="1" aria-label="Augmenter">+</button></div></div>
              <button type="button" class="btn full" id="addToCart" ${canBuy ? "" : "disabled"}>${sheet.size ? `Ajouter au panier · ${euros(p.priceCents * sheet.qty)}` : "Choisis ta taille"}</button>`
            : `<p class="notice">Ce modèle est épuisé pour le moment. Suis-nous sur Instagram pour être au courant de son retour.</p>`
        }
        ${p.available ? productPerks() : ""}
        <p class="hint">${shop.freeShippingMin > 0 ? `Livraison offerte dès ${shop.freeShippingMin} t-shirts ou à moins de 10 km de Toulon, sinon 7,64 €.` : "Livraison offerte à moins de 10 km de Toulon, 7,64 € au-delà."} Le montant exact est calculé avant le paiement.</p>
        <div class="pinfo">
          <details><summary>Matière</summary><p>100 % coton, 220 g/m².</p></details>
          <details><summary>Guide des tailles</summary>
            <p>Mesures du t-shirt posé à plat, en centimètres :</p>
            <div class="table-scroll"><table class="size-table"><thead><tr><th>Taille</th><th>Largeur</th><th>Longueur</th></tr></thead><tbody>${p.sizes
              .filter((sz) => SIZE_CHART[sz])
              .map((sz) => `<tr><th>${esc(sz)}</th><td>${SIZE_CHART[sz][0]} cm</td><td>${SIZE_CHART[sz][1]} cm</td></tr>`)
              .join("")}</tbody></table></div>
            <p class="hint">Largeur : d'une aisselle à l'autre, juste sous les manches. Longueur : du haut de l'épaule, à côté du col, jusqu'en bas du t-shirt. Pour choisir, compare avec un t-shirt que tu aimes porter. Un doute ? Écris-nous sur WhatsApp au 07 66 75 18 40.</p>
          </details>
          <details><summary>Entretien</summary>
            <p class="hint">Conseils généraux pour garder ton t-shirt et son impression plus longtemps :</p>
            <ul><li>Lavage à l'envers, à 30 °C.</li><li>Avec des couleurs similaires.</li><li>Éviter le sèche-linge.</li><li>Ne pas repasser directement sur l'impression.</li><li>Pas de produits blanchissants.</li></ul>
          </details>
        </div>
        ${p.sku ? `<section class="reviews" id="reviewsBox" aria-label="Avis clients">${reviewsHtml(p)}</section>` : ""}
      </div>`;

    const gallery = $("#gallery");
    $$("[data-thumb]").forEach((b) =>
      b.addEventListener("click", () => {
        const target = gallery.children[Number(b.dataset.thumb)];
        gallery.scrollTo({ left: target.offsetLeft, behavior: "smooth" });
        $$("[data-thumb]").forEach((x) => x.setAttribute("aria-current", String(x === b)));
      }),
    );
    $$("[data-size]").forEach((b) =>
      b.addEventListener("click", () => {
        sheet.size = b.dataset.size;
        sheet.qty = Math.min(sheet.qty, Math.max(1, maxFor(sheet.product.sku, sheet.size)));
        renderProduct();
      }),
    );
    $$("[data-qty]").forEach((b) =>
      b.addEventListener("click", () => {
        const cap = sheet.size ? Math.max(1, maxFor(sheet.product.sku, sheet.size)) : MAX_QTY;
        sheet.qty = Math.min(cap, Math.max(1, sheet.qty + Number(b.dataset.qty)));
        renderProduct();
      }),
    );
    $("#addToCart")?.addEventListener("click", () => {
      addToCart(p.sku, sheet.size, sheet.qty);
      toast(`${p.name} · ${sheet.size} ajouté au panier`);
      openCart();
    });
  }

  // ---------------------------------------------------------------------------
  // Panier (navigateur) — le serveur recalcule tout à la commande
  // ---------------------------------------------------------------------------
  const CART_KEY = "fork-cart-v3";
  const PENDING_KEY = "fork-pending-order-v1";
  let cart = store
    .get(CART_KEY, [])
    .filter((l) => l && l.qty > 0 && (isGiftLine(l) ? shop.giftCardAmounts.includes(Number(l.size)) : bySku.has(l.sku) && bySku.get(l.sku).sizes.includes(l.size)));
  let pending = store.get(PENDING_KEY, null);

  function saveCart() {
    store.set(CART_KEY, cart);
    $("#cartCount").textContent = String(cart.reduce((n, l) => n + l.qty, 0));
  }
  // Toute modification du panier rend caduque une commande déjà créée et non payée.
  function cartChanged() {
    if (pending && !pending.paid) {
      pending = null;
      store.remove(PENDING_KEY);
    }
    saveCart();
  }
  function addToCart(sku, size, qty, gift) {
    if (sku === GIFT_SKU) {
      cart.push({ sku, size, qty, gift });
      cartChanged();
      return;
    }
    const line = cart.find((l) => l.sku === sku && l.size === size);
    if (line) line.qty = Math.min(maxFor(sku, size) || MAX_QTY, line.qty + qty);
    else cart.push({ sku, size, qty });
    cartChanged();
  }
  const unitCents = (l) => (isGiftLine(l) ? Number(l.size) * 100 : bySku.get(l.sku)?.priceCents ?? 0);
  const lineInfo = (l) =>
    isGiftLine(l)
      ? { name: "Carte cadeau", meta: `${l.size} € · ${l.gift?.toEmail ? `pour ${l.gift.toName || l.gift.toEmail}` : "envoyée à ton e-mail"}`, img: GIFT_IMG }
      : { name: bySku.get(l.sku).name, meta: `${bySku.get(l.sku).color} · Taille ${l.size}`, img: bySku.get(l.sku).images[0].src };
  const subtotalCents = () => cart.reduce((sum, l) => sum + unitCents(l) * l.qty, 0);
  const tshirtCount = (lines = cart) => lines.filter((l) => !isGiftLine(l)).reduce((n, l) => n + l.qty, 0);
  const hasPhysical = (lines = cart) => lines.some((l) => !isGiftLine(l));
  const packPercentFor = (count) =>
    count >= 3 && shop.pack.threePercent > 0 ? shop.pack.threePercent : count >= 2 ? shop.pack.twoPercent : 0;
  const freeShippingFor = (count) => count > 0 && shop.freeShippingMin > 0 && count >= shop.freeShippingMin;

  // Code promo / carte cadeau saisi à l'étape livraison (vérifié par le serveur, recalculé à la commande).
  const promo = { input: "", state: "idle", code: null, kind: null, percent: 0, balanceCents: 0, message: "" };

  /** Aperçu du prix, calculé comme le serveur (qui refait le calcul à la commande). */
  function pricePreview(feeCents) {
    const count = tshirtCount();
    const tshirtCents = cart.filter((l) => !isGiftLine(l)).reduce((n, l) => n + unitCents(l) * l.qty, 0);
    const subtotal = subtotalCents();
    const pack = packPercentFor(count);
    const codePct = promo.state === "ok" && promo.kind === "percent" && count > 0 ? promo.percent : 0;
    let percent = 0;
    let label = null;
    let codeBeaten = false;
    if (codePct > pack) {
      percent = codePct;
      label = `Code ${promo.code} (-${codePct} %)`;
    } else if (pack > 0) {
      percent = pack;
      label = `Pack ${count >= 3 && shop.pack.threePercent > 0 ? 3 : 2} t-shirts (-${pack} %)`;
      codeBeaten = codePct > 0;
    }
    const discount = Math.round((tshirtCents * percent) / 100);
    const free = freeShippingFor(count);
    const shipping = count === 0 || free ? 0 : feeCents == null ? null : feeCents;
    const due = subtotal - discount + (shipping || 0);
    const gift = promo.state === "ok" && promo.kind === "gift" ? Math.min(promo.balanceCents, due) : 0;
    return { count, subtotal, discount, label, codeBeaten, free, shipping, gift, total: due - gift };
  }

  function priceRows(pr, { estimate = false } = {}) {
    return `<div class="row"><span>Sous-total</span><span>${euros(pr.subtotal)}</span></div>
      ${pr.discount ? `<div class="row save"><span>${esc(pr.label)}</span><span>-${euros(pr.discount)}</span></div>` : ""}
      <div class="row"><span>Livraison</span><span>${pr.count === 0 ? "Par e-mail" : pr.free ? "Offerte" : pr.shipping === null ? "Saisis ton adresse" : pr.shipping ? euros(pr.shipping) : "Offerte"}</span></div>
      ${pr.gift ? `<div class="row save"><span>Carte cadeau ${esc(promo.code)}</span><span>-${euros(pr.gift)}</span></div>` : ""}
      <div class="row total"><span>${estimate ? "Total estimé" : "Total"}</span><span>${pr.count > 0 && !pr.free && pr.shipping === null ? "—" : euros(pr.total)}</span></div>`;
  }

  /** Encart « pack » du panier : ce qu'il manque pour en profiter. */
  function packNudge() {
    const count = tshirtCount();
    if (!count) return "";
    const two = shop.pack.twoPercent;
    const three = shop.pack.threePercent;
    const freeMin = shop.freeShippingMin;
    if (count === 1 && (two > 0 || freeMin === 2)) {
      const save = two > 0 ? Math.round(((unitCents(cart.find((l) => !isGiftLine(l))) * 2) * two) / 100) : 0;
      return `<div class="pack-nudge"><b>Ajoute un 2e t-shirt${save ? ` et économise ${euros(save)}` : ""}${freeMin === 2 ? " + la livraison" : ""}</b><span>Pack 2 t-shirts : ${two > 0 ? `-${two} %` : ""}${two > 0 && freeMin === 2 ? " et " : ""}${freeMin === 2 ? "livraison offerte" : ""}. Un pour toi, un à offrir.</span><a class="link" href="#produits" data-close>Choisir un 2e t-shirt</a></div>`;
    }
    if (count === 2 && three > two) {
      return `<div class="pack-nudge on"><b>✔ Pack 2 t-shirts activé${two ? ` : -${two} %` : ""}</b><span>Ajoute un 3e t-shirt : -${three} % sur les trois.</span><a class="link" href="#produits" data-close>Ajouter un 3e t-shirt</a></div>`;
    }
    const pct = packPercentFor(count);
    if (pct > 0 || freeShippingFor(count))
      return `<div class="pack-nudge on"><b>✔ Pack ${count >= 3 && three > 0 ? 3 : 2} t-shirts activé</b><span>${pct ? `-${pct} % sur tes t-shirts` : ""}${pct && freeShippingFor(count) ? " et " : ""}${freeShippingFor(count) ? "livraison offerte" : ""}.</span></div>`;
    return "";
  }

  // ---------------------------------------------------------------------------
  // Parcours de commande
  // ---------------------------------------------------------------------------
  let step = "cart";
  const form = { name: "", email: "", phone: "", address: "", saveAddress: false, acceptCgv: false, gift: false, giftMessage: "" };
  const quote = { state: "idle", address: "", zone: null, feeCents: 0, message: "" };
  let me = null;
  let savedAddresses = null;

  function openCart(atStep) {
    step = atStep || (pending && !pending.paid ? "payment" : "cart");
    renderCart();
    openDrawer("cartDrawer");
  }
  $("#cartOpen").addEventListener("click", () => openCart());

  function setSteps(active) {
    $("#cartSteps").hidden = !active;
    $$("#cartSteps span").forEach((s) => s.classList.toggle("on", s.dataset.step === active));
  }

  function renderCart() {
    $("#cartTitle").textContent = step === "status" ? "Paiement" : "Panier";
    if (step === "status") return; // rendu par renderPaymentStatus
    setSteps(step);
    if (step === "cart") renderCartStep();
    else if (step === "delivery") renderDeliveryStep();
    else renderPaymentStep();
  }

  function renderCartStep() {
    const body = $("#cartBody");
    const foot = $("#cartFoot");
    if (!cart.length) {
      body.innerHTML = `<div class="empty"><h4>C'est un peu vide ici</h4><p class="muted">La collection FORK t'attend.</p><a class="btn" href="#produits" data-close>Voir la collection</a></div>`;
      foot.innerHTML = "";
      return;
    }
    body.innerHTML = cart
      .map((l, i) => {
        const info = lineInfo(l);
        return `<div class="line">
          <img src="${esc(info.img)}" alt="" loading="lazy">
          <div><div class="pname">${esc(info.name)}</div><div class="pmeta">${esc(info.meta)}</div>
            <div class="qty"><button type="button" data-line="${i}" data-delta="-1" aria-label="Retirer un article">−</button><span>${l.qty}</span><button type="button" data-line="${i}" data-delta="1" aria-label="Ajouter un article">+</button></div>
          </div>
          <span class="price">${euros(unitCents(l) * l.qty)}</span>
        </div>`;
      })
      .join("") + packNudge();
    const pr = pricePreview(null);
    foot.innerHTML = `<div class="row"><span>Sous-total</span><span>${euros(pr.subtotal)}</span></div>
      ${pr.discount ? `<div class="row save"><span>${esc(pr.label)}</span><span>-${euros(pr.discount)}</span></div>` : ""}
      ${pr.count > 0 && pr.free ? `<div class="row save"><span>Livraison</span><span>Offerte</span></div>` : ""}
      <p class="hint">${pr.count === 0 ? "Carte cadeau envoyée par e-mail, sans frais." : pr.free ? "Livraison Colissimo suivie offerte." : "Frais de livraison calculés à l'étape suivante, à partir de ton adresse."} Livraison en France métropolitaine. TVA non applicable, art. 293 B du CGI.</p>
      <button type="button" class="btn full" id="toDelivery">Passer à la livraison</button>`;
    $$("[data-line]", body).forEach((b) =>
      b.addEventListener("click", () => {
        const line = cart[Number(b.dataset.line)];
        line.qty = Math.min(isGiftLine(line) ? 5 : MAX_QTY, line.qty + Number(b.dataset.delta));
        if (line.qty <= 0) cart.splice(Number(b.dataset.line), 1);
        cartChanged();
        renderCart();
      }),
    );
    $("#toDelivery").addEventListener("click", () => {
      step = "delivery";
      prefillFromAccount();
      renderCart();
    });
  }

  function prefillFromAccount() {
    if (!me) return;
    if (!form.name && me.name) form.name = me.name;
    if (!form.email && me.email) form.email = me.email;
    if (!form.phone && me.phone) form.phone = me.phone;
  }

  function quoteIsUsable() {
    if (!hasPhysical()) return true;
    return quote.state === "ok" && quote.address === form.address.trim() && ["free_zone", "outside_zone", "geocoder_unavailable"].includes(quote.zone);
  }

  function renderDeliveryStep() {
    const body = $("#cartBody");
    const physical = hasPhysical();
    const savedSelect =
      physical && me && savedAddresses && savedAddresses.length
        ? `<div class="field"><label for="savedAddress">Mes adresses</label><select id="savedAddress"><option value="">Choisir une adresse enregistrée…</option>${savedAddresses
            .map((a) => `<option value="${a.id}">${esc(a.label || "Adresse")} · ${esc(a.address)}</option>`)
            .join("")}</select></div>`
        : "";
    body.innerHTML = `
      ${me ? "" : `<p class="hint">Tu commandes sans compte. Tu pourras retrouver cette commande plus tard en te connectant avec Google, avec la même adresse e-mail.</p>`}
      <form id="deliveryForm" class="stack" novalidate>
        <div class="field"><label for="f-name">Nom et prénom</label><input id="f-name" autocomplete="name" maxlength="120" required value="${esc(form.name)}"></div>
        <div class="field"><label for="f-email">E-mail</label><input id="f-email" type="email" autocomplete="email" maxlength="200" required value="${esc(form.email)}"></div>
        ${
          physical
            ? `<div class="field"><label for="f-phone">Téléphone</label><input id="f-phone" type="tel" autocomplete="tel" maxlength="40" required value="${esc(form.phone)}"></div>
        ${savedSelect}
        <div class="field"><label for="f-address">Adresse de livraison</label><input id="f-address" autocomplete="street-address" maxlength="500" required placeholder="12 rue Picot, 83000 Toulon" value="${esc(form.address)}">
          <p class="hint">Numéro, rue, code postal et ville. Le code postal sert à calculer la livraison.</p></div>
        ${me ? `<label class="check"><input type="checkbox" id="f-save" ${form.saveAddress ? "checked" : ""}> Enregistrer cette adresse dans mon compte</label>` : ""}
        <div id="quoteBox" aria-live="polite"></div>
        <label class="check"><input type="checkbox" id="f-gift" ${form.gift ? "checked" : ""}><span>🎁 C'est un cadeau : on glisse un mot écrit à la main dans le colis.</span></label>
        <div class="field" id="giftMsgField" ${form.gift ? "" : "hidden"}><label for="f-giftmsg">Ton mot (facultatif)</label><textarea id="f-giftmsg" rows="2" maxlength="300" placeholder="Joyeux anniversaire ! De la part de…">${esc(form.giftMessage)}</textarea></div>`
            : `<p class="notice">La carte cadeau est envoyée par e-mail juste après le paiement : pas de livraison, pas de frais.</p>`
        }
        <div class="field promo-field"><label for="f-promo">Code promo ou carte cadeau</label>
          <div class="promo-row"><input id="f-promo" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="30" placeholder="Ex. BIENVENUE10" value="${esc(promo.input)}"><button type="button" class="btn out" id="applyPromo">Appliquer</button></div>
          <div id="promoBox" aria-live="polite"></div></div>
        <label class="check"><input type="checkbox" id="f-cgv" ${form.acceptCgv ? "checked" : ""}><span>J'accepte les <a class="link" href="cgv.html" target="_blank" rel="noopener">conditions générales de vente</a> et j'ai lu la <a class="link" href="confidentialite.html" target="_blank" rel="noopener">politique de confidentialité</a>.</span></label>
        <p class="notice err" id="deliveryError" hidden></p>
      </form>`;

    const bind = (id, key) =>
      $(id)?.addEventListener("input", (e) => {
        form[key] = e.target.value;
        if (key === "address") scheduleQuote();
        if (key === "email" && promo.state !== "idle") resetPromo(true);
        renderDeliveryFoot();
      });
    bind("#f-name", "name");
    bind("#f-email", "email");
    bind("#f-phone", "phone");
    bind("#f-address", "address");
    $("#f-giftmsg")?.addEventListener("input", (e) => (form.giftMessage = e.target.value));
    $("#f-gift")?.addEventListener("change", (e) => {
      form.gift = e.target.checked;
      $("#giftMsgField").hidden = !form.gift;
    });
    $("#f-save")?.addEventListener("change", (e) => (form.saveAddress = e.target.checked));
    $("#f-cgv").addEventListener("change", (e) => {
      form.acceptCgv = e.target.checked;
      renderDeliveryFoot();
    });
    $("#f-promo").addEventListener("input", (e) => {
      promo.input = e.target.value;
      if (promo.state !== "idle") resetPromo(false);
    });
    $("#f-promo").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyPromo();
      }
    });
    $("#applyPromo").addEventListener("click", applyPromo);
    $("#savedAddress")?.addEventListener("change", (e) => {
      const a = savedAddresses.find((x) => String(x.id) === e.target.value);
      if (!a) return;
      form.address = a.address;
      if (a.recipientName) form.name = a.recipientName;
      if (a.phone) form.phone = a.phone;
      form.saveAddress = false;
      renderDeliveryStep();
      requestQuote();
    });
    $("#deliveryForm").addEventListener("submit", (e) => {
      e.preventDefault();
      submitOrder();
    });
    renderQuote();
    renderPromo();
    renderDeliveryFoot();
    if (physical && form.address.trim().length >= 5 && quote.address !== form.address.trim()) requestQuote();
  }

  function resetPromo(keepInput) {
    Object.assign(promo, { state: "idle", code: null, kind: null, percent: 0, balanceCents: 0, message: "" });
    if (!keepInput) promo.input = $("#f-promo")?.value ?? promo.input;
    renderPromo();
    renderDeliveryFoot();
  }

  async function applyPromo() {
    const code = (promo.input || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!code) {
      resetPromo(true);
      return;
    }
    promo.state = "loading";
    renderPromo();
    const { ok, data } = await api("/api/promo-check", { method: "POST", body: { code, email: form.email.trim() } });
    if (ok && data.ok) Object.assign(promo, { state: "ok", code: data.code, kind: data.kind, percent: data.percent || 0, balanceCents: data.balanceCents || 0, message: "" });
    else Object.assign(promo, { state: "error", code: null, kind: null, message: data.error || "Code invalide." });
    renderPromo();
    renderDeliveryFoot();
  }

  function renderPromo() {
    const box = $("#promoBox");
    if (!box) return;
    if (promo.state === "loading") box.innerHTML = `<p class="hint">Vérification du code…</p>`;
    else if (promo.state === "error") box.innerHTML = `<p class="notice err">${esc(promo.message)}</p>`;
    else if (promo.state === "ok") {
      const pr = pricePreview(quoteIsUsable() ? quote.feeCents : null);
      if (promo.kind === "gift") box.innerHTML = `<p class="notice ok">Carte cadeau ${esc(promo.code)} : ${euros(promo.balanceCents)} disponibles.</p>`;
      else if (pr.codeBeaten) box.innerHTML = `<p class="notice warn">Le pack est plus avantageux que ton code : c'est lui qui s'applique. Garde ton code pour une prochaine commande.</p>`;
      else if (!pr.count) box.innerHTML = `<p class="notice warn">Ce code s'applique aux t-shirts uniquement.</p>`;
      else box.innerHTML = `<p class="notice ok">Code ${esc(promo.code)} appliqué : -${promo.percent} % sur tes t-shirts.</p>`;
    } else box.innerHTML = "";
  }

  function renderQuote() {
    const box = $("#quoteBox");
    if (!box) return;
    const free = freeShippingFor(tshirtCount());
    if (quote.state === "loading") box.innerHTML = `<p class="notice">Calcul des frais de livraison…</p>`;
    else if (quote.state === "ok" && free && quote.zone !== "geocoder_unavailable") box.innerHTML = `<p class="notice ok">Livraison offerte avec ton pack de ${tshirtCount()} t-shirts 🎉</p>`;
    else if (quote.state === "ok") {
      const tone = quote.zone === "geocoder_unavailable" ? "warn" : "ok";
      box.innerHTML = `<p class="notice ${tone}">${esc(quote.message)}</p>`;
    } else if (quote.state === "error") box.innerHTML = `<p class="notice err">${esc(quote.message)}</p>`;
    else box.innerHTML = "";
  }

  function renderDeliveryFoot() {
    const foot = $("#cartFoot");
    const physical = hasPhysical();
    const usable = quoteIsUsable();
    const pr = pricePreview(usable && physical ? quote.feeCents : physical ? null : 0);
    const ready =
      usable &&
      form.acceptCgv &&
      promo.state !== "loading" &&
      form.name.trim() &&
      /^\S+@\S+\.\S+$/.test(form.email.trim()) &&
      (!physical || form.phone.trim().length >= 6);
    foot.innerHTML = `${priceRows(pr, { estimate: true })}
      <div class="actions"><button type="button" class="btn out" id="backToCart">Retour</button><button type="submit" form="deliveryForm" class="btn" id="submitOrder" ${ready ? "" : "disabled"}>Valider la commande</button></div>`;
    $("#backToCart").addEventListener("click", () => {
      step = "cart";
      renderCart();
    });
    if (promo.state === "ok") {
      const box = $("#promoBox");
      if (box) renderPromo();
    }
  }

  let quoteTimer = null;
  let quoteSeq = 0;
  function scheduleQuote() {
    clearTimeout(quoteTimer);
    quote.state = "idle";
    renderQuote();
    quoteTimer = setTimeout(requestQuote, 700);
  }
  async function requestQuote() {
    const address = form.address.trim();
    if (address.length < 5) {
      quote.state = "idle";
      renderQuote();
      return;
    }
    const seq = ++quoteSeq;
    quote.state = "loading";
    renderQuote();
    const { ok, data } = await api("/api/shipping-quote", { method: "POST", body: { address } });
    if (seq !== quoteSeq) return;
    if (!ok) {
      Object.assign(quote, { state: "error", address, zone: null, feeCents: 0, message: data.error || "Impossible de calculer la livraison." });
    } else if (!["free_zone", "outside_zone", "geocoder_unavailable"].includes(data.zone)) {
      Object.assign(quote, { state: "error", address, zone: data.zone, feeCents: 0, message: data.message });
    } else {
      Object.assign(quote, { state: "ok", address, zone: data.zone, feeCents: Number(data.feeCents) || 0, message: data.message });
    }
    renderQuote();
    renderDeliveryFoot();
  }

  async function submitOrder() {
    const errorBox = $("#deliveryError");
    const button = $("#submitOrder");
    errorBox.hidden = true;
    if (!quoteIsUsable() || !form.acceptCgv) return;
    if (promo.state === "error" && promo.input.trim()) {
      errorBox.textContent = "Ton code n'est pas valide : corrige-le ou efface-le pour continuer.";
      errorBox.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = "Enregistrement…";
    const physical = hasPhysical();

    const checkoutToken = uuidV4();
    const saved = store.get(SRC_KEY, null);
    const source = saved && Date.now() - saved.t < 30 * 864e5 ? saved.v : "";
    const { ok, data } = await api("/api/orders", {
      method: "POST",
      body: {
        checkoutToken,
        customer: { name: form.name.trim(), email: form.email.trim(), phone: physical ? form.phone.trim() : form.phone.trim(), address: physical ? form.address.trim() : "" },
        items: cart.map((l) =>
          isGiftLine(l)
            ? { sku: l.sku, size: l.size, quantity: l.qty, giftCard: l.gift || {} }
            : { sku: l.sku, size: l.size, color: bySku.get(l.sku).color, quantity: l.qty },
        ),
        promoCode: promo.state === "ok" ? promo.code : "",
        gift: physical && form.gift,
        giftMessage: physical && form.gift ? form.giftMessage.trim() : "",
        source,
      },
    });

    if (!ok || !data.orderNumber) {
      if (data.field === "promoCode") {
        Object.assign(promo, { state: "error", code: null, kind: null, message: data.error || "Code invalide." });
        renderPromo();
      }
      errorBox.textContent = data.error || "Impossible d'enregistrer la commande pour le moment.";
      errorBox.hidden = false;
      button.disabled = false;
      button.textContent = "Valider la commande";
      return;
    }

    pending = {
      orderNumber: data.orderNumber,
      token: checkoutToken,
      subtotalCents: data.subtotalCents,
      shippingCents: data.shippingCents,
      discountCents: data.discountCents || 0,
      discountLabel: data.discountLabel || "",
      giftCardCents: data.giftCardCents || 0,
      giftCardCode: data.giftCardCode || "",
      totalCents: data.totalCents,
      deliveryMessage: data.delivery?.message || "",
      address: physical ? form.address.trim() : "",
      name: form.name.trim(),
      lines: cart.map((l) => ({ ...l })),
      paid: false,
    };
    store.set(PENDING_KEY, pending);

    if (me && physical && form.saveAddress) {
      const savedAddr = await api("/api/account-addresses", {
        method: "POST",
        body: { recipientName: form.name.trim(), address: form.address.trim(), phone: form.phone.trim() },
      });
      if (savedAddr.ok) savedAddresses = null;
      form.saveAddress = false;
    }
    resetPromo(true);
    promo.input = "";

    // Entièrement réglée par carte cadeau : déjà payée, rien à payer sur SumUp.
    if (data.paid) {
      checkPaymentStatus(pending.orderNumber);
      return;
    }
    step = "payment";
    renderCart();
  }

  function renderPaymentStep() {
    const body = $("#cartBody");
    const foot = $("#cartFoot");
    if (!pending) {
      step = "cart";
      renderCart();
      return;
    }
    const physical = hasPhysical(pending.lines);
    body.innerHTML = `
      <div class="card">
        <div class="card-head"><span class="up">Commande</span><b>${esc(pending.orderNumber)}</b></div>
        <ul class="items">${pending.lines
          .map((l) => {
            if (isGiftLine(l)) return `<li>${l.qty} × Carte cadeau ${esc(l.size)} €${l.gift?.toEmail ? ` · pour ${esc(l.gift.toEmail)}` : ""}</li>`;
            const p = bySku.get(l.sku);
            return `<li>${l.qty} × ${esc(p ? p.name : l.sku)} · ${esc(p ? p.color : "")} · ${esc(l.size)}</li>`;
          })
          .join("")}</ul>
      </div>
      ${physical ? `<div class="card"><span class="up">Livraison à</span><p>${esc(pending.name)}<br>${esc(pending.address)}</p>${pending.deliveryMessage ? `<p class="hint">${esc(pending.deliveryMessage)}</p>` : ""}</div>` : `<div class="card"><span class="up">Carte cadeau</span><p>Envoyée par e-mail juste après le paiement.</p></div>`}
      <p class="hint">Montant calculé par notre serveur. Le paiement se fait sur la page sécurisée de SumUp ; ta commande sera confirmée dès que SumUp nous aura confirmé le paiement.</p>
      <p class="notice err" id="payError" hidden></p>`;
    foot.innerHTML = `<div class="row"><span>Sous-total</span><span>${euros(pending.subtotalCents)}</span></div>
      ${pending.discountCents ? `<div class="row save"><span>${esc(pending.discountLabel || "Remise")}</span><span>-${euros(pending.discountCents)}</span></div>` : ""}
      <div class="row"><span>Livraison</span><span>${pending.shippingCents ? euros(pending.shippingCents) : physical ? "Offerte" : "Par e-mail"}</span></div>
      ${pending.giftCardCents ? `<div class="row save"><span>Carte cadeau ${esc(pending.giftCardCode)}</span><span>-${euros(pending.giftCardCents)}</span></div>` : ""}
      <div class="row total"><span>Total</span><span>${euros(pending.totalCents)}</span></div>
      <button type="button" class="btn full" id="payButton">Payer ${euros(pending.totalCents)} par carte</button>
      <button type="button" class="btn out full" id="alreadyPaid">J'ai déjà payé : vérifier le paiement</button>
      <button type="button" class="link" id="editOrder">Modifier le panier ou l'adresse</button>`;
    $("#alreadyPaid").addEventListener("click", () => checkPaymentStatus(pending.orderNumber));
    $("#payButton").addEventListener("click", startPayment);
    $("#editOrder").addEventListener("click", () => {
      // Une nouvelle commande sera créée : l'ancienne reste non payée.
      pending = null;
      store.remove(PENDING_KEY);
      step = "cart";
      renderCart();
    });
  }

  async function startPayment() {
    const button = $("#payButton");
    const errorBox = $("#payError");
    if (!pending) return;
    if (button) {
      button.disabled = true;
      button.textContent = "Ouverture du paiement sécurisé…";
    }
    if (errorBox) errorBox.hidden = true;
    const { ok, status, data } = await api("/api/sumup-checkout", { method: "POST", body: { orderNumber: pending.orderNumber } });
    if (ok && data.checkoutUrl && isHttps(data.checkoutUrl)) {
      window.location.assign(data.checkoutUrl);
      return;
    }
    if (status === 409) {
      checkPaymentStatus(pending.orderNumber);
      return;
    }
    if (errorBox) {
      errorBox.textContent = data.error || "Le paiement par carte est momentanément indisponible.";
      errorBox.hidden = false;
    }
    if (button) {
      button.disabled = false;
      button.textContent = `Réessayer le paiement · ${euros(pending.totalCents)}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Retour de SumUp : on affiche uniquement ce que le serveur confirme.
  // ---------------------------------------------------------------------------
  let pollTimer = null;
  async function checkPaymentStatus(orderNumber, attempt = 0) {
    step = "status";
    renderCart();
    setSteps(null);
    const body = $("#cartBody");
    const foot = $("#cartFoot");
    clearTimeout(pollTimer);

    if (!pending || pending.orderNumber !== orderNumber) {
      body.innerHTML = `<div class="empty"><h4>Commande ${esc(orderNumber)}</h4><p class="muted">Si ton paiement a abouti, tu reçois un e-mail de confirmation. Tu peux aussi retrouver tes commandes en te connectant avec Google.</p></div>`;
      foot.innerHTML = `<button type="button" class="btn full" data-open-account>Mon compte</button>`;
      return;
    }

    body.innerHTML = `<div class="empty"><h4>Vérification du paiement…</h4><p class="muted">On attend la confirmation de SumUp pour la commande ${esc(orderNumber)}.</p></div>`;
    foot.innerHTML = "";
    const { ok, status, data } = await api(`/api/order-status?order=${encodeURIComponent(orderNumber)}&token=${encodeURIComponent(pending.token)}`);

    if (ok && data.paymentStatus === "paid") {
      pending.paid = true;
      cart = [];
      saveCart();
      store.remove(PENDING_KEY);
      body.innerHTML = `<div class="empty"><h4>Merci, commande confirmée</h4><p>Ton paiement de <b>${euros(data.totalCents)}</b> est confirmé pour la commande <b>${esc(orderNumber)}</b>.</p><p class="muted">Un e-mail de confirmation t'est envoyé. ${hasPhysical(pending.lines || []) ? "On t'écrit à nouveau avec le numéro de suivi dès l'expédition." : "La carte cadeau part par e-mail tout de suite."}</p></div>`;
      foot.innerHTML = `<button type="button" class="btn full" data-close>Continuer</button>`;
      pending = null;
      return;
    }
    if (ok && data.status === "cancelled") {
      store.remove(PENDING_KEY);
      pending = null;
      body.innerHTML = `<div class="empty"><h4>Commande annulée</h4><p class="muted">Cette commande a été annulée. Écris-nous sur WhatsApp si tu as une question.</p></div>`;
      foot.innerHTML = `<button type="button" class="btn full" data-close>Fermer</button>`;
      return;
    }
    if (attempt < 5) {
      pollTimer = setTimeout(() => checkPaymentStatus(orderNumber, attempt + 1), 3000);
      return;
    }
    body.innerHTML = `<div class="empty"><h4>Paiement pas encore confirmé</h4><p class="muted">SumUp ne nous a pas encore confirmé le paiement de la commande ${esc(orderNumber)}. Si tu as payé, la confirmation arrive en général en quelques instants et tu recevras un e-mail. Sinon, tu peux reprendre le paiement.</p>${ok && data.debug ? `<p class="hint">Diagnostic (préversion) : ${esc(data.debug)}</p>` : !ok ? `<p class="hint">Diagnostic (préversion) : statut indisponible (${esc(String(status))}${data.debug ? ` · ${esc(data.debug)}` : ""})</p>` : ""}<p class="notice err" id="payError" hidden></p></div>`;
    foot.innerHTML = `<button type="button" class="btn full" id="recheck">Vérifier à nouveau</button>
      <button type="button" class="btn out full" id="payButton">Reprendre le paiement · ${euros(pending.totalCents)}</button>`;
    $("#recheck").addEventListener("click", () => checkPaymentStatus(orderNumber, 0));
    $("#payButton").addEventListener("click", startPayment);
  }

  // ---------------------------------------------------------------------------
  // Compte client
  // ---------------------------------------------------------------------------
  let acctTab = "orders";
  async function loadMe() {
    const { ok, data } = await api("/.netlify/functions/me");
    me = ok && data.authenticated ? data.user : null;
    renderAccountButton();
    return me;
  }
  function renderAccountButton() {
    const label = $("#accountLabel");
    const icon = $("#accountIcon");
    if (me) {
      label.textContent = (me.name || me.email || "Compte").split(" ")[0];
      if (isHttps(me.avatarUrl)) {
        icon.innerHTML = `<img class="avatar" src="${esc(me.avatarUrl)}" alt="" referrerpolicy="no-referrer">`;
      }
    } else {
      label.textContent = "Compte";
    }
  }

  function openAccount(tab) {
    if (tab) acctTab = tab;
    openDrawer("accountDrawer");
    renderAccount();
  }
  $("#accountOpen").addEventListener("click", () => openAccount());
  $$("#accountTabs [data-acct]").forEach((b) =>
    b.addEventListener("click", () => {
      acctTab = b.dataset.acct;
      renderAccount();
    }),
  );

  function renderAccount() {
    const body = $("#accountBody");
    const tabs = $("#accountTabs");
    if (!me) {
      tabs.hidden = true;
      body.innerHTML = `
        <div class="empty">
          <h4>Connecte-toi</h4>
          <p class="muted">Retrouve tes commandes, ton suivi Colissimo et tes adresses enregistrées.</p>
          ${/Instagram|FBAN|FBAV|FB_IAB|TikTok|Snapchat|Line\//i.test(navigator.userAgent) ? `<p class="notice warn">Google ne permet pas de se connecter depuis le navigateur d'Instagram. Touche ••• puis « Ouvrir dans le navigateur » (Safari), et connecte-toi depuis là.</p>` : ""}
          <a class="google" href="/.netlify/functions/auth-google">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"/></svg>
            Continuer avec Google
          </a>
          <p class="hint">Pas besoin de compte pour commander. Si tu te connectes plus tard avec la même adresse e-mail, tes commandes apparaissent automatiquement.</p>
          <p class="hint"><a class="link" href="confidentialite.html">Comment tes données sont utilisées</a></p>
        </div>`;
      return;
    }
    tabs.hidden = false;
    $$("#accountTabs [data-acct]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.acct === acctTab)));
    if (acctTab === "orders") renderOrders();
    else if (acctTab === "addresses") renderAddresses();
    else renderInfo();
  }

  function sessionExpired() {
    me = null;
    renderAccountButton();
    renderAccount();
    toast("Ta session a expiré. Reconnecte-toi.", true);
  }

  async function renderOrders() {
    const body = $("#accountBody");
    body.innerHTML = `<p class="muted">Chargement de tes commandes…</p>`;
    const { ok, status, data } = await api("/api/account-orders");
    if (acctTab !== "orders") return;
    if (status === 401) return sessionExpired();
    if (!ok) {
      body.innerHTML = `<p class="notice err">${esc(data.error || "Impossible de récupérer tes commandes.")}</p>`;
      return;
    }
    const orders = Array.isArray(data.orders) ? data.orders : [];
    if (!orders.length) {
      body.innerHTML = `<div class="empty"><h4>Vous n'avez pas encore de commande.</h4><a class="btn" href="#produits" data-close>Voir la collection</a></div>`;
      return;
    }
    body.innerHTML = orders
      .map((o) => {
        const items = (Array.isArray(o.items) ? o.items : [])
          .map((it) => `<li>${Number(it.quantity)} × ${esc(it.name)} · ${esc(it.color)} · ${esc(it.size)}${it.giftCard ? " €" : ""} <span class="muted">· ${euros(Number(it.lineTotalCents) || 0)}</span></li>`)
          .join("");
        const tracking = o.trackingNumber && ["shipped", "delivered"].includes(o.status)
          ? `<div class="notice"><b>Commande expédiée</b><span>Transporteur : ${esc(o.carrier || "—")}</span><span>Numéro de suivi : ${esc(o.trackingNumber)}</span>${
              isHttps(o.trackingUrl) ? `<a class="btn" href="${esc(o.trackingUrl)}" target="_blank" rel="noopener">Suivre mon colis</a>` : ""
            }</div>`
          : "";
        return `<article class="card">
          <div class="card-head"><b>${esc(o.orderNumber)}</b><span class="muted">${esc(formatDate(o.createdAt))}</span></div>
          <div class="actions">${pill(STATUS, o.status)}${pill(PAYMENT, o.paymentStatus)}</div>
          <ul class="items">${items}</ul>
          <div class="row"><span>Sous-total</span><span>${euros(o.subtotalCents)}</span></div>
          ${o.discountCents ? `<div class="row save"><span>${esc(o.discountLabel || "Remise")}</span><span>-${euros(o.discountCents)}</span></div>` : ""}
          <div class="row"><span>Livraison</span><span>${o.shippingCents ? euros(o.shippingCents) : "Offerte"}</span></div>
          ${o.giftCardCents ? `<div class="row save"><span>Carte cadeau ${esc(o.giftCardCode || "")}</span><span>-${euros(o.giftCardCents)}</span></div>` : ""}
          <div class="row total"><span>Total</span><span>${euros(o.totalCents)}</span></div>
          ${tracking}
          ${["shipped", "delivered"].includes(o.status) ? `<button type="button" class="btn out full" data-review-order="${esc(o.orderNumber)}">Donner mon avis</button>` : ""}
        </article>`;
      })
      .join("");
  }

  async function fetchAddresses() {
    const { ok, status, data } = await api("/api/account-addresses");
    if (status === 401) return null;
    savedAddresses = ok && Array.isArray(data.addresses) ? data.addresses : [];
    return savedAddresses;
  }

  let editingAddress = null; // null = liste, "new" = ajout, id = modification
  let confirmDelete = null;
  async function renderAddresses() {
    const body = $("#accountBody");
    if (savedAddresses === null) {
      body.innerHTML = `<p class="muted">Chargement de tes adresses…</p>`;
      const list = await fetchAddresses();
      if (acctTab !== "addresses") return;
      if (list === null) return sessionExpired();
    }

    if (editingAddress !== null) {
      const a = editingAddress === "new" ? { label: "Maison", recipientName: me.name || "", address: "", phone: me.phone || "", isDefault: false } : savedAddresses.find((x) => x.id === editingAddress);
      if (!a) {
        editingAddress = null;
        return renderAddresses();
      }
      body.innerHTML = `<form id="addrForm" class="stack" novalidate>
        <h4>${editingAddress === "new" ? "Nouvelle adresse" : "Modifier l'adresse"}</h4>
        <div class="field"><label for="a-label">Nom de l'adresse</label><input id="a-label" maxlength="40" value="${esc(a.label || "")}" placeholder="Maison, Travail…"></div>
        <div class="field"><label for="a-name">Destinataire</label><input id="a-name" maxlength="120" required autocomplete="name" value="${esc(a.recipientName)}"></div>
        <div class="field"><label for="a-address">Adresse</label><input id="a-address" maxlength="500" required autocomplete="street-address" placeholder="12 rue Picot, 83000 Toulon" value="${esc(a.address)}"></div>
        <div class="field"><label for="a-phone">Téléphone</label><input id="a-phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(a.phone || "")}"></div>
        <label class="check"><input type="checkbox" id="a-default" ${a.isDefault ? "checked" : ""}> Adresse par défaut</label>
        <p class="notice err" id="addrError" hidden></p>
        <div class="actions"><button type="button" class="btn out" id="addrCancel">Annuler</button><button type="submit" class="btn">Enregistrer</button></div>
      </form>`;
      $("#addrCancel").addEventListener("click", () => {
        editingAddress = null;
        renderAddresses();
      });
      $("#addrForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          label: $("#a-label").value.trim(),
          recipientName: $("#a-name").value.trim(),
          address: $("#a-address").value.trim(),
          phone: $("#a-phone").value.trim(),
          isDefault: $("#a-default").checked,
        };
        const err = $("#addrError");
        if (!payload.recipientName || !payload.address) {
          err.textContent = "Le destinataire et l'adresse sont obligatoires.";
          err.hidden = false;
          return;
        }
        const res =
          editingAddress === "new"
            ? await api("/api/account-addresses", { method: "POST", body: payload })
            : await api("/api/account-addresses", { method: "PUT", body: { ...payload, id: editingAddress } });
        if (res.status === 401) return sessionExpired();
        if (!res.ok) {
          err.textContent = res.data.error || "Impossible d'enregistrer cette adresse.";
          err.hidden = false;
          return;
        }
        editingAddress = null;
        savedAddresses = null;
        toast("Adresse enregistrée");
        renderAddresses();
      });
      return;
    }

    const list = savedAddresses
      .map(
        (a) => `<article class="card">
          <div class="card-head"><b>${esc(a.label || "Adresse")}</b>${a.isDefault ? '<span class="pill ok">Par défaut</span>' : ""}</div>
          <p>${esc(a.recipientName)}<br>${esc(a.address)}${a.phone ? `<br>${esc(a.phone)}` : ""}</p>
          <div class="actions">
            <button type="button" class="btn out" data-addr-edit="${a.id}">Modifier</button>
            ${a.isDefault ? "" : `<button type="button" class="btn out" data-addr-default="${a.id}">Par défaut</button>`}
            <button type="button" class="btn out danger" data-addr-delete="${a.id}">${confirmDelete === a.id ? "Confirmer la suppression" : "Supprimer"}</button>
          </div>
        </article>`,
      )
      .join("");
    body.innerHTML = `${list || `<p class="muted">Aucune adresse enregistrée pour l'instant.</p>`}<button type="button" class="btn full" id="addrNew">Ajouter une adresse</button>`;
    $("#addrNew").addEventListener("click", () => {
      editingAddress = "new";
      renderAddresses();
    });
    $$("[data-addr-edit]", body).forEach((b) =>
      b.addEventListener("click", () => {
        editingAddress = Number(b.dataset.addrEdit);
        renderAddresses();
      }),
    );
    $$("[data-addr-default]", body).forEach((b) =>
      b.addEventListener("click", async () => {
        const a = savedAddresses.find((x) => x.id === Number(b.dataset.addrDefault));
        const res = await api("/api/account-addresses", { method: "PUT", body: { id: a.id, isDefault: true } });
        if (res.status === 401) return sessionExpired();
        if (!res.ok) return toast(res.data.error || "Modification impossible.", true);
        savedAddresses = null;
        renderAddresses();
      }),
    );
    $$("[data-addr-delete]", body).forEach((b) =>
      b.addEventListener("click", async () => {
        const id = Number(b.dataset.addrDelete);
        if (confirmDelete !== id) {
          confirmDelete = id;
          return renderAddresses();
        }
        confirmDelete = null;
        const res = await api(`/api/account-addresses?id=${id}`, { method: "DELETE" });
        if (res.status === 401) return sessionExpired();
        if (!res.ok) return toast(res.data.error || "Suppression impossible.", true);
        savedAddresses = null;
        toast("Adresse supprimée");
        renderAddresses();
      }),
    );
  }

  function renderInfo() {
    const body = $("#accountBody");
    body.innerHTML = `
      <div class="who">${isHttps(me.avatarUrl) ? `<img src="${esc(me.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : ""}<div><b>${esc(me.name || "")}</b><div class="muted">${esc(me.email)}</div></div></div>
      <form id="infoForm" class="stack" novalidate>
        <div class="field"><label for="i-name">Prénom et nom</label><input id="i-name" maxlength="120" autocomplete="name" required value="${esc(me.name || "")}"></div>
        <div class="field"><label for="i-phone">Téléphone</label><input id="i-phone" type="tel" maxlength="40" autocomplete="tel" value="${esc(me.phone || "")}"></div>
        <div class="field"><label for="i-email">E-mail (compte Google)</label><input id="i-email" value="${esc(me.email)}" readonly></div>
        <p class="hint">L'e-mail est celui de ton compte Google : c'est ton identifiant, il n'est pas modifiable ici.</p>
        <p class="notice err" id="infoError" hidden></p>
        <button type="submit" class="btn">Enregistrer</button>
      </form>
      <button type="button" class="btn out full" id="logout">Se déconnecter</button>`;
    $("#infoForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#infoError");
      const name = $("#i-name").value.trim();
      if (!name) {
        err.textContent = "Le nom est obligatoire.";
        err.hidden = false;
        return;
      }
      const res = await api("/api/account-profile", { method: "PUT", body: { name, phone: $("#i-phone").value.trim() } });
      if (res.status === 401) return sessionExpired();
      if (!res.ok) {
        err.textContent = res.data.error || "Impossible d'enregistrer tes informations.";
        err.hidden = false;
        return;
      }
      me = { ...me, ...res.data.user };
      renderAccountButton();
      toast("Informations enregistrées");
      renderInfo();
    });
    $("#logout").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      me = null;
      savedAddresses = null;
      renderAccountButton();
      renderAccount();
      toast("Tu es déconnecté");
    });
  }

  // ---------------------------------------------------------------------------
  // Réglages boutique (admin) : bandeau, pack, livraison offerte, fenêtre -10 %
  // ---------------------------------------------------------------------------
  async function loadShopSettings() {
    try {
      const r = await fetch("/api/shop-settings");
      if (r.ok) {
        const d = await r.json();
        shop = {
          banner: typeof d.banner === "string" ? d.banner : null,
          pack: { twoPercent: Number(d.pack?.twoPercent) || 0, threePercent: Number(d.pack?.threePercent) || 0 },
          freeShippingMin: Number(d.freeShippingMin) || 0,
          popup: { active: Boolean(d.popup?.active), percent: Number(d.popup?.percent) || 0 },
          giftCardAmounts: Array.isArray(d.giftCardAmounts) && d.giftCardAmounts.length ? d.giftCardAmounts.map(Number) : shop.giftCardAmounts,
        };
      }
    } catch {
      /* réglages par défaut */
    }
    const bar = $("#annonce");
    if (bar && shop.banner !== null) {
      bar.hidden = !shop.banner;
      if (shop.banner) $("#annonceText").textContent = shop.banner;
    }
    $$("[data-pack-percent]").forEach((el) => (el.textContent = shop.pack.twoPercent ? `-${shop.pack.twoPercent} %` : ""));
    if (sheet.product) renderProduct();
    if (!$("#cartDrawer").hidden && step !== "status") renderCart();
    schedulePopup();
  }

  // Fenêtre « -10 % sur ta première commande » : une seule fois par visiteur,
  // après 8 secondes ou la moitié de la page, jamais pendant une commande.
  const POP_KEY = "fork-pop-seen";
  function schedulePopup() {
    const box = $("#promoPop");
    if (!box || !shop.popup.active || !shop.popup.percent) return;
    if (store.get(POP_KEY, null) || store.get("fork-subscribed", null)) return;
    if (urlSrc === "email-bienvenue" || new URLSearchParams(location.search).has("payment")) return;
    let fired = false;
    const fire = () => {
      if (fired) return;
      if (document.body.classList.contains("locked") || pending) {
        setTimeout(fire, 6000);
        return;
      }
      fired = true;
      window.removeEventListener("scroll", onScroll);
      showPopup();
    };
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max > 0 && scrollY / max >= 0.5) fire();
    };
    setTimeout(fire, 8000);
    window.addEventListener("scroll", onScroll, { passive: true });
  }
  function showPopup() {
    const box = $("#promoPop");
    store.set(POP_KEY, Date.now());
    box.innerHTML = `<button type="button" class="x" data-pop-close aria-label="Fermer">✕</button>
      <p class="up">Bienvenue chez FORK</p>
      <h3 id="promoTitle">-${shop.popup.percent} % sur ta première commande</h3>
      <p class="muted">Et les sorties FORK en avant-première.</p>
      <form id="popForm" novalidate>
        <label class="hp" aria-hidden="true">Ne pas remplir<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
        <input type="email" name="email" required maxlength="254" autocomplete="email" placeholder="Ton adresse e-mail" aria-label="Ton adresse e-mail">
        <label class="check"><input type="checkbox" name="consent" required><span>J'accepte de recevoir les e-mails de FORK (désinscription en un clic). <a class="link" href="confidentialite.html" target="_blank" rel="noopener">Confidentialité</a></span></label>
        <button type="submit" class="btn full">Je veux mes -${shop.popup.percent} %</button>
        <p class="pop-msg" aria-live="polite"></p>
      </form>`;
    box.hidden = false;
    box.querySelector("[data-pop-close]").addEventListener("click", () => (box.hidden = true));
    $("#popForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target;
      const msg = f.querySelector(".pop-msg");
      const email = f.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        msg.textContent = "Indique une adresse e-mail valide.";
        return;
      }
      if (!f.consent.checked) {
        msg.textContent = "Coche la case pour recevoir ton code par e-mail.";
        return;
      }
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      const { ok, data } = await api("/api/newsletter", { method: "POST", body: { email, consent: true, source: "popup", website: f.website.value } });
      btn.disabled = false;
      if (!ok) {
        msg.textContent = data.error || "Inscription impossible pour le moment.";
        return;
      }
      store.set("fork-subscribed", Date.now());
      box.innerHTML = `<button type="button" class="x" data-pop-close aria-label="Fermer">✕</button>
        <h3>C'est envoyé !</h3>
        <p>Ton code de -${shop.popup.percent} % t'attend dans ta boîte mail. Pense à regarder dans les spams.</p>
        <button type="button" class="btn full" data-pop-close>Voir la collection</button>`;
      $$("[data-pop-close]", box).forEach((b) =>
        b.addEventListener("click", () => {
          box.hidden = true;
          if (b.classList.contains("btn") && $("#produits")) $("#produits").scrollIntoView();
        }),
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Carte cadeau
  // ---------------------------------------------------------------------------
  const giftForm = { amount: null, toName: "", toEmail: "", message: "" };
  function openGiftCard() {
    if (!giftForm.amount) giftForm.amount = shop.giftCardAmounts[0];
    renderGiftCard();
    openDrawer("giftDrawer");
  }
  function renderGiftCard() {
    const body = $("#giftBody");
    const foot = $("#giftFoot");
    if (!body) return;
    body.innerHTML = `
      <img class="gift-visual" src="${GIFT_IMG}" alt="Carte cadeau FORK" width="600" height="360">
      <p>Le cadeau parfait pour un Toulonnais, même sans connaître sa taille. La carte est envoyée par e-mail juste après le paiement, valable 1 an, utilisable en une ou plusieurs fois.</p>
      <div class="field"><span class="up">Montant</span><div class="sizes">${shop.giftCardAmounts
        .map((a) => `<button type="button" class="size" data-gift-amount="${a}" aria-pressed="${giftForm.amount === a}">${a} €</button>`)
        .join("")}</div></div>
      <div class="field"><label for="g-name">Son prénom (facultatif)</label><input id="g-name" maxlength="60" value="${esc(giftForm.toName)}"></div>
      <div class="field"><label for="g-email">Son e-mail (facultatif)</label><input id="g-email" type="email" maxlength="200" value="${esc(giftForm.toEmail)}">
        <p class="hint">Vide : la carte t'est envoyée à toi, pour que tu la transfères ou l'imprimes.</p></div>
      <div class="field"><label for="g-msg">Ton petit mot (facultatif)</label><textarea id="g-msg" rows="3" maxlength="300">${esc(giftForm.message)}</textarea></div>
      <p class="notice err" id="giftError" hidden></p>`;
    foot.innerHTML = `<button type="button" class="btn full" id="giftAdd">Ajouter au panier · ${euros(giftForm.amount * 100)}</button>`;
    $$("[data-gift-amount]", body).forEach((b) =>
      b.addEventListener("click", () => {
        giftForm.amount = Number(b.dataset.giftAmount);
        renderGiftCard();
      }),
    );
    $("#g-name").addEventListener("input", (e) => (giftForm.toName = e.target.value));
    $("#g-email").addEventListener("input", (e) => (giftForm.toEmail = e.target.value));
    $("#g-msg").addEventListener("input", (e) => (giftForm.message = e.target.value));
    $("#giftAdd").addEventListener("click", () => {
      const toEmail = giftForm.toEmail.trim();
      if (toEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) {
        $("#giftError").textContent = "L'e-mail de la personne n'est pas valide (ou laisse-le vide).";
        $("#giftError").hidden = false;
        return;
      }
      addToCart(GIFT_SKU, String(giftForm.amount), 1, { toName: giftForm.toName.trim(), toEmail, message: giftForm.message.trim() });
      Object.assign(giftForm, { toName: "", toEmail: "", message: "" });
      toast("Carte cadeau ajoutée au panier");
      openCart();
    });
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-giftcard]")) {
      e.preventDefault();
      openGiftCard();
    }
  });

  // ---------------------------------------------------------------------------
  // Démarrage
  // ---------------------------------------------------------------------------
  function consumeUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const login = params.get("login");
    const payment = params.get("payment");
    const order = params.get("order");
    const reason = params.get("reason");
    const avis = params.get("avis");
    const newsletter = params.get("newsletter");
    if (login || payment || avis || newsletter) {
      const clean = new URL(window.location.href);
      ["login", "payment", "order", "reason", "avis", "newsletter"].forEach((k) => clean.searchParams.delete(k));
      history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
    }
    return { login, payment, order, reason, avis, newsletter };
  }

  async function start() {
    $("#year").textContent = String(new Date().getFullYear());
    saveCart();
    renderGrid();
    const { login, payment, order, reason, avis, newsletter } = consumeUrlParams();
    if (newsletter === "unsubscribed") toast("Tu es bien désinscrit. Tu ne recevras plus nos e-mails de nouvelles collections.");
    else if (newsletter === "invalid") toast("Lien de désinscription invalide ou déjà utilisé.", true);
    if (PAGE_PRODUCT && byId.has(PAGE_PRODUCT)) {
      sheet.product = byId.get(PAGE_PRODUCT);
      renderProduct();
    }
    if (urlSrc) store.set(SRC_KEY, { v: urlSrc, t: Date.now() });
    loadShopSettings();
    loadReviewSummary();
    loadStockInfo();
    await loadMe();
    if (me) fetchAddresses();
    let pendingReview = null;
    try {
      pendingReview = JSON.parse(sessionStorage.getItem(REVIEW_PENDING_KEY) || "null");
      sessionStorage.removeItem(REVIEW_PENDING_KEY);
    } catch {}

    if (payment === "sumup" && order) {
      openDrawer("cartDrawer");
      checkPaymentStatus(order.slice(0, 80));
    } else if (avis) {
      openReview(null, avis.slice(0, 80));
    } else if (login === "success" && pendingReview) {
      toast(me ? `Bienvenue ${(me.name || "").split(" ")[0]}` : "Connexion réussie");
      openReview(pendingReview.sku, pendingReview.orderNumber);
    } else if (login === "success") {
      toast(me ? `Bienvenue ${(me.name || "").split(" ")[0]}` : "Connexion réussie");
      openAccount("orders");
    } else if (login) {
      const messages = {
        cancelled: "Connexion Google annulée.",
        expired: "La connexion a expiré. Réessaie.",
        unverified: "Ton adresse Google n'est pas vérifiée.",
        failed: "La connexion Google a échoué. Réessaie.",
      };
      // « reason » n'est fourni que par les préversions, pour le diagnostic.
      toast(`${messages[login] || messages.failed}${reason ? ` (${reason.slice(0, 200)})` : ""}`, true);
    }
  }

  // Retour arrière (Safari/iPhone remet la page en cache) : on relance le bandeau défilant,
  // que le toucher sur le lien avait pu laisser figé.
  window.addEventListener("pageshow", () => {
    const track = $(".tick-track");
    if (!track) return;
    if (document.activeElement?.closest?.(".ticker")) document.activeElement.blur();
    track.style.animation = "none";
    void track.offsetWidth;
    track.style.animation = "";
  });

  // Calendrier des matchs : on masque les matchs passés (le lendemain du dernier jour).
  (() => {
    const list = $("#matches");
    if (!list) return;
    const today = new Date().toISOString().slice(0, 10);
    $$("li[data-until]", list).forEach((li) => {
      if (li.dataset.until < today) li.remove();
    });
    if (!list.children.length) {
      list.innerHTML = `<li><span class="m-opp">Le calendrier de la prochaine saison arrive bientôt.</span></li>`;
    }
  })();

  // ---------------------------------------------------------------------------
  // Vos moments : photos des clients avec leur t-shirt FORK
  // ---------------------------------------------------------------------------
  // Chaque photo est vérifiée par le serveur (IA) avant publication : t-shirt FORK
  // reconnu et photo correcte → en ligne ; doute → validée à la main par FORK ;
  // sinon refusée avec une explication.
  const moment = { photo: null, firstName: "", place: "", sku: "", email: "", consent: false, error: "", sending: false, done: null };
  let momentsNext = null;

  const momentCaption = (m) =>
    `<span>${m.byShop ? `<b class="by-fork">Par FORK</b>` : `<b>${esc(m.firstName)}</b>`}${m.place ? ` · ${esc(m.place)}` : ""}</span>${m.product ? `<a href="${esc(m.product.url)}">${esc(m.product.name)}</a>` : ""}`;

  function momentCard(m) {
    return `<figure class="moment">
      <button type="button" class="moment-open" data-moment-photo="${esc(m.photo)}" data-moment-cap="${m.byShop ? "Par FORK" : esc(m.firstName)}${m.place ? ` · ${esc(m.place)}` : ""}${m.product ? ` · ${esc(m.product.name)}` : ""}" aria-label="Agrandir la photo ${m.byShop ? "publiée par FORK" : `de ${esc(m.firstName)}`}">
        <img src="${esc(m.photo)}" alt="${m.byShop ? `Photo FORK${m.place ? ` : ${esc(m.place)}` : ""}` : `${esc(m.firstName)} avec son ${esc(m.product ? m.product.name : "t-shirt FORK")}${m.place ? `, ${esc(m.place)}` : ""}`}" loading="lazy">
      </button>
      <figcaption>${momentCaption(m)}</figcaption>
    </figure>`;
  }

  async function loadMoments(more = false) {
    const grid = $("#momentsGrid");
    if (!grid) return;
    const { ok, data } = await api(`/api/moments${more && momentsNext ? `?before=${momentsNext}` : ""}`);
    if (!ok) {
      if (!more) grid.innerHTML = "";
      return;
    }
    const items = Array.isArray(data.items) ? data.items : [];
    if (!more) {
      grid.innerHTML = items.length
        ? items.map(momentCard).join("")
        : `<div class="moments-empty"><p><b>Aucun moment pour l'instant.</b></p><p class="muted">Sois le premier à partager une photo avec ton t-shirt FORK !</p></div>`;
    } else {
      grid.insertAdjacentHTML("beforeend", items.map(momentCard).join(""));
    }
    momentsNext = data.next || null;
    $("#momentsMore").hidden = !momentsNext;
  }

  function saveMomentFields() {
    const v = (id) => $(`#${id}`)?.value ?? "";
    if (!$("#momentForm")) return;
    moment.firstName = v("m-first");
    moment.place = v("m-place");
    moment.sku = v("m-sku");
    moment.email = v("m-email");
    moment.consent = Boolean($("#m-consent")?.checked);
  }

  function renderMoment() {
    const body = $("#momentBody");
    if (moment.done) {
      body.innerHTML =
        moment.done === "published"
          ? `<div class="empty"><h4>Ta photo est en ligne ! 🎉</h4><p class="muted">Merci ${esc(moment.firstName)} ! On a bien reconnu ton t-shirt FORK : ta photo est maintenant dans « Vos moments ». Tu as aussi reçu un e-mail de confirmation.</p><button type="button" class="btn full" data-close>Voir les moments</button></div>`
          : `<div class="empty"><h4>Merci ${esc(moment.firstName)} !</h4><p class="muted">Ta photo est bien reçue. On la vérifie et elle sera en ligne très vite : tu recevras un e-mail dès qu'elle sera publiée.</p><button type="button" class="btn full" data-close>Fermer</button></div>`;
      return;
    }
    const options = PRODUCTS.filter((p) => p.type === "T-shirt")
      .map((p) => `<option value="${esc(p.sku)}" ${moment.sku === p.sku ? "selected" : ""}>${esc(p.type)} ${esc(p.name)}</option>`)
      .join("");
    body.innerHTML = `
      <p class="muted">Une photo de toi avec ton t-shirt FORK, où tu veux. On vérifie que le t-shirt se voit bien avant de la publier.</p>
      <form id="momentForm" class="stack" novalidate>
        <div class="field"><span class="up">Ta photo</span>
          ${
            moment.photo
              ? `<div class="moment-preview"><img src="${esc(moment.photo)}" alt="Ta photo"><button type="button" class="link" data-moment-repick>Changer de photo</button></div>`
              : `<label class="photo-add wide">+ Choisir une photo<input type="file" id="m-photo" accept="image/*" hidden></label>`
          }
          <p class="hint">Le t-shirt (devant ou dos) doit bien se voir.</p>
        </div>
        <div class="field"><label for="m-first">Ton prénom</label><input id="m-first" maxlength="30" autocomplete="given-name" required value="${esc(moment.firstName)}"></div>
        <div class="field"><label for="m-place">Lieu (facultatif)</label><input id="m-place" maxlength="60" placeholder="Ex. : Plage du Mourillon" value="${esc(moment.place)}"></div>
        <div class="field"><label for="m-sku">Ton t-shirt</label><select id="m-sku"><option value="">Je ne sais plus</option>${options}</select></div>
        <div class="field"><label for="m-email">Ton e-mail (jamais affiché)</label><input id="m-email" type="email" maxlength="200" autocomplete="email" required value="${esc(moment.email)}"><p class="hint">Pour te prévenir quand ta photo est en ligne.</p></div>
        <div class="hp" aria-hidden="true"><label for="m-website">Ne pas remplir</label><input id="m-website" tabindex="-1" autocomplete="off"></div>
        <label class="check"><input type="checkbox" id="m-consent" ${moment.consent ? "checked" : ""}><span>J'accepte que cette photo, mon prénom et le lieu soient publiés sur fork-clothe.com. Je suis sur la photo ou j'ai l'accord des personnes visibles (et de leurs parents pour un mineur). Je peux demander le retrait à tout moment à forkofficiel@gmail.com. <a href="confidentialite.html">Confidentialité</a></span></label>
        ${moment.error ? `<p class="notice err">${esc(moment.error)}</p>` : ""}
        <button class="btn full" type="submit" id="m-submit" ${moment.sending ? "disabled" : ""}>${moment.sending ? "Vérification de ta photo…" : "Publier ma photo"}</button>
      </form>`;
    $("#m-photo")?.addEventListener("change", async (e) => {
      saveMomentFields();
      const file = e.target.files[0];
      if (!file) return;
      try {
        moment.photo = await shrinkPhoto(file);
        moment.error = "";
      } catch {
        moment.error = "Cette photo n'a pas pu être lue. Essaie avec une autre.";
      }
      renderMoment();
    });
    $("[data-moment-repick]")?.addEventListener("click", () => {
      saveMomentFields();
      moment.photo = null;
      renderMoment();
      $("#m-photo")?.click();
    });
    $("#momentForm").addEventListener("submit", submitMoment);
  }

  async function submitMoment(e) {
    e.preventDefault();
    if (moment.sending) return;
    saveMomentFields();
    moment.error = "";
    if (!moment.photo) moment.error = "Choisis une photo.";
    else if (moment.firstName.trim().length < 2) moment.error = "Indique ton prénom.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(moment.email.trim())) moment.error = "Indique une adresse e-mail valide.";
    else if (!moment.consent) moment.error = "Coche la case d'accord pour publier ta photo.";
    if (moment.error) return renderMoment();
    moment.sending = true;
    renderMoment();
    const { ok, data } = await api("/api/moments", {
      method: "POST",
      body: {
        photo: moment.photo,
        firstName: moment.firstName,
        place: moment.place,
        sku: moment.sku,
        email: moment.email,
        consent: true,
        website: $("#m-website")?.value || "",
      },
    });
    moment.sending = false;
    if (!ok) {
      moment.error = data.error || "L'envoi n'a pas abouti. Réessaie.";
      return renderMoment();
    }
    moment.done = data.status === "published" ? "published" : "pending";
    renderMoment();
    if (moment.done === "published") loadMoments();
  }

  function openMomentShare() {
    if (moment.done) Object.assign(moment, { photo: null, place: "", sku: "", consent: false, error: "", done: null });
    renderMoment();
    openDrawer("momentDrawer");
  }

  function openLightbox(src, caption) {
    $("#lightboxImg").src = src;
    $("#lightboxImg").alt = caption;
    $("#lightboxCap").textContent = caption;
    $("#momentLightbox").hidden = false;
    document.body.classList.add("locked");
    $("[data-lightbox-close]").focus();
  }
  function closeLightbox() {
    if ($("#momentLightbox")?.hidden !== false) return;
    $("#momentLightbox").hidden = true;
    document.body.classList.remove("locked");
  }

  if ($("#momentsGrid")) {
    loadMoments();
    $("#momentsMore").addEventListener("click", () => loadMoments(true));
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-moment-share]")) return openMomentShare();
    const open = e.target.closest("[data-moment-photo]");
    if (open) return openLightbox(open.dataset.momentPhoto, open.dataset.momentCap);
    if (e.target.closest("[data-lightbox-close]") || e.target.id === "momentLightbox") closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
  if (new URLSearchParams(location.search).get("moment") === "1") openMomentShare();

  // Mesure d'audience maison, sans cookie (voir la politique de confidentialité).
  // Les visites du propriétaire (appareil où l'admin a été ouvert) ne sont pas comptées.
  (() => {
    try {
      if (localStorage.getItem("fork-no-count") === "1") return;
    } catch {
      /* stockage indisponible : on compte quand même */
    }
    const path = document.body.dataset.page === "404" ? "/404" : location.pathname;
    const payload = JSON.stringify({ path, ref: document.referrer || "", ...(urlSrc ? { src: urlSrc } : {}) });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon("/api/visit", new Blob([payload], { type: "application/json" }))) return;
    } catch {
      /* repli ci-dessous */
    }
    fetch("/api/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  })();

  start();
})();
