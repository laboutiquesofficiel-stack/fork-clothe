import type { Config } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db/index.js";
import { orders, sessions } from "../../db/schema.js";

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

export default async (request: Request) => {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Méthode non autorisée." },
      { status: 405 },
    );
  }

  try {
    const userId = await getSessionUserId(request);

    if (!userId) {
      return Response.json(
        {
          authenticated: false,
          orders: [],
        },
        { status: 401 },
      );
    }

    const userOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        items: orders.items,
        itemCount: orders.itemCount,
        subtotalCents: orders.subtotalCents,
        shippingCents: orders.shippingCents,
        totalCents: orders.totalCents,
        currency: orders.currency,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        paymentProvider: orders.paymentProvider,
        shipmentStatus: orders.shipmentStatus,
        carrier: orders.carrier,
        trackingNumber: orders.trackingNumber,
        trackingUrl: orders.trackingUrl,
        shippedAt: orders.shippedAt,
        deliveredAt: orders.deliveredAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));

    return Response.json({
      authenticated: true,
      orders: userOrders,
    });
  } catch (error) {
    console.error(
      "Account orders failed",
      error instanceof Error ? error.message : "Unknown error",
    );

    return Response.json(
      {
        error: "Impossible de récupérer vos commandes pour le moment.",
      },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: "/api/account-orders",
  method: "GET",
};