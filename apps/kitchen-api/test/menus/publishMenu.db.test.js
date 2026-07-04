import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executePublishMenu } from "../../src/application/usecases/menus.ts";
import { seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("publishMenu persistence", () => {
  it("creates current menu rows, sellable items, and audit/idempotency records", async () => {
    const kitchen = await seedKitchen();

    const result = await executePublishMenu({
      messageId: "db_menu_001",
      actor: {
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        contactId: "1"
      },
      kitchenId: String(kitchen.id),
      items: [
        {
          name: "Torta de asado",
          price: 45,
          stockQuantity: 10,
          availabilityStatus: "AVAILABLE"
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(await prisma.menu.count()).toBe(1);
    expect(await prisma.menuItem.count()).toBe(1);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.activityLog.count()).toBe(1);
    expect(await prisma.processedEvent.count()).toBe(1);
  });

  it("does not duplicate persisted menu publication for the same messageId", async () => {
    const kitchen = await seedKitchen();
    const input = {
      messageId: "db_menu_002",
      actor: {
        role: "KITCHEN",
        kitchenId: String(kitchen.id),
        contactId: "1"
      },
      kitchenId: String(kitchen.id),
      items: [
        {
          name: "Torta de asado",
          price: 45,
          stockQuantity: 10,
          availabilityStatus: "AVAILABLE"
        }
      ]
    };

    await executePublishMenu(input);
    await executePublishMenu(input);

    expect(await prisma.menu.count()).toBe(1);
  });

  it("updates an existing current menu item in place instead of cloning menu/product links", async () => {
    const kitchen = await seedKitchen();
    const actor = {
      role: "KITCHEN",
      kitchenId: String(kitchen.id),
      contactId: "1"
    };

    await executePublishMenu({
      messageId: "db_menu_003",
      actor,
      kitchenId: String(kitchen.id),
      items: [
        {
          name: "Taco",
          price: 75,
          stockQuantity: 20,
          availabilityStatus: "AVAILABLE"
        }
      ]
    });

    await executePublishMenu({
      messageId: "db_menu_004",
      actor,
      kitchenId: String(kitchen.id),
      items: [
        {
          name: "taco",
          price: 75,
          stockQuantity: 8,
          availabilityStatus: "AVAILABLE"
        }
      ]
    });

    expect(await prisma.menu.count()).toBe(1);
    expect(await prisma.menuItem.count()).toBe(1);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.portion.count()).toBe(1);
    expect(await prisma.productPortion.count()).toBe(1);

    const menuItem = await prisma.menuItem.findFirstOrThrow({
      include: {
        productPortion: {
          include: {
            product: true,
            portion: true
          }
        }
      }
    });

    expect(menuItem.displayName).toBe("taco");
    expect(Number(menuItem.price)).toBe(75);
    expect(menuItem.stockQuantity).toBe(8);
    expect(menuItem.productPortion.product.normalizedName).toBe("taco");
    expect(Number(menuItem.productPortion.portion.price)).toBe(75);
  });
});
