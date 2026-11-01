"use strict";

/*
 * FORK Custom Studio — bibliothèque partagée (site + admin).
 *
 * Unités : millimètres. Le t-shirt est dessiné à l'échelle d'un M posé à plat
 * (50 × 73 cm). Chaque zone d'impression a son origine en haut à gauche ;
 * un élément est placé par son centre (x, y), sa taille et sa rotation.
 * Le même rendu sert à l'aperçu client et au fichier imprimeur (PNG 300 dpi).
 */
(() => {
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Polices libres (SIL OFL / Apache 2.0), hébergées sur le site.
  const FONTS = [
    { id: "anton", name: "Anton", file: "Anton-Regular.ttf", family: "FS Anton" },
    { id: "archivo", name: "Archivo Black", file: "ArchivoBlack-Regular.ttf", family: "FS Archivo" },
    { id: "bebas", name: "Bebas Neue", file: "BebasNeue-Regular.ttf", family: "FS Bebas" },
    { id: "marker", name: "Marker", file: "PermanentMarker-Regular.ttf", family: "FS Marker" },
    { id: "rubik", name: "Rubik Mono", file: "RubikMonoOne-Regular.ttf", family: "FS Rubik" },
    { id: "pacifico", name: "Pacifico", file: "Pacifico-Regular.ttf", family: "FS Pacifico" },
    { id: "caveat", name: "Caveat", file: "Caveat.ttf", family: "FS Caveat" },
    { id: "monoton", name: "Monoton", file: "Monoton-Regular.ttf", family: "FS Monoton" },
    { id: "noel", name: "Noël", file: "MountainsofChristmas-Bold.ttf", family: "FS Noel" },
  ];
  const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
  const FONT_BASE = "/studio/fonts/";

  const COLORS = [
    ["#111111", "Noir"],
    ["#ffffff", "Blanc"],
    ["#c8102e", "Rouge"],
    ["#0e2a3f", "Bleu rade"],
    ["#1b8fa3", "Bleu volet"],
    ["#7fb8e0", "Bleu ciel"],
    ["#f2b632", "Jaune soleil"],
    ["#e8692c", "Orange"],
    ["#f29bb8", "Rose"],
    ["#2f7d4a", "Vert"],
    ["#6b4aa0", "Violet"],
    ["#e9dcc0", "Sable"],
    ["#8a8a8a", "Gris"],
    ["#c9a227", "Doré"],
  ];

  // T-shirts vierges proposés : blanc et noir uniquement.
  const GARMENTS = {
    blanc: { name: "Blanc", fill: "#f7f6f2", stroke: "#d9d5cc", shade: "rgba(0,0,0,.06)" },
    noir: { name: "Noir", fill: "#1a1a1a", stroke: "#000000", shade: "rgba(255,255,255,.05)" },
  };

  // Bibliothèque : dessins originaux FORK, vectoriels, d'une seule couleur (currentColor).
  const S = 'stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const MOTIFS = [
    // --- Noël
    { id: "flocon", cat: "noel", name: "Flocon", svg: `<g ${S} stroke-width="5">${[0, 60, 120].map((a) => `<g transform="rotate(${a} 50 50)"><path d="M50 6v88"/><path d="M50 22l-9-9M50 22l9-9M50 78l-9 9M50 78l9 9M50 36l-7-6M50 36l7-6M50 64l-7 6M50 64l7 6"/></g>`).join("")}</g>` },
    { id: "etoile", cat: "noel", name: "Étoile", svg: `<path fill="currentColor" d="M50 4l13.4 29.6L96 37.3 71.6 59.5 78.4 92 50 75.6 21.6 92l6.8-32.5L4 37.3l32.6-3.7z"/>` },
    { id: "sapin", cat: "noel", name: "Sapin", svg: `<path fill="currentColor" d="M50 4L27 34h12L20 58h14L12 84h76L66 58h14L61 34h12z"/><rect fill="currentColor" x="43" y="84" width="14" height="12" rx="2"/>` },
    { id: "bonnet", cat: "noel", name: "Bonnet", svg: `<path fill="currentColor" d="M12 72C14 44 32 22 58 18c16-3 28 6 28 22v6h-9v-4c0-6-5-9-11-7-10 4-12 22-12 37z"/><rect fill="currentColor" x="8" y="68" width="64" height="18" rx="9"/><circle fill="currentColor" cx="81" cy="56" r="11"/>` },
    { id: "cadeau", cat: "noel", name: "Cadeau", svg: `<path fill="currentColor" fill-rule="evenodd" d="M14 36h72v16H14zM20 52h60v40H20z M46 36h8v56h-8z"/><path ${S} stroke-width="6" d="M50 34C40 14 22 18 28 30c4 6 22 6 22 6zM50 34c10-20 28-16 22-4-4 6-22 6-22 6z"/>` },
    { id: "boule", cat: "noel", name: "Boule", svg: `<path fill="currentColor" fill-rule="evenodd" d="M50 26a32 32 0 1 1 0 64 32 32 0 0 1 0-64zM22 52h56v6H22zM24 66h52v5H24z"/><rect fill="currentColor" x="42" y="18" width="16" height="10" rx="2"/><path ${S} stroke-width="4" d="M50 18c0-8 8-10 10-6"/>` },
    { id: "houx", cat: "noel", name: "Houx", svg: `<path fill="currentColor" d="M50 52C40 40 22 40 8 46c6 4 4 10 10 12-2 6 2 10 8 8 2 6 8 6 12 2 4 4 10 2 12-6zM50 52c10-12 28-12 42-6-6 4-4 10-10 12 2 6-2 10-8 8-2 6-8 6-12 2-4 4-10 2-12-6z"/><circle fill="currentColor" cx="42" cy="36" r="8"/><circle fill="currentColor" cx="58" cy="36" r="8"/><circle fill="currentColor" cx="50" cy="24" r="8"/>` },
    { id: "sucre-orge", cat: "noel", name: "Sucre d'orge", svg: `<path ${S} stroke-width="14" d="M40 94V34a16 16 0 0 1 32 0v6"/><path stroke="var(--fork-bg, #fff)" fill="none" stroke-width="5" d="M33 82l14-8M33 64l14-8M33 46l14-8M40 26l12-8M60 20l8 12"/>` },
    { id: "etoile-filante", cat: "noel", name: "Étoile filante", svg: `<path fill="currentColor" d="M70 10l7.6 16.8 18.4 2.1-13.8 12.6 3.9 18.5L70 50.7 53.9 60l3.9-18.5L44 28.9l18.4-2.1z"/><path ${S} stroke-width="5" d="M44 44L8 80M50 56L22 92M36 34L6 56"/>` },
    { id: "renne", cat: "noel", name: "Bois de renne", svg: `<path ${S} stroke-width="6" d="M38 92V60C38 44 30 34 18 28M30 38c-8 0-14-6-16-14M24 32c4-8 2-16-4-22M62 92V60c0-16 8-26 20-32M70 38c8 0 14-6 16-14M76 32c-4-8-2-16 4-22"/><ellipse fill="currentColor" cx="50" cy="76" rx="14" ry="18"/>` },
    // --- Toulon & Méditerranée
    { id: "soleil", cat: "sud", name: "Soleil", svg: `<circle fill="currentColor" cx="50" cy="50" r="20"/><g ${S} stroke-width="6">${Array.from({ length: 12 }, (_, i) => `<path transform="rotate(${i * 30} 50 50)" d="M50 6v14"/>`).join("")}</g>` },
    { id: "vagues", cat: "sud", name: "Vagues", svg: `<g ${S} stroke-width="7"><path d="M4 34c12-12 20-12 32 0s20 12 32 0 20-12 28-4"/><path d="M4 54c12-12 20-12 32 0s20 12 32 0 20-12 28-4"/><path d="M4 74c12-12 20-12 32 0s20 12 32 0 20-12 28-4"/></g>` },
    { id: "faron", cat: "sud", name: "Faron & téléphérique", svg: `<path fill="currentColor" d="M2 92l26-34 12 10 20-34 14 18 8-6 16 46z"/><path ${S} stroke-width="3" d="M6 10l90 26"/><path ${S} stroke-width="3" d="M46 22v8"/><rect fill="currentColor" x="38" y="30" width="16" height="12" rx="3"/>` },
    { id: "voilier", cat: "sud", name: "Voilier", svg: `<path fill="currentColor" d="M48 8v60H14zM54 18c18 12 26 30 26 50H54z"/><path fill="currentColor" d="M8 74h84l-12 16H22z"/>` },
    { id: "ancre", cat: "sud", name: "Ancre", svg: `<g ${S} stroke-width="7"><circle cx="50" cy="16" r="8"/><path d="M50 24v68M32 38h36M14 62c0 18 16 30 36 30s36-12 36-30"/><path d="M8 66l6-8 8 6M92 66l-6-8-8 6"/></g>` },
    { id: "palmier", cat: "sud", name: "Palmier", svg: `<path fill="currentColor" d="M46 96c2-24 4-44 0-60h8c4 16 2 36 0 60z"/><path fill="currentColor" d="M50 34C40 18 22 14 6 22c14 0 26 4 34 14C28 30 14 36 8 48c12-8 26-10 38-8zM50 34c10-16 28-20 44-12-14 0-26 4-34 14 12-6 26 0 32 12-12-8-26-10-38-8z"/>` },
    { id: "cigale", cat: "sud", name: "Cigale", svg: `<path fill="currentColor" d="M50 14c8 0 12 6 12 12 0 4-2 7-4 9l2 44c0 10-4 16-10 16s-10-6-10-16l2-44c-2-2-4-5-4-9 0-6 4-12 12-12z"/><path fill="currentColor" opacity=".85" d="M46 36C30 40 14 60 16 86c10-4 22-20 30-40zM54 36c16 4 32 24 30 50-10-4-22-20-30-40z"/><circle fill="var(--fork-bg, #fff)" cx="44" cy="24" r="3"/><circle fill="var(--fork-bg, #fff)" cx="56" cy="24" r="3"/>` },
    { id: "rugby", cat: "sud", name: "Ballon ovale", svg: `<g transform="rotate(-35 50 50)"><ellipse fill="currentColor" cx="50" cy="50" rx="44" ry="26"/><g stroke="var(--fork-bg, #fff)" stroke-width="3.5" fill="none" stroke-linecap="round"><path d="M28 50h44"/><path d="M38 44v12M46 44v12M54 44v12M62 44v12"/><path d="M14 38c10-6 20-9 36-9M14 62c10 6 20 9 36 9"/></g></g>` },
    { id: "petanque", cat: "sud", name: "Pétanque", svg: `<g fill="currentColor"><circle cx="30" cy="62" r="22"/><circle cx="70" cy="62" r="22"/><circle cx="52" cy="26" r="8"/></g><g stroke="var(--fork-bg, #fff)" stroke-width="3" fill="none"><path d="M12 56c10 6 26 6 36 0M52 56c10 6 26 6 36 0"/></g>` },
    { id: "citron", cat: "sud", name: "Citron", svg: `<path fill="currentColor" d="M4 58l8-4c4-20 24-32 44-32 18 0 30 8 36 18l6 2-4 6c2 22-20 38-44 38-18 0-32-8-38-22z"/><path fill="currentColor" d="M54 24c2-10 12-18 26-18-2 12-12 18-26 18z"/>` },
    // --- Symboles & cœurs
    { id: "coeur", cat: "symboles", name: "Cœur", svg: `<path fill="currentColor" d="M50 90C20 68 6 52 6 32 6 18 17 8 30 8c9 0 16 5 20 12 4-7 11-12 20-12 13 0 24 10 24 24 0 20-14 36-44 58z"/>` },
    { id: "coeur-trait", cat: "symboles", name: "Cœur dessiné", svg: `<path ${S} stroke-width="7" d="M50 86C22 66 10 52 10 34 10 22 19 14 30 14c9 0 16 6 20 14 4-8 11-14 20-14 11 0 20 8 20 20 0 18-12 32-40 52z"/>` },
    { id: "eclair", cat: "symboles", name: "Éclair", svg: `<path fill="currentColor" d="M58 4L18 56h26l-8 40 46-56H54z"/>` },
    { id: "couronne", cat: "symboles", name: "Couronne", svg: `<path fill="currentColor" d="M10 30l20 18 20-30 20 30 20-18-8 46H18z"/><rect fill="currentColor" x="18" y="80" width="64" height="10" rx="2"/>` },
    { id: "flamme", cat: "symboles", name: "Flamme", svg: `<path fill="currentColor" d="M52 4c4 18 30 30 30 58 0 20-14 34-32 34S18 82 18 64c0-14 8-22 14-28 0 10 4 16 10 18-4-20 4-36 10-50z"/>` },
    { id: "etincelles", cat: "symboles", name: "Étincelles", svg: `<path fill="currentColor" d="M40 10c3 18 8 23 26 26-18 3-23 8-26 26-3-18-8-23-26-26 18-3 23-8 26-26zM74 54c2 11 5 14 16 16-11 2-14 5-16 16-2-11-5-14-16-16 11-2 14-5 16-16zM24 66c1.5 8 4 10 12 12-8 1.5-10.5 4-12 12-1.5-8-4-10.5-12-12 8-2 10.5-4 12-12z"/>` },
    { id: "oeil", cat: "symboles", name: "Œil", svg: `<path fill="currentColor" fill-rule="evenodd" d="M4 50C16 28 32 18 50 18s34 10 46 32C84 72 68 82 50 82S16 72 4 50zm46-20a20 20 0 1 0 0 40 20 20 0 0 0 0-40z"/><circle fill="currentColor" cx="50" cy="50" r="10"/>` },
    // --- Street & motifs
    { id: "trame", cat: "street", name: "Trame", svg: `<g fill="currentColor">${Array.from({ length: 36 }, (_, i) => { const x = 10 + (i % 6) * 16, y = 10 + Math.floor(i / 6) * 16, r = 2 + ((i % 6) + Math.floor(i / 6)) * 0.55; return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}"/>`; }).join("")}</g>` },
    { id: "rayures", cat: "street", name: "Rayures", svg: `<g fill="currentColor">${Array.from({ length: 6 }, (_, i) => `<rect x="4" y="${6 + i * 16}" width="92" height="8"/>`).join("")}</g>` },
    { id: "damier", cat: "street", name: "Damier", svg: `<g fill="currentColor">${Array.from({ length: 25 }, (_, i) => ((i % 5) + Math.floor(i / 5)) % 2 ? "" : `<rect x="${2 + (i % 5) * 19.2}" y="${2 + Math.floor(i / 5) * 19.2}" width="19.2" height="19.2"/>`).join("")}</g>` },
    { id: "tache", cat: "street", name: "Éclaboussure", svg: `<path fill="currentColor" d="M48 14c8 0 10 12 18 10s14-10 18-4-6 12 0 18 16 2 14 10-14 4-14 12 10 14 4 18-12-6-18 0-2 18-10 18-6-14-14-14-12 10-18 6 2-14-4-18-16 0-16-8 12-6 12-14-12-10-8-16 14 2 18-4-4-16 4-18z"/><circle fill="currentColor" cx="14" cy="16" r="5"/><circle fill="currentColor" cx="88" cy="88" r="4"/><circle fill="currentColor" cx="90" cy="12" r="3"/>` },
    { id: "spray", cat: "street", name: "Cercle tagué", svg: `<path ${S} stroke-width="9" d="M80 30C70 14 46 8 28 20 10 32 8 58 22 74c14 16 42 18 58 4 12-10 14-28 8-40"/>` },
    { id: "fleche", cat: "street", name: "Flèche", svg: `<path ${S} stroke-width="8" d="M10 70c20-34 44-48 74-48M64 8l20 14-14 20"/>` },
    // --- Formes simples
    { id: "rond", cat: "formes", name: "Rond", svg: `<circle fill="currentColor" cx="50" cy="50" r="46"/>` },
    { id: "carre", cat: "formes", name: "Carré", svg: `<rect fill="currentColor" x="6" y="6" width="88" height="88" rx="4"/>` },
    { id: "losange", cat: "formes", name: "Losange", svg: `<path fill="currentColor" d="M50 4l46 46-46 46L4 50z"/>` },
    { id: "triangle", cat: "formes", name: "Triangle", svg: `<path fill="currentColor" d="M50 8l46 82H4z"/>` },
    { id: "anneau", cat: "formes", name: "Anneau", svg: `<circle ${S} stroke-width="8" cx="50" cy="50" r="42"/>` },
    { id: "cadre", cat: "formes", name: "Cadre", svg: `<rect ${S} stroke-width="6" x="5" y="5" width="90" height="90"/>` },
    { id: "banniere", cat: "formes", name: "Banderole", ar: 0.36, vb: "0 0 100 36", svg: `<path fill="currentColor" d="M14 4h72v24H14zM14 10H2l6 9-6 9h12zM86 10h12l-6 9 6 9H86z"/>` },
    { id: "trait", cat: "formes", name: "Trait", ar: 0.1, vb: "0 0 100 10", svg: `<rect fill="currentColor" x="0" y="2" width="100" height="6" rx="3"/>` },
  ];
  const CATS = [
    { id: "noel", name: "Christmas Edition" },
    { id: "sud", name: "Toulon & Méditerranée" },
    { id: "symboles", name: "Symboles & cœurs" },
    { id: "street", name: "Street" },
    { id: "formes", name: "Formes" },
  ];
  const motifById = (id) => MOTIFS.find((m) => m.id === id) || null;

  // --- Géométrie du t-shirt (taille M à plat, mm) ---------------------------
  const W = 760;
  const H = 820;
  const CX = W / 2;
  const BODY = (neckDepth) =>
    `M300 45C330 ${neckDepth} 430 ${neckDepth} 460 45L585 75L722 252L642 322L625 272L630 780Q380 792 130 780L135 272L118 322L38 252L175 75Z`;
  const NECK = (neckDepth) => `M300 45C330 ${neckDepth} 430 ${neckDepth} 460 45`;
  const DEFAULT_SETTINGS = { zones: { front: { w: 250, h: 300 }, back: { w: 280, h: 360 } }, logoWidth: 80 };
  const LOGO_AR = 1084 / 1617; // hauteur / largeur du logo officiel
  function zoneRect(side, settings) {
    const z = (settings?.zones || DEFAULT_SETTINGS.zones)[side];
    const top = side === "front" ? 215 : 110;
    return { x: CX - z.w / 2, y: top, w: z.w, h: z.h };
  }
  function logoRect(settings) {
    const w = settings?.logoWidth || DEFAULT_SETTINGS.logoWidth;
    const h = w * LOGO_AR;
    return { x: CX + 110 - w / 2, y: 170 - h / 2, w, h };
  }

  // --- Rendu d'un élément (coordonnées de zone) -----------------------------
  function elementSvg(el, ctx) {
    const rot = Number(el.r) || 0;
    const tr = rot ? ` transform="rotate(${rot.toFixed(2)} ${el.x.toFixed(2)} ${el.y.toFixed(2)})"` : "";
    const data = ctx.interactive ? ` data-el="${ctx.index}" class="st-el${ctx.selected ? " sel" : ""}"` : "";
    if (el.t === "text") {
      const f = fontById(el.font);
      const lines = String(el.text || "").split("\n").slice(0, 3);
      const s = Number(el.s) || 20;
      const lh = s * 1.1;
      const y0 = el.y - ((lines.length - 1) * lh) / 2;
      const spans = lines
        .map((ln, i) => `<tspan x="${el.x.toFixed(2)}" y="${(y0 + i * lh).toFixed(2)}">${esc(ln) || " "}</tspan>`)
        .join("");
      return `<g${data}${tr}><text font-family="'${f.family}'" font-size="${s.toFixed(2)}" fill="${esc(el.color)}" text-anchor="middle" dominant-baseline="central"${el.ls ? ` letter-spacing="${(s * el.ls).toFixed(2)}"` : ""}>${spans}</text></g>`;
    }
    if (el.t === "motif") {
      const m = motifById(el.id);
      if (!m) return "";
      const ar = m.ar || 1;
      const w = Number(el.w) || 60;
      const h = w * ar;
      return `<g${data}${tr}><svg x="${(el.x - w / 2).toFixed(2)}" y="${(el.y - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" viewBox="${m.vb || "0 0 100 100"}" color="${esc(el.color)}" overflow="visible">${m.svg.replace(/var\(--fork-bg, #fff\)/g, esc(ctx.bg))}</svg></g>`;
    }
    if (el.t === "image") {
      const w = Number(el.w) || 80;
      const h = w * (Number(el.ar) || 1);
      const href = ctx.imageHref ? ctx.imageHref(el) : "";
      return `<g${data}${tr}><image href="${esc(href)}" x="${(el.x - w / 2).toFixed(2)}" y="${(el.y - h / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" preserveAspectRatio="none"/></g>`;
    }
    return "";
  }

  let uid = 0;
  // Rendu de l'encre sur le tissu (repris dans studio.css pour l'affichage sur la page).
  const INK_CSS = ".fk-ink-light{mix-blend-mode:multiply}.fk-ink-dark{opacity:.96}";
  function logoSvg(color, rect, href) {
    const id = `fkLogoTint${++uid}`;
    return `<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feFlood flood-color="${esc(color)}"/><feComposite in2="SourceAlpha" operator="in"/></filter>
      <image class="st-logo" href="${esc(href)}" x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${rect.w.toFixed(2)}" height="${rect.h.toFixed(2)}" filter="url(#${id})" preserveAspectRatio="none"/>`;
  }

  /**
   * Aperçu d'une face du t-shirt (vêtement + zone + éléments + logo).
   * opts : { settings, interactive, selected, showZone, imageHref(el), logoHref }
   */
  // Photos « portées » (t-shirts vierges) et calage : position du milieu du col (cx, top, en px)
  // et échelle s (px par mm) pour poser la création au bon endroit sur le torse.
  const PHOTOS = {
    blanc: {
      front: { src: "/studio/portes/blanc-devant.jpg", w: 1200, h: 1600, cx: 600, top: 769, s: 1.725 },
      back: { src: "/studio/portes/blanc-dos.jpg", w: 1200, h: 1600, cx: 588, top: 425, s: 1.644 },
    },
    noir: {
      front: { src: "/studio/portes/noir-devant.jpg", w: 1200, h: 1600, cx: 594, top: 650, s: 1.919 },
      back: { src: "/studio/portes/noir-dos.jpg", w: 1200, h: 1600, cx: 600, top: 494, s: 1.769 },
    },
  };
  const photoOf = (design, side) => (PHOTOS[design.color] || PHOTOS.blanc)[side];

  function renderSide(design, side, opts = {}) {
    if (opts.photo !== false && typeof renderPhoto === "function") return renderPhoto(design, side, opts);
    const g = GARMENTS[design.color] || GARMENTS.blanc;
    const neck = side === "front" ? 135 : 72;
    const z = zoneRect(side, opts.settings);
    const els = (design[side] || [])
      .map((el, i) => elementSvg(el, { interactive: opts.interactive, index: i, selected: opts.selected === i, bg: g.fill, imageHref: opts.imageHref }))
      .join("");
    const logo = side === "front" ? logoSvg(design.logoColor || "#111111", logoRect(opts.settings), opts.logoHref || "/studio/logo-fork.png") : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="st-svg" role="img" aria-label="T-shirt ${g.name.toLowerCase()}, ${side === "front" ? "devant" : "dos"}">
      <defs><radialGradient id="fkShade${++uid}" cx="50%" cy="35%" r="70%"><stop offset="60%" stop-color="rgba(0,0,0,0)"/><stop offset="100%" stop-color="${g.shade}"/></radialGradient></defs>
      <path d="${BODY(neck)}" fill="${g.fill}" stroke="${g.stroke}" stroke-width="2"/>
      <path d="${BODY(neck)}" fill="url(#fkShade${uid})"/>
      <path d="${NECK(neck)}" fill="none" stroke="${g.stroke}" stroke-width="10" opacity=".6"/>
      <path d="M135 272L118 322M625 272L642 322" stroke="${g.stroke}" stroke-width="2" fill="none" opacity=".7"/>
      ${opts.showZone ? `<rect class="st-zone" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="none" stroke="${design.color === "noir" ? "rgba(255,255,255,.45)" : "rgba(0,0,0,.35)"}" stroke-width="1.6" stroke-dasharray="6 6" rx="2"/>` : ""}
      <g transform="translate(${z.x} ${z.y})" class="st-layer">${els}</g>
      ${logo}
    </svg>`;
  }

  /**
   * Aperçu « porté » : la création posée sur la photo d'un t-shirt vierge.
   * Sur le blanc, l'impression est fondue (multiplication) pour garder plis et ombres du tissu.
   * opts.crop : cadrage resserré sur le torse (éditeur).
   */
  function renderPhoto(design, side, opts = {}) {
    const P = photoOf(design, side);
    const z = zoneRect(side, opts.settings);
    const bg = design.color === "noir" ? "#1a1a1a" : "#f4f2ee";
    const els = (design[side] || [])
      .map((el, i) => elementSvg(el, { interactive: opts.interactive, index: i, selected: opts.selected === i, bg, imageHref: opts.imageHref }))
      .join("");
    const logo = side === "front" ? logoSvg(design.logoColor || "#111111", logoRect(opts.settings), opts.logoHref || "/studio/logo-fork.png") : "";
    const y0 = opts.crop ? Math.max(0, Math.round(P.top - 70 * P.s)) : 0;
    const blend = design.color === "noir" ? "fk-ink-dark" : "fk-ink-light";
    const zoneStroke = design.color === "noir" ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.4)";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${y0} ${P.w} ${P.h - y0}" class="st-svg st-photo" role="img" aria-label="T-shirt ${design.color === "noir" ? "noir" : "blanc"} porté, ${side === "front" ? "devant" : "dos"}">
      <image href="${esc(opts.photoHref ? opts.photoHref(P) : P.src)}" x="0" y="0" width="${P.w}" height="${P.h}"/>
      <g transform="translate(${(P.cx - CX * P.s).toFixed(2)} ${(P.top - 45 * P.s).toFixed(2)}) scale(${P.s})">
        ${opts.showZone ? `<rect class="st-zone" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="none" stroke="${zoneStroke}" stroke-width="1.4" stroke-dasharray="6 6" rx="2"/>` : ""}
        <g class="${blend}"><g transform="translate(${z.x} ${z.y})" class="st-layer">${els}</g>${logo}</g>
      </g>
    </svg>`;
  }

  /**
   * Fichier imprimeur d'une face : uniquement la surface imprimée, en mm.
   * Devant : la zone + le logo (mêmes positions relatives que sur le t-shirt).
   * opts : { settings, imageHref(el), logoHref, fontCss }
   */
  function renderPrint(design, side, opts = {}) {
    const z = zoneRect(side, opts.settings);
    const l = logoRect(opts.settings);
    let box = { x: z.x, y: z.y, w: z.w, h: z.h };
    if (side === "front") {
      const x0 = Math.min(z.x, l.x), y0 = Math.min(z.y, l.y);
      const x1 = Math.max(z.x + z.w, l.x + l.w), y1 = Math.max(z.y + z.h, l.y + l.h);
      box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    const bg = (GARMENTS[design.color] || GARMENTS.blanc).fill;
    const els = (design[side] || []).map((el, i) => elementSvg(el, { index: i, bg, imageHref: opts.imageHref })).join("");
    const logo = side === "front" ? logoSvg(design.logoColor || "#111111", l, opts.logoHref || "/studio/logo-fork.png") : "";
    return {
      box,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}mm" height="${box.h}mm" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">${opts.fontCss ? `<style>${opts.fontCss}</style>` : ""}<g transform="translate(${z.x} ${z.y})">${els}</g>${logo}</svg>`,
    };
  }

  function fontFaceCss(srcFor) {
    return FONTS.map((f) => `@font-face{font-family:'${f.family}';src:url('${srcFor ? srcFor(f) : FONT_BASE + f.file}') format('truetype');font-display:block}`).join("");
  }

  /** Niveau de personnalisation selon ce qui est utilisé. */
  function tierOf(design) {
    const all = [...(design.front || []), ...(design.back || [])];
    if (all.some((e) => e.t === "image")) return "unlimited";
    if (all.some((e) => e.t === "text")) return "custom";
    return "basic";
  }
  const TIERS = {
    basic: { name: "FORK Basic", what: "Motifs, formes et couleurs" },
    custom: { name: "FORK Custom", what: "Texte libre, polices et motifs" },
    unlimited: { name: "FORK Unlimited", what: "Ta propre photo ou image" },
  };
  function priceOf(design, prices) {
    if (!prices) return null;
    const base = prices[tierOf(design)];
    if (!base) return null;
    const both = (design.front || []).length > 0 && (design.back || []).length > 0;
    return base + (both ? prices.bothSides || 0 : 0);
  }

  // --- Export en image (aperçus et fichier imprimeur) ------------------------
  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("Lecture impossible"));
      r.readAsDataURL(blob);
    });
  const dataCache = new Map();
  async function fetchDataUrl(url) {
    if (dataCache.has(url)) return dataCache.get(url);
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`Fichier introuvable (${res.status})`);
    const data = await blobToDataUrl(await res.blob());
    dataCache.set(url, data);
    return data;
  }
  const imageUrl = (el) => `/api/studio-image?id=${encodeURIComponent(el.img)}&k=${encodeURIComponent(el.k)}`;

  /** Prépare polices, logo et images en données intégrées (indispensable pour dessiner un SVG dans un canvas). */
  async function embedAssets(design) {
    const all = [...(design.front || []), ...(design.back || [])];
    const fonts = [...new Set(all.filter((e) => e.t === "text").map((e) => fontById(e.font).id))];
    const fontCss = (
      await Promise.all(
        fonts.map(async (id) => {
          const f = fontById(id);
          const data = await fetchDataUrl(FONT_BASE + f.file);
          return `@font-face{font-family:'${f.family}';src:url('${data}') format('truetype')}`;
        }),
      )
    ).join("");
    const logoHref = await fetchDataUrl("/studio/logo-fork.png");
    const images = {};
    for (const e of all) if (e.t === "image") images[e.img] = await fetchDataUrl(imageUrl(e));
    return { fontCss, logoHref, imageHref: (el) => images[el.img] || "" };
  }

  function svgToCanvas(svg, widthPx, heightPx, background) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      img.onload = async () => {
        // Laisse au navigateur le temps de décoder les polices intégrées avant de dessiner.
        await new Promise((r) => setTimeout(r, 120));
        const c = document.createElement("canvas");
        c.width = Math.round(widthPx);
        c.height = Math.round(heightPx);
        const ctx = c.getContext("2d");
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Rendu impossible"));
      };
      img.src = url;
    });
  }

  /** Aperçu du t-shirt (vêtement compris) en image, pour le panier. */
  async function mockupDataUrl(design, side, settings, widthPx = 320) {
    const a = await embedAssets(design);
    const P = photoOf(design, side);
    const photo = await fetchDataUrl(P.src);
    let svg = renderSide(design, side, { settings, logoHref: a.logoHref, imageHref: a.imageHref, photoHref: () => photo, crop: true });
    const m = /viewBox="0 (\d+) (\d+) (\d+)"/.exec(svg);
    const vw = Number(m[2]);
    const vh = Number(m[3]);
    svg = svg
      .replace("<svg ", `<svg width="${vw}" height="${vh}" `)
      .replace(/(<svg [^>]*>)/, `$1<style>${a.fontCss}${INK_CSS}</style>`);
    const canvas = await svgToCanvas(svg, widthPx, (widthPx * vh) / vw, "#f8f4ec");
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  /** Fichier imprimeur d'une face : PNG transparent à la résolution demandée (300 dpi par défaut) + SVG. */
  async function printFiles(design, side, settings, dpi = 300) {
    const a = await embedAssets(design);
    const { box, svg } = renderPrint(design, side, { settings, logoHref: a.logoHref, imageHref: a.imageHref, fontCss: a.fontCss });
    const pxPerMm = dpi / 25.4;
    const canvas = await svgToCanvas(svg, box.w * pxPerMm, box.h * pxPerMm, null);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return { png, svg, box, widthPx: canvas.width, heightPx: canvas.height };
  }

  window.ForkStudioLib = { FONTS, COLORS, GARMENTS, MOTIFS, CATS, TIERS, W, H, LOGO_AR, fontById, motifById, zoneRect, logoRect, renderSide, renderPrint, fontFaceCss, tierOf, priceOf, esc, imageUrl, mockupDataUrl, printFiles };
})();
