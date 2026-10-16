"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { clientIpFromHeaders } from "@/lib/api";
import { signIn, signOut } from "@/lib/auth/config";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/** Server actions carry Next.js's built-in origin check; Auth.js adds its own CSRF token. */
export async function signInWithGoogle(formData: FormData) {
  const limit = await rateLimit(`auth:signin:${clientIpFromHeaders(await headers())}`, RATE_LIMITS.auth);
  if (!limit.success) redirect("/login?error=rate_limited");

  const requested = formData.get("returnTo");
  const returnTo =
    typeof requested === "string" && requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/dashboard";
  await signIn("google", { redirectTo: returnTo });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
