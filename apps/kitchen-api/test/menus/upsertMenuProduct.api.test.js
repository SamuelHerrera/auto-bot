import { describe, expect, it } from 'vitest';
import { upsertMenuProduct } from './upsertMenuProduct.js';

describe('POST /kitchens/{kitchen_id}/menu-products - upsertMenuProduct', () => {
  it('allows a trusted kitchen actor to upsert one product with multiple portions', async () => {
    const input = {
      messageId: 'wa_menu_product_001',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      product: {
        name: 'Taco',
        stockQuantity: 20,
        portions: [
          {
            label: 'Chico',
            price: 45
          },
          {
            label: 'Grande',
            price: 75,
            availabilityStatus: 'AVAILABLE'
          }
        ]
      }
    };

    const result = await upsertMenuProduct(input);

    expect(result).toMatchObject({
      ok: true,
      product: {
        name: 'Taco',
        stockQuantity: 20,
        portions: [
          {
            label: 'Chico',
            price: 45,
            availabilityStatus: 'AVAILABLE'
          },
          {
            label: 'Grande',
            price: 75,
            availabilityStatus: 'AVAILABLE'
          }
        ]
      },
      auditEvent: {
        type: 'menu_product_upserted',
        actorId: 'contact_1'
      }
    });
  });

  it('rejects invalid portion definitions', async () => {
    const input = {
      messageId: 'wa_menu_product_002',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      product: {
        name: 'Taco',
        stockQuantity: 20,
        portions: [
          {
            label: '',
            price: 45
          }
        ]
      }
    };

    const result = await upsertMenuProduct(input);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_menu_item',
      field: 'product.portions.label'
    });
  });
});
