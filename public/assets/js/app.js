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
      id: "authentique",
      sku: "fork-authentique",
      name: "L'Authentique",
      color: "Rouge & noir",
      category: "homme",
      priceCents: 3000,
      sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
      available: true,
      isNew: false,
      description: "Le classique rouge et noir : coupe droite, coton épais, impression « Chez nous à Toulon on craint degun ».",
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
      sku: "fork-lou-faron",
      name: "Lou Faron",
      color: "Léopard",
      category: "femme",
      priceCents: 3000,
      sizes: ["S", "M", "L"],
      available: true,
      isNew: true,
      description: "Le modèle léopard, pensé comme une pièce forte du vestiaire féminin.",
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
      sku: "fork-les-boutades",
      name: "Les Boutades",
      color: "Noir",
      category: "homme",
      priceCents: 3000,
      sizes: ["S", "M", "L", "XL", "2XL", "3XL"],
      available: true,
      isNew: true,
      description: "Un noir profond et graphique, inspiré des expressions du Sud.",
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
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const MAX_QTY = 20;

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
    const list = PRODUCTS.filter((p) => {
      if (filter === "out") return !p.available;
      if (filter === "homme" || filter === "femme") return p.category === filter;
      return true;
    }).sort((a, b) => Number(b.available) - Number(a.available));

    $("#productGrid").innerHTML = list
      .map((p) => {
        const badge = !p.available ? `<span class="pbadge out">Épuisé</span>` : p.isNew ? `<span class="pbadge">Nouveau</span>` : "";
        const back = p.images[1] ? `<img class="back" src="${esc(p.images[1].src)}" alt="" loading="lazy">` : "";
        return `<button type="button" class="pcard" data-product="${esc(p.id)}" aria-label="${esc(`${p.name} ${p.color}, ${euros(p.priceCents)}${p.available ? "" : ", épuisé"}`)}">
          <div class="pimg">${badge}<img src="${esc(p.images[0].src)}" alt="${esc(p.images[0].alt)}" loading="lazy">${back}</div>
          <span class="pname">T-shirt ${esc(p.name)}</span>
          <span class="pmeta">${esc(p.color)} · ${p.category === "femme" ? "Femme" : "Homme"}</span>
          <span class="price">${p.available ? euros(p.priceCents) : `<s>${euros(p.priceCents)}</s> · Épuisé`}</span>
        </button>`;
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
    if (card) openProduct(card.dataset.product);
    if (e.target.closest("[data-open-account]")) openAccount();
  });

  // ---------------------------------------------------------------------------
  // Fiche produit
  // ---------------------------------------------------------------------------
  const sheet = { product: null, size: null, qty: 1 };
  function openProduct(id) {
    const product = byId.get(id);
    if (!product) return;
    sheet.product = product;
    sheet.size = null;
    sheet.qty = 1;
    renderProduct();
    openDrawer("productDrawer");
  }
  function renderProduct() {
    const p = sheet.product;
    $("#productTitle").textContent = `${p.name} · ${p.color}`;
    const canBuy = p.available && sheet.size;
    $("#productSheet").innerHTML = `
      <div class="gallery" id="gallery">${p.images.map((img, i) => `<img src="${esc(img.src)}" alt="${esc(img.alt)}" ${i ? 'loading="lazy"' : ""} data-index="${i}">`).join("")}</div>
      <div class="sheet-info">
        <div class="thumbs">${p.images.map((img, i) => `<button type="button" data-thumb="${i}" aria-label="Photo ${i + 1}" aria-current="${i === 0}"><img src="${esc(img.src)}" alt="" loading="lazy"></button>`).join("")}</div>
        <div>
          ${p.available ? (p.isNew ? '<span class="pill info">Nouveau</span>' : "") : '<span class="pill err">Épuisé</span>'}
          <h2>T-shirt ${esc(p.name)}</h2>
          <p class="pmeta">${esc(p.color)} · ${p.category === "femme" ? "Femme" : "Homme"}</p>
        </div>
        <p class="price">${euros(p.priceCents)}</p>
        <p class="muted">${esc(p.description)}</p>
        ${
          p.available
            ? `<div class="field"><span class="up">Taille</span><div class="sizes">${p.sizes
                .map((s) => `<button type="button" class="size" data-size="${esc(s)}" aria-pressed="${sheet.size === s}">${esc(s)}</button>`)
                .join("")}</div><p class="hint">Coupe droite : ta taille habituelle, ou une au-dessus pour un style oversize.</p></div>
              <div class="field"><span class="up">Quantité</span><div class="qty"><button type="button" data-qty="-1" aria-label="Diminuer">−</button><span>${sheet.qty}</span><button type="button" data-qty="1" aria-label="Augmenter">+</button></div></div>
              <button type="button" class="btn full" id="addToCart" ${canBuy ? "" : "disabled"}>${sheet.size ? `Ajouter au panier · ${euros(p.priceCents * sheet.qty)}` : "Choisis ta taille"}</button>`
            : `<p class="notice">Ce modèle est épuisé pour le moment. Suis-nous sur Instagram pour être au courant de son retour.</p>`
        }
        <p class="hint">Livraison offerte à moins de 10 km de Toulon, 7,64 € au-delà. Le montant exact est calculé avant le paiement.</p>
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
        renderProduct();
      }),
    );
    $$("[data-qty]").forEach((b) =>
      b.addEventListener("click", () => {
        sheet.qty = Math.min(MAX_QTY, Math.max(1, sheet.qty + Number(b.dataset.qty)));
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
  let cart = store.get(CART_KEY, []).filter((l) => bySku.has(l.sku) && bySku.get(l.sku).sizes.includes(l.size) && l.qty > 0);
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
  function addToCart(sku, size, qty) {
    const line = cart.find((l) => l.sku === sku && l.size === size);
    if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
    else cart.push({ sku, size, qty });
    cartChanged();
  }
  const subtotalCents = () => cart.reduce((sum, l) => sum + bySku.get(l.sku).priceCents * l.qty, 0);

  // ---------------------------------------------------------------------------
  // Parcours de commande
  // ---------------------------------------------------------------------------
  let step = "cart";
  const form = { name: "", email: "", phone: "", address: "", saveAddress: false, acceptCgv: false };
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
        const p = bySku.get(l.sku);
        return `<div class="line">
          <img src="${esc(p.images[0].src)}" alt="" loading="lazy">
          <div><div class="pname">${esc(p.name)}</div><div class="pmeta">${esc(p.color)} · Taille ${esc(l.size)}</div>
            <div class="qty"><button type="button" data-line="${i}" data-delta="-1" aria-label="Retirer un article">−</button><span>${l.qty}</span><button type="button" data-line="${i}" data-delta="1" aria-label="Ajouter un article">+</button></div>
          </div>
          <span class="price">${euros(p.priceCents * l.qty)}</span>
        </div>`;
      })
      .join("");
    foot.innerHTML = `<div class="row"><span>Sous-total</span><span>${euros(subtotalCents())}</span></div>
      <p class="hint">Frais de livraison calculés à l'étape suivante, à partir de ton adresse. Livraison en France métropolitaine. TVA non applicable, art. 293 B du CGI.</p>
      <button type="button" class="btn full" id="toDelivery">Passer à la livraison</button>`;
    $$("[data-line]", body).forEach((b) =>
      b.addEventListener("click", () => {
        const line = cart[Number(b.dataset.line)];
        line.qty = Math.min(MAX_QTY, line.qty + Number(b.dataset.delta));
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
    return quote.state === "ok" && quote.address === form.address.trim() && ["free_zone", "outside_zone", "geocoder_unavailable"].includes(quote.zone);
  }

  function renderDeliveryStep() {
    const body = $("#cartBody");
    const savedSelect =
      me && savedAddresses && savedAddresses.length
        ? `<div class="field"><label for="savedAddress">Mes adresses</label><select id="savedAddress"><option value="">Choisir une adresse enregistrée…</option>${savedAddresses
            .map((a) => `<option value="${a.id}">${esc(a.label || "Adresse")} · ${esc(a.address)}</option>`)
            .join("")}</select></div>`
        : "";
    body.innerHTML = `
      ${me ? "" : `<p class="hint">Tu commandes sans compte. Tu pourras retrouver cette commande plus tard en te connectant avec Google, avec la même adresse e-mail.</p>`}
      <form id="deliveryForm" class="stack" novalidate>
        <div class="field"><label for="f-name">Nom et prénom</label><input id="f-name" autocomplete="name" maxlength="120" required value="${esc(form.name)}"></div>
        <div class="field"><label for="f-email">E-mail</label><input id="f-email" type="email" autocomplete="email" maxlength="200" required value="${esc(form.email)}"></div>
        <div class="field"><label for="f-phone">Téléphone</label><input id="f-phone" type="tel" autocomplete="tel" maxlength="40" required value="${esc(form.phone)}"></div>
        ${savedSelect}
        <div class="field"><label for="f-address">Adresse de livraison</label><input id="f-address" autocomplete="street-address" maxlength="500" required placeholder="12 rue Picot, 83000 Toulon" value="${esc(form.address)}">
          <p class="hint">Numéro, rue, code postal et ville. Le code postal sert à calculer la livraison.</p></div>
        ${me ? `<label class="check"><input type="checkbox" id="f-save" ${form.saveAddress ? "checked" : ""}> Enregistrer cette adresse dans mon compte</label>` : ""}
        <div id="quoteBox" aria-live="polite"></div>
        <label class="check"><input type="checkbox" id="f-cgv" ${form.acceptCgv ? "checked" : ""}><span>J'accepte les <a class="link" href="cgv.html" target="_blank" rel="noopener">conditions générales de vente</a> et j'ai lu la <a class="link" href="confidentialite.html" target="_blank" rel="noopener">politique de confidentialité</a>.</span></label>
        <p class="notice err" id="deliveryError" hidden></p>
      </form>`;

    const bind = (id, key) =>
      $(id).addEventListener("input", (e) => {
        form[key] = e.target.value;
        if (key === "address") scheduleQuote();
        renderDeliveryFoot();
      });
    bind("#f-name", "name");
    bind("#f-email", "email");
    bind("#f-phone", "phone");
    bind("#f-address", "address");
    $("#f-save")?.addEventListener("change", (e) => (form.saveAddress = e.target.checked));
    $("#f-cgv").addEventListener("change", (e) => {
      form.acceptCgv = e.target.checked;
      renderDeliveryFoot();
    });
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
    renderDeliveryFoot();
    if (form.address.trim().length >= 5 && quote.address !== form.address.trim()) requestQuote();
  }

  function renderQuote() {
    const box = $("#quoteBox");
    if (!box) return;
    if (quote.state === "loading") box.innerHTML = `<p class="notice">Calcul des frais de livraison…</p>`;
    else if (quote.state === "ok") {
      const tone = quote.zone === "geocoder_unavailable" ? "warn" : "ok";
      box.innerHTML = `<p class="notice ${tone}">${esc(quote.message)}</p>`;
    } else if (quote.state === "error") box.innerHTML = `<p class="notice err">${esc(quote.message)}</p>`;
    else box.innerHTML = "";
  }

  function renderDeliveryFoot() {
    const foot = $("#cartFoot");
    const usable = quoteIsUsable();
    const fee = usable ? quote.feeCents : null;
    const ready =
      usable && form.acceptCgv && form.name.trim() && /^\S+@\S+\.\S+$/.test(form.email.trim()) && form.phone.trim().length >= 6;
    foot.innerHTML = `<div class="row"><span>Sous-total</span><span>${euros(subtotalCents())}</span></div>
      <div class="row"><span>Livraison</span><span>${fee === null ? "Saisis ton adresse" : fee ? euros(fee) : "Offerte"}</span></div>
      <div class="row total"><span>Total estimé</span><span>${fee === null ? "—" : euros(subtotalCents() + fee)}</span></div>
      <div class="actions"><button type="button" class="btn out" id="backToCart">Retour</button><button type="submit" form="deliveryForm" class="btn" id="submitOrder" ${ready ? "" : "disabled"}>Valider la commande</button></div>`;
    $("#backToCart").addEventListener("click", () => {
      step = "cart";
      renderCart();
    });
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
    button.disabled = true;
    button.textContent = "Enregistrement…";

    const checkoutToken = uuidV4();
    const { ok, data } = await api("/api/orders", {
      method: "POST",
      body: {
        checkoutToken,
        customer: { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(), address: form.address.trim() },
        items: cart.map((l) => ({ sku: l.sku, size: l.size, color: bySku.get(l.sku).color, quantity: l.qty })),
      },
    });

    if (!ok || !data.orderNumber) {
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
      totalCents: data.totalCents,
      deliveryMessage: data.delivery?.message || "",
      address: form.address.trim(),
      name: form.name.trim(),
      lines: cart.map((l) => ({ ...l })),
      paid: false,
    };
    store.set(PENDING_KEY, pending);

    if (me && form.saveAddress) {
      const saved = await api("/api/account-addresses", {
        method: "POST",
        body: { recipientName: form.name.trim(), address: form.address.trim(), phone: form.phone.trim() },
      });
      if (saved.ok) savedAddresses = null;
      form.saveAddress = false;
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
    body.innerHTML = `
      <div class="card">
        <div class="card-head"><span class="up">Commande</span><b>${esc(pending.orderNumber)}</b></div>
        <ul class="items">${pending.lines
          .map((l) => {
            const p = bySku.get(l.sku);
            return `<li>${l.qty} × ${esc(p ? p.name : l.sku)} · ${esc(p ? p.color : "")} · ${esc(l.size)}</li>`;
          })
          .join("")}</ul>
      </div>
      <div class="card"><span class="up">Livraison à</span><p>${esc(pending.name)}<br>${esc(pending.address)}</p>${pending.deliveryMessage ? `<p class="hint">${esc(pending.deliveryMessage)}</p>` : ""}</div>
      <p class="hint">Montant calculé par notre serveur. Le paiement se fait sur la page sécurisée de SumUp ; ta commande sera confirmée dès que SumUp nous aura confirmé le paiement.</p>
      <p class="notice err" id="payError" hidden></p>`;
    foot.innerHTML = `<div class="row"><span>Sous-total</span><span>${euros(pending.subtotalCents)}</span></div>
      <div class="row"><span>Livraison</span><span>${pending.shippingCents ? euros(pending.shippingCents) : "Offerte"}</span></div>
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
      body.innerHTML = `<div class="empty"><h4>Merci, commande confirmée</h4><p>Ton paiement de <b>${euros(data.totalCents)}</b> est confirmé pour la commande <b>${esc(orderNumber)}</b>.</p><p class="muted">Un e-mail de confirmation t'est envoyé. On t'écrit à nouveau avec le numéro de suivi dès l'expédition.</p></div>`;
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
          .map((it) => `<li>${Number(it.quantity)} × ${esc(it.name)} · ${esc(it.color)} · ${esc(it.size)} <span class="muted">· ${euros(Number(it.lineTotalCents) || 0)}</span></li>`)
          .join("");
        const tracking = o.trackingNumber
          ? `<div class="notice"><b>Commande expédiée</b><span>Transporteur : ${esc(o.carrier || "—")}</span><span>Numéro de suivi : ${esc(o.trackingNumber)}</span>${
              isHttps(o.trackingUrl) ? `<a class="btn" href="${esc(o.trackingUrl)}" target="_blank" rel="noopener">Suivre mon colis</a>` : ""
            }</div>`
          : "";
        return `<article class="card">
          <div class="card-head"><b>${esc(o.orderNumber)}</b><span class="muted">${esc(formatDate(o.createdAt))}</span></div>
          <div class="actions">${pill(STATUS, o.status)}${pill(PAYMENT, o.paymentStatus)}</div>
          <ul class="items">${items}</ul>
          <div class="row"><span>Sous-total</span><span>${euros(o.subtotalCents)}</span></div>
          <div class="row"><span>Livraison</span><span>${o.shippingCents ? euros(o.shippingCents) : "Offerte"}</span></div>
          <div class="row total"><span>Total</span><span>${euros(o.totalCents)}</span></div>
          ${tracking}
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
  // Démarrage
  // ---------------------------------------------------------------------------
  function consumeUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const login = params.get("login");
    const payment = params.get("payment");
    const order = params.get("order");
    const reason = params.get("reason");
    if (login || payment) {
      const clean = new URL(window.location.href);
      ["login", "payment", "order", "reason"].forEach((k) => clean.searchParams.delete(k));
      history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
    }
    return { login, payment, order, reason };
  }

  async function start() {
    $("#year").textContent = String(new Date().getFullYear());
    saveCart();
    renderGrid();
    const { login, payment, order, reason } = consumeUrlParams();
    await loadMe();
    if (me) fetchAddresses();

    if (payment === "sumup" && order) {
      openDrawer("cartDrawer");
      checkPaymentStatus(order.slice(0, 80));
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

  start();
})();
