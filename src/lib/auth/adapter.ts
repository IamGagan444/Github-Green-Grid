import type { Adapter, AdapterAccount, AdapterSession, AdapterUser } from "next-auth/adapters";

import { hashToken } from "@/lib/encryption";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";

/**
 * Auth.js database adapter, written against our schema rather than using
 * `@auth/prisma-adapter`, for three reasons:
 *
 *  1. Session tokens are stored as SHA-256 hashes. A database leak does not
 *     yield usable session cookies.
 *  2. Provider OAuth tokens (Google access/refresh/id tokens) are discarded.
 *     Sign-in only needs the identity; storing unused credentials is liability.
 *  3. Role and status are owned by the application. Auth.js can never create
 *     or update a user with a role other than USER, and disabled users cannot
 *     resolve a session.
 */

interface UserRecord {
  id: string;
  name: string | null;
  email: string | null;
  emailVerified: Date | null;
  image: string | null;
  role: UserRole;
  status: UserStatus;
}

/** The subset of the Prisma client the adapter touches — narrow so tests can fake it. */
export interface AdapterDb {
  user: {
    create(args: { data: Record<string, unknown> }): Promise<UserRecord>;
    findUnique(args: { where: { id: string } | { email: string } }): Promise<UserRecord | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<UserRecord>;
    delete(args: { where: { id: string } }): Promise<unknown>;
  };
  account: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    findUnique(args: {
      where: { provider_providerAccountId: { provider: string; providerAccountId: string } };
      include: { user: true };
    }): Promise<{ user: UserRecord } | null>;
    deleteMany(args: { where: { provider: string; providerAccountId: string } }): Promise<unknown>;
  };
  session: {
    create(args: { data: { userId: string; tokenHash: string; expiresAt: Date } }): Promise<unknown>;
    findUnique(args: {
      where: { tokenHash: string };
      include: { user: true };
    }): Promise<{ userId: string; expiresAt: Date; user: UserRecord } | null>;
    update(args: {
      where: { tokenHash: string };
      data: { expiresAt: Date };
    }): Promise<{ userId: string; expiresAt: Date }>;
    deleteMany(args: { where: { tokenHash: string } | { userId: string } }): Promise<unknown>;
  };
}

export function toAdapterUser(user: UserRecord): AdapterUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email ?? "",
    emailVerified: user.emailVerified,
    image: user.image,
    role: user.role,
    status: user.status,
  };
}

export function createAuthAdapter(db: AdapterDb): Adapter {
  return {
    async createUser(user) {
      // Role and status are never taken from the incoming object.
      const created = await db.user.create({
        data: {
          email: user.email.toLowerCase(),
          name: user.name ?? null,
          image: user.image ?? null,
          emailVerified: user.emailVerified ?? null,
          role: "USER",
          status: "ACTIVE",
        },
      });
      return toAdapterUser(created);
    },

    async getUser(id) {
      const user = await db.user.findUnique({ where: { id } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByEmail(email) {
      const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
      return user ? toAdapterUser(user) : null;
    },

    async getUserByAccount({ provider, providerAccountId }) {
      const account = await db.account.findUnique({
        where: { provider_providerAccountId: { provider, providerAccountId } },
        include: { user: true },
      });
      return account ? toAdapterUser(account.user) : null;
    },

    async updateUser(user) {
      // Only profile fields sync from the identity provider.
      const updated = await db.user.update({
        where: { id: user.id },
        data: {
          ...(user.name !== undefined ? { name: user.name } : {}),
          ...(user.image !== undefined ? { image: user.image } : {}),
          ...(user.emailVerified !== undefined ? { emailVerified: user.emailVerified } : {}),
        },
      });
      return toAdapterUser(updated);
    },

    async deleteUser(id) {
      await db.user.delete({ where: { id } });
    },

    async linkAccount(account: AdapterAccount) {
      // access_token / refresh_token / id_token are deliberately dropped.
      await db.account.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
      });
      return undefined;
    },

    async unlinkAccount({ provider, providerAccountId }) {
      await db.account.deleteMany({ where: { provider, providerAccountId } });
      return undefined;
    },

    async createSession({ sessionToken, userId, expires }): Promise<AdapterSession> {
      await db.session.create({
        data: { userId, tokenHash: hashToken(sessionToken), expiresAt: expires },
      });
      return { sessionToken, userId, expires };
    },

    async getSessionAndUser(sessionToken) {
      const tokenHash = hashToken(sessionToken);
      const session = await db.session.findUnique({ where: { tokenHash }, include: { user: true } });
      if (!session) return null;

      if (session.expiresAt.getTime() < Date.now()) {
        await db.session.deleteMany({ where: { tokenHash } });
        return null;
      }

      // A disabled account loses every session immediately.
      if (session.user.status !== "ACTIVE") {
        await db.session.deleteMany({ where: { userId: session.userId } });
        return null;
      }

      return {
        session: { sessionToken, userId: session.userId, expires: session.expiresAt },
        user: toAdapterUser(session.user),
      };
    },

    async updateSession({ sessionToken, expires }) {
      if (!expires) return null;
      const updated = await db.session.update({
        where: { tokenHash: hashToken(sessionToken) },
        data: { expiresAt: expires },
      });
      return { sessionToken, userId: updated.userId, expires: updated.expiresAt };
    },

    async deleteSession(sessionToken) {
      await db.session.deleteMany({ where: { tokenHash: hashToken(sessionToken) } });
      return undefined;
    },
  };
}
