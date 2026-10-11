import { CATALOGUE } from "./catalogue.generated.js";
import { MOMENT_REFS } from "./moment-refs.generated.js";

/**
 * Vérification d'une photo « Vos moments » par l'IA (Claude, via l'AI Gateway
 * de Netlify : aucune clé à configurer, consommation sur les crédits Netlify).
 *
 * L'IA compare la photo aux t-shirts FORK de référence et répond :
 * t-shirt FORK visible (oui / non / incertain), modèle reconnu, photo correcte,
 * vraie photo (pas une capture ni un visuel de la boutique), mineur visible.
 */

export type MomentVerdict = {
  forkVisible: "yes" | "no" | "unsure";
  modelSku: string | null;
  appropriate: boolean;
  realPhoto: boolean;
  minorVisible: boolean;
  note: string;
};

export type MomentDecision =
  | { kind: "publish"; verdict: MomentVerdict }
  | { kind: "review"; verdict: MomentVerdict | null; reason: string }
  | { kind: "reject"; verdict: MomentVerdict; message: string };

const MODEL = "claude-haiku-5-5";
const SKUS = CATALOGUE.map((p) => p.sku);

const TOOL = {
  name: "verdict",
  description: "Résultat de la vérification de la photo.",
  input_schema: {
    type: "object",
    properties: {
      fork_tshirt_visible: {
        type: "string",
        enum: ["yes", "no", "unsure"],
        description:
          "yes si l'un des t-shirts FORK de référence (même imprimé, devant ou dos) est clairement visible et porté ou tenu sur la photo ; no s'il n'y en a pas ; unsure si c'est trop flou, trop petit ou caché pour être sûr.",
      },
      model_sku: { type: "string", enum: [...SKUS, "unknown"], description: "Le modèle reconnu, ou unknown." },
      appropriate: {
        type: "boolean",
        description:
          "false si la photo contient de la nudité ou un contenu sexuel, de la violence, des armes, de la drogue, un geste ou un texte injurieux ou haineux, ou une information personnelle lisible (plaque d'immatriculation, adresse, document). true sinon.",
      },
      real_photo: {
        type: "boolean",
        description:
          "true si c'est une vraie photo prise par quelqu'un. false si c'est une capture d'écran, un montage, une image générée, ou l'une des images de référence de la boutique (ou une photo de la boutique).",
      },
      minor_visible: { type: "boolean", description: "true si une personne qui semble avoir moins de 18 ans est visible sur la photo." },
      note: { type: "string", description: "Une phrase courte en français qui explique la décision." },
    },
    required: ["fork_tshirt_visible", "model_sku", "appropriate", "real_photo", "minor_visible", "note"],
  },
};

export async function verifyMomentPhoto(photo: { contentType: string; base64: string }): Promise<MomentVerdict | null> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.NETLIFY_AI_GATEWAY_KEY;
  const base = process.env.ANTHROPIC_BASE_URL || process.env.NETLIFY_AI_GATEWAY_URL;
  if (!key || !base) {
    console.error("Moments: AI Gateway indisponible (variables absentes)");
    return null;
  }

  const content: unknown[] = [
    {
      type: "text",
      text:
        "Tu vérifies les photos que les clients de FORK (marque de t-shirts de Toulon) veulent publier dans la galerie « Vos moments » du site. Voici d'abord les t-shirts FORK de référence (devant et dos de chaque modèle) :",
    },
  ];
  for (const r of MOMENT_REFS) {
    content.push({ type: "text", text: `Référence ${r.sku} — ${r.name} (${r.side}) :` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.data } });
  }
  content.push({ type: "text", text: "Voici la photo envoyée par le client :" });
  content.push({ type: "image", source: { type: "base64", media_type: photo.contentType, data: photo.base64 } });
  content.push({
    type: "text",
    text:
      "Analyse attentivement la photo du client. Un t-shirt noir ou blanc quelconque ne suffit pas : il faut reconnaître l'imprimé d'un t-shirt FORK de référence (logo FORK, ballon « Chez nous à Toulon on craint degun », Faron léopard, mots du Sud, vignettes Les Minots…). Réponds avec l'outil verdict.",
  });

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "verdict" },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(8500),
    });
    const data = (await response.json().catch(() => null)) as { content?: { type: string; input?: Record<string, unknown> }[]; error?: { message?: string } } | null;
    if (!response.ok || !data) {
      console.error("Moments: vérification IA refusée", response.status, data?.error?.message ?? "");
      return null;
    }
    const input = data.content?.find((c) => c.type === "tool_use")?.input;
    if (!input) return null;
    const fork = input.fork_tshirt_visible;
    const sku = typeof input.model_sku === "string" && SKUS.includes(input.model_sku) ? input.model_sku : null;
    return {
      forkVisible: fork === "yes" || fork === "no" ? fork : "unsure",
      modelSku: sku,
      appropriate: input.appropriate !== false,
      realPhoto: input.real_photo !== false,
      minorVisible: input.minor_visible === true,
      note: typeof input.note === "string" ? input.note.slice(0, 300) : "",
    };
  } catch (error) {
    console.error("Moments: vérification IA impossible", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}

export function decide(verdict: MomentVerdict | null): MomentDecision {
  if (!verdict) return { kind: "review", verdict: null, reason: "Vérification automatique indisponible : à valider à la main." };
  if (!verdict.appropriate) {
    return { kind: "reject", verdict, message: "Cette photo ne peut pas être publiée sur le site." };
  }
  if (!verdict.realPhoto) {
    return { kind: "reject", verdict, message: "Envoie une vraie photo de toi avec ton t-shirt FORK (pas une capture d'écran ni une image de la boutique)." };
  }
  if (verdict.forkVisible === "no") {
    return {
      kind: "reject",
      verdict,
      message: "On ne reconnaît pas de t-shirt FORK sur ta photo. Essaie avec une photo où l'imprimé (devant ou dos) se voit bien.",
    };
  }
  if (verdict.minorVisible) return { kind: "review", verdict, reason: "Une personne mineure semble visible : à valider à la main." };
  if (verdict.forkVisible === "unsure") return { kind: "review", verdict, reason: "Le t-shirt n'est pas reconnu avec certitude : à valider à la main." };
  return { kind: "publish", verdict };
}

export const productBySku = (sku: string | null | undefined) => (sku ? CATALOGUE.find((p) => p.sku === sku) ?? null : null);
