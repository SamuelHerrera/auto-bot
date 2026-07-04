import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { executeUpsertMenuProduct } from "../../src/application/usecases/menus.ts";
import { seedAuthorizedContact, seedKitchen, useDbTestHooks } from "../setup/db-fixtures.js";

useDbTestHooks();

describe("upsertMenuProduct persistence", () => {
  it("reuses an existing sold-out product, keeps it visible to kitchen workflows, and restores stock without cloning", async () => {
    const kitchen = await seedKitchen();
    const admin = await seedAuthorizedContact({
      kitchenId: kitchen.id,
      phone: "+529991110505",
      role: "KITCHEN",
      name: "Menu Portions Admin",
      active: true
    });
    const actor = {
      role: "KITCHEN",
      kitchenId: String(kitchen.id),
      contactId: admin.contact.id,
      phone: admin.contact.phone
    };

    await executeUpsertMenuProduct({
      messageId: "db_menu_product_001",
      actor,
      kitchenId: String(kitchen.id),
      product: {
        name: "Taco",
        stockQuantity: 0,
        portions: [
          { label: "Chico", price: 45 },
          { label: "Grande", price: 75 }
        ]
      }
    });

    await executeUpsertMenuProduct({
      messageId: "db_menu_product_002",
      actor,
      kitchenId: String(kitchen.id),
      product: {
        name: "Tacos",
        stockQuantity: 8,
        portions: [
          { label: "Chico", price: 50 },
          { label: "Grande", price: 75 }
        ]
      }
    });

    expect(await prisma.menu.count()).toBe(1);
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.menuItem.count()).toBe(2);

    const product = await prisma.product.findFirstOrThrow();
    const menuItems = await prisma.menuItem.findMany({
      orderBy: { id: "asc" },
      include: {
        productPortion: {
          include: {
            portion: true,
            product: true
          }
        }
      }
    });

    expect(product.name).toBe("Taco");
    expect(product.stock).toBe(8);
    expect(menuItems.map((item) => item.stockQuantity)).toEqual([8, 8]);
    expect(menuItems.map((item) => item.availabilityStatus)).toEqual(["AVAILABLE", "AVAILABLE"]);
    expect(menuItems.map((item) => item.productPortion.portion.size)).toEqual(["Chico", "Grande"]);
    expect(menuItems.map((item) => Number(item.price))).toEqual([50, 75]);
  });
});
