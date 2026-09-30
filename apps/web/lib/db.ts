// Prisma client singleton for the Next.js app.
// The client itself is constructed in @dashboard/db; this module re-exports
// it under the conventional `db` name used across API routes.

import { prisma } from '@dashboard/db';

export { prisma };
export const db = prisma;
export default prisma;
