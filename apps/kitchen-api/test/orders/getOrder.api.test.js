import { describe, expect, it } from 'vitest';
import { getOrder } from './getOrder.js';

describe('GET /orders/{order_id} - getOrder', () => {
  it('allows a client to read their own order', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      orderId: 'order_1'
    };
    const context = {
      order: {
        id: 'order_1',
        clientPhone: '+529991112233',
        kitchenId: 'kitchen_1',
        status: 'CONFIRMED',
        total: 90,
        items: [
          {
            nameSnapshot: 'Torta de asado',
            quantity: 2,
            unitPriceSnapshot: 45,
            lineTotal: 90
          }
        ]
      }
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: true,
      order: {
        id: 'order_1',
        status: 'CONFIRMED',
        total: 90,
        items: [
          {
            name: 'Torta de asado',
            quantity: 2,
            unitPrice: 45,
            lineTotal: 90
          }
        ]
      }
    });
  });

  it('returns order_not_found when a client reads another client order', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529998887777'
      },
      orderId: 'order_1'
    };
    const context = {
      order: {
        id: 'order_1',
        clientPhone: '+529991112233',
        kitchenId: 'kitchen_1',
        status: 'CONFIRMED',
        total: 90,
        items: []
      }
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'order_not_found'
    });
  });

  it('allows role KITCHEN to read an order from their kitchen', async () => {
    const input = {
      actor: buildKitchenActor('kitchen_1', 'contact_1'),
      orderId: 'order_1'
    };
    const context = {
      order: {
        id: 'order_1',
        clientPhone: '+529991112233',
        kitchenId: 'kitchen_1',
        status: 'CONFIRMED',
        total: 90,
        items: []
      }
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: true,
      order: {
        id: 'order_1',
        status: 'CONFIRMED',
        total: 90,
        clientPhone: '+529991112233',
        items: []
      }
    });
  });

  it('returns order_not_found when role KITCHEN reads another kitchen order', async () => {
    const input = {
      actor: buildKitchenActor('kitchen_2', 'contact_2'),
      orderId: 'order_1'
    };
    const context = {
      order: {
        id: 'order_1',
        clientPhone: '+529991112233',
        kitchenId: 'kitchen_1',
        status: 'CONFIRMED',
        total: 90,
        items: []
      }
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'order_not_found'
    });
  });

  it('returns order_not_found when a driver reads another driver order', async () => {
    const input = {
      actor: {
        role: 'DELIVERER',
        id: 'driver_2',
        kitchenId: 'kitchen_1'
      },
      orderId: 'order_1'
    };
    const context = {
      order: {
        id: 'order_1',
        clientPhone: '+529991112233',
        kitchenId: 'kitchen_1',
        assignedDriverId: 'driver_1',
        status: 'IN_PROCESS_OF_DELIVERY',
        total: 90,
        items: []
      }
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'order_not_found'
    });
  });

  it('allows a driver to read their assigned delivery order without client phone', async () => {
    const input = {
      actor: {
        role: 'DELIVERER',
        id: 'driver_1',
        kitchenId: 'kitchen_1'
      },
      orderId: 'order_1'
    };
    const context = {
      order: {
        id: 'order_1',
        clientPhone: '+529991112233',
        kitchenId: 'kitchen_1',
        assignedDriverId: 'driver_1',
        deliveryType: 'DELIVERY',
        deliveryAddress: {
          street: 'Calle 10',
          exteriorNumber: '25',
          neighborhood: 'Centro'
        },
        status: 'IN_PROCESS_OF_DELIVERY',
        total: 90,
        items: []
      }
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: true,
      order: {
        id: 'order_1',
        status: 'IN_PROCESS_OF_DELIVERY',
        total: 90,
        deliveryAddress: {
          street: 'Calle 10',
          exteriorNumber: '25',
          neighborhood: 'Centro'
        },
        items: []
      }
    });
  });

  it('allows a driver to inspect an unassigned delivery order in their kitchen', async () => {
    const input = {
      actor: {
        role: 'DELIVERER',
        id: 'driver_1',
        kitchenId: 'kitchen_1'
      },
      orderId: 'order_1'
    };
    const context = {
      order: {
        id: 'order_1',
        clientPhone: '+529991112233',
        kitchenId: 'kitchen_1',
        assignedDriverId: null,
        deliveryType: 'DELIVERY',
        deliveryAddress: {
          street: 'Calle 10',
          exteriorNumber: '25',
          neighborhood: 'Centro'
        },
        status: 'CONFIRMED',
        total: 90,
        items: []
      }
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: true,
      order: {
        id: 'order_1',
        status: 'CONFIRMED',
        total: 90,
        deliveryAddress: {
          street: 'Calle 10',
          exteriorNumber: '25',
          neighborhood: 'Centro'
        },
        items: []
      }
    });
  });

  it('returns order_not_found when the order does not exist', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      orderId: 'missing_order'
    };
    const context = {
      order: null
    };

    const result = await getOrder(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'order_not_found'
    });
  });
});

function buildKitchenActor(kitchenId = 'kitchen_1', contactId = 'contact_1') {
  return {
    role: 'KITCHEN',
    kitchenId,
    contactId
  };
}
