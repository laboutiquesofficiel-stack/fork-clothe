// Génère les pages statiques dérivées du catalogue (public/assets/js/app.js) :
//   - public/t-shirt/<id>/index.html : une vraie page par t-shirt (même design que l'accueil)
//   - public/404.html                : page introuvable aux couleurs de FORK
//   - public/sitemap.xml             : plan du site pour Google
//   - public/merchant-feed.xml       : flux produits pour Google Merchant Center (Shopping)
//
// À relancer après chaque modification du catalogue :  node scripts/build-pages.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUB = join(ROOT, "public");
const SITE = "https://fork-clothe.com";

// --- Catalogue : extrait tel quel de app.js (source unique) ---------------
const appJs = readFileSync(join(PUB, "assets/js/app.js"), "utf8");
const start = appJs.indexOf("const PRODUCTS = [");
const end = appJs.indexOf("\n  ];", start);
if (start < 0 || end < 0) throw new Error("Catalogue introuvable dans app.js");
const PRODUCTS = new Function(`return ${appJs.slice(start + "const PRODUCTS = ".length, end + 4)}`)();
const forSale = PRODUCTS.filter((p) => p.sku);

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const euros = (c) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
const abs = (src) => `${SITE}/${src.replace(/^\//, "")}`;
const pageUrl = (p) => `${SITE}/t-shirt/${p.id}/`;
const plain = (s) => String(s).replace(/\s*☀\s*/g, " ").trim();
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;

// --- Gabarit : en-tête, pied de page et tiroirs repris de l'accueil -------
const index = readFileSync(join(PUB, "index.html"), "utf8");
const bodyStart = index.indexOf("<body>") + "<body>".length;
const mainStart = index.indexOf("  <main>");
const mainEnd = index.indexOf("  </main>") + "  </main>".length;
const header = index.slice(bodyStart, mainStart);
const tail = index.slice(mainEnd);
const newsStart = index.indexOf('    <section class="news"');
const newsEnd = index.indexOf("    </section>", newsStart) + "    </section>".length;
const newsBlock = index.slice(newsStart, newsEnd);

const SHARED_HEAD = `  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <base href="/">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="icon" href="/favicon-96.png" type="image/png" sizes="96x96">
  <link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="theme-color" content="#0e2a3f">
  <link rel="stylesheet" href="assets/css/fork.css">
  <script src="assets/js/app.js" defer></script>`;

const RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: "FR",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 14,
  returnMethod: "https://schema.org/ReturnByMail",
  returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
};
const SHIPPING = {
  "@type": "OfferShippingDetails",
  shippingRate: { "@type": "MonetaryAmount", value: 7.64, currency: "EUR" },
  shippingDestination: { "@type": "DefinedRegion", addressCountry: "FR" },
  deliveryTime: {
    "@type": "ShippingDeliveryTime",
    handlingTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 3, unitCode: "DAY" },
    transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 5, unitCode: "DAY" },
  },
};

function card(p) {
  return `<a class="pcard" href="t-shirt/${esc(p.id)}/" data-product="${esc(p.id)}">
          <div class="pimg">${p.isNew && p.available ? '<span class="pbadge">Nouveau</span>' : ""}<img src="${esc(p.images[0].src)}" alt="${esc(p.images[0].alt)}" loading="lazy"></div>
          <span class="pname">T-shirt ${esc(p.name)}</span>
          <span class="pmeta">${esc(p.color)} · ${p.category === "femme" ? "Femme" : "Homme"}</span>
          <span class="price">${euros(p.priceCents)}</span>
        </a>`;
}

// --- Pages t-shirt --------------------------------------------------------
rmSync(join(PUB, "t-shirt"), { recursive: true, force: true });
for (const p of forSale) {
  const title = `T-shirt ${p.name} ${p.color.toLowerCase()} · FORK Toulon`;
  const description = `${plain(p.description)} ${euros(p.priceCents)}, tailles ${p.sizes.join(", ")}.`.slice(0, 300);
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `T-shirt ${p.name}`,
    description: plain(p.description),
    image: p.images.map((i) => abs(i.src)),
    sku: p.sku,
    color: p.color,
    material: "100 % coton",
    brand: { "@type": "Brand", name: "FORK" },
    offers: {
      "@type": "Offer",
      url: pageUrl(p),
      price: (p.priceCents / 100).toFixed(2),
      priceCurrency: "EUR",
      availability: p.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "FORK" },
      shippingDetails: SHIPPING,
      hasMerchantReturnPolicy: RETURN_POLICY,
    },
  };
  const crumbsLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Collection", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: `T-shirt ${p.name}`, item: pageUrl(p) },
    ],
  };
  const others = forSale.filter((o) => o.id !== p.id);
  const html = `<!doctype html>
<html lang="fr">
<head>
${SHARED_HEAD}
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${pageUrl(p)}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="FORK">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:url" content="${pageUrl(p)}">
  <meta property="og:title" content="T-shirt ${esc(p.name)} · FORK">
  <meta property="og:description" content="${esc(plain(p.description))}">
  <meta property="og:image" content="${abs(p.images[0].src)}">
  <meta property="og:image:alt" content="${esc(p.images[0].alt)}">
  <meta property="product:price:amount" content="${(p.priceCents / 100).toFixed(2)}">
  <meta property="product:price:currency" content="EUR">
  <meta name="twitter:card" content="summary_large_image">
  ${ld(productLd)}
  ${ld(crumbsLd)}
</head>
<body data-product-page="${esc(p.id)}">${header}  <main>
    <div class="wrap">
      <nav class="crumbs" aria-label="Fil d'Ariane"><a href="./#produits">Collection</a><span aria-hidden="true">›</span><span>T-shirt ${esc(p.name)}</span></nav>
      <div class="sheet page-sheet" id="pageSheet">
        <div class="gallery">${p.images.map((img, i) => `<img src="${esc(img.src)}" alt="${esc(img.alt)}"${i ? ' loading="lazy"' : ""}>`).join("")}</div>
        <div class="sheet-info page-static">
          <h1>T-shirt ${esc(p.name)}</h1>
          <p class="pmeta">${esc(p.color)} · ${p.category === "femme" ? "Femme" : "Homme"}</p>
          <p class="price">${euros(p.priceCents)}</p>
          <p class="muted">${esc(p.description)}</p>
          <p>Tailles : ${p.sizes.map(esc).join(", ")}. 100 % coton, 220 g/m².</p>
        </div>
      </div>
    </div>

    <section class="sec wrap" aria-labelledby="othersTitle">
      <div class="sec-head"><h2 id="othersTitle">Les autres t-shirts</h2><a class="link" href="./#produits">Toute la collection</a></div>
      <div class="others">
        ${others.map(card).join("\n        ")}
      </div>
    </section>

${newsBlock}
  </main>${tail}`;
  mkdirSync(join(PUB, "t-shirt", p.id), { recursive: true });
  writeFileSync(join(PUB, "t-shirt", p.id, "index.html"), html);
}

// --- Page introuvable -----------------------------------------------------
writeFileSync(
  join(PUB, "404.html"),
  `<!doctype html>
<html lang="fr">
<head>
${SHARED_HEAD}
  <title>Page introuvable · FORK</title>
  <meta name="robots" content="noindex">
</head>
<body>${header}  <main>
    <section class="wrap notfound">
      <span class="big">404</span>
      <h1>Cette page s'est perdue dans la rade</h1>
      <p class="muted">L'adresse est peut-être mal tapée, ou la page n'existe plus. Pas de panique, la collection est toujours là.</p>
      <div class="actions"><a class="btn" href="./#produits">Voir la collection</a><a class="btn out" href="./">Retour à l'accueil</a></div>
    </section>
    <section class="sec wrap" aria-label="T-shirts">
      <div class="others">
        ${forSale.map(card).join("\n        ")}
      </div>
    </section>
  </main>${tail}`,
);

// --- Plan du site ---------------------------------------------------------
const urls = [
  { loc: `${SITE}/`, freq: "weekly", prio: "1.0" },
  ...forSale.map((p) => ({ loc: pageUrl(p), freq: "weekly", prio: "0.9" })),
  { loc: `${SITE}/cgv.html`, freq: "yearly", prio: "0.3" },
  { loc: `${SITE}/mentions-legales.html`, freq: "yearly", prio: "0.2" },
  { loc: `${SITE}/confidentialite.html`, freq: "yearly", prio: "0.2" },
];
writeFileSync(
  join(PUB, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><changefreq>${u.freq}</changefreq><priority>${u.prio}</priority></url>`).join("\n")}
</urlset>
`,
);

// --- Flux Google Merchant Center (une ligne par taille) -------------------
const x = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// Les t-shirts présentés avec des visuels générés par IA restent hors du flux Google
// Shopping (règles de Google sur les images de produits) jusqu'aux vraies photos.
const items = forSale.filter((p) => !p.aiVisuals).flatMap((p) =>
  p.sizes.map(
    (size) => `    <item>
      <g:id>${x(`${p.sku}-${size}`)}</g:id>
      <g:item_group_id>${x(p.sku)}</g:item_group_id>
      <g:title>${x(`T-shirt ${p.name} ${p.color} – FORK Toulon – Taille ${size}`)}</g:title>
      <g:description>${x(`${plain(p.description)} 100 % coton, 220 g/m².`)}</g:description>
      <g:link>${pageUrl(p)}</g:link>
      <g:image_link>${abs(p.images[0].src)}</g:image_link>
${p.images.slice(1, 10).map((i) => `      <g:additional_image_link>${abs(i.src)}</g:additional_image_link>`).join("\n")}
      <g:availability>${p.available ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${(p.priceCents / 100).toFixed(2)} EUR</g:price>
      <g:brand>FORK</g:brand>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>212</g:google_product_category>
      <g:product_type>Vêtements &gt; T-shirts</g:product_type>
      <g:color>${x(p.color)}</g:color>
      <g:size>${x(size)}</g:size>
      <g:size_system>FR</g:size_system>
      <g:gender>${p.category === "femme" ? "female" : "male"}</g:gender>
      <g:age_group>adult</g:age_group>
      <g:material>Coton</g:material>
    </item>`,
  ),
);
writeFileSync(
  join(PUB, "merchant-feed.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>FORK – T-shirts de Toulon</title>
    <link>${SITE}/</link>
    <description>Catalogue FORK pour Google Merchant Center</description>
${items.join("\n")}
  </channel>
</rss>
`,
);

// --- Catalogue côté serveur (annonces automatiques des nouveautés) ---------
writeFileSync(
  join(ROOT, "lib", "catalogue.generated.ts"),
  `// Fichier généré par scripts/build-pages.mjs à partir de public/assets/js/app.js. Ne pas modifier à la main.
export type CatalogueItem = { sku: string; id: string; type: string; name: string; color: string; priceCents: number; sizes: string[]; available: boolean; image: string; url: string };

export const CATALOGUE: CatalogueItem[] = ${JSON.stringify(
    forSale.map((p) => ({
      sku: p.sku,
      id: p.id,
      type: p.type || "T-shirt",
      name: p.name,
      color: p.color,
      priceCents: p.priceCents,
      sizes: p.sizes,
      available: Boolean(p.available),
      image: abs(p.images[0].src),
      url: pageUrl(p),
    })),
    null,
    2,
  )};
`,
);

console.log(`${forSale.length} pages t-shirt, 404, sitemap (${urls.length} adresses), flux Merchant (${items.length} articles)`);
