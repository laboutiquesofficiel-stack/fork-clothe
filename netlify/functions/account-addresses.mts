import type { Config } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db/index.js";
import { sessions, userAddresses } from "../../db/schema.js";

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

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return session.userId;
};

const unauthorized = () =>
  Response.json(
    {
      authenticated: false,
      error: "Connexion requise.",
    },
    { status: 401 },
  );

export default async (request: Request) => {
  try {
    const userId = await getSessionUserId(request);

    if (!userId) {
      return unauthorized();
    }

    if (request.method === "GET") {
      const addresses = await db
        .select()
        .from(userAddresses)
        .where(eq(userAddresses.userId, userId))
        .orderBy(userAddresses.createdAt);

      return Response.json({
        authenticated: true,
        addresses,
      });
    }

    if (request.method === "POST") {
      const body = await request.json();

      const recipientName =
        typeof body.recipientName === "string"
          ? body.recipientName.trim()
          : "";

      const address =
        typeof body.address === "string"
          ? body.address.trim()
          : "";

      const phone =
        typeof body.phone === "string"
          ? body.phone.trim()
          : "";

      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : "Maison";

      if (!recipientName || !address) {
        return Response.json(
          {
            error: "Le nom du destinataire et l'adresse sont obligatoires.",
          },
          { status: 400 },
        );
      }

      const existingAddresses = await db
        .select({
          id: userAddresses.id,
        })
        .from(userAddresses)
        .where(eq(userAddresses.userId, userId));

      const isDefault =
        existingAddresses.length === 0 ||
        body.isDefault === true;

      if (isDefault) {
        await db
          .update(userAddresses)
          .set({
            isDefault: false,
            updatedAt: new Date(),
          })
          .where(eq(userAddresses.userId, userId));
      }

      const [createdAddress] = await db
        .insert(userAddresses)
        .values({
          userId,
          label,
          recipientName,
          address,
          phone: phone || null,
          isDefault,
        })
        .returning();

      return Response.json(
        {
          address: createdAddress,
        },
        { status: 201 },
      );
    }

    if (request.method === "PUT") {
      const body = await request.json();

      const id = Number(body.id);

      if (!Number.isInteger(id) || id <= 0) {
        return Response.json(
          { error: "Adresse invalide." },
          { status: 400 },
        );
      }

      const existing = await db
        .select()
        .from(userAddresses)
        .where(
          and(
            eq(userAddresses.id, id),
            eq(userAddresses.userId, userId),
          ),
        )
        .limit(1);

      if (!existing[0]) {
        return Response.json(
          { error: "Adresse introuvable." },
          { status: 404 },
        );
      }

      const recipientName =
        typeof body.recipientName === "string"
          ? body.recipientName.trim()
          : existing[0].recipientName;

      const address =
        typeof body.address === "string"
          ? body.address.trim()
          : existing[0].address;

      const phone =
        typeof body.phone === "string"
          ? body.phone.trim()
          : existing[0].phone ?? "";

      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.trim()
          : existing[0].label ?? "Maison";

      if (!recipientName || !address) {
        return Response.json(
          {
            error: "Le nom du destinataire et l'adresse sont obligatoires.",
          },
          { status: 400 },
        );
      }

      if (body.isDefault === true) {
        await db
          .update(userAddresses)
          .set({
            isDefault: false,
            updatedAt: new Date(),
          })
          .where(eq(userAddresses.userId, userId));
      }

      const [updatedAddress] = await db
        .update(userAddresses)
        .set({
          label,
          recipientName,
          address,
          phone: phone || null,
          isDefault:
            body.isDefault === true
              ? true
              : existing[0].isDefault,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userAddresses.id, id),
            eq(userAddresses.userId, userId),
          ),
        )
        .returning();

      return Response.json({
        address: updatedAddress,
      });
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const id = Number(url.searchParams.get("id"));

      if (!Number.isInteger(id) || id <= 0) {
        return Response.json(
          { error: "Adresse invalide." },
          { status: 400 },
        );
      }

      const existing = await db
        .select()
        .from(userAddresses)
        .where(
          and(
            eq(userAddresses.id, id),
            eq(userAddresses.userId, userId),
          ),
        )
        .limit(1);

      if (!existing[0]) {
        return Response.json(
          { error: "Adresse introuvable." },
          { status: 404 },
        );
      }

      await db
        .delete(userAddresses)
        .where(
          and(
            eq(userAddresses.id, id),
            eq(userAddresses.userId, userId),
          ),
        );

      if (existing[0].isDefault) {
        const [nextAddress] = await db
          .select()
          .from(userAddresses)
          .where(eq(userAddresses.userId, userId))
          .orderBy(userAddresses.createdAt)
          .limit(1);

        if (nextAddress) {
          await db
            .update(userAddresses)
            .set({
              isDefault: true,
              updatedAt: new Date(),
            })
            .where(eq(userAddresses.id, nextAddress.id));
        }
      }

      return Response.json({
        success: true,
      });
    }

    return Response.json(
      { error: "Méthode non autorisée." },
      { status: 405 },
    );
  } catch (error) {
    console.error(
      "Account addresses failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    return Response.json(
      {
        error: "Impossible de gérer vos adresses pour le moment.",
      },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/account-addresses",
};
