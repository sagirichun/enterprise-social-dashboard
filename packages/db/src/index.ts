// Shared Prisma client singleton for the monorepo.
// Import from "@esm/db" in apps and workers. Run `pnpm db:generate` after
// changing the schema.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  __esmPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.__esmPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__esmPrisma = prisma;
}

export default prisma;

// Re-export generated enums / types so consumers don't need @prisma/client directly.
export * from "@prisma/client";
