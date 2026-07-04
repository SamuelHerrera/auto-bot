import { describe, expect, it } from 'vitest';
import { registerKitchen } from './registerKitchen.js';

describe('POST /kitchens - registerKitchen', () => {
  it('allows platform support access to register a kitchen in pending setup', async () => {
    const input = {
      messageId: 'wa_register_kitchen_001',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      tenant: {
        name: 'Cocina Lupita'
      }
    };
    const context = {
      kitchens: []
    };

    const result = await registerKitchen(input, context);

    expect(result.ok).toBe(true);
    expect(result.kitchen).toEqual({
      name: 'Cocina Lupita',
      description: JSON.stringify({
        businessVoice: 'friendly',
        receptionistEnabled: true
      }),
      setupStatus: 'PENDING_SETUP'
    });
  });

  it('rejects role KITCHEN registering kitchens', async () => {
    const input = {
      messageId: 'wa_register_kitchen_002',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1'
      },
      tenant: {
        name: 'Cocina Lupita'
      }
    };
    const context = {
      kitchens: []
    };

    const result = await registerKitchen(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('rejects missing required tenant name', async () => {
    const input = {
      messageId: 'wa_register_kitchen_003',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      tenant: {
      }
    };
    const context = {
      kitchens: []
    };

    const result = await registerKitchen(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'missing_fields',
      missingFields: ['tenant.name']
    });
  });

  it('does not use tenant slug because the DB model has no slug column', async () => {
    const input = {
      messageId: 'wa_register_kitchen_004',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      tenant: {
        name: 'Cocina Lupita',
        slug: 'cocina-lupita'
      }
    };
    const context = {
      kitchens: [
        {
          name: 'Cocina Lupita'
        }
      ]
    };

    const result = await registerKitchen(input, context);

    expect(result.ok).toBe(true);
    expect(result.kitchen).not.toHaveProperty('slug');
  });

  it('stores default bot settings in kitchen description', async () => {
    const input = {
      messageId: 'wa_register_kitchen_005',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      tenant: {
        name: 'Cocina Lupita'
      }
    };
    const context = {
      kitchens: []
    };

    const result = await registerKitchen(input, context);

    expect(JSON.parse(result.kitchen.description)).toEqual({
      businessVoice: 'friendly',
      receptionistEnabled: true
    });
  });

  it('produces an audit event when a kitchen is registered', async () => {
    const input = {
      messageId: 'wa_register_kitchen_006',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      tenant: {
        name: 'Cocina Lupita'
      }
    };
    const context = {
      kitchens: []
    };

    const result = await registerKitchen(input, context);

    expect(result.auditEvent).toEqual({
      type: 'kitchen_registered',
      actorScope: 'PLATFORM_SUPPORT',
      actorId: 'support_1',
      kitchenName: 'Cocina Lupita',
      messageId: 'wa_register_kitchen_006'
    });
  });

  it('returns the same result when the same messageId was already processed', async () => {
    const previousResult = {
      ok: true,
      kitchen: {
        name: 'Cocina Lupita',
        setupStatus: 'PENDING_SETUP'
      }
    };
    const input = {
      messageId: 'wa_register_kitchen_007',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      tenant: {
        name: 'Another Kitchen'
      }
    };
    const context = {
      kitchens: [],
      processedEvents: [
        {
          messageId: 'wa_register_kitchen_007',
          result: previousResult
        }
      ]
    };

    const result = await registerKitchen(input, context);

    expect(result).toBe(previousResult);
  });
});
