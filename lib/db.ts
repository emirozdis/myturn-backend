import { prisma } from "./prisma";

/**
 * Unifies the database client references across the app.
 * Points to the connection-pool adapter client defined in prisma.ts
 * to prevent conflicting global variables or mismatched schema clients.
 */
export const db = prisma;