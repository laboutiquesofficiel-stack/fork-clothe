/**
 * API « Suivi v2 » de La Poste (clé LAPOSTE_API_KEY, header X-Okapi-Key).
 * Partagé par la tâche planifiée track-shipments et le bouton
 * « Vérifier le suivi maintenant » de l'admin.
 */

const ENDPOINT = "https://api.laposte.fr/suivi/v2/idships/";

type Timeline = { id?: number; status?: boolean; shortLabel?: string };
type LaPosteEvent = { code?: string; label?: string; date?: string };
export type Tracking = {
  returnCode?: number;
  returnMessage?: string;
  shipment?: { isFinal?: boolean; product?: string; timeline?: Timeline[]; event?: LaPosteEvent[] };
};

export type TrackingResult =
  | { ok: true; httpStatus: number; data: Tracking }
  | { ok: false; httpStatus: number; error: string };

export async function fetchTracking(key: string, trackingNumber: string): Promise<TrackingResult> {
  try {
    const response = await fetch(`${ENDPOINT}${encodeURIComponent(trackingNumber)}?lang=fr_FR`, {
      headers: { "X-Okapi-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    const raw = await response.text();
    let data: Tracking | null = null;
    try {
      data = JSON.parse(raw) as Tracking;
    } catch {
      /* réponse non JSON */
    }
    const code = Number(data?.returnCode ?? response.status);
    if (!data || ![200, 207].includes(code)) {
      const error = `HTTP ${response.status}${data?.returnCode ? ` · code ${data.returnCode}` : ""} · ${(data?.returnMessage ?? raw).slice(0, 200)}`;
      console.error("La Poste tracking refusé", trackingNumber, error);
      return { ok: false, httpStatus: response.status, error };
    }
    return { ok: true, httpStatus: response.status, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    console.error("La Poste tracking failed", trackingNumber, message);
    return { ok: false, httpStatus: 0, error: message };
  }
}

const step = (t: Tracking, id: number) => Boolean(t.shipment?.timeline?.find((s) => s.id === id)?.status);
/** Pris en charge : une étape au-delà de « annoncé » validée, ou un événement autre que « en préparation chez l'expéditeur » (DR…). */
export const pickedUp = (t: Tracking) =>
  step(t, 2) || step(t, 3) || step(t, 4) || step(t, 5) || Boolean(t.shipment?.event?.some((e) => e.code && !e.code.toUpperCase().startsWith("DR")));
/** Livré : envoi terminé et dernière étape (« livré ») validée. */
export const delivered = (t: Tracking) => Boolean(t.shipment?.isFinal) && step(t, 5);

/** Résumé lisible pour l'admin. */
export function summarize(t: Tracking) {
  return {
    returnCode: t.returnCode ?? null,
    product: t.shipment?.product ?? null,
    isFinal: Boolean(t.shipment?.isFinal),
    steps: (t.shipment?.timeline ?? []).map((s) => ({ id: s.id ?? null, done: Boolean(s.status), label: s.shortLabel ?? "" })),
    events: (t.shipment?.event ?? []).slice(0, 5).map((e) => ({ code: e.code ?? "", label: e.label ?? "", date: e.date ?? "" })),
    pickedUp: pickedUp(t),
    delivered: delivered(t),
  };
}
