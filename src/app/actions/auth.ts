"use server";

import { signIn, signOut } from "@/lib/auth/config";

/** Server actions carry Next.js's built-in origin check; Auth.js adds its own CSRF token. */
export async function signInWithGoogle(formData: FormData) {
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
