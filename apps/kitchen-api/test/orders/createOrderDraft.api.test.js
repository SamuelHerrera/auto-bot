import { describe, it, expect } from 'vitest';
import { createOrderDraft } from './createOrderDraft.js';

describe('POST /orders/draft - createOrderDraft', () => {
  it('creates a valid pickup draft using current menu prices', async () => {
    const input = {
      messageId: 'wa_msg_001',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      orderId: null,
      items: [
        {
          productName: 'Torta de asado',
          quantity: 2
        }
      ],
      deliveryType: 'PICKUP',
      address: null,
      paymentMethod: 'CASH',
      comments: null
    };

    const context = {
      kitchen: {
        id: 'kitchen_1',
        status: 'OPEN',
        schedule: 'Lunes a viernes 09:00-18:00'
      },
      menuItems: [
        {
          id: 'item_1',
          productId: 'product_1',
          normalizedProductName: 'torta de asado',
          name: 'Torta de asado',
          portionLabel: 'STANDARD',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ],
      existingDraft: null
    };

    const result = await createOrderDraft(input, context);

    expect(result.ok).toBe(true);

    expect(result.order).toEqual({
      status: 'DRAFT',
      items: [
        {
          menuItemId: 'item_1',
          nameSnapshot: 'Torta de asado',
          quantity: 2,
          unitPriceSnapshot: 45,
          lineTotal: 90
        }
      ],
      subtotal: 90,
      deliveryFee: 0,
      total: 90
    });

    expect(result.readyToConfirm).toBe(true);
    expect(result.nextMissingField).toBe(null);
  });

  it('rejects products that do not exist in the current menu', async () => {
    const input = {
      messageId: 'wa_msg_002',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      orderId: null,
      items: [
        {
          productName: 'Pizza',
          quantity: 1
        }
      ],
      deliveryType: 'PICKUP',
      address: null,
      paymentMethod: 'CASH',
      comments: null
    };

    const context = {
      kitchen: {
        id: 'kitchen_1',
        status: 'OPEN'
      },
      menuItems: [
        {
          id: 'item_1',
          productId: 'product_1',
          normalizedProductName: 'torta de asado',
          name: 'Torta de asado',
          portionLabel: 'STANDARD',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ],
      existingDraft: null
    };

    const result = await createOrderDraft(input, context);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('product_not_found');
    expect(result.productChoices).toEqual([]);
    expect(result.readyToConfirm).toBe(false);
  });

  it('allows an incomplete delivery draft and reports the missing address fields', async () => {
    const input = {
      messageId: 'wa_msg_003',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      orderId: null,
      items: [
        {
          productName: 'Torta de asado',
          quantity: 1
        }
      ],
      deliveryType: 'DELIVERY',
      address: null,
      paymentMethod: 'CASH',
      comments: null
    };

    const context = {
      kitchen: {
        id: 'kitchen_1',
        status: 'OPEN'
      },
      menuItems: [
        {
          id: 'item_1',
          productId: 'product_1',
          normalizedProductName: 'torta de asado',
          name: 'Torta de asado',
          portionLabel: 'STANDARD',
          price: 45,
          stockQuantity: 10,
          availabilityStatus: 'AVAILABLE'
        }
      ],
      existingDraft: null
    };

    const result = await createOrderDraft(input, context);

    expect(result).toEqual({
      ok: true,
      order: {
        status: 'DRAFT',
        items: [
          {
            menuItemId: 'item_1',
            nameSnapshot: 'Torta de asado',
            quantity: 1,
            unitPriceSnapshot: 45,
            lineTotal: 45
          }
        ],
        subtotal: 45,
        deliveryFee: 0,
        total: 45
      },
      readyToConfirm: false,
      nextMissingField: 'address.street',
      missingFields: [
        'address.street',
        'address.exteriorNumber',
        'address.neighborhood',
        'address.reference'
      ]
    });
  });
});
it('rejects an item when there is not enough stock', async () => {
  const input = {
    messageId: 'wa_msg_004',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 5
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        productId: 'product_1',
        normalizedProductName: 'torta de asado',
        name: 'Torta de asado',
        portionLabel: 'STANDARD',
        price: 45,
        stockQuantity: 2,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('insufficient_stock');
  expect(result.soldOutItems).toEqual([
    {
      menuItemId: 'item_1',
      name: 'Torta de asado',
      requestedQuantity: 5,
      availableQuantity: 2
    }
  ]);
  expect(result.readyToConfirm).toBe(false);
});
it('rejects an item when it is not available for sale', async () => {
  const input = {
    messageId: 'wa_msg_005',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        productId: 'product_1',
        normalizedProductName: 'torta de asado',
        name: 'Torta de asado',
        portionLabel: 'STANDARD',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'SOLD_OUT'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('item_sold_out');
  expect(result.soldOutItems).toEqual([
    {
      menuItemId: 'item_1',
      name: 'Torta de asado',
      availabilityStatus: 'SOLD_OUT'
    }
  ]);
  expect(result.readyToConfirm).toBe(false);
});
it('returns schedule details when the kitchen is closed', async () => {
  const input = {
    messageId: 'wa_msg_006',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'CLOSED',
      schedule: 'Lunes a viernes 09:00-18:00'
    },
    menuItems: [],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result).toEqual({
    ok: false,
    error: 'kitchen_not_accepting_orders',
    kitchenStatus: 'CLOSED',
    schedule: 'Lunes a viernes 09:00-18:00',
    availabilityMessage: 'La cocina esta closed. Horario: Lunes a viernes 09:00-18:00.',
    readyToConfirm: false
  });
});
it('asks for a portion when the product has multiple available portions', async () => {
  const input = {
    messageId: 'wa_msg_007',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Taco',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        productId: 'product_1',
        normalizedProductName: 'taco',
        name: 'Taco',
        portionLabel: 'Chico',
        price: 45,
        stockQuantity: 5,
        availabilityStatus: 'AVAILABLE'
      },
      {
        id: 'item_2',
        productId: 'product_1',
        normalizedProductName: 'taco',
        name: 'Taco',
        portionLabel: 'Grande',
        price: 75,
        stockQuantity: 5,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result).toEqual({
    ok: false,
    error: 'missing_fields',
    missingFields: ['items.portionLabel'],
    productChoices: [
      {
        productName: 'Taco',
        portionLabels: ['Chico', 'Grande'],
        prices: [
          { label: 'Chico', price: 45 },
          { label: 'Grande', price: 75 }
        ]
      }
    ],
    readyToConfirm: false
  });
});
it('rejects an item when quantity is less than one', async () => {
  const input = {
    messageId: 'wa_msg_006',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 0
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('invalid_quantity');
  expect(result.invalidItems).toEqual([
    {
      productName: 'Torta de asado',
      quantity: 0
    }
  ]);
  expect(result.readyToConfirm).toBe(false);
});
it('rejects a draft when no items are provided', async () => {
  const input = {
    messageId: 'wa_msg_007',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('missing_fields');
  expect(result.missingFields).toEqual(['items']);
  expect(result.readyToConfirm).toBe(false);
});
it('rejects a draft when the kitchen is not open', async () => {
  const input = {
    messageId: 'wa_msg_008',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'CLOSED'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('kitchen_not_accepting_orders');
  expect(result.kitchenStatus).toBe('CLOSED');
  expect(result.readyToConfirm).toBe(false);
});
it('creates a valid delivery draft when an address is provided', async () => {
  const input = {
    messageId: 'wa_msg_009',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'DELIVERY',
    address: {
      street: 'Calle 55',
      exteriorNumber: '345',
      neighborhood: 'Centro',
      reference: 'Casa azul'
    },
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN',
      deliveryFee: 15
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(true);

    expect(result.order).toEqual({
      status: 'DRAFT',
      address: {
        street: 'Calle 55',
        exteriorNumber: '345',
        neighborhood: 'Centro',
        reference: 'Casa azul'
      },
      deliveryAddressSnapshot: {
        street: 'Calle 55',
        exteriorNumber: '345',
        neighborhood: 'Centro',
        reference: 'Casa azul'
      },
    items: [
      {
        menuItemId: 'item_1',
        nameSnapshot: 'Torta de asado',
        quantity: 1,
        unitPriceSnapshot: 45,
        lineTotal: 45
      }
    ],
    subtotal: 45,
    deliveryFee: 15,
    total: 60
  });

  expect(result.readyToConfirm).toBe(true);
  expect(result.nextMissingField).toBe(null);
});
it('preserves a partial delivery address and keeps asking for the remaining fields', async () => {
  const input = {
    messageId: 'wa_msg_009b',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: 'order_1',
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'DELIVERY',
    address: {
      street: 'Calle 55'
    },
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN',
      deliveryFee: 15
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: {
      id: 'order_1',
      status: 'DRAFT',
      clientPhone: '+529991112233',
      deliveryAddressSnapshot: {
        exteriorNumber: '345'
      }
    }
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(true);
  expect(result.order).toEqual({
    id: 'order_1',
    status: 'DRAFT',
    address: {
      street: 'Calle 55',
      exteriorNumber: '345'
    },
    deliveryAddressSnapshot: {
      street: 'Calle 55',
      exteriorNumber: '345'
    },
    items: [
      {
        menuItemId: 'item_1',
        nameSnapshot: 'Torta de asado',
        quantity: 1,
        unitPriceSnapshot: 45,
        lineTotal: 45
      }
    ],
    subtotal: 45,
    deliveryFee: 15,
    total: 60
  });
  expect(result.readyToConfirm).toBe(false);
  expect(result.nextMissingField).toBe('address.neighborhood');
  expect(result.missingFields).toEqual([
    'address.neighborhood',
    'address.reference'
  ]);
});
it('rejects updating a draft when the order is outside the actor scope', async () => {
  const input = {
    messageId: 'wa_msg_010',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: 'order_from_another_client',
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: {
      id: 'order_from_another_client',
      status: 'DRAFT',
      kitchenId: 'kitchen_1',
      clientPhone: '+529994445566'
    }
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('action_not_allowed');
  expect(result.readyToConfirm).toBe(false);
});
it('updates an existing draft when the order belongs to the actor scope', async () => {
  const input = {
    messageId: 'wa_msg_011',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: 'order_1',
    items: [
      {
        productName: 'Torta de asado',
        quantity: 3
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: {
      id: 'order_1',
      status: 'DRAFT',
      kitchenId: 'kitchen_1',
      clientPhone: '+529991112233',
      items: [
        {
          menuItemId: 'item_1',
          nameSnapshot: 'Torta de asado',
          quantity: 1,
          unitPriceSnapshot: 45,
          lineTotal: 45
        }
      ],
      subtotal: 45,
      deliveryFee: 0,
      total: 45
    }
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(true);

  expect(result.order).toEqual({
    id: 'order_1',
    status: 'DRAFT',
    items: [
      {
        menuItemId: 'item_1',
        nameSnapshot: 'Torta de asado',
        quantity: 3,
        unitPriceSnapshot: 45,
        lineTotal: 135
      }
    ],
    subtotal: 135,
    deliveryFee: 0,
    total: 135
  });

  expect(result.readyToConfirm).toBe(true);
  expect(result.nextMissingField).toBe(null);
});
it('uses backend menu prices instead of client supplied prices', async () => {
  const input = {
    messageId: 'wa_msg_012',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 2,
        unitPrice: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(true);

  expect(result.order.items).toEqual([
    {
      menuItemId: 'item_1',
      nameSnapshot: 'Torta de asado',
      quantity: 2,
      unitPriceSnapshot: 45,
      lineTotal: 90
    }
  ]);

  expect(result.order.subtotal).toBe(90);
  expect(result.order.deliveryFee).toBe(0);
  expect(result.order.total).toBe(90);
  expect(result.readyToConfirm).toBe(true);
});

it('preserves comments in the draft', async () => {
  const input = {
    messageId: 'wa_msg_013',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: 'Sin cebolla'
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(true);
  expect(result.order.comments).toBe('Sin cebolla');
  expect(result.order.subtotal).toBe(45);
  expect(result.order.deliveryFee).toBe(0);
  expect(result.order.total).toBe(45);
  expect(result.readyToConfirm).toBe(true);
});
it('returns the same result when the same messageId was already processed', async () => {
  const input = {
    messageId: 'wa_msg_014',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const previousResult = {
    ok: true,
    order: {
      id: 'order_1',
      status: 'DRAFT',
      items: [
        {
          menuItemId: 'item_1',
          nameSnapshot: 'Torta de asado',
          quantity: 1,
          unitPriceSnapshot: 45,
          lineTotal: 45
        }
      ],
      subtotal: 45,
      deliveryFee: 0,
      total: 45
    },
    readyToConfirm: true,
    nextMissingField: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 60,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null,
    processedEvents: [
      {
        messageId: 'wa_msg_014',
        result: previousResult
      }
    ]
  };

  const result = await createOrderDraft(input, context);

  expect(result).toEqual(previousResult);
});

it('returns missing_fields when delivery type is not provided', async () => {
  const input = {
    messageId: 'wa_msg_015',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: null,
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result).toEqual({
    ok: false,
    error: 'missing_fields',
    missingFields: ['deliveryType'],
    readyToConfirm: false
  });
});

it('rejects unsupported payment methods', async () => {
  const input = {
    messageId: 'wa_msg_016',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CRYPTO',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result).toEqual({
    ok: false,
    error: 'unsupported_payment_method',
    allowedPaymentMethods: ['CASH', 'TRANSFER'],
    readyToConfirm: false
  });
});

it('allows a draft without a payment method but does not mark it ready', async () => {
  const input = {
    messageId: 'wa_msg_017',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: 'Torta de asado',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: null,
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(true);
  expect(result.order.status).toBe('DRAFT');
  expect(result.readyToConfirm).toBe(false);
  expect(result.nextMissingField).toBe('paymentMethod');
});

it('does not overwrite a confirmed order as a draft', async () => {
  const input = {
    messageId: 'wa_msg_018',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: 'order_1',
    items: [
      {
        productName: 'Torta de asado',
        quantity: 2
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: {
      id: 'order_1',
      status: 'CONFIRMED',
      kitchenId: 'kitchen_1',
      clientPhone: '+529991112233'
    }
  };

  const result = await createOrderDraft(input, context);

  expect(result).toEqual({
    ok: false,
    error: 'action_not_allowed',
    readyToConfirm: false
  });
});

it('matches product names after trimming whitespace', async () => {
  const input = {
    messageId: 'wa_msg_019',
    actor: {
      role: 'CLIENT',
      phone: '+529991112233'
    },
    kitchenId: 'kitchen_1',
    orderId: null,
    items: [
      {
        productName: '  torta de asado  ',
        quantity: 1
      }
    ],
    deliveryType: 'PICKUP',
    address: null,
    paymentMethod: 'CASH',
    comments: null
  };

  const context = {
    kitchen: {
      id: 'kitchen_1',
      status: 'OPEN'
    },
    menuItems: [
      {
        id: 'item_1',
        name: 'Torta de asado',
        price: 45,
        stockQuantity: 10,
        availabilityStatus: 'AVAILABLE'
      }
    ],
    existingDraft: null
  };

  const result = await createOrderDraft(input, context);

  expect(result.ok).toBe(true);
  expect(result.order.items[0].menuItemId).toBe('item_1');
});
