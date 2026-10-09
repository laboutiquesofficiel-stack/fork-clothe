/**
 * Envoi d'e-mails via l'API Resend, uniquement côté serveur.
 *
 * Variables d'environnement :
 * - RESEND_API_KEY : clé Resend (secrète, jamais dans le frontend) ;
 * - MAIL_FROM : expéditeur sur un domaine vérifié chez Resend,
 *   par exemple « FORK <commandes@mail.fork-clothe.com> ».
 *
 * Sans ces variables, les e-mails sont simplement ignorés (avec un log) :
 * un e-mail manqué ne doit jamais bloquer une commande ou un paiement.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Clé d'idempotence Resend : le même e-mail n'est pas envoyé deux fois. */
  idempotencyKey?: string;
};

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();
  if (!apiKey || !from) {
    console.warn("Email skipped: RESEND_API_KEY or MAIL_FROM is not configured", message.subject);
    return false;
  }

  try {
    // Préversions : EMAIL_REDIRECT_TO détourne tous les e-mails vers une adresse de test,
    // pour qu'aucun vrai client ne reçoive un e-mail envoyé depuis une préversion.
    const redirectTo = process.env.EMAIL_REDIRECT_TO?.trim();
    const to = redirectTo || message.to;
    const subject = redirectTo ? `[TEST pour ${message.to}] ${message.subject}` : message.subject;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (message.idempotencyKey) headers["Idempotency-Key"] = `${redirectTo ? "test-" : ""}${message.idempotencyKey}`;

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.error("Email sending failed", response.status, message.subject);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Email sending failed", error instanceof Error ? error.message : "Unknown error");
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}
