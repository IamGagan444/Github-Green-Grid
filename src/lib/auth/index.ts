import "server-only";

export { auth, handlers, signIn, signOut } from "@/lib/auth/config";
export {
  getCurrentUser,
  requireUser,
  requireAdmin,
  displayNameFor,
  type SessionUser,
} from "@/lib/auth/session";
