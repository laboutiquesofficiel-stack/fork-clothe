import type { Config } from "@netlify/functions";
import { clearedSessionCookie, deleteSession } from "../../lib/auth.js";

/** Déconnexion : supprime la session en base et efface le cookie. */
export default async (request: Request) => {
  try {
    await deleteSession(request);
  } catch (error) {
    console.error("Logout failed", error instanceof Error ? error.message : "Unknown error");
  }

  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearedSessionCookie(), "Cache-Control": "no-store" } },
  );
};

export const config: Config = {
  path: "/api/logout",
  method: "POST",
};
