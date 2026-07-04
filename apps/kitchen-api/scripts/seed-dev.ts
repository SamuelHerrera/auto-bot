import { Prisma } from "@prisma/client";
import { prisma } from "../src/infrastructure/prisma";
import { normalizeMexicanText } from "../src/shared/normalize";

const DEV_KITCHEN_NAME = "KitchenIA Local Test Kitchen";
const DEV_KITCHEN_DESCRIPTION = "Dedicated local-only kitchen for backend manual testing.";
const DEV_MENU_NAME = "KitchenIA Local Test Menu";
const DEV_PRODUCT_NAME = "Taco";
const DEV_PRODUCT_DESCRIPTION = "Seeded menu item for local orders flow verification.";
const DEV_PORTION_SIZE = "LOCAL_TEST_STANDARD";
const DEV_PRICE = 75;
const DEV_STOCK_QUANTITY = 20;
const DEV_DELIVERY_FEE = 25;

type SeedDb = Prisma.TransactionClient;

async function findOrCreateKitchen(db: SeedDb) {
  const existingKitchen = await db.kitchen.findFirst({
    where: { name: DEV_KITCHEN_NAME },
    orderBy: { id: "asc" }
  });

  if (existingKitchen) {
    return db.kitchen.update({
      where: { id: existingKitchen.id },
      data: {
        description: DEV_KITCHEN_DESCRIPTION,
        setupStatus: "ACTIVE",
        orderingStatus: "OPEN",
        paymentOptions: ["CASH", "TRANSFER"],
        deliveryEnabled: true,
        deliveryFee: new Prisma.Decimal(DEV_DELIVERY_FEE)
      }
    });
  }

  return db.kitchen.create({
    data: {
      name: DEV_KITCHEN_NAME,
      description: DEV_KITCHEN_DESCRIPTION,
      setupStatus: "ACTIVE",
      orderingStatus: "OPEN",
      paymentOptions: ["CASH", "TRANSFER"],
      deliveryEnabled: true,
      deliveryFee: new Prisma.Decimal(DEV_DELIVERY_FEE)
    }
  });
}

async function findOrCreatePortion(db: SeedDb) {
  const existingPortion = await db.portion.findFirst({
    where: {
      size: DEV_PORTION_SIZE,
      price: new Prisma.Decimal(DEV_PRICE)
    },
    orderBy: { id: "asc" }
  });

  if (existingPortion) {
    return existingPortion;
  }

  return db.portion.create({
    data: {
      size: DEV_PORTION_SIZE,
      price: new Prisma.Decimal(DEV_PRICE)
    }
  });
}

async function main() {
  const summary = await prisma.$transaction(async (db) => {
    const kitchen = await findOrCreateKitchen(db);
    const normalizedProductName = normalizeMexicanText(DEV_PRODUCT_NAME);

    const product = await db.product.upsert({
      where: {
        kitchenId_normalizedName: {
          kitchenId: kitchen.id,
          normalizedName: normalizedProductName
        }
      },
      update: {
        name: DEV_PRODUCT_NAME,
        normalizedName: normalizedProductName,
        description: DEV_PRODUCT_DESCRIPTION,
        stock: DEV_STOCK_QUANTITY
      },
      create: {
        kitchenId: kitchen.id,
        name: DEV_PRODUCT_NAME,
        normalizedName: normalizedProductName,
        description: DEV_PRODUCT_DESCRIPTION,
        stock: DEV_STOCK_QUANTITY
      }
    });

    const portion = await findOrCreatePortion(db);

    const productPortion = await db.productPortion.upsert({
      where: {
        productId_portionId: {
          productId: product.id,
          portionId: portion.id
        }
      },
      update: {},
      create: {
        productId: product.id,
        portionId: portion.id
      }
    });

    await db.menu.updateMany({
      where: {
        kitchenId: kitchen.id,
        isCurrent: true
      },
      data: {
        isCurrent: false
      }
    });

    const existingMenu = await db.menu.findFirst({
      where: {
        kitchenId: kitchen.id,
        name: DEV_MENU_NAME
      },
      orderBy: { id: "asc" }
    });

    const menu = existingMenu
      ? await db.menu.update({
          where: { id: existingMenu.id },
          data: {
            status: "PUBLISHED",
            isCurrent: true,
            publishedAt: new Date()
          }
        })
      : await db.menu.create({
          data: {
            kitchenId: kitchen.id,
            name: DEV_MENU_NAME,
            status: "PUBLISHED",
            isCurrent: true,
            publishedAt: new Date()
          }
        });

    const existingMenuItem = await db.menuItem.findFirst({
      where: {
        menuId: menu.id,
        OR: [
          { productPortionId: productPortion.id },
          { normalizedDisplayName: normalizedProductName }
        ]
      },
      orderBy: { id: "asc" }
    });

    const menuItem = existingMenuItem
      ? await db.menuItem.update({
          where: { id: existingMenuItem.id },
          data: {
            productPortionId: productPortion.id,
            displayName: DEV_PRODUCT_NAME,
            normalizedDisplayName: normalizedProductName,
            description: DEV_PRODUCT_DESCRIPTION,
            price: new Prisma.Decimal(DEV_PRICE),
            stockQuantity: DEV_STOCK_QUANTITY,
            availabilityStatus: "AVAILABLE"
          }
        })
      : await db.menuItem.create({
          data: {
            menuId: menu.id,
            productPortionId: productPortion.id,
            displayName: DEV_PRODUCT_NAME,
            normalizedDisplayName: normalizedProductName,
            description: DEV_PRODUCT_DESCRIPTION,
            price: new Prisma.Decimal(DEV_PRICE),
            stockQuantity: DEV_STOCK_QUANTITY,
            availabilityStatus: "AVAILABLE"
          }
        });

    return {
      kitchen,
      menu,
      menuItem
    };
  });

  console.log("Development seed ready.");
  console.log(`Kitchen ID: ${summary.kitchen.id.toString()}`);
  console.log(`Kitchen name: ${summary.kitchen.name}`);
  console.log(`Current menu: ${summary.menu.name}`);
  console.log(`Menu item: ${summary.menuItem.displayName}`);
  console.log(`Price: ${DEV_PRICE}`);
  console.log(`Stock quantity: ${DEV_STOCK_QUANTITY}`);
  console.log("Use this kitchen ID for x-caller-context and POST /orders/draft manual testing.");
  console.log(`PowerShell copy-paste: $KitchenId = ${summary.kitchen.id.toString()}`);
  console.log("Rerun this seed at any time to restore the local Taco menu item to the documented test state.");
}

main()
  .catch((error) => {
    console.error("Development seed failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
