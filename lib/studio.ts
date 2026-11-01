import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteSettings, studioImages } from "../db/schema.js";
import { STUDIO_FONTS, STUDIO_MOTIFS } from "./studio-catalog.generated.js";

/**
 * FORK Custom Studio — règles côté serveur.
 *
 * Le navigateur envoie la création (positions en mm dans chaque zone) ;
 * le serveur la nettoie, vérifie motifs/polices/images, calcule le niveau
 * et le prix. Le logo FORK n'est pas un élément de la création : il est
 * toujours ajouté à sa place fixe au rendu, seule sa couleur est choisie.
 */

export const STUDIO_SKU = "fork-studio";

export type StudioSettings = {
  enabled: boolean;
  /** Dernier jour de commande (AAAA-MM-JJ, heure de Paris). */
  deadline: string;
  deliveryText: string;
  prices: { basic: number; custom: number; unlimited: number; bothSides: number };
  zones: { front: { w: number; h: number }; back: { w: number; h: number } };
  logoWidth: number;
  sizes: string[];
};

export const DEFAULT_STUDIO: StudioSettings = {
  enabled: false,
  deadline: "2026-12-13",
  deliveryText: "Précommande : livraison prévue autour du 24 décembre",
  prices: { basic: 3200, custom: 3500, unlimited: 3800, bothSides: 200 },
  zones: { front: { w: 250, h: 300 }, back: { w: 280, h: 360 } },
  logoWidth: 80,
  sizes: ["S", "M", "L", "XL", "XXL", "3XL"],
};

const KEY = "studio";
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const cents = (v: unknown, fallback: number) => Math.round(num(v, 0, 10000, fallback));

export function cleanStudioSettings(input: unknown, base: StudioSettings = DEFAULT_STUDIO): StudioSettings {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const deadline = typeof v.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.deadline) ? v.deadline : base.deadline;
  const zone = (z: any, b: { w: number; h: number }) => ({ w: Math.round(num(z?.w, 50, 400, b.w)), h: Math.round(num(z?.h, 50, 450, b.h)) });
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : base.enabled,
    deadline,
    deliveryText: typeof v.deliveryText === "string" ? v.deliveryText.replace(/\s+/g, " ").trim().slice(0, 140) || base.deliveryText : base.deliveryText,
    prices: {
      basic: cents(v.prices?.basic, base.prices.basic),
      custom: cents(v.prices?.custom, base.prices.custom),
      unlimited: cents(v.prices?.unlimited, base.prices.unlimited),
      bothSides: cents(v.prices?.bothSides, base.prices.bothSides),
    },
    zones: { front: zone(v.zones?.front, base.zones.front), back: zone(v.zones?.back, base.zones.back) },
    logoWidth: Math.round(num(v.logoWidth, 40, 140, base.logoWidth)),
    sizes: base.sizes,
  };
}

export async function loadStudioSettings(): Promise<StudioSettings> {
  try {
    const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, KEY)).limit(1);
    return row ? cleanStudioSettings(row.value) : DEFAULT_STUDIO;
  } catch (error) {
    console.error("Studio settings load failed", error instanceof Error ? error.message : "Unknown error");
    return DEFAULT_STUDIO;
  }
}

export async function saveStudioSettings(input: unknown): Promise<StudioSettings> {
  const next = cleanStudioSettings(input, await loadStudioSettings());
  const value = next as unknown as Record<string, unknown>;
  await db
    .insert(siteSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value, updatedAt: new Date() } });
  return next;
}

const parisDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
/** Le Studio prend-il des commandes aujourd'hui ? */
export function studioOpen(s: StudioSettings): boolean {
  return s.enabled && parisDay() <= s.deadline;
}

// --- Création ----------------------------------------------------------------
export type StudioElement =
  | { t: "text"; text: string; font: string; color: string; x: number; y: number; s: number; r: number; ls?: number }
  | { t: "motif"; id: string; color: string; x: number; y: number; w: number; r: number }
  | { t: "image"; img: string; k: string; ar: number; x: number; y: number; w: number; r: number };
export type StudioDesign = { color: "blanc" | "noir"; logoColor: string; front: StudioElement[]; back: StudioElement[] };
export type StudioTier = "basic" | "custom" | "unlimited";

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_ELEMENTS = 25;

/** Nettoie une création venant du navigateur ; renvoie une erreur lisible si elle est invalide. */
export async function cleanDesign(input: unknown, s: StudioSettings): Promise<{ ok: true; design: StudioDesign } | { ok: false; error: string }> {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const color = v.color === "noir" ? "noir" : v.color === "blanc" ? "blanc" : null;
  if (!color) return { ok: false, error: "Choisis la couleur du t-shirt." };
  const logoColor = typeof v.logoColor === "string" && HEX.test(v.logoColor) ? v.logoColor.toLowerCase() : "#111111";
  const imageIds = new Set<string>();

  const side = (list: unknown, zone: { w: number; h: number }): StudioElement[] | string => {
    if (!Array.isArray(list)) return [];
    if (list.length > MAX_ELEMENTS) return `${MAX_ELEMENTS} éléments maximum par face.`;
    const out: StudioElement[] = [];
    for (const raw of list) {
      const e = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
      const x = num(e.x, 0, zone.w, zone.w / 2);
      const y = num(e.y, 0, zone.h, zone.h / 2);
      const r = num(e.r, -360, 360, 0);
      const c = typeof e.color === "string" && HEX.test(e.color) ? e.color.toLowerCase() : "#111111";
      if (e.t === "text") {
        const text = typeof e.text === "string" ? e.text.replace(/\r/g, "").split("\n").slice(0, 3).map((l: string) => l.slice(0, 40)).join("\n").trim() : "";
        if (!text) continue;
        const font = STUDIO_FONTS.includes(e.font) ? e.font : STUDIO_FONTS[0];
        out.push({ t: "text", text, font, color: c, x, y, s: num(e.s, 4, 200, 20), r, ...(e.ls ? { ls: num(e.ls, 0, 0.5, 0) } : {}) });
      } else if (e.t === "motif") {
        if (!STUDIO_MOTIFS.includes(e.id)) return "Un motif de la création n'existe pas.";
        out.push({ t: "motif", id: e.id, color: c, x, y, w: num(e.w, 5, Math.max(zone.w, zone.h), 60), r });
      } else if (e.t === "image") {
        const img = typeof e.img === "string" && /^[a-f0-9]{16}$/.test(e.img) ? e.img : "";
        const k = typeof e.k === "string" && /^[a-f0-9]{32}$/.test(e.k) ? e.k : "";
        if (!img || !k) return "Une image de la création est invalide.";
        imageIds.add(img);
        out.push({ t: "image", img, k, ar: num(e.ar, 0.05, 20, 1), x, y, w: num(e.w, 5, Math.max(zone.w, zone.h), 80), r });
      }
    }
    return out;
  };
  const front = side(v.front, s.zones.front);
  if (typeof front === "string") return { ok: false, error: front };
  const back = side(v.back, s.zones.back);
  if (typeof back === "string") return { ok: false, error: back };
  if (!front.length && !back.length) return { ok: false, error: "Ajoute au moins un élément sur ton t-shirt." };

  if (imageIds.size) {
    const rows = await db.select({ publicId: studioImages.publicId, key: studioImages.key }).from(studioImages).where(inArray(studioImages.publicId, [...imageIds]));
    const keys = new Map(rows.map((r: { publicId: string; key: string }) => [r.publicId, r.key]));
    for (const e of [...front, ...back]) {
      if (e.t === "image" && keys.get(e.img) !== e.k) return { ok: false, error: "Une image de la création est introuvable : importe-la à nouveau." };
    }
  }
  return { ok: true, design: { color, logoColor, front, back } };
}

export function tierOf(d: StudioDesign): StudioTier {
  const all = [...d.front, ...d.back];
  if (all.some((e) => e.t === "image")) return "unlimited";
  if (all.some((e) => e.t === "text")) return "custom";
  return "basic";
}
export const TIER_NAMES: Record<StudioTier, string> = { basic: "FORK Basic", custom: "FORK Custom", unlimited: "FORK Unlimited" };

export function priceOf(d: StudioDesign, s: StudioSettings): number {
  const base = s.prices[tierOf(d)];
  return base + (d.front.length > 0 && d.back.length > 0 ? s.prices.bothSides : 0);
}
