import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import "server-only";

import { createAuthAdapter, type AdapterDb } from "@/lib/auth/adapter";
import { evaluateSignIn } from "@/lib/auth/sign-in-policy";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging/logger";
import { recordAudit } from "@/services/audit-service";

const log = createLogger("auth");

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // refresh expiry at most daily

/**
 * Auth.js configuration.
 *
 * - Google is the only sign-in provider. GitHub and Slack are *integrations*
 *   connected after sign-in, not identities.
 * - Database sessions: the cookie holds an opaque token, the database holds its
 *   hash. Revoking a session (sign-out, account disabled) is immediate.
 * - Cookies are httpOnly, SameSite=Lax, and `__Secure-` prefixed over HTTPS
 *   (Auth.js defaults). Auth.js enforces its own CSRF token on sign-in/out.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createAuthAdapter(prisma as unknown as AdapterDb),
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ account, profile }) {
      const email = typeof profile?.email === "string" ? profile.email.toLowerCase() : null;
      const existing = email
        ? await prisma.user.findUnique({ where: { email }, select: { status: true } })
        : null;

      const decision = evaluateSignIn({
        provider: account?.provider ?? null,
        email,
        emailVerified: profile?.email_verified === true,
        existingStatus: existing?.status ?? null,
      });

      if (!decision.allowed) {
        log.warn("sign-in rejected", { reason: decision.reason });
        return `/login?error=${decision.reason}`;
      }
      return true;
    },

    session({ session, user }) {
      // `user` is loaded fresh from the database on every request (database
      // strategy), so role and status changes apply immediately.
      session.user = {
        ...session.user,
        id: user.id,
        name: user.name ?? null,
        email: user.email,
        image: user.image ?? null,
        role: user.role,
        status: user.status,
      };
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id) return;
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await recordAudit({
        actorUserId: user.id,
        action: "USER_LOGIN",
        targetType: "User",
        targetId: user.id,
        metadata: { provider: "google" },
      });
    },
  },
  logger: {
    error(error) {
      log.error("auth.js error", { name: error.name, message: error.message });
    },
    warn(code) {
      log.warn("auth.js warning", { code });
    },
    debug() {
      // Auth.js debug output can include provider payloads; never forwarded.
    },
  },
});
