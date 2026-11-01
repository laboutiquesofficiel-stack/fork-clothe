"use strict";

/*
 * FORK Custom Studio — page /studio/ et éditeur plein écran.
 *
 * La création vit dans le navigateur (sauvegardée sur l'appareil) jusqu'à
 * « Ajouter au panier » : le serveur la nettoie alors, calcule son niveau et
 * son prix, puis elle suit le parcours de commande et de paiement habituel.
 */
(() => {
  const L = window.ForkStudioLib;
  const Shop = window.ForkShop;
  if (!L || !document.getElementById("stEditor")) return;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = L.esc;
  const euros = (c) => `${(c / 100).toFixed(2).replace(".", ",").replace(",00", "")} €`;
  const SAVE_KEY = "fork-studio-v1";
  const IMG_KEY = "fork-studio-images-v1";
  const store = {
    get(k, f) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : f;
      } catch {
        return f;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {
        /* stockage indisponible : la création reste en mémoire */
      }
    },
  };

  let cfg = { enabled: false, open: false, prices: null, zones: { front: { w: 250, h: 300 }, back: { w: 280, h: 360 } }, logoWidth: 80, sizes: ["S", "M", "L", "XL", "XXL", "3XL"], deliveryText: "", deadline: "" };
  const blank = () => ({ color: "blanc", logoColor: "#111111", front: [], back: [] });
  const validDesign = (d) => d && (d.color === "blanc" || d.color === "noir") && Array.isArray(d.front) && Array.isArray(d.back);
  const st = {
    design: validDesign(store.get(SAVE_KEY, null)) ? store.get(SAVE_KEY, null) : blank(),
    side: "back",
    sel: null,
    tab: "motifs",
    motifCat: "noel",
    undo: [],
    redo: [],
    images: store.get(IMG_KEY, []),
    hint: true,
  };

  const PRESETS = ["TOULON", "JOYEUX NOËL", "83", "LA RADE", "FADA", "MISTRAL", "DEGUN", "PITCHOUN"];
  const dateFr = (iso) => {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
  };
  const toast = (msg, err = false) => {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("err", err);
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), err ? 7000 : 3000);
  };

  // --- Géométrie --------------------------------------------------------------
  const zone = () => L.zoneRect(st.side, cfg);
  const els = () => st.design[st.side];
  const selected = () => (st.sel === null ? null : els()[st.sel] || null);
  const measureCtx = document.createElement("canvas").getContext("2d");
  function extent(el) {
    if (el.t === "text") {
      const f = L.fontById(el.font);
      const lines = String(el.text || " ").split("\n");
      measureCtx.font = `${el.s}px "${f.family}"`;
      const w = Math.max(...lines.map((l) => measureCtx.measureText(l || " ").width)) * 1.02;
      const h = el.s * (1.1 * (lines.length - 1) + 1.15);
      return { hw: w / 2, hh: h / 2 };
    }
    const ar = el.t === "image" ? el.ar || 1 : L.motifById(el.id)?.ar || 1;
    return { hw: el.w / 2, hh: (el.w * ar) / 2 };
  }
  const sizeOf = (el) => (el.t === "text" ? el.s : el.w);
  const setSize = (el, v) => (el.t === "text" ? (el.s = Math.max(4, v)) : (el.w = Math.max(6, v)));
  /** Garde l'élément entièrement dans la zone d'impression (réduit sa taille si besoin). */
  function fit(el) {
    const z = cfg.zones[st.side];
    const rad = ((el.r || 0) * Math.PI) / 180;
    const ext = () => {
      const { hw, hh } = extent(el);
      return { ex: Math.abs(hw * Math.cos(rad)) + Math.abs(hh * Math.sin(rad)), ey: Math.abs(hw * Math.sin(rad)) + Math.abs(hh * Math.cos(rad)) };
    };
    let { ex, ey } = ext();
    if (2 * ex > z.w || 2 * ey > z.h) {
      const k = Math.min(z.w / (2 * ex), z.h / (2 * ey)) * 0.999;
      setSize(el, sizeOf(el) * k);
      ({ ex, ey } = ext());
    }
    el.x = Math.min(z.w - ex, Math.max(ex, el.x));
    el.y = Math.min(z.h - ey, Math.max(ey, el.y));
  }

  // --- Historique et sauvegarde ----------------------------------------------
  const snap = () => JSON.stringify(st.design);
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(SAVE_KEY, st.design), 250);
  };
  function pushUndo(before) {
    if (before === snap()) return;
    st.undo.push(before);
    if (st.undo.length > 60) st.undo.shift();
    st.redo = [];
    save();
  }
  function change(fn, keepSel = true) {
    const before = snap();
    fn();
    const el = selected();
    if (el && keepSel) fit(el);
    pushUndo(before);
    renderAll();
  }
  function undo() {
    if (!st.undo.length) return;
    st.redo.push(snap());
    st.design = JSON.parse(st.undo.pop());
    st.sel = null;
    save();
    renderAll();
  }
  function redo() {
    if (!st.redo.length) return;
    st.undo.push(snap());
    st.design = JSON.parse(st.redo.pop());
    st.sel = null;
    save();
    renderAll();
  }

  // --- Ajout d'éléments --------------------------------------------------------
  const defaultColor = () => (st.design.color === "noir" ? "#ffffff" : "#111111");
  function addElement(el) {
    const z = cfg.zones[st.side];
    const n = els().length;
    el.x = z.w / 2 + ((n % 4) - 1.5) * 6;
    el.y = z.h * 0.42 + ((n % 3) - 1) * 8;
    el.r = 0;
    if (els().length >= 25) return toast("25 éléments maximum par face.", true);
    change(() => {
      els().push(el);
      st.sel = els().length - 1;
      fit(el);
    });
  }
  function addText(text) {
    const t = String(text || "").trim();
    if (!t) return;
    addElement({ t: "text", text: t.slice(0, 120), font: "anton", color: defaultColor(), s: t.length > 12 ? 22 : 40 });
    document.fonts?.load?.(`40px "FS Anton"`).then(() => renderAll());
  }

  // --- Rendu -------------------------------------------------------------------
  const stage = $("#stStage");
  const imageHref = (el) => L.imageUrl(el);
  function renderStage() {
    stage.innerHTML =
      L.renderSide(st.design, st.side, { settings: cfg, interactive: true, selected: st.sel, showZone: true, imageHref }) +
      (st.hint && !els().length ? `<p class="st-hint">${st.side === "back" ? "Le dos est vide : ajoute un texte ou un motif ↓" : "Devant : ton logo FORK + ta zone en pointillés"}</p>` : "") +
      (st.hint && els().length && st.sel !== null ? `<p class="st-hint">Glisse pour déplacer · pince ou tire la poignée pour agrandir</p>` : "");
    const el = selected();
    if (!el) return;
    const g = stage.querySelector(`[data-el="${st.sel}"]`);
    if (!g) return;
    let b;
    try {
      b = g.getBBox();
    } catch {
      return;
    }
    const pad = 4;
    const ns = "http://www.w3.org/2000/svg";
    const ov = document.createElementNS(ns, "g");
    ov.setAttribute("transform", g.getAttribute("transform") || "");
    const rect = document.createElementNS(ns, "rect");
    Object.entries({ x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2, class: "st-sel-box" }).forEach(([k, v]) => rect.setAttribute(k, v));
    const hx = b.x + b.width + pad;
    const hy = b.y + b.height + pad;
    const hit = document.createElementNS(ns, "circle");
    Object.entries({ cx: hx, cy: hy, r: 34, fill: "transparent", class: "st-handle-hit" }).forEach(([k, v]) => hit.setAttribute(k, v));
    const handle = document.createElementNS(ns, "circle");
    Object.entries({ cx: hx, cy: hy, r: 15, class: "st-handle" }).forEach(([k, v]) => handle.setAttribute(k, v));
    const ico = document.createElementNS(ns, "path");
    Object.entries({ d: `M${hx - 6} ${hy - 6}L${hx + 6} ${hy + 6}M${hx + 6} ${hy}V${hy + 6}H${hx}M${hx - 6} ${hy}V${hy - 6}H${hx}`, stroke: "#1b8fa3", "stroke-width": 2.4, fill: "none", class: "st-handle-ico" }).forEach(([k, v]) => ico.setAttribute(k, v));
    ov.append(rect, handle, ico, hit);
    g.parentNode.appendChild(ov);
  }

  function renderTop() {
    $$(".st-sides [data-side]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.side === st.side)));
    $('[data-st="undo"]').disabled = !st.undo.length;
    $('[data-st="redo"]').disabled = !st.redo.length;
    const empty = !st.design.front.length && !st.design.back.length;
    const price = cfg.prices ? (empty ? cfg.prices.basic : L.priceOf(st.design, cfg.prices)) : null;
    $("#stPrice").innerHTML = price ? `${empty ? "dès " : ""}${euros(price)}<small>${esc(L.TIERS[L.tierOf(st.design)].name)}</small>` : "";
    $$(".st-tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(st.sel === null && b.dataset.tab === st.tab)));
  }

  const swatches = (current, attr) =>
    `<div class="st-swatches" role="group" aria-label="Couleurs">${L.COLORS.map(
      ([hex, name]) => `<button type="button" class="st-sw" data-${attr}="${hex}" aria-label="${esc(name)}" aria-pressed="${String(current).toLowerCase() === hex}" title="${esc(name)}"></button>`,
    ).join("")}<span class="st-sw st-sw-custom" title="Autre couleur"><input type="color" data-${attr}-custom value="${esc(current)}" aria-label="Choisir une autre couleur"></span></div>`;

  function renderPanel() {
    const panel = $("#stPanel");
    const el = selected();
    let html = "";
    if (el) {
      const z = cfg.zones[st.side];
      const max = el.t === "text" ? 160 : Math.max(z.w, z.h);
      const min = el.t === "text" ? 6 : 10;
      const label = el.t === "text" ? "Texte" : el.t === "image" ? "Image" : L.motifById(el.id)?.name || "Motif";
      let warn = "";
      if (el.t === "image") {
        const info = st.images.find((i) => i.id === el.img);
        if (info) {
          const dpi = info.w / (el.w / 25.4);
          if (dpi < 150) warn = `<p class="st-warn">Image un peu petite pour cette taille (${Math.round(dpi)} dpi) : elle risque d'être floue à l'impression. Réduis-la ou choisis une image plus grande.</p>`;
        }
      }
      html = `<div class="st-panel-in">
        <div class="st-row"><h3>${esc(label)}</h3><button type="button" class="link st-end" data-st="deselect">Terminé</button></div>
        ${el.t === "text" ? `<textarea class="st-text-input" id="stTextEdit" rows="2" maxlength="120" aria-label="Ton texte">${esc(el.text)}</textarea>
          <div class="st-scroll" role="group" aria-label="Police">${L.FONTS.map((f) => `<button type="button" class="st-chip st-font ff-${f.id}" data-font="${f.id}" aria-pressed="${el.font === f.id}">${esc(f.name)}</button>`).join("")}</div>` : ""}
        ${el.t !== "image" ? swatches(el.color, "color") : ""}
        ${warn}
        <label class="st-range">Taille<input type="range" id="stSize" min="${min}" max="${max}" step="1" value="${Math.round(sizeOf(el))}"><output>${(sizeOf(el) / 10).toFixed(1)} cm</output></label>
        <label class="st-range">Rotation<input type="range" id="stRot" min="-180" max="180" step="1" value="${Math.round(el.r || 0)}"><output>${Math.round(el.r || 0)}°</output></label>
        <div class="st-actions">
          <button type="button" data-act="dup"><span aria-hidden="true">⧉</span>Dupliquer</button>
          <button type="button" data-act="center"><span aria-hidden="true">⊕</span>Centrer</button>
          <button type="button" data-act="front"><span aria-hidden="true">⇡</span>Devant tout</button>
          <button type="button" data-act="del" class="danger"><span aria-hidden="true">🗑</span>Supprimer</button>
        </div>
      </div>`;
    } else if (st.tab === "tshirt") {
      html = `<div class="st-panel-in">
        <h3>Couleur du t-shirt</h3>
        <div class="st-row">${Object.entries(L.GARMENTS)
          .map(([id, g]) => `<button type="button" class="st-chip" data-garment="${id}" aria-pressed="${st.design.color === id}">${esc(g.name)}</button>`)
          .join("")}</div>
        <h3>Couleur du logo FORK</h3>
        ${swatches(st.design.logoColor, "logo")}
        <p class="st-note">Le logo FORK reste toujours à sa place, côté cœur : tu choisis juste sa couleur.</p>
        <button type="button" class="link" data-st="reset">Repartir de zéro</button>
      </div>`;
    } else if (st.tab === "text") {
      html = `<div class="st-panel-in">
        <textarea class="st-text-input" id="stNewText" rows="2" maxlength="120" placeholder="Écris ton texte (3 lignes max)" aria-label="Nouveau texte"></textarea>
        <button type="button" class="btn full" data-st="addtext">Ajouter le texte</button>
        <div class="st-scroll" role="group" aria-label="Idées">${PRESETS.map((p) => `<button type="button" class="st-chip" data-preset="${esc(p)}">${esc(p)}</button>`).join("")}</div>
        <p class="st-note">Ajouter un texte fait passer ta création en FORK Custom${cfg.prices ? ` (${euros(cfg.prices.custom)})` : ""}.</p>
      </div>`;
    } else if (st.tab === "motifs") {
      html = `<div class="st-panel-in">
        <div class="st-scroll" role="tablist" aria-label="Catégories">${L.CATS.map((c) => `<button type="button" class="st-chip" data-cat="${c.id}" aria-pressed="${st.motifCat === c.id}">${esc(c.name)}</button>`).join("")}</div>
        <div class="st-grid">${L.MOTIFS.filter((m) => m.cat === st.motifCat)
          .map((m) => `<button type="button" data-motif="${m.id}" aria-label="${esc(m.name)}" title="${esc(m.name)}"><svg viewBox="${m.vb || "0 0 100 100"}" color="#0e2a3f">${m.svg.replace(/var\(--fork-bg, #fff\)/g, "#fff")}</svg></button>`)
          .join("")}</div>
      </div>`;
    } else if (st.tab === "photo") {
      html = `<div class="st-panel-in st-upload">
        <label class="btn full" for="stFile">Importer une photo ou une image</label>
        <input type="file" id="stFile" accept="image/png,image/jpeg,image/webp">
        ${st.images.length ? `<div class="st-thumbs">${st.images.map((i) => `<button type="button" data-reuse="${esc(i.id)}" aria-label="Réutiliser cette image"><img src="${esc(L.imageUrl({ img: i.id, k: i.k }))}" alt=""></button>`).join("")}</div>` : ""}
        <p class="st-note">Niveau FORK Unlimited${cfg.prices ? ` (${euros(cfg.prices.unlimited)})` : ""}. Pour un beau rendu : une image nette et grande (au moins 2000 pixels), idéalement un PNG à fond transparent.</p>
        <p class="st-note">N'importe que des images que tu as le droit d'utiliser : pas de logo d'une autre marque, de personnage connu ni de photo de quelqu'un sans son accord. Chaque image est vérifiée avant fabrication.</p>
      </div>`;
    }
    panel.innerHTML = html;
    // Pastilles de couleur : fond posé par le script (pas de style dans le HTML, politique de sécurité).
    $$(".st-sw[data-color], .st-sw[data-logo]", panel).forEach((b) => (b.style.background = b.dataset.color || b.dataset.logo));
  }

  function renderAll() {
    renderTop();
    renderStage();
    renderPanel();
  }

  // --- Gestes sur le t-shirt (doigt, souris) ---------------------------------
  const pointers = new Map();
  let gest = null;
  function toSvg(e) {
    const svg = stage.querySelector("svg");
    const m = svg?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const ang = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const normRot = (r) => {
    let v = ((r + 180) % 360 + 360) % 360 - 180;
    for (const s of [-180, -90, 0, 90, 180]) if (Math.abs(v - s) < 4) v = s;
    return v === -180 ? 180 : v;
  };
  function startPinch() {
    const el = selected();
    if (!el) return;
    const [a, b] = [...pointers.values()];
    gest = { type: "pinch", d0: dist(a, b), a0: ang(a, b), size0: sizeOf(el), r0: el.r || 0, before: gest?.before || snap(), moved: true };
  }
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".st-hint")) return;
    stage.setPointerCapture?.(e.pointerId);
    const p = toSvg(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) return startPinch();
    if (pointers.size > 2) return;
    const z = zone();
    if (e.target.closest(".st-handle-hit") && selected()) {
      const el = selected();
      const c = { x: el.x + z.x, y: el.y + z.y };
      gest = { type: "handle", c, d0: Math.max(1, dist(p, c)), a0: ang(c, p), size0: sizeOf(el), r0: el.r || 0, before: snap() };
      return;
    }
    const hit = e.target.closest("[data-el]");
    if (hit) {
      const idx = Number(hit.dataset.el);
      const changed = st.sel !== idx;
      st.sel = idx;
      const el = selected();
      gest = { type: "drag", p0: p, x0: el.x, y0: el.y, before: snap() };
      if (changed) renderAll();
      return;
    }
    gest = null;
    if (st.sel !== null) {
      st.sel = null;
      renderAll();
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = toSvg(e);
    pointers.set(e.pointerId, p);
    const el = selected();
    if (!gest || !el) return;
    if (gest.type === "drag") {
      el.x = gest.x0 + (p.x - gest.p0.x);
      el.y = gest.y0 + (p.y - gest.p0.y);
    } else if (gest.type === "handle") {
      setSize(el, gest.size0 * (dist(p, gest.c) / gest.d0));
      el.r = normRot(gest.r0 + (ang(gest.c, p) - gest.a0));
    } else if (gest.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      setSize(el, gest.size0 * (dist(a, b) / Math.max(1, gest.d0)));
      el.r = normRot(gest.r0 + (ang(a, b) - gest.a0));
    }
    gest.moved = true;
    st.hint = false;
    fit(el);
    renderStage();
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size) {
      // On relâche un doigt sur deux : on attend que tout soit relâché.
      if (gest) gest.type = "wait";
      return;
    }
    if (gest?.moved) {
      pushUndo(gest.before);
      renderAll();
    }
    gest = null;
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  // Clavier (ordinateur) : flèches pour déplacer, Suppr pour effacer, Cmd/Ctrl+Z.
  document.addEventListener("keydown", (e) => {
    if ($("#stEditor").hidden || e.target.closest("textarea, input")) return;
    const el = selected();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (!el) return;
    const step = e.shiftKey ? 10 : 2;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      change(() => {
        el.x += moves[e.key][0];
        el.y += moves[e.key][1];
      });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      change(() => {
        els().splice(st.sel, 1);
        st.sel = null;
      }, false);
    }
  });

  // --- Panneau : clics et réglages -------------------------------------------
  const panel = $("#stPanel");
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const el = selected();
    if (b.dataset.garment) {
      return change(() => {
        const from = st.design.color;
        st.design.color = b.dataset.garment;
        // Les éléments noirs sur t-shirt noir (ou blancs sur blanc) passent à la couleur visible.
        const swap = { blanc: "#ffffff", noir: "#111111" };
        for (const side of ["front", "back"])
          for (const x of st.design[side]) if (x.t !== "image" && x.color === swap[st.design.color] && from !== st.design.color) x.color = swap[from];
        if (st.design.logoColor === swap[st.design.color]) st.design.logoColor = swap[from];
      }, false);
    }
    if (b.dataset.logo) return change(() => (st.design.logoColor = b.dataset.logo), false);
    if (b.dataset.color && el) return change(() => (el.color = b.dataset.color));
    if (b.dataset.font && el) {
      const f = L.fontById(b.dataset.font);
      return (document.fonts?.load?.(`40px "${f.family}"`) || Promise.resolve()).then(() => change(() => (el.font = f.id)));
    }
    if (b.dataset.cat) {
      st.motifCat = b.dataset.cat;
      return renderPanel();
    }
    if (b.dataset.motif) return addElement({ t: "motif", id: b.dataset.motif, color: b.dataset.motif === "sapin" || b.dataset.motif === "houx" ? "#2f7d4a" : ["coeur", "flamme", "boule", "bonnet"].includes(b.dataset.motif) ? "#c8102e" : b.dataset.motif === "soleil" ? "#f2b632" : defaultColor(), w: 90 });
    if (b.dataset.preset) return addText(b.dataset.preset);
    if (b.dataset.reuse) {
      const i = st.images.find((x) => x.id === b.dataset.reuse);
      if (i) addImageEl(i);
      return;
    }
    if (b.dataset.act && el) {
      const a = b.dataset.act;
      if (a === "dup") {
        if (els().length >= 25) return toast("25 éléments maximum par face.", true);
        return change(() => {
          const copy = JSON.parse(JSON.stringify(el));
          copy.x += 12;
          copy.y += 12;
          els().push(copy);
          st.sel = els().length - 1;
        });
      }
      if (a === "center") return change(() => (el.x = cfg.zones[st.side].w / 2));
      if (a === "front")
        return change(() => {
          els().splice(st.sel, 1);
          els().push(el);
          st.sel = els().length - 1;
        });
      if (a === "del")
        return change(() => {
          els().splice(st.sel, 1);
          st.sel = null;
        }, false);
    }
    const act = b.dataset.st;
    if (act === "deselect") {
      st.sel = null;
      return renderAll();
    }
    if (act === "addtext") return addText($("#stNewText").value);
    if (act === "reset") {
      if (b.dataset.confirm !== "1") {
        b.dataset.confirm = "1";
        b.textContent = "Touche encore pour tout effacer";
        return;
      }
      return change(() => {
        st.design.front = [];
        st.design.back = [];
        st.sel = null;
      }, false);
    }
  });
  let liveBefore = null;
  panel.addEventListener("focusin", (e) => {
    if (e.target.matches("#stTextEdit, #stSize, #stRot, [data-color-custom], [data-logo-custom]")) liveBefore = snap();
  });
  panel.addEventListener("pointerdown", (e) => {
    if (e.target.matches("#stSize, #stRot")) liveBefore = snap();
  });
  panel.addEventListener("input", (e) => {
    const el = selected();
    const t = e.target;
    if (t.id === "stTextEdit" && el) {
      el.text = t.value.split("\n").slice(0, 3).join("\n");
      fit(el);
      renderStage();
    } else if (t.id === "stSize" && el) {
      setSize(el, Number(t.value));
      fit(el);
      t.nextElementSibling.textContent = `${(sizeOf(el) / 10).toFixed(1)} cm`;
      renderStage();
    } else if (t.id === "stRot" && el) {
      el.r = Number(t.value);
      fit(el);
      t.nextElementSibling.textContent = `${Math.round(el.r)}°`;
      renderStage();
    } else if (t.matches("[data-color-custom]") && el) {
      el.color = t.value;
      renderStage();
    } else if (t.matches("[data-logo-custom]")) {
      st.design.logoColor = t.value;
      renderStage();
    }
    renderTop();
  });
  panel.addEventListener("change", (e) => {
    if (e.target.id === "stFile") return upload(e.target.files?.[0]);
    if (liveBefore) {
      pushUndo(liveBefore);
      liveBefore = null;
      renderTop();
      if (e.target.matches("[data-color-custom], [data-logo-custom], #stSize")) renderPanel();
    }
  });
  panel.addEventListener("keydown", (e) => {
    if (e.target.id === "stNewText" && e.key === "Enter" && !e.shiftKey && e.target.value.split("\n").length >= 3) e.preventDefault();
  });

  // --- Import d'image (FORK Unlimited) ---------------------------------------
  function addImageEl(i) {
    const z = cfg.zones[st.side];
    const ar = i.h / i.w;
    let w = z.w * 0.7;
    if (w * ar > z.h * 0.7) w = (z.h * 0.7) / ar;
    addElement({ t: "image", img: i.id, k: i.k, ar, w });
  }
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const max = 3600;
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        // PNG conservé (transparence utile en DTF) s'il reste raisonnable, sinon JPEG.
        let data = file.type === "image/png" ? c.toDataURL("image/png") : "";
        if (!data || data.length > 5_000_000) data = c.toDataURL("image/jpeg", 0.92);
        if (data.length > 5_000_000) data = c.toDataURL("image/jpeg", 0.8);
        resolve({ data, w: c.width, h: c.height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Cette image n'a pas pu être lue. Essaie une photo JPEG ou PNG."));
      };
      img.src = url;
    });
  }
  async function upload(file) {
    if (!file) return;
    const label = $('label[for="stFile"]');
    if (label) label.textContent = "Vérification de l'image…";
    try {
      const img = await readImage(file);
      const res = await fetch("/api/studio/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: img.data, width: img.w, height: img.h }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import impossible pour le moment.");
      const info = { id: data.id, k: data.k, w: data.width, h: data.height };
      st.images = [info, ...st.images.filter((x) => x.id !== info.id)].slice(0, 12);
      store.set(IMG_KEY, st.images);
      if (data.warning) toast(data.warning, true);
      addImageEl(info);
    } catch (err) {
      toast(err.message, true);
      renderPanel();
    }
  }

  // --- Barre du haut, onglets ---------------------------------------------------
  const editor = $("#stEditor");
  const recap = $("#stRecap");
  editor.addEventListener("click", (e) => {
    const side = e.target.closest("[data-side]");
    if (side) {
      st.side = side.dataset.side;
      st.sel = null;
      return renderAll();
    }
    const tab = e.target.closest(".st-tabs [data-tab]");
    if (tab) {
      st.tab = tab.dataset.tab;
      st.sel = null;
      return renderAll();
    }
    const a = e.target.closest(".st-top [data-st], .st-tabs [data-st]")?.dataset.st;
    if (a === "close") return closeStudio();
    if (a === "undo") return undo();
    if (a === "redo") return redo();
    if (a === "recap") return openRecap();
  });

  function openStudio(fromExample) {
    if (!cfg.open) {
      toast(cfg.enabled ? "Les commandes du Studio sont terminées." : "Le Studio ouvre très bientôt !", true);
      return;
    }
    if (fromExample) {
      const before = snap();
      st.design = JSON.parse(JSON.stringify(fromExample));
      st.undo.push(before);
      save();
    }
    st.side = st.design.back.length || !st.design.front.length ? "back" : "front";
    st.sel = null;
    editor.hidden = false;
    document.body.classList.add("st-open");
    try {
      history.pushState({ forkStudio: 1 }, "", "#creer");
    } catch {
      /* rien */
    }
    renderAll();
  }
  function closeStudio(fromHistory) {
    editor.hidden = true;
    recap.hidden = true;
    document.body.classList.remove("st-open");
    if (!fromHistory && location.hash === "#creer") history.back();
  }
  window.addEventListener("popstate", () => {
    if (!recap.hidden) {
      recap.hidden = true;
      editor.hidden = false;
      history.pushState({ forkStudio: 1 }, "", "#creer");
      return;
    }
    if (!editor.hidden) closeStudio(true);
  });

  // --- Récapitulatif et ajout au panier ---------------------------------------
  const rec = { size: null, qty: 1, ok: false, busy: false };
  function openRecap() {
    if (!st.design.front.length && !st.design.back.length) return toast("Ajoute au moins un texte, un motif ou une image.", true);
    st.sel = null;
    editor.hidden = true;
    recap.hidden = false;
    renderRecap();
  }
  function renderRecap() {
    const d = st.design;
    const unit = L.priceOf(d, cfg.prices);
    const tier = L.TIERS[L.tierOf(d)];
    $("#stRecapBody").innerHTML = `
      <div class="st-recap-views">
        <figure>${L.renderSide(d, "front", { settings: cfg, imageHref })}<figcaption>Devant</figcaption></figure>
        <figure>${L.renderSide(d, "back", { settings: cfg, imageHref })}<figcaption>Dos</figcaption></figure>
      </div>
      <div class="card stack">
        <div class="row"><span>${esc(tier.name)} · ${esc(tier.what)}</span><b>${unit ? euros(unit) : "—"}</b></div>
        <p class="hint">T-shirt ${esc(L.GARMENTS[d.color].name.toLowerCase())}, logo FORK ${esc(L.COLORS.find(([h]) => h === d.logoColor)?.[1]?.toLowerCase() || "personnalisé")}${d.front.length && d.back.length && cfg.prices?.bothSides ? `, impression devant et dos (+${euros(cfg.prices.bothSides)} inclus)` : ""}.</p>
        <div class="field"><span class="up">Taille</span><div class="sizes">${cfg.sizes.map((s) => `<button type="button" class="size" data-rsize="${s}" aria-pressed="${rec.size === s}">${s}</button>`).join("")}</div>
          <p class="hint">À plat : S 46 × 71 · M 50 × 73 · L 55 × 76 · XL 59 × 76 · XXL 63 × 79 · 3XL 65 × 82 cm (largeur × longueur).</p></div>
        <div class="field"><span class="up">Quantité</span><div class="qty"><button type="button" data-rqty="-1" aria-label="Diminuer">−</button><span>${rec.qty}</span><button type="button" data-rqty="1" aria-label="Augmenter">+</button></div></div>
        <p class="notice">${esc(cfg.deliveryText || "Précommande de Noël")}${cfg.deadline ? ` · commande avant le ${esc(dateFr(cfg.deadline))}` : ""}. Chaque création est vérifiée par FORK avant fabrication.</p>
        <label class="check"><input type="checkbox" id="stOk" ${rec.ok ? "checked" : ""}><span>J'ai compris : mon t-shirt est fabriqué sur mesure pour moi et ne pourra pas être retourné (sauf défaut de fabrication).</span></label>
        <p class="notice err" id="stRecapErr" hidden></p>
        <button type="button" class="btn full" id="stAdd" ${rec.size && rec.ok && unit && !rec.busy ? "" : "disabled"}>${rec.busy ? "Enregistrement…" : `Ajouter au panier · ${unit ? euros(unit * rec.qty) : "—"}`}</button>
        <button type="button" class="link" data-st="back">Modifier ma création</button>
      </div>`;
  }
  recap.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.st === "back") {
      recap.hidden = true;
      editor.hidden = false;
      return renderAll();
    }
    if (b.dataset.rsize) {
      rec.size = b.dataset.rsize;
      return renderRecap();
    }
    if (b.dataset.rqty) {
      rec.qty = Math.min(10, Math.max(1, rec.qty + Number(b.dataset.rqty)));
      return renderRecap();
    }
    if (b.dataset.clear) {
      Shop?.clearCart();
      return addToCart();
    }
    if (b.id === "stAdd") return addToCart();
  });
  recap.addEventListener("change", (e) => {
    if (e.target.id === "stOk") {
      rec.ok = e.target.checked;
      renderRecap();
    }
  });
  async function addToCart() {
    const err = $("#stRecapErr");
    rec.busy = true;
    renderRecap();
    try {
      const res = await fetch("/api/studio/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ design: st.design }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) throw new Error(data.error || "Impossible d'enregistrer ta création pour le moment.");
      let thumb = null;
      try {
        const side = data.design.back.length ? "back" : "front";
        thumb = await L.mockupDataUrl(data.design, side, cfg, 200);
      } catch {
        thumb = null;
      }
      const result = Shop?.addStudioToCart({
        designId: data.id,
        size: rec.size,
        qty: rec.qty,
        unitCents: data.priceCents,
        tierName: L.TIERS[data.tier]?.name || "Création",
        colorName: L.GARMENTS[data.design.color].name,
        thumb,
      });
      rec.busy = false;
      if (!result?.ok) {
        renderRecap();
        const e2 = $("#stRecapErr");
        e2.innerHTML = `Ton panier contient d'autres articles. Les créations du Studio se commandent à part (elles partent pour Noël).<br><button type="button" class="btn out" data-clear="1">Vider le panier et ajouter ma création</button>`;
        e2.hidden = false;
        return;
      }
      closeStudio();
      toast("Ta création est dans le panier 🎄");
      setTimeout(() => Shop?.openCart(), 50);
    } catch (error) {
      rec.busy = false;
      renderRecap();
      const e2 = $("#stRecapErr");
      e2.textContent = error.message;
      e2.hidden = false;
    }
    void err;
  }

  // --- Page de présentation ----------------------------------------------------
  const EXAMPLES = [
    {
      title: "Noël à Toulon",
      design: {
        color: "noir",
        logoColor: "#ffffff",
        front: [],
        back: [
          { t: "motif", id: "sapin", color: "#2f7d4a", x: 140, y: 120, w: 150, r: 0 },
          { t: "motif", id: "etoile", color: "#f2b632", x: 140, y: 42, w: 40, r: 0 },
          { t: "motif", id: "flocon", color: "#ffffff", x: 48, y: 70, w: 34, r: 0 },
          { t: "motif", id: "flocon", color: "#ffffff", x: 236, y: 150, w: 26, r: 18 },
          { t: "text", text: "JOYEUX NOËL", font: "noel", color: "#ffffff", x: 140, y: 248, s: 40, r: 0 },
          { t: "text", text: "DEPUIS TOULON", font: "bebas", color: "#c8102e", x: 140, y: 292, s: 26, r: 0 },
        ],
      },
    },
    {
      title: "Soleil du Sud",
      design: {
        color: "blanc",
        logoColor: "#0e2a3f",
        front: [],
        back: [
          { t: "motif", id: "soleil", color: "#f2b632", x: 140, y: 110, w: 170, r: 0 },
          { t: "motif", id: "vagues", color: "#1b8fa3", x: 140, y: 225, w: 200, r: 0 },
          { t: "text", text: "LA RADE", font: "anton", color: "#0e2a3f", x: 140, y: 312, s: 52, r: 0 },
        ],
      },
    },
    {
      title: "Cœur de Toulon",
      design: {
        color: "blanc",
        logoColor: "#c8102e",
        front: [{ t: "text", text: "Fada de toi", font: "pacifico", color: "#c8102e", x: 125, y: 40, s: 22, r: -6 }],
        back: [
          { t: "motif", id: "coeur", color: "#c8102e", x: 140, y: 140, w: 200, r: 0 },
          { t: "text", text: "83", font: "rubik", color: "#ffffff", x: 140, y: 130, s: 70, r: 0 },
          { t: "text", text: "TOULON", font: "rubik", color: "#111111", x: 140, y: 290, s: 30, r: 0 },
        ],
      },
    },
  ];
  function renderLanding() {
    const ex = $("#stExamples");
    if (ex)
      ex.innerHTML = EXAMPLES.map(
        (x, i) => `<article class="st-example">
          <div class="st-pair">${L.renderSide(x.design, "front", { settings: cfg })}${L.renderSide(x.design, "back", { settings: cfg })}</div>
          <b>${esc(x.title)}</b>
          <button type="button" class="btn out full" data-example="${i}" ${cfg.open ? "" : "disabled"}>Partir de cet exemple</button>
        </article>`,
      ).join("");
    const hero = $("#stHeroArt");
    if (hero) hero.innerHTML = L.renderSide(EXAMPLES[1].design, "back", { settings: cfg });
    const xm = $("#stXmasArt");
    if (xm) xm.innerHTML = L.renderSide(EXAMPLES[0].design, "back", { settings: cfg });
    $$("[data-tier-price]").forEach((el) => (el.textContent = cfg.prices ? euros(cfg.prices[el.dataset.tierPrice]) : "—"));
    const both = $("#stBothSides");
    if (both) both.textContent = cfg.prices?.bothSides ? `Impression devant et dos : +${euros(cfg.prices.bothSides)}. Le logo FORK côté cœur est toujours compris.` : "";
    const status = $("#stStatus");
    if (status)
      status.textContent = !cfg.enabled
        ? "Le Studio ouvre très bientôt. Suis-nous sur Instagram @fork__off pour ne pas rater l'ouverture."
        : cfg.open
          ? `Commandes ouvertes jusqu'au ${dateFr(cfg.deadline)} · ${cfg.deliveryText}`
          : "Les commandes de la Christmas Edition sont terminées. Merci à tous !";
    const dl = $("#stDeadline");
    if (dl) dl.textContent = cfg.enabled && cfg.deadline ? `${cfg.deliveryText}. Dernier jour pour commander : le ${dateFr(cfg.deadline)}.` : "";
    const faq = $("#stDeliveryFaq");
    if (faq && cfg.enabled) faq.textContent = `C'est une précommande : toutes les créations sont fabriquées ensemble, puis envoyées en Colissimo suivi. ${cfg.deliveryText}${cfg.deadline ? `, pour toute commande passée avant le ${dateFr(cfg.deadline)}` : ""}.`;
    $$("[data-studio-start]").forEach((b) => (b.disabled = !cfg.open));
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-studio-start]")) return openStudio();
    const ex = e.target.closest("[data-example]");
    if (ex) openStudio(EXAMPLES[Number(ex.dataset.example)].design);
  });

  Shop?.onShop((shop) => {
    if (shop.studio) cfg = { ...cfg, ...shop.studio };
    renderLanding();
    if (location.hash === "#creer" && cfg.open && editor.hidden) {
      history.replaceState(null, "", location.pathname);
      openStudio();
    }
  });
  renderLanding();
  // Les polices sont chargées dès l'arrivée : l'aperçu et les mesures de texte sont justes.
  if (document.fonts?.load) Promise.all(L.FONTS.map((f) => document.fonts.load(`40px "${f.family}"`).catch(() => null))).then(() => renderLanding());
})();
