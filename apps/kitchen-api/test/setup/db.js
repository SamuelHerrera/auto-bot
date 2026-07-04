import { prisma } from "../../src/db/prisma.js";

const TABLES = [
  "whatsapp_manager_delivery_jobs",
  "whatsapp_manager_provider_messages",
  "whatsapp_manager_conversation_states",
  "processed_events",
  "activity_logs",
  "chat_logs",
  "conversations",
  "order_product_portions",
  "orders",
  "menu_items",
  "menus",
  "product_portions",
  "portions",
  "products",
  "whatsapp_sessions",
  "printers",
  "addresses",
  "linked_phones",
  "users",
  "kitchens"
];

export async function clearDatabase() {
  await prisma.$transaction(
    TABLES.map((tableName) =>
      prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE`)
    )
  );
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
