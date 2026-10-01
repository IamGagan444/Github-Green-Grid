#!/usr/bin/env node
/**
 * Promotes (or demotes) a user by email. Roles are never self-selected in the
 * app; the first administrator is created by an operator with database access:
 *
 *   npm run admin:grant -- someone@example.com
 *   npm run admin:grant -- someone@example.com --revoke
 *
 * The user must have signed in with Google at least once.
 */
import "dotenv/config";
import pg from "pg";

const [email, flag] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error("Usage: npm run admin:grant -- <email> [--revoke]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const role = flag === "--revoke" ? "USER" : "ADMIN";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const result = await client.query(
    `UPDATE "users" SET "role" = $1::"UserRole", "updatedAt" = NOW() WHERE lower("email") = lower($2) RETURNING "id"`,
    [role, email],
  );
  if (result.rowCount === 0) {
    console.error(`No user with email ${email}. They must sign in once first.`);
    process.exitCode = 1;
  } else {
    await client.query(
      `INSERT INTO "audit_logs" ("id", "actorUserId", "action", "targetType", "targetId", "metadata", "createdAt")
       VALUES (gen_random_uuid()::text, NULL, 'ADMIN_ACTION', 'User', $1, $2::jsonb, NOW())`,
      [result.rows[0].id, JSON.stringify({ operation: role === "ADMIN" ? "role_granted_cli" : "role_revoked_cli" })],
    );
    console.log(`${email} is now ${role}.`);
  }
} finally {
  await client.end();
}
