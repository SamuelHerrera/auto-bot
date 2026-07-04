import { describe, expect, it, vi } from 'vitest';
import { changeOrderStatus } from './changeOrderStatus.js';

describe('POST /orders/{order_id}/status - changeOrderStatus', () => {
  it('allows a client to confirm a complete draft', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_001',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CONFIRMED'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: 'CASH'
        }),
        kitchen: {
          id: 'kitchen_1',
          orderingStatus: 'OPEN'
        }
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('CONFIRMED');
  });

  it('rejects confirmation when the draft is incomplete', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_002',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CONFIRMED'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: null
        }),
        kitchen: {
          id: 'kitchen_1',
          orderingStatus: 'OPEN'
        }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'missing_fields',
      missingFields: ['paymentMethod'],
      nextMissingField: 'paymentMethod'
    });
  });

  it('rejects delivery confirmation when required address fields are missing', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_002b',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CONFIRMED'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: 'CASH',
          deliveryType: 'DELIVERY',
          deliveryAddressSnapshot: {
            street: 'Calle 55',
            exteriorNumber: '345'
          }
        }),
        kitchen: {
          id: 'kitchen_1',
          orderingStatus: 'OPEN'
        }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'missing_fields',
      missingFields: ['address.neighborhood', 'address.reference'],
      nextMissingField: 'address.neighborhood'
    });
  });

  it('rejects confirmation when current stock is insufficient', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_003',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CONFIRMED'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: 'CASH',
          items: [{ menuItemId: 'item_1', quantity: 2 }]
        }),
        kitchen: {
          id: 'kitchen_1',
          orderingStatus: 'OPEN'
        },
        menuItems: [
          {
            id: 'item_1',
            productId: 'product_1',
            name: 'Torta de asado',
            stockQuantity: 1
          }
        ]
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'insufficient_stock',
      soldOutItems: [
        {
          menuItemId: 'item_1',
          name: 'Torta de asado',
          requestedQuantity: 2,
          availableQuantity: 1
        }
      ]
    });
  });

  it('reserves stock atomically when confirming a draft', async () => {
    const confirmedOrder = buildOrder({
      status: 'CONFIRMED',
      clientPhone: '+529991112233',
      paymentMethod: 'CASH'
    });
    const confirmOrderAtomically = vi.fn().mockResolvedValue(confirmedOrder);

    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_004',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CONFIRMED'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: 'CASH'
        }),
        kitchen: {
          id: 'kitchen_1',
          orderingStatus: 'OPEN'
        },
        confirmOrderAtomically
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order).toBe(confirmedOrder);
    expect(confirmOrderAtomically).toHaveBeenCalledWith({
      orderId: 'order_1',
      items: [
        {
          menuItemId: 'item_1',
          quantity: 1
        }
      ]
    });
  });

  it('allows a client to cancel a draft with a natural reason', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_005',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CANCELLED',
        cancellationDescription: 'El cliente ya no quiere el pedido'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: 'CASH'
        })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('CANCELLED');
    expect(result.order.cancellationDescription).toBe(
      'El cliente ya no quiere el pedido'
    );
  });

  it('allows role KITCHEN to move a delivery order into delivery process', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_006',
        actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
        orderId: 'order_1',
        targetOrderStatus: 'IN_PROCESS_OF_DELIVERY'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1',
          deliveryType: 'DELIVERY'
        })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('IN_PROCESS_OF_DELIVERY');
  });

  it('allows role KITCHEN to assign a deliverer while moving an order into delivery process', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_006b',
        actor: {
          role: 'KITCHEN',
          kitchenId: 'kitchen_1',
          contactId: 'contact_1'
        },
        orderId: 'order_1',
        targetOrderStatus: 'IN_PROCESS_OF_DELIVERY',
        deliveryDriverUserId: 'driver_2'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1',
          deliveryType: 'DELIVERY'
        })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('IN_PROCESS_OF_DELIVERY');
  });

  it('allows role KITCHEN to mark a confirmed pickup order delivered', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_007',
        actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
        orderId: 'order_1',
        targetOrderStatus: 'DELIVERED'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1',
          deliveryType: 'PICKUP'
        })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('DELIVERED');
  });

  it('allows an assigned deliverer to mark an in-process delivery as delivered', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_008',
        actor: {
          role: 'DELIVERER',
          id: 'driver_1',
          kitchenId: 'kitchen_1'
        },
        orderId: 'order_1',
        targetOrderStatus: 'DELIVERED'
      },
      {
        order: buildOrder({
          status: 'IN_PROCESS_OF_DELIVERY',
          deliveryType: 'DELIVERY',
          deliveryDriverUserId: 'driver_1'
        })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('DELIVERED');
  });

  it('allows a deliverer to self-claim an unassigned confirmed delivery order', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_008b',
        actor: {
          role: 'DELIVERER',
          id: 'driver_1',
          kitchenId: 'kitchen_1'
        },
        orderId: 'order_1',
        targetOrderStatus: 'IN_PROCESS_OF_DELIVERY'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1',
          deliveryType: 'DELIVERY',
          deliveryDriverUserId: null,
          assignedDriverId: null
        })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('IN_PROCESS_OF_DELIVERY');
  });

  it('rejects a deliverer trying to steal an order assigned to another driver', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_008c',
        actor: {
          role: 'DELIVERER',
          id: 'driver_1',
          kitchenId: 'kitchen_1'
        },
        orderId: 'order_1',
        targetOrderStatus: 'IN_PROCESS_OF_DELIVERY'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1',
          deliveryType: 'DELIVERY',
          deliveryDriverUserId: 'driver_2',
          assignedDriverId: 'driver_2'
        })
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('allows role KITCHEN to cancel a confirmed order with a reason', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_009',
        actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
        orderId: 'order_1',
        targetOrderStatus: 'CANCELLED',
        cancellationDescription: 'El cliente no llegó por el pedido'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1'
        })
      }
    );

    expect(result.ok).toBe(true);
    expect(result.order.status).toBe('CANCELLED');
    expect(result.order.cancellationDescription).toBe(
      'El cliente no llegó por el pedido'
    );
  });

  it('rejects transitions after DELIVERED because it is terminal', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_010',
        actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
        orderId: 'order_1',
        targetOrderStatus: 'CANCELLED'
      },
      {
        order: buildOrder({
          status: 'DELIVERED',
          kitchenId: 'kitchen_1'
        })
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'invalid_status_transition',
      currentStatus: 'DELIVERED',
      requestedStatus: 'CANCELLED'
    });
  });

  it('rejects transitions after CANCELLED because it is terminal', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_011',
        actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
        orderId: 'order_1',
        targetOrderStatus: 'DELIVERED'
      },
      {
        order: buildOrder({
          status: 'CANCELLED',
          kitchenId: 'kitchen_1'
        })
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'invalid_status_transition',
      currentStatus: 'CANCELLED',
      requestedStatus: 'DELIVERED'
    });
  });

  it('rejects status changes outside the actor kitchen scope', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_012',
        actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_2',
        contactId: 'contact_2'
      },
        orderId: 'order_1',
        targetOrderStatus: 'DELIVERED'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1'
        })
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'order_not_found'
    });
  });

  it('adds status history when role KITCHEN changes order status', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_013',
        actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
        orderId: 'order_1',
        targetOrderStatus: 'DELIVERED'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1',
          statusHistory: []
        })
      }
    );

    expect(result.order.statusHistory).toEqual([
      {
        fromStatus: 'CONFIRMED',
        toStatus: 'DELIVERED',
        actorRole: 'KITCHEN',
        messageId: 'wa_status_013'
      }
    ]);
  });

  it('produces an audit event when role KITCHEN changes order status', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_014',
        actor: {
          role: 'KITCHEN',
          kitchenId: 'kitchen_1',
          contactId: 'contact_1'
        },
        orderId: 'order_1',
        targetOrderStatus: 'DELIVERED'
      },
      {
        order: buildOrder({
          status: 'CONFIRMED',
          kitchenId: 'kitchen_1'
        })
      }
    );

    expect(result.auditEvent).toEqual({
      type: 'order_status_changed',
      orderId: 'order_1',
      fromStatus: 'CONFIRMED',
      toStatus: 'DELIVERED',
      actorRole: 'KITCHEN',
      actorId: 'contact_1',
      messageId: 'wa_status_014'
    });
  });

  it('returns the same result when the same message was already processed', async () => {
    const previousResult = {
      ok: true,
      order: buildOrder({ status: 'CONFIRMED' })
    };

    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_015',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CONFIRMED'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: 'CASH'
        }),
        kitchen: {
          id: 'kitchen_1',
          orderingStatus: 'OPEN'
        },
        processedEvents: [
          {
            messageId: 'wa_status_015',
            result: previousResult
          }
        ]
      }
    );

    expect(result).toBe(previousResult);
  });

  it('rejects draft confirmation when the kitchen is closed and returns the schedule', async () => {
    const result = await changeOrderStatus(
      {
        messageId: 'wa_status_016',
        actor: {
          role: 'CLIENT',
          phone: '+529991112233'
        },
        orderId: 'order_1',
        targetOrderStatus: 'CONFIRMED'
      },
      {
        order: buildOrder({
          status: 'DRAFT',
          clientPhone: '+529991112233',
          paymentMethod: 'CASH'
        }),
        kitchen: {
          id: 'kitchen_1',
          orderingStatus: 'CLOSED',
          schedule: 'Lunes a viernes 09:00-18:00'
        }
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'kitchen_not_accepting_orders',
      kitchenStatus: 'CLOSED',
      schedule: 'Lunes a viernes 09:00-18:00',
      availabilityMessage: 'La cocina esta closed. Horario: Lunes a viernes 09:00-18:00.',
      readyToConfirm: false
    });
  });
});

function buildOrder(overrides = {}) {
  return {
    id: 'order_1',
    status: 'DRAFT',
    kitchenId: 'kitchen_1',
    clientPhone: '+529991112233',
    deliveryType: 'PICKUP',
    paymentMethod: 'CASH',
    items: [
      {
        menuItemId: 'item_1',
        quantity: 1,
        unitPriceSnapshot: 45,
        lineTotal: 45
      }
    ],
    total: 45,
    ...overrides
  };
}
