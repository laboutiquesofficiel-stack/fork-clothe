import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { sessions, userIdentities, users } from "../../db/schema.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const REDIRECT_URI =
  "https://fork-clothe.netlify.app/.netlify/functions/auth-google";

const FORK_URL = "https://fork-clothe.netlify.app/";

const createSession = async (userId: number) => {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
  });

  return token;
};

export default async (req: Request) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return new Response("Configuration Google OAuth manquante.", {
      status: 500,
    });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  // Première étape : redirection vers Google.
  if (!code) {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
    });

    return new Response(null, {
      status: 302,
      headers: {
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      },
    });
  }

  // Deuxième étape : échange du code contre un token Google.
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();

    console.error(
        "Google token exchange failed:",
        tokenResponse.status,
        errorText,
    );

    return new Response("Impossible de finaliser la connexion Google.", {
        status: 502,
    });
}

const tokens = await tokenResponse.json();

  // Récupération des informations Google.
  const userResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    },
  );

  if (!userResponse.ok) {
    return new Response("Impossible de récupérer le compte Google.", {
      status: 502,
    });
  }

  const googleUser = await userResponse.json();

  if (
    typeof googleUser.sub !== "string" ||
    typeof googleUser.email !== "string" ||
    googleUser.email_verified !== true
  ) {
    return new Response("Compte Google non vérifié.", {
      status: 400,
    });
  }

  // Cherche d'abord l'identité Google existante.
  const existingIdentity = await db
    .select()
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, "google"),
        eq(userIdentities.providerAccountId, googleUser.sub),
      ),
    )
    .limit(1);

  let userId: number;

  if (existingIdentity.length > 0) {
    // Le compte Google existe déjà.
    userId = existingIdentity[0].userId;

    await db
      .update(users)
      .set({
        email: googleUser.email,
        name: typeof googleUser.name === "string" ? googleUser.name : null,
        avatarUrl:
          typeof googleUser.picture === "string"
            ? googleUser.picture
            : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } else {
    // Cherche un compte Fork existant avec cette adresse e-mail.
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, googleUser.email))
      .limit(1);

    if (existingUser.length > 0) {
      userId = existingUser[0].id;

      await db
        .insert(userIdentities)
        .values({
          userId,
          provider: "google",
          providerAccountId: googleUser.sub,
        })
        .onConflictDoNothing();
    } else {
      // Création du compte Fork.
      const [newUser] = await db
        .insert(users)
        .values({
          email: googleUser.email,
          name: typeof googleUser.name === "string" ? googleUser.name : null,
          avatarUrl:
            typeof googleUser.picture === "string"
              ? googleUser.picture
              : null,
        })
        .returning();

      if (!newUser) {
        return new Response("Impossible de créer le compte Fork.", {
          status: 500,
        });
      }

      userId = newUser.id;

      await db.insert(userIdentities).values({
        userId,
        provider: "google",
        providerAccountId: googleUser.sub,
      });
    }
  }

  // Création d'une session Fork.
  const sessionToken = await createSession(userId);

  const headers = new Headers({
    Location: `${FORK_URL}?login=success`,
  });

  headers.append(
    "Set-Cookie",
    [
      `fork_session=${sessionToken}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Max-Age=2592000",
    ].join("; "),
  );

  return new Response(null, {
    status: 302,
    headers,
  });
};