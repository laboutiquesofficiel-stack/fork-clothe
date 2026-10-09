import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db/index.js";
import { sessions, users } from "../../db/schema.js";

const getSessionUserId = async (request: Request): Promise<number | null> => {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");
  let sessionToken: string | null = null;

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === "fork_session") {
      sessionToken = decodeURIComponent(valueParts.join("="));
      break;
    }
  }

  if (!sessionToken) return null;

  const tokenHash = createHash("sha256")
    .update(sessionToken)
    .digest("hex");

  const [session] = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return session.userId;
};

export default async (request: Request) => {
  try {
    const userId = await getSessionUserId(request);

    if (!userId) {
      return Response.json(
        {
          authenticated: false,
          error: "Connexion requise.",
        },
        { status: 401 },
      );
    }

    if (request.method === "GET") {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        return Response.json(
          { error: "Utilisateur introuvable." },
          { status: 404 },
        );
      }

      return Response.json({
        authenticated: true,
        user,
      });
    }

    if (request.method === "PUT") {
      const body = await request.json();

      const name =
        typeof body.name === "string"
          ? body.name.trim()
          : "";

      const phone =
        typeof body.phone === "string"
          ? body.phone.trim()
          : "";

      if (!name) {
        return Response.json(
          { error: "Le nom est obligatoire." },
          { status: 400 },
        );
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          name,
          phone: phone || null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          name: users.name,
          email: users.email,
          phone: users.phone,
          avatarUrl: users.avatarUrl,
        });

      if (!updatedUser) {
        return Response.json(
          { error: "Utilisateur introuvable." },
          { status: 404 },
        );
      }

      return Response.json({
        success: true,
        user: updatedUser,
      });
    }

    return Response.json(
      { error: "Méthode non autorisée." },
      { status: 405 },
    );
  } catch (error) {
    console.error(
      "Account profile failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    return Response.json(
      {
        error: "Impossible de modifier vos informations pour le moment.",
      },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/account-profile",
};
