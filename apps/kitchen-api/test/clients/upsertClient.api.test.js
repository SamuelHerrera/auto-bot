import { describe, expect, it } from 'vitest';
import { upsertClient } from './upsertClient.js';

describe('POST /clients - upsertClient', () => {
  it('creates minimum client identity from authenticated phone context', async () => {
    const input = {
      messageId: 'wa_client_001',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      profile: {}
    };
    const context = {
      existingClient: null
    };

    const result = await upsertClient(input, context);

    expect(result).toEqual({
      ok: true,
      client: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        addresses: []
      }
    });
  });

  it('updates the client name', async () => {
    const input = {
      messageId: 'wa_client_002',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      profile: {
        name: 'Ana'
      }
    };
    const context = {
      existingClient: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        addresses: []
      }
    };

    const result = await upsertClient(input, context);

    expect(result.client.name).toBe('Ana');
  });

  it('reuses a matching existing address', async () => {
    const input = {
      messageId: 'wa_client_004',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      profile: {
        address: {
          street: ' calle 10 ',
          exteriorNumber: '25',
          neighborhood: 'centro'
        }
      }
    };
    const existingAddress = {
      id: 'address_1',
      street: 'Calle 10',
      exteriorNumber: '25',
      neighborhood: 'Centro'
    };
    const context = {
      existingClient: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        addresses: [existingAddress]
      }
    };

    const result = await upsertClient(input, context);

    expect(result.client.addresses).toEqual([existingAddress]);
  });

  it('creates a distinct address when the address is new', async () => {
    const input = {
      messageId: 'wa_client_005',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      profile: {
        address: {
          street: 'Calle 12',
          exteriorNumber: '30',
          neighborhood: 'Centro'
        }
      }
    };
    const existingAddress = {
      id: 'address_1',
      street: 'Calle 10',
      exteriorNumber: '25',
      neighborhood: 'Centro'
    };
    const context = {
      existingClient: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        addresses: [existingAddress]
      }
    };

    const result = await upsertClient(input, context);

    expect(result.client.addresses).toEqual([
      existingAddress,
      {
        street: 'Calle 12',
        exteriorNumber: '30',
        neighborhood: 'Centro'
      }
    ]);
  });

  it('requires confirmation for protected phone changes', async () => {
    const input = {
      messageId: 'wa_client_006',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      profile: {
        phone: '+529998887777'
      }
    };
    const context = {
      existingClient: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        addresses: []
      }
    };

    const result = await upsertClient(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'confirmation_required',
      field: 'phone'
    });
  });

  it('produces an audit event when client data is upserted', async () => {
    const input = {
      messageId: 'wa_client_007',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      profile: {
        name: 'Ana'
      }
    };
    const context = {
      existingClient: null
    };

    const result = await upsertClient(input, context);

    expect(result.auditEvent).toEqual({
      type: 'client_upserted',
      kitchenId: 'kitchen_1',
      actorRole: 'CLIENT',
      actorPhone: '+529991112233',
      messageId: 'wa_client_007'
    });
  });

  it('returns the same result when the same messageId was already processed', async () => {
    const previousResult = {
      ok: true,
      client: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        addresses: []
      }
    };
    const input = {
      messageId: 'wa_client_008',
      actor: {
        role: 'CLIENT',
        phone: '+529991112233'
      },
      kitchenId: 'kitchen_1',
      profile: {
        name: 'Ana'
      }
    };
    const context = {
      existingClient: null,
      processedEvents: [
        {
          messageId: 'wa_client_008',
          result: previousResult
        }
      ]
    };

    const result = await upsertClient(input, context);

    expect(result).toBe(previousResult);
  });

});
