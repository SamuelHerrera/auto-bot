import { describe, expect, it } from 'vitest';
import { upsertAuthorizedContact } from './upsertAuthorizedContact.js';

describe('POST /kitchens/{kitchen_id}/authorized-contacts - upsertAuthorizedContact', () => {
  it('allows role KITCHEN to add an authorized contact', async () => {
    const input = {
      messageId: 'wa_contact_001',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'DELIVERER',
        name: 'Luis'
      }
    };
    const context = {
      contacts: []
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result).toMatchObject({
      ok: true,
      contact: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        role: 'DELIVERER',
        name: 'Luis',
        active: true
      },
      auditEvent: {
        type: 'authorized_contact_upserted',
        actorId: 'contact_1'
      }
    });
  });

  it('rejects clients adding authorized contacts', async () => {
    const input = {
      messageId: 'wa_contact_002',
      actor: {
        role: 'CLIENT'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'DELIVERER',
        name: 'Luis'
      }
    };
    const context = {
      contacts: []
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('rejects role KITCHEN managing contacts outside their kitchen scope', async () => {
    const input = {
      messageId: 'wa_contact_003',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_2',
        contactId: 'contact_2'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'DELIVERER',
        name: 'Luis'
      }
    };
    const context = {
      contacts: []
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('rejects creating platform support contacts from kitchen context', async () => {
    const input = {
      messageId: 'wa_contact_004',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'PLATFORM_SUPPORT',
        name: 'Luis'
      }
    };
    const context = {
      contacts: []
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_role'
    });
  });

  it('rejects unsupported contact roles', async () => {
    const input = {
      messageId: 'wa_contact_005',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'ACCOUNTANT',
        name: 'Luis'
      }
    };
    const context = {
      contacts: []
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'invalid_role'
    });
  });

  it('updates an existing authorized contact matched by phone', async () => {
    const input = {
      messageId: 'wa_contact_006',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'KITCHEN',
        name: 'Luis Admin'
      }
    };
    const context = {
      contacts: [
        {
          id: 'contact_1',
          kitchenId: 'kitchen_1',
          phone: '+529991112233',
          role: 'DELIVERER',
          name: 'Luis',
          active: true
        }
      ]
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result.contact).toEqual({
      id: 'contact_1',
      kitchenId: 'kitchen_1',
      phone: '+529991112233',
      role: 'KITCHEN',
      name: 'Luis Admin',
      active: true
    });
  });

  it('rejects deactivating the final role KITCHEN contact', async () => {
    const input = {
      messageId: 'wa_contact_007',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'KITCHEN',
        name: 'Luis',
        active: false
      }
    };
    const context = {
      contacts: [
        {
          id: 'contact_1',
          kitchenId: 'kitchen_1',
          phone: '+529991112233',
          role: 'KITCHEN',
          name: 'Luis',
          active: true
        }
      ]
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('allows deactivating a non-final authorized contact', async () => {
    const input = {
      messageId: 'wa_contact_008',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'DELIVERER',
        name: 'Luis',
        active: false
      }
    };
    const context = {
      contacts: [
        {
          id: 'contact_1',
          kitchenId: 'kitchen_1',
          phone: '+529991112233',
          role: 'DELIVERER',
          name: 'Luis',
          active: true
        },
        {
          id: 'contact_2',
          kitchenId: 'kitchen_1',
          phone: '+529994445555',
          role: 'KITCHEN',
          name: 'Admin',
          active: true
        }
      ]
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result.contact.active).toBe(false);
  });

  it('produces an audit event when an authorized contact is changed', async () => {
    const input = {
      messageId: 'wa_contact_009',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'admin_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'DELIVERER',
        name: 'Luis'
      }
    };
    const context = {
      contacts: []
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result.auditEvent).toEqual({
      type: 'authorized_contact_upserted',
      kitchenId: 'kitchen_1',
      actorRole: 'KITCHEN',
      actorId: 'admin_1',
      messageId: 'wa_contact_009'
    });
  });

  it('returns the same result when the same messageId was already processed', async () => {
    const previousResult = {
      ok: true,
      contact: {
        kitchenId: 'kitchen_1',
        phone: '+529991112233',
        role: 'DELIVERER',
        name: 'Luis',
        active: true
      }
    };
    const input = {
      messageId: 'wa_contact_010',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1',
        contactId: 'contact_1'
      },
      kitchenId: 'kitchen_1',
      contact: {
        phone: '+52 999 111 2233',
        role: 'DELIVERER',
        name: 'Luis'
      }
    };
    const context = {
      contacts: [],
      processedEvents: [
        {
          messageId: 'wa_contact_010',
          result: previousResult
        }
      ]
    };

    const result = await upsertAuthorizedContact(input, context);

    expect(result).toBe(previousResult);
  });
});
