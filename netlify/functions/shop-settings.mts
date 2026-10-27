import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { promoCodes } from "../../db/schema.js";
import { GIFT_CARD_AMOUNTS } from "../../lib/promos.js";
import { DEFAULT_SETTINGS, loadSettings } from "../../lib/settings.js";

/**
 * GET /api/shop-settings → réglages publics de la boutique (bandeau, pack,
 * livraison offerte, fenêtre -10 %). Mis en cache 1 minute sur le CDN :
 * un changement dans l'admin apparaît sur le site en une minute au plus.
 */
export default async () => {
  const settings = await loadSettings();
  let popupPercent = 0;
  try {
    if (settings.popup.active && settings.popup.code) {
      const [code] = await db
        .select({ percent: promoCodes.percent, active: promoCodes.active, kind: promoCodes.kind })
        .from(promoCodes)
        .where(eq(promoCodes.code, settings.popup.code))
        .limit(1);
      if (code?.active && code.kind === "percent") popupPercent = code.percent ?? 0;
    }
  } catch {
    popupPercent = 0;
  }
  return Response.json(
    {
      banner: settings.banner.active && settings.banner.text ? settings.banner.text : "",
      pack: settings.pack ?? DEFAULT_SETTINGS.pack,
      freeShippingMin: settings.freeShippingMin,
      popup: { active: settings.popup.active && popupPercent > 0, percent: popupPercent },
      giftCardAmounts: GIFT_CARD_AMOUNTS,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Netlify-CDN-Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
};

export const config: Config = { path: "/api/shop-settings", method: "GET" };
