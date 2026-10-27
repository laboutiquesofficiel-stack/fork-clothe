import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteSettings } from "../db/schema.js";

/**
 * Réglages de la boutique modifiables depuis l'admin (onglet « Promos »),
 * sans republier le site.
 */
export type ShopSettings = {
  /** Bandeau fin en haut de toutes les pages. */
  banner: { active: boolean; text: string };
  /** Pack : remise sur les t-shirts dès 2 (twoPercent) ou dès 3 (threePercent, 0 = même remise que 2). */
  pack: { twoPercent: number; threePercent: number };
  /** Livraison offerte dès N t-shirts (0 = désactivé). */
  freeShippingMin: number;
  /** Fenêtre d'inscription « -X % sur ta première commande ». */
  popup: { active: boolean; code: string };
};

export const DEFAULT_SETTINGS: ShopSettings = {
  banner: { active: true, text: "Livraison offerte dès 2 t-shirts · Expédié depuis Toulon sous 48 h" },
  pack: { twoPercent: 10, threePercent: 0 },
  freeShippingMin: 2,
  popup: { active: true, code: "BIENVENUE10" },
};

const KEY = "shop";
const pct = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : fallback;
};

/** Nettoie des réglages venant de l'admin ou de la base (jamais de valeur hors bornes). */
export function cleanSettings(input: unknown, base: ShopSettings = DEFAULT_SETTINGS): ShopSettings {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const text = typeof v.banner?.text === "string" ? v.banner.text.replace(/\s+/g, " ").trim().slice(0, 140) : base.banner.text;
  const code = typeof v.popup?.code === "string" ? v.popup.code.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 30) : base.popup.code;
  const min = Math.round(Number(v.freeShippingMin));
  return {
    banner: { active: typeof v.banner?.active === "boolean" ? v.banner.active : base.banner.active, text },
    pack: { twoPercent: pct(v.pack?.twoPercent, base.pack.twoPercent), threePercent: pct(v.pack?.threePercent, base.pack.threePercent) },
    freeShippingMin: Number.isFinite(min) ? Math.min(10, Math.max(0, min)) : base.freeShippingMin,
    popup: { active: typeof v.popup?.active === "boolean" ? v.popup.active : base.popup.active, code: code || base.popup.code },
  };
}

export async function loadSettings(): Promise<ShopSettings> {
  try {
    const [row] = await db.select({ value: siteSettings.value }).from(siteSettings).where(eq(siteSettings.key, KEY)).limit(1);
    return row ? cleanSettings(row.value) : DEFAULT_SETTINGS;
  } catch (error) {
    console.error("Settings load failed", error instanceof Error ? error.message : "Unknown error");
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(input: unknown): Promise<ShopSettings> {
  const next = cleanSettings(input, await loadSettings());
  await db
    .insert(siteSettings)
    .values({ key: KEY, value: next as unknown as Record<string, unknown> })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date() } });
  return next;
}

/** Remise du pack selon le nombre de t-shirts (0 si pas de pack). */
export function packPercent(settings: ShopSettings, tshirtCount: number): number {
  if (tshirtCount >= 3 && settings.pack.threePercent > 0) return settings.pack.threePercent;
  if (tshirtCount >= 2) return settings.pack.twoPercent;
  return 0;
}
