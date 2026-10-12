import { CATALOGUE } from "./catalogue.generated.js";
import { MOMENT_REFS } from "./moment-refs.generated.js";

/**
 * Scanner de stock : l'IA (Claude via l'AI Gateway de Netlify) regarde la photo
 * d'un t-shirt FORK (plié ou non) et lit la taille sur l'étiquette du col ;
 * elle reconnaît le modèle grâce à l'imprimé (logo du devant visible dans le
 * coin quand le t-shirt est plié). Rien n'est deviné : si la taille ou le
 * modèle ne se lit pas, la réponse le dit et l'admin demande de toucher le bon bouton.
 */

export const ALL_SIZES = ["S", "M", "L", "XL", "XXL", "3XL"];
const SKUS = CATALOGUE.map((p) => p.sku);
const MODEL = "claude-haiku-5-5";

export type ScanResult = { tshirt: boolean; sku: string | null; size: string | null; note: string };

const FRONT_HINTS =
  "Repères du devant (souvent seul visible quand le t-shirt est plié, dans un coin) : " +
  "L'Authentique = t-shirt blanc, logo FORK noir avec « vibe TOULONNAISE » en rouge ; " +
  "Lou Faron = t-shirt blanc, logo FORK (deux gouttes) à motif léopard ; " +
  "Les Boutades = t-shirt noir, logo FORK (deux gouttes) blanc ; " +
  "Les Minots = t-shirt noir, petit badge orange avec un mot en lettres noires.";

const TOOL = {
  name: "scan",
  description: "Résultat de la lecture du t-shirt.",
  input_schema: {
    type: "object",
    properties: {
      tshirt_visible: { type: "boolean", description: "true si un t-shirt est visible sur la photo." },
      model_sku: {
        type: "string",
        enum: [...SKUS, "unknown"],
        description: "Le modèle FORK reconnu à son imprimé ou à son logo, ou unknown si l'imprimé ne se voit pas ou ne correspond à aucun modèle.",
      },
      size: {
        type: "string",
        enum: [...ALL_SIZES, "unreadable"],
        description:
          "La taille écrite sur l'étiquette du col (S, M, L, XL, XXL ou 3XL ; « 2XL » = XXL, « XXXL » = 3XL). unreadable si l'étiquette n'est pas visible ou pas lisible avec certitude : ne devine jamais.",
      },
      note: { type: "string", description: "Une phrase courte en français (ce qui a été lu)." },
    },
    required: ["tshirt_visible", "model_sku", "size", "note"],
  },
};

export async function scanTshirt(photo: { contentType: string; base64: string }, lockedSku: string | null): Promise<ScanResult | null> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.NETLIFY_AI_GATEWAY_KEY;
  const base = process.env.ANTHROPIC_BASE_URL || process.env.NETLIFY_AI_GATEWAY_URL;
  if (!key || !base) {
    console.error("Stock scan: AI Gateway indisponible (variables absentes)");
    return null;
  }

  const content: unknown[] = [];
  if (!lockedSku) {
    content.push({ type: "text", text: "Voici les t-shirts FORK de référence (devant et dos de chaque modèle) :" });
    for (const r of MOMENT_REFS) {
      content.push({ type: "text", text: `Référence ${r.sku} — ${r.name} (${r.side}) :` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: r.data } });
    }
    content.push({ type: "text", text: FRONT_HINTS });
  }
  content.push({ type: "text", text: "Photo prise par le vendeur pour son stock :" });
  content.push({ type: "image", source: { type: "base64", media_type: photo.contentType, data: photo.base64 } });
  content.push({
    type: "text",
    text: lockedSku
      ? "Lis uniquement la taille sur l'étiquette du col (petite étiquette tissée). Le modèle est déjà connu. Réponds avec l'outil scan (model_sku = unknown)."
      : "Lis la taille sur l'étiquette du col (petite étiquette tissée) et reconnais le modèle FORK. Réponds avec l'outil scan.",
  });

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, tools: [TOOL], tool_choice: { type: "tool", name: "scan" }, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(8500),
    });
    const data = (await response.json().catch(() => null)) as { content?: { type: string; input?: Record<string, unknown> }[]; error?: { message?: string } } | null;
    if (!response.ok || !data) {
      console.error("Stock scan: IA refusée", response.status, data?.error?.message ?? "");
      return null;
    }
    const input = data.content?.find((c) => c.type === "tool_use")?.input;
    if (!input) return null;
    const sku = !lockedSku && typeof input.model_sku === "string" && SKUS.includes(input.model_sku) ? input.model_sku : lockedSku;
    const size = typeof input.size === "string" && ALL_SIZES.includes(input.size) ? input.size : null;
    return { tshirt: input.tshirt_visible !== false, sku, size, note: typeof input.note === "string" ? input.note.slice(0, 200) : "" };
  } catch (error) {
    console.error("Stock scan: IA impossible", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}
