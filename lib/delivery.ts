/**
 * Zone de livraison FORK : offerte autour de Toulon, facturée au-delà.
 *
 * L'adresse du client est géocodée via l'API Adresse (api-adresse.data.gouv.fr,
 * service public gratuit et sans clé), puis la distance à vol d'oiseau jusqu'au
 * centre de Toulon décide si les frais s'appliquent.
 */

export const TOULON_CENTRE = { lat: 43.126057, lon: 5.930735 } as const;
export const FREE_DELIVERY_RADIUS_KM = 10;
export const DELIVERY_FEE_CENTS = 764;

const GEOCODER_ENDPOINT = "https://api-adresse.data.gouv.fr/search/";
const GEOCODER_TIMEOUT_MS = 4000;
const MIN_GEOCODER_SCORE = 0.25;

export type DeliveryZone =
  | "free_zone"
  | "outside_zone"
  | "needs_postcode"
  | "outside_area"
  | "unresolved"
  | "geocoder_unavailable";

export type DeliveryQuote = {
  /** Verdict de zone : seul `outside_zone` déclenche des frais. */
  zone: DeliveryZone;
  feeCents: number;
  /** Distance à vol d'oiseau depuis le centre de Toulon, arrondie à 0,1 km. */
  distanceKm: number | null;
  /** Distance en mètres, pour l'archivage de la commande. */
  distanceMeters: number | null;
  /** `precise` = numéro/rue géocodé, `approximate` = centre de la commune. */
  precision: "precise" | "approximate" | null;
  /** Adresse normalisée renvoyée par l'API Adresse. */
  matchedLabel: string | null;
  /** Message prêt à afficher au client. */
  message: string;
};

type GeocoderPoint = {
  lat: number;
  lon: number;
  label: string;
  precision: "precise" | "approximate";
};

type GeocoderFeature = {
  geometry?: { coordinates?: unknown };
  properties?: { score?: unknown; label?: unknown };
};

/** Distance orthodromique en kilomètres (formule de haversine). */
export function distanceKmFromToulon(lat: number, lon: number): number {
  const earthRadiusKm = 6371.0088;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(lat - TOULON_CENTRE.lat);
  const deltaLon = toRadians(lon - TOULON_CENTRE.lon);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(TOULON_CENTRE.lat)) * Math.cos(toRadians(lat)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

/**
 * Un code postal français est indispensable : sans lui, une rue homonyme peut
 * être géocodée à l'autre bout du pays et facturée à tort.
 */
export function extractPostcode(address: string): string | null {
  const matches = address.match(/\b(?:0[1-9]|[1-8]\d|9[0-8])\d{3}\b/g);
  return matches?.at(-1) ?? null;
}

function formatKm(distanceKm: number): string {
  return distanceKm.toFixed(1).replace(".", ",");
}

/** Interroge l'API Adresse ; lève une erreur si le service est injoignable. */
async function fetchGeocoder(params: Record<string, string>): Promise<GeocoderFeature | null> {
  const url = new URL(GEOCODER_ENDPOINT);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(GEOCODER_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GEOCODER_HTTP_${response.status}`);

  const payload = (await response.json()) as { features?: unknown };
  const feature = Array.isArray(payload.features) ? payload.features[0] : null;
  return feature && typeof feature === "object" ? (feature as GeocoderFeature) : null;
}

function readPoint(feature: GeocoderFeature, precision: "precise" | "approximate"): GeocoderPoint | null {
  const coordinates = feature.geometry?.coordinates;
  const score = Number(feature.properties?.score);
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const [lon, lat] = (coordinates as unknown[]).map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (precision === "precise" && !(score >= MIN_GEOCODER_SCORE)) return null;

  const label = typeof feature.properties?.label === "string" ? feature.properties.label : "";
  return { lat, lon, label, precision };
}

/**
 * Géocode l'adresse en deux temps : d'abord la rue filtrée sur le code postal,
 * puis, si la rue est introuvable ou mal orthographiée, le centre de la commune.
 */
async function geocode(address: string, postcode: string): Promise<GeocoderPoint | null> {
  const street = address.replaceAll(postcode, " ").replace(/\s+/g, " ").trim();

  if (street.length >= 3) {
    const feature = await fetchGeocoder({ q: street, postcode });
    const point = feature && readPoint(feature, "precise");
    if (point) return point;
  }

  const fallback = await fetchGeocoder({ q: postcode, type: "municipality" });
  return fallback ? readPoint(fallback, "approximate") : null;
}

/** Calcule les frais de livraison applicables à une adresse de livraison. */
export async function quoteDelivery(address: string): Promise<DeliveryQuote> {
  const cleaned = address.replace(/\s+/g, " ").trim();
  const postcode = extractPostcode(cleaned);

  if (!postcode) {
    return {
      zone: "needs_postcode",
      feeCents: 0,
      distanceKm: null,
      distanceMeters: null,
      precision: null,
      matchedLabel: null,
      message: "Ajoutez votre code postal à l’adresse pour calculer les frais de livraison.",
    };
  }

  // Lancement : livraison en France métropolitaine uniquement (pas d'outre-mer ni de Monaco).
  if (postcode.startsWith("97") || postcode.startsWith("98")) {
    return {
      zone: "outside_area",
      feeCents: 0,
      distanceKm: null,
      distanceMeters: null,
      precision: null,
      matchedLabel: null,
      message: "Nous livrons uniquement en France métropolitaine pour le moment.",
    };
  }

  let point: GeocoderPoint | null = null;
  try {
    point = await geocode(cleaned, postcode);
  } catch (error) {
    // Géocodeur injoignable : on ne bloque jamais une commande pour autant.
    console.warn("Delivery geocoding unavailable", error instanceof Error ? error.message : "Unknown error");
    return {
      zone: "geocoder_unavailable",
      feeCents: 0,
      distanceKm: null,
      distanceMeters: null,
      precision: null,
      matchedLabel: null,
      message: "Vérification de la zone de livraison indisponible : les frais éventuels vous seront confirmés par e-mail.",
    };
  }

  if (!point) {
    return {
      zone: "unresolved",
      feeCents: 0,
      distanceKm: null,
      distanceMeters: null,
      precision: null,
      matchedLabel: null,
      message: "Adresse non reconnue : vérifiez le numéro, la rue et le code postal.",
    };
  }

  const exactKm = distanceKmFromToulon(point.lat, point.lon);
  const distanceKm = Math.round(exactKm * 10) / 10;
  const isFreeZone = exactKm <= FREE_DELIVERY_RADIUS_KM;

  return {
    zone: isFreeZone ? "free_zone" : "outside_zone",
    feeCents: isFreeZone ? 0 : DELIVERY_FEE_CENTS,
    distanceKm,
    distanceMeters: Math.round(exactKm * 1000),
    precision: point.precision,
    matchedLabel: point.label || null,
    message: isFreeZone
      ? `Livraison offerte : vous êtes à ${formatKm(distanceKm)} km de Toulon centre (moins de ${FREE_DELIVERY_RADIUS_KM} km).`
      : `Vous êtes à ${formatKm(distanceKm)} km de Toulon centre, au-delà des ${FREE_DELIVERY_RADIUS_KM} km : ${(DELIVERY_FEE_CENTS / 100).toFixed(2).replace(".", ",")} € de frais de livraison s’ajoutent.`,
  };
}
