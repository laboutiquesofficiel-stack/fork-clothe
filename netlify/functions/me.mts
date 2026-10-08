import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { sessions, users } from "../../db/schema.js";

const getCookie = (cookieHeader: string | null, name: string) => {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");

    if (key === name) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return null;
};

export default async (req: Request) => {
  const sessionToken = getCookie(
    req.headers.get("cookie"),
    "fork_session",
  );

  if (!sessionToken) {
    return Response.json(
      {
        authenticated: false,
      },
      {
        status: 401,
      },
    );
  }

  const tokenHash = createHash("sha256")
    .update(sessionToken)
    .digest("hex");

  const result = await db
    .select({
      user: users,
      session: sessions,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  const account = result[0];

  if (!account || account.session.expiresAt.getTime() <= Date.now()) {
    return Response.json(
      {
        authenticated: false,
      },
      {
        status: 401,
      },
    );
  }

  return Response.json(
    {
      authenticated: true,
      user: {
        id: account.user.id,
        email: account.user.email,
        name: account.user.name,
        phone: account.user.phone,
        avatarUrl: account.user.avatarUrl,
      },
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};