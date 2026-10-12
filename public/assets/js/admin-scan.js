"use strict";

/*
 * Scanner de stock (admin FORK).
 * La caméra reste ouverte : on montre le t-shirt (étiquette du col + logo), on appuie
 * sur le déclencheur, l'IA lit la taille et reconnaît le modèle, et le stock est mis
 * à jour tout de suite : +1 en Réception, −1 en Vente (vente sur place).
 * Si la taille ou le modèle ne se lit pas, on touche le bon bouton. Chaque scan peut être annulé.
 */
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

  let products = []; // { sku, name, sizes, priceCents }
  let toCollect = 0; // ventes scannées pas encore encaissées (centimes)
  const euros = (c) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
  let box = null;
  let stream = null;
  let mode = "in";
  let lockSku = "";
  let busy = false;
  let pending = null; // scan incomplet : { sku, size, note }
  let last = null; // dernier mouvement appliqué (pour Annuler)
  const tally = { in: 0, out: 0 };

  async function post(body) {
    try {
      const res = await fetch("/api/admin/stock-scan", {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      return { ok: res.ok, data: await res.json().catch(() => ({})) };
    } catch {
      return { ok: false, data: { error: "Connexion impossible." } };
    }
  }

  async function loadProducts() {
    try {
      const res = await fetch("/api/admin/stock", { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" });
      const d = await res.json();
      products = (d.products || []).map((p) => ({ sku: p.sku, name: p.name, sizes: p.sizes.map((s) => s.size), priceCents: p.priceCents || 0 }));
    } catch {
      products = [];
    }
  }

  const nameOf = (sku) => products.find((p) => p.sku === sku)?.name || sku;

  function renderPanel() {
    if (!box) return;
    const panel = $(".scan-panel", box);
    let html = "";
    if (busy) {
      html = `<p class="scan-status">Lecture du t-shirt…</p>`;
    } else if (pending) {
      const p = products.find((x) => x.sku === pending.sku);
      html = `<div class="scan-card warn"><p>${esc(pending.note || "Lecture incomplète.")}</p>`;
      if (!p) {
        html += `<p class="small">Quel modèle${pending.size ? ` (taille ${esc(pending.size)})` : ""} ?</p><div class="scan-picks">${products
          .filter((x) => !pending.size || x.sizes.includes(pending.size))
          .map((x) => `<button type="button" class="btn out" data-pick-sku="${esc(x.sku)}">${esc(x.name)}</button>`)
          .join("")}</div>`;
      } else {
        html += `<p class="small">${esc(p.name)} : quelle taille ?</p><div class="scan-picks">${p.sizes
          .map((s) => `<button type="button" class="btn out" data-pick-size="${esc(s)}">${esc(s)}</button>`)
          .join("")}</div>`;
      }
      html += `<button type="button" class="link" data-scan-skip>Ignorer</button></div>`;
    } else if (last) {
      html = `<div class="scan-card ok"><p><b>${last.delta > 0 ? "+1" : "−1"} ${esc(last.name)} · ${esc(last.size)}</b>${
        last.quantity === null || last.quantity === undefined ? "" : ` — reste ${esc(last.quantity)}`
      }</p><button type="button" class="link" data-scan-undo>Annuler</button></div>`;
    } else {
      html = `<p class="scan-status">Cadre le t-shirt plié : l'étiquette du col et le logo doivent se voir. Rapproche-toi si l'étiquette est petite.</p>`;
    }
    if (mode === "out" || toCollect) {
      html += `<a class="btn full scan-sumup" href="sumupmerchant://" data-sumup>${toCollect ? `Encaisser ${esc(euros(toCollect))} · ` : ""}Ouvrir SumUp</a>`;
    }
    html += `<p class="scan-tally">Cette session : ${tally.in ? `+${tally.in} reçu${tally.in > 1 ? "s" : ""}` : "0 reçu"} · ${tally.out ? `−${tally.out} vendu${tally.out > 1 ? "s" : ""}` : "0 vendu"}</p>`;
    panel.innerHTML = html;
    $(".scan-shot", box).disabled = busy || Boolean(pending);
  }

  function applied(a) {
    last = a;
    pending = null;
    tally[a.delta > 0 ? "in" : "out"] += 1;
    if (a.delta < 0) toCollect += products.find((p) => p.sku === a.sku)?.priceCents || 0;
    if (navigator.vibrate) navigator.vibrate(60);
  }

  function capture() {
    const video = $("video", box);
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, 2000 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      img.src = url;
    });
  }

  async function scan(photo) {
    if (!photo || busy) return;
    busy = true;
    last = null;
    renderPanel();
    const { ok, data } = await post({ mode, photo, lockSku: lockSku || undefined });
    busy = false;
    if (!ok) {
      pending = null;
      renderPanel();
      $(".scan-panel", box).insertAdjacentHTML("afterbegin", `<p class="notice err">${esc(data.error || "Lecture impossible, réessaie.")}</p>`);
      return;
    }
    if (data.applied) applied(data.applied);
    else pending = { sku: data.detection?.sku || null, size: data.detection?.size || null, note: data.error || data.detection?.note || "" };
    renderPanel();
  }

  async function manual(sku, size) {
    busy = true;
    renderPanel();
    const { ok, data } = await post({ mode, sku, size });
    busy = false;
    if (ok && data.applied) applied(data.applied);
    else pending = { ...pending, note: data.error || "Enregistrement impossible." };
    renderPanel();
  }

  async function open() {
    if (box) return;
    await loadProducts();
    box = document.createElement("div");
    box.className = "scan-box scan-stock";
    box.innerHTML = `
      <div class="scan-top">
        <div class="scan-mode" role="tablist" aria-label="Type de mouvement">
          <button type="button" data-scan-mode="in" aria-selected="${mode === "in"}">Réception +1</button>
          <button type="button" data-scan-mode="out" aria-selected="${mode === "out"}">Vente −1</button>
        </div>
        <button type="button" class="scan-close" data-scan-close aria-label="Fermer le scanner">✕</button>
      </div>
      <label class="scan-lock">Modèle
        <select data-scan-lock><option value="">Reconnaître automatiquement</option>${products
          .map((p) => `<option value="${esc(p.sku)}" ${lockSku === p.sku ? "selected" : ""}>${esc(p.name)}</option>`)
          .join("")}</select></label>
      <div class="scan-view"><video playsinline muted autoplay></video>
        <label class="scan-file" hidden>Prendre une photo<input type="file" accept="image/*" capture="environment" hidden data-scan-file></label></div>
      <button type="button" class="scan-shot" aria-label="Scanner ce t-shirt"></button>
      <div class="scan-panel" aria-live="polite"></div>`;
    document.body.appendChild(box);
    document.body.classList.add("locked");
    renderPanel();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
      const video = $("video", box);
      video.srcObject = stream;
      await video.play();
    } catch {
      // Caméra en direct indisponible : on passe par l'appareil photo du téléphone.
      $("video", box).hidden = true;
      $(".scan-file", box).hidden = false;
      $(".scan-shot", box).hidden = true;
    }
  }

  function close() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    box?.remove();
    box = null;
    pending = null;
    last = null;
    document.body.classList.remove("locked");
    if (tally.in || tally.out) document.dispatchEvent(new CustomEvent("fork:stock"));
    tally.in = 0;
    tally.out = 0;
  }

  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-scan-open]")) return open();
    if (!box || !box.contains(e.target)) return;
    if (e.target.closest("[data-scan-close]")) return close();
    const m = e.target.closest("[data-scan-mode]");
    if (m) {
      mode = m.dataset.scanMode;
      box.querySelectorAll("[data-scan-mode]").forEach((b) => b.setAttribute("aria-selected", String(b === m)));
      return renderPanel();
    }
    if (e.target.closest(".scan-shot")) return scan(capture());
    if (e.target.closest("[data-sumup]")) {
      // On laisse le lien ouvrir l'appli SumUp ; le montant à encaisser repart de zéro.
      setTimeout(() => {
        toCollect = 0;
        renderPanel();
      }, 800);
      return;
    }
    const ps = e.target.closest("[data-pick-sku]");
    if (ps) {
      pending.sku = ps.dataset.pickSku;
      if (pending.size) return manual(pending.sku, pending.size);
      return renderPanel();
    }
    const pz = e.target.closest("[data-pick-size]");
    if (pz) return manual(pending.sku, pz.dataset.pickSize);
    if (e.target.closest("[data-scan-skip]")) {
      pending = null;
      return renderPanel();
    }
    if (e.target.closest("[data-scan-undo]") && last) {
      const l = last;
      last = null;
      renderPanel();
      const { ok } = await post({ undo: { sku: l.sku, size: l.size, delta: l.delta } });
      if (ok) {
        tally[l.delta > 0 ? "in" : "out"] -= 1;
        if (l.delta < 0) toCollect = Math.max(0, toCollect - (products.find((p) => p.sku === l.sku)?.priceCents || 0));
      }
      else last = l;
      renderPanel();
    }
  });
  document.addEventListener("change", async (e) => {
    if (!box) return;
    if (e.target.matches("[data-scan-lock]")) lockSku = e.target.value;
    if (e.target.matches("[data-scan-file]") && e.target.files[0]) {
      try {
        await scan(await fileToDataUrl(e.target.files[0]));
      } catch {
        pending = null;
      }
      e.target.value = "";
    }
  });
})();
