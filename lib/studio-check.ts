/**
 * Vérification d'une image importée dans le Studio par l'IA (Claude via
 * l'AI Gateway de Netlify, sur les crédits Netlify). Ce n'est qu'un premier
 * tri : chaque création est de toute façon validée par FORK avant fabrication.
 */
export type ImageVerdict = {
  allowed: boolean;
  thirdPartyRights: boolean;
  personVisible: boolean;
  note: string;
};

const TOOL = {
  name: "verdict",
  description: "Résultat de la vérification de l'image.",
  input_schema: {
    type: "object",
    properties: {
      allowed: {
        type: "boolean",
        description:
          "false si l'image contient de la nudité ou un contenu sexuel, de la violence ou du sang, un symbole ou un message haineux, raciste ou extrémiste, de la drogue, ou une insulte. true sinon.",
      },
      third_party_rights: {
        type: "boolean",
        description:
          "true si l'image montre une marque ou un logo d'une autre entreprise, un personnage connu (dessin animé, film, jeu, manga), une œuvre ou un visuel protégé, l'écusson d'un club, ou une personne célèbre.",
      },
      person_visible: { type: "boolean", description: "true si une personne est reconnaissable sur l'image." },
      note: { type: "string", description: "Une phrase courte en français qui décrit l'image et les problèmes éventuels." },
    },
    required: ["allowed", "third_party_rights", "person_visible", "note"],
  },
};

export async function checkStudioImage(image: { contentType: string; base64: string }): Promise<ImageVerdict | null> {
  const key = process.env.ANTHROPIC_API_KEY || process.env.NETLIFY_AI_GATEWAY_KEY;
  const base = process.env.ANTHROPIC_BASE_URL || process.env.NETLIFY_AI_GATEWAY_URL;
  if (!key || !base) return null;
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 300,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "verdict" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Un client veut faire imprimer cette image sur un t-shirt personnalisé FORK. Vérifie-la et réponds avec l'outil verdict." },
              { type: "image", source: { type: "base64", media_type: image.contentType, data: image.base64 } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(9000),
    });
    const data = (await response.json().catch(() => null)) as { content?: { type: string; input?: Record<string, unknown> }[] } | null;
    const input = response.ok ? data?.content?.find((c) => c.type === "tool_use")?.input : null;
    if (!input) return null;
    return {
      allowed: input.allowed !== false,
      thirdPartyRights: input.third_party_rights === true,
      personVisible: input.person_visible === true,
      note: typeof input.note === "string" ? input.note.slice(0, 300) : "",
    };
  } catch (error) {
    console.error("Studio: vérification IA impossible", error instanceof Error ? error.message : "Unknown error");
    return null;
  }
}
