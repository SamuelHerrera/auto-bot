import { describe, expect, it } from 'vitest';
import { getPrintQueue } from './getPrintQueue.js';

describe('GET /kitchens/{kitchen_id}/print-queue - getPrintQueue', () => {
  it('returns confirmed printable orders for an authorized printer device', async () => {
    const input = {
      printerIdentifier: 'printer-thermal-1',
      kitchenId: 'kitchen_1',
      printerCredential: {
        type: 'service_token'
      }
    };
    const context = {
      printers: [
        {
          identifier: 'printer-thermal-1',
          kitchenId: 'kitchen_1',
          status: 'ON',
          isActive: true
        }
      ],
      orders: [
        {
          id: 'order_1',
          kitchenId: 'kitchen_1',
          status: 'CONFIRMED',
          revision: 3,
          items: []
        },
        {
          id: 'order_2',
          kitchenId: 'kitchen_1',
          status: 'DRAFT',
          revision: 1,
          items: []
        }
      ]
    };

    const result = await getPrintQueue(input, context);

    expect(result).toEqual({
      ok: true,
      orders: [
        {
          id: 'order_1',
          printKey: 'order_1:3',
          status: 'CONFIRMED',
          items: []
        }
      ]
    });
  });

  it('rejects Hermes accessing the print queue', async () => {
    const input = {
      printerIdentifier: null,
      kitchenId: 'kitchen_1'
    };
    const context = {
      printers: [],
      orders: []
    };

    const result = await getPrintQueue(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'printer_not_authorized'
    });
  });

  it('rejects identifier-only access when no trusted printer credential is present', async () => {
    const input = {
      printerIdentifier: 'printer-thermal-1',
      kitchenId: 'kitchen_1'
    };
    const context = {
      printers: [
        {
          identifier: 'printer-thermal-1',
          kitchenId: 'kitchen_1',
          status: 'ON',
          isActive: true
        }
      ],
      orders: []
    };

    const result = await getPrintQueue(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'printer_not_authorized'
    });
  });

  it('rejects a disabled printer device', async () => {
    const input = {
      printerIdentifier: 'printer-thermal-1',
      kitchenId: 'kitchen_1'
    };
    const context = {
      printers: [
        {
          identifier: 'printer-thermal-1',
          kitchenId: 'kitchen_1',
          status: 'ON',
          isActive: false
        }
      ],
      orders: []
    };

    const result = await getPrintQueue(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'printer_not_authorized'
    });
  });
});
