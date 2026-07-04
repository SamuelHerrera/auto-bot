import { describe, expect, it } from 'vitest';
import { publishMenu } from './publishMenu.js';

describe('POST /kitchens/{kitchen_id}/menus - publishMenu', () => {
  it('rejects clients publishing a menu', async () => {
    const input = {
      messageId: 'wa_menu_001',
      actor: {
        role: 'CLIENT'
      },
      kitchenId: 'kitchen_1',
      items: []
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('allows role KITCHEN to publish the current menu', async () => {
    const input = {
      messageId: 'wa_menu_002',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de asado',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toMatchObject({
      ok: true,
      menu: {
        kitchenId: 'kitchen_1',
        status: 'PUBLISHED',
        isCurrent: true,
        items: [
          {
            name: 'Torta de asado',
            price: 45,
            stockQuantity: 10,
            availabilityStatus: 'AVAILABLE'
          }
        ]
      },
      auditEvent: {
        type: 'menu_published',
        actorId: 'contact_1'
      }
    });
  });

  it('rejects role KITCHEN publishing outside their kitchen scope', async () => {
    const input = {
      messageId: 'wa_menu_003',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_2',
        contactId: 'contact_2'
      },
      kitchenId: 'kitchen_1',
      items: []
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('rejects a menu item with a blank name', async () => {
    const input = {
      messageId: 'wa_menu_004',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: '   ',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_menu_item',
      field: 'name'
    });
  });

  it('rejects a menu item with a non-positive price', async () => {
    const input = {
      messageId: 'wa_menu_005',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de asado',
          price: 0,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_menu_item',
      field: 'price'
    });
  });

  it('rejects a menu item with negative stock', async () => {
    const input = {
      messageId: 'wa_menu_006',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de asado',
          price: 45,
          stockQuantity: -1,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_menu_item',
      field: 'stockQuantity'
    });
  });

  it('rejects a menu item with unsupported availability status', async () => {
    const input = {
      messageId: 'wa_menu_007',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de asado',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'SOLD_OUT_SOON'
        }
      ]
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_menu_item',
      field: 'availabilityStatus'
    });
  });

  it('rejects duplicate product names after normalization', async () => {
    const input = {
      messageId: 'wa_menu_008',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de Asado',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        },
        {
          name: '  torta de asado  ',
          price: 50,
          stockQuantity: 5,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'duplicate_product'
    });
  });

  it('updates an existing product matched by normalized name', async () => {
    const input = {
      messageId: 'wa_menu_009',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: ' torta de asado ',
          price: 50,
          stockQuantity: 8,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {
      currentMenu: {
        items: [
          {
            id: 'item_1',
            name: 'Torta de Asado'
          }
        ]
      }
    };

    const result = await publishMenu(input, context);

    expect(result.menu.items).toEqual([
      {
        id: 'item_1',
        name: 'torta de asado',
        price: 50,
        stockQuantity: 8,
        availabilityStatus: 'AVAILABLE'
      }
    ]);
  });

  it('keeps omitted existing products unless removal is explicit', async () => {
    const input = {
      messageId: 'wa_menu_010',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de asado',
          price: 50,
          stockQuantity: 8,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {
      currentMenu: {
        items: [
          {
            id: 'item_1',
            name: 'Torta de asado'
          },
          {
            id: 'item_2',
            name: 'Agua fresca',
            price: 25,
            stockQuantity: 12,
            availabilityStatus: 'AVAILABLE'
          }
        ]
      }
    };

    const result = await publishMenu(input, context);

    expect(result.menu.items).toContainEqual({
      id: 'item_2',
      name: 'Agua fresca',
      price: 25,
      stockQuantity: 12,
      availabilityStatus: 'AVAILABLE'
    });
  });

  it('produces an audit event when role KITCHEN publishes a menu', async () => {
    const input = {
      messageId: 'wa_menu_011',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'admin_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de asado',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {};

    const result = await publishMenu(input, context);

    expect(result.auditEvent).toEqual({
      type: 'menu_published',
      kitchenId: 'kitchen_1',
      actorRole: 'KITCHEN',
      actorId: 'admin_1',
      messageId: 'wa_menu_011'
    });
  });

  it('returns the same result when the same messageId was already processed', async () => {
    const previousResult = {
      ok: true,
      menu: {
        kitchenId: 'kitchen_1',
        status: 'PUBLISHED',
        isCurrent: true,
        items: []
      }
    };
    const input = {
      messageId: 'wa_menu_012',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      items: [
        {
          name: 'Torta de asado',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ]
    };
    const context = {
      processedEvents: [
        {
          messageId: 'wa_menu_012',
          result: previousResult
        }
      ]
    };

    const result = await publishMenu(input, context);

    expect(result).toBe(previousResult);
  });
});
