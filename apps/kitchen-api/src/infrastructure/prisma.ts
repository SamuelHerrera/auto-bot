import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __hermesPrisma: PrismaClient | undefined;
}

function createPrismaClient() {
  if (!process.env.DATABASE_URL) {
    if ((process.env.NODE_ENV ?? "development") === "production") {
      throw new Error("DATABASE_URL is required in production");
    }

    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/kitchen_chatbot?schema=public";
  }

  return new PrismaClient();
}

export const prisma =
  globalThis.__hermesPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__hermesPrisma = prisma;
}
