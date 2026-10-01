import type { UserStatus } from "@/generated/prisma/enums";

export type SignInRejection = "provider_not_allowed" | "email_unverified" | "account_disabled";

export interface SignInAttempt {
  provider: string | null;
  email: string | null;
  emailVerified: boolean;
  /** Status of the existing user with this email, or null for a first login. */
  existingStatus: UserStatus | null;
}

/**
 * Pure sign-in decision, kept separate from Auth.js so it is unit-testable.
 * First-time users are always allowed (and become role USER in the adapter);
 * disabled users are always rejected.
 */
export function evaluateSignIn(
  attempt: SignInAttempt,
): { allowed: true } | { allowed: false; reason: SignInRejection } {
  if (attempt.provider !== "google") return { allowed: false, reason: "provider_not_allowed" };
  if (!attempt.email || !attempt.emailVerified) return { allowed: false, reason: "email_unverified" };
  if (attempt.existingStatus === "DISABLED") return { allowed: false, reason: "account_disabled" };
  return { allowed: true };
}
