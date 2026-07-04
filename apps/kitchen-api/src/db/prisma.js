let prismaModule;

const nodeEnv = process.env.NODE_ENV ?? "development";

if (!process.env.DATABASE_URL && ["development", "test"].includes(nodeEnv)) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/kitchen_chatbot?schema=public";
}

try {
  prismaModule = require("../infrastructure/prisma.ts");
} catch {
  const { PrismaClient } = require("@prisma/client");

  global.__hermesLegacyPrisma ??= new PrismaClient();
  prismaModule = {
    prisma: global.__hermesLegacyPrisma
  };
}

module.exports = prismaModule;
