import { redirect } from "next/navigation";
import "server-only";

import { getSessionUser, type SessionUser } from "@/lib/session";

/** For server components: redirect anonymous visitors to /login. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export { getSessionUser };
export type { SessionUser };
