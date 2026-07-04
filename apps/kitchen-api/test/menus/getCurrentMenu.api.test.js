import { describe, expect, it } from 'vitest';
import { getCurrentMenu } from './getCurrentMenu.js';

describe('GET /kitchens/{kitchen_id}/menus - getCurrentMenu', () => {
  it('returns the current available menu when the kitchen is open', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      },
      currentMenu: {
        id: 'menu_1',
        kitchenId: 'kitchen_1',
        items: [
          {
            id: 'item_1',
            name: 'Torta de asado',
            price: 45,
            availabilityStatus: 'AVAILABLE',
            stockQuantity: 10
          }
        ]
      }
    };

    const result = await getCurrentMenu(input, context);

    expect(result).toEqual({
      ok: true,
      availability: {
        acceptingOrders: true
      },
      menu: {
        id: 'menu_1',
        products: [
          {
            productId: null,
            name: 'Torta de asado',
            availabilityStatus: 'AVAILABLE',
            portions: [
              {
                menuItemId: 'item_1',
                label: 'STANDARD',
                price: 45,
                availabilityStatus: 'AVAILABLE'
              }
            ]
          }
        ]
      }
    });
  });

  it('returns machine-readable availability state when the kitchen is closed', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'CLOSED',
        schedule: 'Lunes a viernes 09:00-18:00'
      },
      currentMenu: {
        id: 'menu_1',
        kitchenId: 'kitchen_1',
        items: []
      }
    };

    const result = await getCurrentMenu(input, context);

    expect(result.availability).toEqual({
      acceptingOrders: false,
      reason: 'closed',
      schedule: 'Lunes a viernes 09:00-18:00'
    });
  });

  it('returns a safe response when no current menu exists', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      },
      currentMenu: null
    };

    const result = await getCurrentMenu(input, context);

    expect(result).toEqual({
      ok: true,
      availability: {
        acceptingOrders: true
      },
      menu: null
    });
  });

  it('does not return a menu from another kitchen', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_2'
    };
    const context = {
      kitchen: {
        id: 'kitchen_2',
        orderingStatus: 'OPEN'
      },
      currentMenu: {
        id: 'menu_1',
        kitchenId: 'kitchen_1',
        items: []
      }
    };

    const result = await getCurrentMenu(input, context);

    expect(result.menu).toBe(null);
  });

  it('hides SOLD_OUT items from the public menu', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      },
      currentMenu: {
        id: 'menu_1',
        kitchenId: 'kitchen_1',
        items: [
          {
            id: 'item_1',
            name: 'Torta de asado',
            price: 45,
            availabilityStatus: 'AVAILABLE'
          },
          {
            id: 'item_2',
            name: 'Agua fresca',
            price: 25,
            availabilityStatus: 'SOLD_OUT'
          }
        ]
      }
    };

    const result = await getCurrentMenu(input, context);

    expect(result.menu.products).toEqual([
      {
        productId: null,
        name: 'Torta de asado',
        availabilityStatus: 'AVAILABLE',
        portions: [
          {
            menuItemId: 'item_1',
            label: 'STANDARD',
            price: 45,
            availabilityStatus: 'AVAILABLE'
          }
        ]
      }
    ]);
  });

  it('shows grouped portions and stock to a trusted kitchen actor', async () => {
    const input = {
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      },
      currentMenu: {
        id: 'menu_1',
        kitchenId: 'kitchen_1',
        items: [
          {
            id: 'item_1',
            productId: 'product_1',
            normalizedProductName: 'taco',
            name: 'Taco',
            portionLabel: 'Chico',
            price: 45,
            stockQuantity: 12,
            availabilityStatus: 'AVAILABLE'
          },
          {
            id: 'item_2',
            productId: 'product_1',
            normalizedProductName: 'taco',
            name: 'Taco',
            portionLabel: 'Grande',
            price: 75,
            stockQuantity: 12,
            availabilityStatus: 'SOLD_OUT'
          }
        ]
      }
    };

    const result = await getCurrentMenu(input, context);

    expect(result.menu.products).toEqual([
      {
        productId: 'product_1',
        name: 'Taco',
        availabilityStatus: 'AVAILABLE',
        portions: [
          {
            menuItemId: 'item_1',
            label: 'Chico',
            price: 45,
            stockQuantity: 12,
            availabilityStatus: 'AVAILABLE'
          },
          {
            menuItemId: 'item_2',
            label: 'Grande',
            price: 75,
            stockQuantity: 12,
            availabilityStatus: 'SOLD_OUT'
          }
        ]
      }
    ]);
  });
});
