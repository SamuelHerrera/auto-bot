import { describe, expect, it, vi } from 'vitest';
import { queryOrders } from './queryOrders.js';
import { executeQueryOrders } from '../../src/application/usecases/orders.ts';

describe('GET /orders?params=filter - queryOrders', () => {
  it('returns active kitchen-scoped orders for role KITCHEN', async () => {
    const input = {
      actor: buildKitchenActor(),
      filter: 'active'
    };
    const context = {
      orders: [
        {
          id: 'order_1',
          kitchenId: 'kitchen_1',
          status: 'CONFIRMED',
          total: 90
        },
        {
          id: 'order_2',
          kitchenId: 'kitchen_2',
          status: 'CONFIRMED',
          total: 120
        },
        {
          id: 'order_3',
          kitchenId: 'kitchen_1',
          status: 'DELIVERED',
          total: 45
        }
      ]
    };

    const result = await queryOrders(input, context);

    expect(result).toEqual({
      ok: true,
      orders: [
        {
          id: 'order_1',
          status: 'CONFIRMED',
          total: 90
        }
      ]
    });
  });

  it('rejects unsupported filters', async () => {
    const input = {
      actor: buildKitchenActor(),
      filter: 'everything'
    };
    const context = {
      orders: []
    };

    const result = await queryOrders(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'unsupported_filter'
    });
  });

  it('rejects clients requesting order reports', async () => {
    const input = {
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      filter: 'active'
    };
    const context = {
      orders: []
    };

    const result = await queryOrders(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('limits results and returns a cursor when more orders are available', async () => {
    const input = {
      actor: buildKitchenActor(),
      filter: 'active',
      limit: 1
    };
    const context = {
      orders: [
        {
          id: 'order_1',
          kitchenId: 'kitchen_1',
          status: 'CONFIRMED',
          total: 90
        },
        {
          id: 'order_2',
          kitchenId: 'kitchen_1',
          status: 'IN_PROCESS_OF_DELIVERY',
          total: 120
        }
      ]
    };

    const result = await queryOrders(input, context);

    expect(result).toEqual({
      ok: true,
      orders: [
        {
          id: 'order_1',
          status: 'CONFIRMED',
          total: 90
        }
      ],
      nextCursor: 'order_2'
    });
  });

  it('returns only assigned active delivery orders for a driver', async () => {
    const input = {
      actor: {
        role: 'DELIVERER',
        id: 'driver_1',
        kitchenId: 'kitchen_1'
      },
      filter: 'active'
    };
    const context = {
      orders: [
        {
          id: 'order_1',
          kitchenId: 'kitchen_1',
          assignedDriverId: 'driver_1',
          deliveryType: 'DELIVERY',
          status: 'IN_PROCESS_OF_DELIVERY',
          total: 90
        },
        {
          id: 'order_2',
          kitchenId: 'kitchen_1',
          assignedDriverId: null,
          deliveryType: 'DELIVERY',
          status: 'CONFIRMED',
          total: 120
        },
        {
          id: 'order_3',
          kitchenId: 'kitchen_1',
          assignedDriverId: 'driver_2',
          deliveryType: 'DELIVERY',
          status: 'IN_PROCESS_OF_DELIVERY',
          total: 130
        },
        {
          id: 'order_4',
          kitchenId: 'kitchen_1',
          assignedDriverId: 'driver_1',
          deliveryType: 'PICKUP',
          status: 'CONFIRMED',
          total: 45
        }
      ]
    };

    const result = await queryOrders(input, context);

    expect(result).toEqual({
      ok: true,
      orders: [
        {
          id: 'order_1',
          status: 'IN_PROCESS_OF_DELIVERY',
          total: 90
        },
        {
          id: 'order_2',
          status: 'CONFIRMED',
          total: 120
        }
      ]
    });
  });

  it('passes deliverer user scope to the repository query', async () => {
    const query = vi.fn().mockResolvedValue([]);

    const result = await executeQueryOrders(
      {
        actor: {
          role: 'DELIVERER',
          id: 'driver_1',
          kitchenId: 'kitchen_1'
        },
        filter: 'active'
      },
      {
        orders: {
          query
        }
      }
    );

    expect(result).toEqual({
      ok: true,
      orders: []
    });
    expect(query).toHaveBeenCalledWith({
      filter: 'active',
      kitchenId: 'kitchen_1',
      delivererUserId: 'driver_1'
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
