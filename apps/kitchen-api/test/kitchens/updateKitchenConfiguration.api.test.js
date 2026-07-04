import { describe, expect, it } from 'vitest';
import { updateKitchenConfiguration } from './updateKitchenConfiguration.js';

describe('POST /kitchens/{kitchen_id} - updateKitchenConfiguration', () => {
  it('allows role KITCHEN to update documented configuration fields', async () => {
    const input = {
      messageId: 'wa_kitchen_001',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        orderingStatus: 'PAUSED',
        businessVoice: 'friendly and concise'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN',
        businessVoice: 'warm'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toMatchObject({
      ok: true,
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'PAUSED',
        businessVoice: 'friendly and concise'
      },
      auditEvent: {
        type: 'kitchen_configuration_updated',
        actorId: 'contact_1'
      }
    });
  });

  it('allows role KITCHEN to update the kitchen schedule', async () => {
    const input = {
      messageId: 'wa_kitchen_schedule_001',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        schedule: 'Lunes a viernes 09:00-18:00'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN',
        schedule: null
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toMatchObject({
      ok: true,
      kitchen: {
        id: 'kitchen_1',
        schedule: 'Lunes a viernes 09:00-18:00'
      }
    });
  });

  it('rejects clients updating kitchen configuration', async () => {
    const input = {
      messageId: 'wa_kitchen_002',
      actor: {
        role: 'CLIENT'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        orderingStatus: 'PAUSED'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('rejects role KITCHEN updating another kitchen configuration', async () => {
    const input = {
      messageId: 'wa_kitchen_003',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_2',
        contactId: 'contact_2'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        orderingStatus: 'PAUSED'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('rejects unsupported configuration fields', async () => {
    const input = {
      messageId: 'wa_kitchen_004',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        unknownSetting: true
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'unsupported_field',
      field: 'unknownSetting'
    });
  });

  it('rejects tenant ownership changes as protected fields', async () => {
    const input = {
      messageId: 'wa_kitchen_005',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        tenantId: 'tenant_2'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        tenantId: 'tenant_1',
        orderingStatus: 'OPEN'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'protected_field',
      field: 'tenantId'
    });
  });

  it('rejects session secret changes as protected fields', async () => {
    const input = {
      messageId: 'wa_kitchen_006',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        whatsappSessionSecret: 'secret_from_hermes'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'protected_field',
      field: 'whatsappSessionSecret'
    });
  });

  it('rejects unsupported ordering status values', async () => {
    const input = {
      messageId: 'wa_kitchen_007',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        orderingStatus: 'VACATION'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_configuration',
      field: 'orderingStatus'
    });
  });

  it('rejects unsupported payment options', async () => {
    const input = {
      messageId: 'wa_kitchen_008',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        paymentOptions: ['CASH', 'CRYPTO']
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        paymentOptions: ['CASH']
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_configuration',
      field: 'paymentOptions'
    });
  });

  it('rejects invalid delivery settings', async () => {
    const input = {
      messageId: 'wa_kitchen_009',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        deliverySettings: {
          enabled: 'yes'
        }
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        deliverySettings: {
          enabled: false
        }
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_configuration',
      field: 'deliverySettings'
    });
  });

  it('produces an audit event when configuration is updated', async () => {
    const input = {
      messageId: 'wa_kitchen_010',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'admin_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        orderingStatus: 'PAUSED'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'OPEN'
      }
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result.auditEvent).toEqual({
      type: 'kitchen_configuration_updated',
      kitchenId: 'kitchen_1',
      actorRole: 'KITCHEN',
      actorId: 'admin_1',
      messageId: 'wa_kitchen_010'
    });
  });

  it('returns the same result when the same messageId was already processed', async () => {
    const previousResult = {
      ok: true,
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'PAUSED'
      }
    };
    const input = {
      messageId: 'wa_kitchen_011',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      configuration: {
        orderingStatus: 'OPEN'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1',
        orderingStatus: 'CLOSED'
      },
      processedEvents: [
        {
          messageId: 'wa_kitchen_011',
          result: previousResult
        }
      ]
    };

    const result = await updateKitchenConfiguration(input, context);

    expect(result).toBe(previousResult);
  });
});
