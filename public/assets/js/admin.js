"use strict";

/*
 * Gestion des commandes FORK.
 * Toutes les données viennent de /api/admin/orders ; chaque action est
 * vérifiée par le serveur (code d'accès et statut courant de la commande).
 * Le code d'accès n'est gardé qu'en sessionStorage (effacé à la fermeture de l'onglet).
 */
(() => {
  const TOKEN_KEY = "fork-admin-token";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const euros = (c) => `${(Number(c) / 100).toFixed(2).replace(".", ",")} €`;
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  };
  const STATUS = {
    pending_payment: ["Non payée", "warn"],
    paid: ["Payée · à préparer", "ok"],
    preparing: ["En préparation", "info"],
    shipped: ["Expédiée", "info"],
    delivered: ["Livrée", "ok"],
    cancelled: ["Annulée", "err"],
  };
  const ZONES = { free_zone: "Zone offerte", outside_zone: "Hors zone", geocoder_unavailable: "Zone à vérifier", unknown: "Zone inconnue" };

  const session = {
    get() {
      try {
        return sessionStorage.getItem(TOKEN_KEY) || "";
      } catch {
        return session.memory || "";
      }
    },
    set(v) {
      session.memory = v;
      try {
        v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* mémoire seulement */
      }
    },
    memory: "",
  };

  let statusFilter = "";
  let orders = [];
  let autoTracking = false;
  const confirmCancel = new Set();
  const editTracking = new Set();

  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("err", isError);
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 3500);
  }

  async function call(method, body, query = "") {
    try {
      const res = await fetch(`/api/admin/orders${query}`, {
        method,
        headers: { Authorization: `Bearer ${session.get()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: "Connexion impossible." } };
    }
  }

  function showLogin(message) {
    $("#loginView").hidden = false;
    $("#ordersView").hidden = true;
    $("#lock").hidden = true;
    const err = $("#loginError");
    err.hidden = !message;
    err.textContent = message || "";
    $("#token").focus();
  }

  async function load() {
    $("#orderList").innerHTML = `<p class="muted">Chargement…</p>`;
    const { ok, status, data } = await call("GET", null, statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "");
    if (status === 401 || status === 503) {
      session.set("");
      return showLogin(data.error);
    }
    $("#loginView").hidden = true;
    $("#ordersView").hidden = false;
    $("#lock").hidden = false;
    if (!ok) {
      $("#orderList").innerHTML = `<p class="notice err">${esc(data.error || "Chargement impossible.")}</p>`;
      return;
    }
    orders = Array.isArray(data.orders) ? data.orders : [];
    autoTracking = Boolean(data.autoTracking);
    render();
  }

  function actionsFor(o) {
    const parts = [];
    if (o.status === "paid") parts.push(`<button type="button" class="btn out" data-act="prepare">Passer en préparation</button>`);
    const awaiting = o.shipmentStatus === "awaiting_pickup" && o.trackingNumber;
    if (awaiting) {
      parts.push(`<div class="notice"><b>En attente du dépôt à La Poste</b><span>Colissimo n° ${esc(o.trackingNumber)}. Dès que La Poste scanne le colis, la commande passe « Expédiée » et le client reçoit l'e-mail de suivi, automatiquement.</span></div>
        <div class="actions"><button type="button" class="btn out" data-act="send-now" data-tracking="${esc(o.trackingNumber)}">Envoyer l'e-mail maintenant</button><button type="button" class="link" data-act="edit-tracking">Corriger le numéro</button></div>`);
    }
    if ((o.status === "paid" || o.status === "preparing") && (!awaiting || editTracking.has(o.orderNumber))) {
      parts.push(`<form class="ship-form" data-ship novalidate>
        <div class="field"><label for="carrier-${o.id}">Transporteur</label><select id="carrier-${o.id}" name="carrier"><option>Colissimo</option><option>Remise en main propre</option><option>Autre</option></select></div>
        <div class="field"><label for="tracking-${o.id}">Numéro de suivi</label><div class="scan-row"><input id="tracking-${o.id}" name="trackingNumber" autocomplete="off" autocapitalize="characters" required value="${esc(o.trackingNumber || "")}">${"BarcodeDetector" in window ? `<button type="button" class="btn out" data-scan>Scanner</button>` : ""}</div>
          <p class="hint">Sur iPhone : touche la case, puis l'icône « Scanner du texte » du clavier et vise le numéro imprimé sous le code-barres.</p></div>
        <div class="field"><label for="url-${o.id}">Lien de suivi (facultatif pour Colissimo)</label><input id="url-${o.id}" name="trackingUrl" type="url" placeholder="https://…" autocomplete="off"></div>
        <button type="submit" class="btn">${autoTracking ? "Enregistrer le numéro (e-mail envoyé au dépôt)" : "Marquer expédiée et prévenir le client"}</button>
      </form>`);
    }
    if (o.status === "shipped") {
      parts.push(`<label class="check"><input type="checkbox" data-notify checked> Envoyer l'e-mail « commande livrée »</label>
        <button type="button" class="btn" data-act="deliver">Marquer livrée</button>`);
    }
    if (["pending_payment", "paid", "preparing"].includes(o.status)) {
      const paid = o.paymentStatus === "paid";
      parts.push(
        confirmCancel.has(o.orderNumber)
          ? `<p class="notice warn">${paid ? "Cette commande est payée : le remboursement est à faire toi-même dans SumUp." : "La commande n'est pas payée."} Confirmer l'annulation ?</p>
             <div class="actions"><button type="button" class="btn out" data-act="cancel-no">Non</button><button type="button" class="btn" data-act="cancel">Oui, annuler</button></div>`
          : `<button type="button" class="link danger" data-act="cancel-ask">Annuler la commande</button>`,
      );
    }
    return parts.join("");
  }

  function render() {
    const list = $("#orderList");
    if (!orders.length) {
      list.innerHTML = `<p class="muted">Aucune commande dans cette catégorie.</p>`;
      return;
    }
    list.innerHTML = orders
      .map((o) => {
        const [label, tone] = STATUS[o.status] || [o.status, "info"];
        const items = (Array.isArray(o.items) ? o.items : [])
          .map((it) => `<li>${Number(it.quantity)} × ${esc(it.name)} · ${esc(it.color)} · <b>${esc(it.size)}</b></li>`)
          .join("");
        const tracking = o.trackingNumber
          ? `<p>${esc(o.carrier || "")} · ${esc(o.trackingNumber)}${o.trackingUrl && /^https:\/\//i.test(o.trackingUrl) ? ` · <a class="link" href="${esc(o.trackingUrl)}" target="_blank" rel="noopener">suivi</a>` : ""}</p>`
          : "";
        return `<article class="card" data-order="${esc(o.orderNumber)}">
          <div class="card-head"><b>${esc(o.orderNumber)}</b><span class="muted">${esc(when(o.createdAt))}</span></div>
          <div class="actions"><span class="pill ${tone}">${esc(label)}</span><span class="pill ${o.paymentStatus === "paid" ? "ok" : "warn"}">${o.paymentStatus === "paid" ? "Paiement confirmé" : "Paiement en attente"}</span></div>
          <div class="admin-order">
            <div class="col">
              <ul class="items">${items}</ul>
              <div class="row"><span>Sous-total</span><span>${euros(o.subtotalCents)}</span></div>
              <div class="row"><span>Livraison · ${esc(ZONES[o.deliveryZone] || o.deliveryZone)}</span><span>${o.shippingCents ? euros(o.shippingCents) : "Offerte"}</span></div>
              <div class="row total"><span>Total</span><span>${euros(o.totalCents)}</span></div>
              ${o.paymentReference ? `<p class="hint">Réf. SumUp : ${esc(o.paymentReference)}</p>` : ""}
            </div>
            <div class="col">
              <address><b>${esc(o.customerName)}</b><br>${esc(o.shippingAddress)}<br>${esc(o.customerPhone)}<br>${esc(o.customerEmail)}</address>
              ${tracking}
            </div>
          </div>
          ${actionsFor(o)}
        </article>`;
      })
      .join("");
  }

  async function act(orderNumber, body, card) {
    $$("button", card).forEach((b) => (b.disabled = true));
    const { ok, status, data } = await call("POST", { orderNumber, ...body });
    if (status === 401) {
      session.set("");
      return showLogin("Code d'accès refusé.");
    }
    if (!ok) {
      toast(data.error || "Action impossible.", true);
      return load();
    }
    editTracking.delete(orderNumber);
    toast(body.sendNow ? "E-mail d'expédition envoyé" : body.action === "ship" && autoTracking ? "Numéro enregistré : l'e-mail partira au dépôt du colis" : "Commande mise à jour");
    load();
  }

  document.addEventListener("click", (e) => {
    const button = e.target.closest("[data-act]");
    if (!button) return;
    const card = button.closest("[data-order]");
    const orderNumber = card.dataset.order;
    const action = button.dataset.act;
    if (action === "cancel-ask") {
      confirmCancel.add(orderNumber);
      return render();
    }
    if (action === "cancel-no") {
      confirmCancel.delete(orderNumber);
      return render();
    }
    if (action === "edit-tracking") {
      editTracking.add(orderNumber);
      return render();
    }
    if (action === "send-now") {
      return act(orderNumber, { action: "ship", carrier: "Colissimo", trackingNumber: button.dataset.tracking, sendNow: true }, card);
    }
    if (action === "cancel") confirmCancel.delete(orderNumber);
    const extra = action === "deliver" ? { notifyCustomer: $("[data-notify]", card)?.checked !== false } : {};
    act(orderNumber, { action, ...extra }, card);
  });

  document.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-ship]");
    if (!form) return;
    e.preventDefault();
    const card = form.closest("[data-order]");
    const data = new FormData(form);
    const trackingNumber = String(data.get("trackingNumber") || "").trim();
    if (!trackingNumber) return toast("Saisis le numéro de suivi.", true);
    act(
      card.dataset.order,
      {
        action: "ship",
        carrier: String(data.get("carrier") || "Colissimo"),
        trackingNumber,
        trackingUrl: String(data.get("trackingUrl") || "").trim(),
      },
      card,
    );
  });

  // Scan du code-barres (navigateurs compatibles BarcodeDetector).
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-scan]");
    if (!b) return;
    const input = b.parentElement.querySelector("input");
    let stream;
    const box = document.createElement("div");
    box.className = "scan-box";
    box.innerHTML = `<video playsinline muted></video><button type="button" class="btn">Fermer</button>`;
    document.body.appendChild(box);
    const stop = () => {
      stream?.getTracks().forEach((t) => t.stop());
      box.remove();
    };
    box.querySelector("button").addEventListener("click", stop);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = box.querySelector("video");
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector();
      const loop = async () => {
        if (!document.body.contains(box)) return;
        const codes = await detector.detect(video).catch(() => []);
        const code = codes.map((c) => c.rawValue.replace(/\s+/g, "")).find((v) => /^[A-Za-z0-9]{8,40}$/.test(v));
        if (code) {
          input.value = code.toUpperCase();
          stop();
          toast("Numéro scanné");
          return;
        }
        requestAnimationFrame(loop);
      };
      loop();
    } catch {
      stop();
      toast("Caméra indisponible : saisis le numéro.", true);
    }
  });

  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      statusFilter = t.dataset.status;
      $$(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === t)));
      load();
    }),
  );

  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = $("#token").value.trim();
    if (!value) return showLogin("Saisis le code d'accès.");
    session.set(value);
    $("#token").value = "";
    load();
  });

  $("#lock").addEventListener("click", () => {
    session.set("");
    orders = [];
    $("#orderList").innerHTML = "";
    showLogin("");
  });

  if (session.get()) load();
  else showLogin("");
})();
