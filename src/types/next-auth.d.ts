import type { DefaultSession } from "next-auth";

import type { UserRole, UserStatus } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      status: UserStatus;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
    status?: UserStatus;
  }
}

declare module "@auth/core/adapters" {
  interface AdapterUser {
    role: UserRole;
    status: UserStatus;
  }
}
