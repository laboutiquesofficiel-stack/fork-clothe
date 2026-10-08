import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { userIdentities, users } from "../../db/schema.js";
import { createSession, readCookie, sessionCookie } from "../../lib/auth.js";

/**
 * Connexion Google (OAuth 2.0, flux « authorization code »).
 *
 * 1. Sans `code` : on redirige vers Google avec un `state` aléatoire, aussi
 *    posé dans un cookie HttpOnly limité à cette fonction.
 * 2. Au retour : on exige que le `state` reçu soit identique au cookie
 *    (protection contre la connexion forcée), puis on échange le code
 *    côté serveur et on crée la session FORK.
 *
 * L'adresse de retour est construite à partir du domaine qui reçoit la
 * requête : la connexion fonctionne sur fork-clothe.com comme sur une
 * préversion, à condition que l'adresse soit autorisée dans Google Cloud.
 */

const STATE_COOKIE = "fork_oauth_state";
const CALLBACK_PATH = "/.netlify/functions/auth-google";
const STATE_MAX_AGE_SECONDS = 600;

function stateCookie(value: string, maxAge: number): string {
  return [
    `${STATE_COOKIE}=${value}`,
    `Path=${CALLBACK_PATH}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ].join("; ");
}

function sameState(received: string | null, expected: string | null): boolean {
  if (!received || !expected || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

type GoogleUser = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  picture?: unknown;
};

export default async (req: Request, context: Context) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return new Response("Configuration Google OAuth manquante.", { status: 500 });
  }

  const url = new URL(req.url);
  const origin = url.origin;
  const redirectUri = `${origin}${CALLBACK_PATH}`;
  const clearState = stateCookie("", 0);
  // Hors production, la raison d'un échec est ajoutée à l'adresse de retour (jamais de secret).
  const failed = (reason: string) =>
    redirectTo(
      `${origin}/?login=failed${context?.deploy?.context !== "production" ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ""}`,
      [clearState],
    );

  // Le client a refusé ou Google a renvoyé une erreur.
  if (url.searchParams.get("error")) {
    return redirectTo(`${origin}/?login=cancelled`, [clearState]);
  }

  const code = url.searchParams.get("code");

  // Première étape : redirection vers Google.
  if (!code) {
    const state = randomBytes(24).toString("hex");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      prompt: "select_account",
      state,
    });
    return redirectTo(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, [
      stateCookie(state, STATE_MAX_AGE_SECONDS),
    ]);
  }

  if (!sameState(url.searchParams.get("state"), readCookie(req, STATE_COOKIE))) {
    return redirectTo(`${origin}/?login=expired`, [clearState]);
  }

  try {
    // Deuxième étape : échange du code contre un jeton, côté serveur.
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!tokenResponse.ok) {
      const detail = (await tokenResponse.json().catch(() => ({}))) as { error?: unknown; error_description?: unknown };
      const reason = `Google ${tokenResponse.status} ${String(detail.error ?? "")} ${String(detail.error_description ?? "")}`.trim();
      console.error("Google token exchange failed", reason);
      return failed(reason);
    }

    const tokens = (await tokenResponse.json()) as { access_token?: unknown };
    if (typeof tokens.access_token !== "string") {
      return failed("jeton Google absent");
    }

    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!userResponse.ok) {
      return failed(`profil Google illisible (${userResponse.status})`);
    }

    const googleUser = (await userResponse.json()) as GoogleUser;
    if (
      typeof googleUser.sub !== "string" ||
      typeof googleUser.email !== "string" ||
      googleUser.email_verified !== true
    ) {
      return redirectTo(`${origin}/?login=unverified`, [clearState]);
    }

    const googleId = googleUser.sub;
    const email = googleUser.email.trim().toLowerCase();
    const googleName = typeof googleUser.name === "string" ? googleUser.name.trim().slice(0, 120) : null;
    const avatarUrl = typeof googleUser.picture === "string" ? googleUser.picture : null;

    const [identity] = await db
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, "google"), eq(userIdentities.providerAccountId, googleId)))
      .limit(1);

    let userId: number;

    if (identity) {
      userId = identity.userId;
      const [current] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      // Le nom saisi dans « Mes informations » n'est jamais écrasé par celui de Google.
      await db
        .update(users)
        .set({
          email,
          avatarUrl,
          ...(current?.name ? {} : { name: googleName }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        userId = existingUser.id;
      } else {
        const [newUser] = await db
          .insert(users)
          .values({ email, name: googleName, avatarUrl })
          .returning({ id: users.id });
        if (!newUser) throw new Error("USER_CREATE_FAILED");
        userId = newUser.id;
      }

      await db
        .insert(userIdentities)
        .values({ userId, provider: "google", providerAccountId: googleId })
        .onConflictDoNothing();
    }

    const sessionToken = await createSession(userId);
    return redirectTo(`${origin}/?login=success`, [clearState, sessionCookie(sessionToken)]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Google sign-in failed", message);
    return failed(`erreur serveur : ${message}`);
  }
};
