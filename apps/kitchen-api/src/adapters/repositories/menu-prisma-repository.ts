import type { MenuRepository } from "../../domain/ports/menu-repository";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../infrastructure/prisma";
import { normalizeMexicanText } from "../../shared/normalize";
import { mapMenuToContext, toBigIntId, toDecimal } from "./helpers";

export class MenuPrismaRepository implements MenuRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async getCurrentMenu(kitchenId: string): Promise<any> {
    const menu = await this.findCurrentMenuWithRelations(toBigIntId(kitchenId, "kitchenId"));

    return mapMenuToContext(menu);
  }

  async publishMenu(input: Record<string, unknown>): Promise<any> {
    const kitchenId = toBigIntId(String(input.kitchenId), "kitchenId");
    const items = (input.items as Array<Record<string, unknown>>) ?? [];
    const currentMenu = await this.findCurrentMenuWithRelations(kitchenId);

    const targetMenu = await this.getOrCreateCurrentMenu(kitchenId, currentMenu);

    const retainedMenuItemIds = new Set<bigint>();

    for (const item of items) {
      const displayName = String(item.name);
      const normalizedName = normalizeMexicanText(displayName);
      const existingMenuItem = currentMenu?.menuItems.find((menuItem) => menuItem.normalizedDisplayName === normalizedName) ?? null;
      const product = existingMenuItem?.productPortion?.product
        ? await this.db.product.update({
            where: { id: existingMenuItem.productPortion.product.id },
            data: {
              name: displayName,
              normalizedName,
              stock: Number(item.stockQuantity ?? 0)
            }
          })
        : await this.db.product.upsert({
            where: {
              kitchenId_normalizedName: {
                kitchenId,
                normalizedName
              }
            },
            update: {
              name: displayName,
              normalizedName,
              stock: Number(item.stockQuantity ?? 0)
            },
            create: {
              kitchenId,
              name: displayName,
              normalizedName,
              stock: Number(item.stockQuantity ?? 0)
            }
          });

      const portion = await this.resolveOrCreatePortion(
        "STANDARD",
        Number(item.price),
        existingMenuItem?.productPortion?.portion?.id
      );
      const productPortion = await this.resolveOrCreateProductPortion(product.id, portion.id);

      const persistedMenuItem = existingMenuItem
        ? await this.db.menuItem.update({
            where: { id: existingMenuItem.id },
            data: {
              menuId: targetMenu.id,
              productPortionId: productPortion.id,
              displayName,
              normalizedDisplayName: normalizedName,
              price: toDecimal(Number(item.price)),
              stockQuantity: Number(item.stockQuantity ?? 0),
              availabilityStatus: item.availabilityStatus as any
            }
          })
        : await this.db.menuItem.create({
            data: {
              menuId: targetMenu.id,
              productPortionId: productPortion.id,
              displayName,
              normalizedDisplayName: normalizedName,
              price: toDecimal(Number(item.price)),
              stockQuantity: Number(item.stockQuantity ?? 0),
              availabilityStatus: item.availabilityStatus as any
            }
          });

      retainedMenuItemIds.add(persistedMenuItem.id);
    }

    await this.db.menuItem.deleteMany({
      where: {
        menuId: targetMenu.id,
        ...(retainedMenuItemIds.size > 0
          ? {
              id: {
                notIn: [...retainedMenuItemIds]
              }
            }
          : {})
      }
    });

    const menu = await this.db.menu.findUniqueOrThrow(this.buildMenuWithRelationsArgs({ id: targetMenu.id }));

    return mapMenuToContext(menu);
  }

  async upsertMenuProduct(input: Record<string, unknown>): Promise<any> {
    const kitchenId = toBigIntId(String(input.kitchenId), "kitchenId");
    const productInput = (input.product as Record<string, unknown>) ?? {};
    const requestedProductName = String(productInput.name ?? "").trim();
    const normalizedProductName = normalizeMexicanText(requestedProductName);
    const stockQuantity = Number(productInput.stockQuantity ?? 0);
    const portions = Array.isArray(productInput.portions)
      ? (productInput.portions as Array<Record<string, unknown>>)
      : [];
    const currentMenu = await this.findCurrentMenuWithRelations(kitchenId);
    const targetMenu = await this.getOrCreateCurrentMenu(kitchenId, currentMenu);
    const aliasMatchedProduct = await this.findAliasMatchedProduct(kitchenId, normalizedProductName);
    const shouldPreserveCanonicalName = aliasMatchedProduct && aliasMatchedProduct.normalizedName !== normalizedProductName;
    const productName = shouldPreserveCanonicalName ? aliasMatchedProduct.name : requestedProductName;
    const product = aliasMatchedProduct
      ? await this.db.product.update({
          where: { id: aliasMatchedProduct.id },
          data: {
            name: productName,
            normalizedName: shouldPreserveCanonicalName ? aliasMatchedProduct.normalizedName : normalizedProductName,
            stock: stockQuantity
          }
        })
      : await this.db.product.create({
          data: {
            kitchenId,
            name: productName,
            normalizedName: normalizedProductName,
            stock: stockQuantity
          }
        });
    const existingMenuItems =
      currentMenu?.menuItems.filter((menuItem) => menuItem.productPortion?.product?.id === product.id) ?? [];
    const retainedMenuItemIds = new Set<bigint>();

    for (const portionInput of portions) {
      const portionLabel = String(portionInput.label ?? "").trim();
      const normalizedPortionLabel = normalizeMexicanText(portionLabel);
      const portionDisplayName = portionLabel === "STANDARD"
        ? productName
        : `${productName} (${portionLabel})`;
      const existingMenuItem =
        existingMenuItems.find((menuItem) => {
          return normalizeMexicanText(menuItem.productPortion?.portion?.size ?? "") === normalizedPortionLabel;
        }) ?? null;
      const portion = await this.resolveOrCreatePortion(
        portionLabel,
        Number(portionInput.price),
        existingMenuItem?.productPortion?.portion?.id
      );
      const productPortion = await this.resolveOrCreateProductPortion(product.id, portion.id);
      const availabilityStatus = resolveAvailabilityStatus(portionInput.availabilityStatus, stockQuantity);
      const persistedMenuItem = existingMenuItem
        ? await this.db.menuItem.update({
            where: { id: existingMenuItem.id },
            data: {
              menuId: targetMenu.id,
              productPortionId: productPortion.id,
              displayName: portionDisplayName,
              normalizedDisplayName: normalizeMexicanText(portionDisplayName),
              price: toDecimal(Number(portionInput.price)),
              stockQuantity,
              availabilityStatus
            }
          })
        : await this.db.menuItem.create({
            data: {
              menuId: targetMenu.id,
              productPortionId: productPortion.id,
              displayName: portionDisplayName,
              normalizedDisplayName: normalizeMexicanText(portionDisplayName),
              price: toDecimal(Number(portionInput.price)),
              stockQuantity,
              availabilityStatus
            }
          });

      retainedMenuItemIds.add(persistedMenuItem.id);
    }

    if (existingMenuItems.length > 0) {
      await this.db.menuItem.deleteMany({
        where: {
          id: {
            in: existingMenuItems
              .map((item) => item.id)
              .filter((id) => !retainedMenuItemIds.has(id))
          }
        }
      });
    }

    const menu = await this.db.menu.findUniqueOrThrow(this.buildMenuWithRelationsArgs({ id: targetMenu.id }));
    const menuContext = mapMenuToContext(menu);
    const productItems = menuContext.items.filter((item: any) => {
      return String(item.productId) === product.id.toString();
    });

    return {
      id: product.id.toString(),
      name: product.name,
      stockQuantity: Number(product.stock),
      portions: productItems.map((item: any) => ({
        menuItemId: item.id,
        label: item.portionLabel,
        price: item.price,
        stockQuantity: item.stockQuantity,
        availabilityStatus: item.availabilityStatus
      }))
    };
  }

  private buildMenuWithRelationsArgs(where: Record<string, unknown>): any {
    return {
      where,
      include: {
        menuItems: {
          include: {
            productPortion: {
              include: {
                product: true,
                portion: true
              }
            }
          },
          orderBy: [{ displayName: "asc" }, { id: "asc" }]
        }
      }
    };
  }

  private async findCurrentMenuWithRelations(kitchenId: bigint): Promise<any> {
    return this.db.menu.findFirst({
      ...this.buildMenuWithRelationsArgs({
        kitchenId,
        isCurrent: true,
        status: "PUBLISHED"
      }),
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }]
    });
  }

  private async getOrCreateCurrentMenu(kitchenId: bigint, currentMenu: any) {
    return currentMenu
      ? await this.db.menu.update({
          where: { id: currentMenu.id },
          data: {
            name: currentMenu.name ?? "Current Menu",
            status: "PUBLISHED",
            isCurrent: true,
            publishedAt: new Date()
          }
        })
      : await this.db.menu.create({
          data: {
            kitchenId,
            name: "Current Menu",
            status: "PUBLISHED",
            isCurrent: true,
            publishedAt: new Date()
          }
        });
  }

  private async resolveOrCreatePortion(
    label: string,
    price: number,
    existingPortionId?: bigint | null
  ) {
    const normalizedLabel = label.trim() || "STANDARD";

    if (existingPortionId) {
      const existingPortion = await this.db.portion.findUnique({
        where: { id: existingPortionId }
      });

      if (existingPortion && Number(existingPortion.price) === price && existingPortion.size === normalizedLabel) {
        return existingPortion;
      }
    }

    const reusablePortion = await this.db.portion.findFirst({
      where: {
        size: normalizedLabel,
        price: toDecimal(price)
      },
      orderBy: { id: "asc" }
    });

    if (reusablePortion) {
      return reusablePortion;
    }

    return this.db.portion.create({
      data: {
        size: normalizedLabel,
        price: toDecimal(price)
      }
    });
  }

  private async findAliasMatchedProduct(kitchenId: bigint, normalizedName: string) {
    const aliases = buildNormalizedNameAliases(normalizedName);
    const products = await this.db.product.findMany({
      where: {
        kitchenId,
        normalizedName: {
          in: aliases
        }
      },
      orderBy: { id: "asc" }
    });

    if (products.length === 1) {
      return products[0];
    }

    return products.find((product) => product.normalizedName === normalizedName) ?? null;
  }

  private async resolveOrCreateProductPortion(productId: bigint, portionId: bigint) {
    const existing = await this.db.productPortion.findUnique({
      where: {
        productId_portionId: {
          productId,
          portionId
        }
      }
    });

    if (existing) {
      return existing;
    }

    return this.db.productPortion.create({
      data: {
        productId,
        portionId
      }
    });
  }
}

function buildNormalizedNameAliases(normalizedName: string) {
  const aliases = new Set([normalizedName]);

  if (normalizedName.endsWith("es") && normalizedName.length > 2) {
    aliases.add(normalizedName.slice(0, -2));
  }

  if (normalizedName.endsWith("s") && normalizedName.length > 1) {
    aliases.add(normalizedName.slice(0, -1));
  } else {
    aliases.add(`${normalizedName}s`);
  }

  return [...aliases];
}

function resolveAvailabilityStatus(inputAvailabilityStatus: unknown, stockQuantity: number) {
  if (inputAvailabilityStatus === "HIDDEN") {
    return "HIDDEN";
  }

  if (inputAvailabilityStatus === "SOLD_OUT" || stockQuantity === 0) {
    return "SOLD_OUT";
  }

  return "AVAILABLE";
}
