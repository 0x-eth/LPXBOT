import type { IssuedSession } from "@lpbot/security";
import type { FastifyReply } from "fastify";

export const sessionCookieName = "lpbot_session";

export function setBrowserSessionCookie(
  reply: Pick<FastifyReply, "setCookie">,
  session: IssuedSession,
): void {
  reply.setCookie(sessionCookieName, session.token, {
    expires: session.expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
}
