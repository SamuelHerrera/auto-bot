import { describe, expect, it } from 'vitest';
import { registerWhatsappSession } from './registerWhatsappSession.js';

describe('POST /kitchens/{kitchen_id}/register-whatsapp-sessions - registerWhatsappSession', () => {
  it('allows platform support access to create a pending WhatsApp session with safe QR media reference', async () => {
    const input = {
      messageId: 'wa_session_001',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1'
      },
      providerSession: {
        qrMediaRef: 'media_qr_123',
        rawSecret: 'provider_secret'
      }
    };

    const result = await registerWhatsappSession(input, context);

    expect(result).toEqual({
      ok: true,
      session: {
        kitchenId: 'kitchen_1',
        status: 'PENDING_LINK',
        qrMediaRef: 'media_qr_123'
      }
    });
    expect(result.session.rawSecret).toBeUndefined();
  });

  it('rejects actors without platform support access creating WhatsApp sessions', async () => {
    const input = {
      messageId: 'wa_session_002',
      actor: {
        role: 'KITCHEN',
        kitchenId: 'kitchen_1'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1'
      },
      providerSession: {
        qrMediaRef: 'media_qr_123'
      }
    };

    const result = await registerWhatsappSession(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'action_not_allowed'
    });
  });

  it('rejects invalid kitchen scope', async () => {
    const input = {
      messageId: 'wa_session_003',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_2'
      },
      providerSession: {
        qrMediaRef: 'media_qr_123'
      }
    };

    const result = await registerWhatsappSession(input, context);

    expect(result).toEqual({
      ok: false,
      error: 'order_not_found'
    });
  });

  it('moves the session to connected when provider connected event is received', async () => {
    const input = {
      messageId: 'wa_session_004',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      kitchenId: 'kitchen_1',
      providerEvent: {
        type: 'CONNECTED'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1'
      },
      currentSession: {
        kitchenId: 'kitchen_1',
        status: 'PENDING_LINK'
      },
      providerSession: {
        qrMediaRef: 'media_qr_123'
      }
    };

    const result = await registerWhatsappSession(input, context);

    expect(result.session).toEqual({
      kitchenId: 'kitchen_1',
      status: 'CONNECTED'
    });
  });

  it('moves the session to expired when QR expiration event is received', async () => {
    const input = {
      messageId: 'wa_session_005',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      kitchenId: 'kitchen_1',
      providerEvent: {
        type: 'QR_EXPIRED'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1'
      },
      currentSession: {
        kitchenId: 'kitchen_1',
        status: 'PENDING_LINK'
      },
      providerSession: {
        qrMediaRef: 'media_qr_123'
      }
    };

    const result = await registerWhatsappSession(input, context);

    expect(result.session).toEqual({
      kitchenId: 'kitchen_1',
      status: 'EXPIRED'
    });
  });

  it('emits a safe channel connected event when provider connects', async () => {
    const input = {
      messageId: 'wa_session_006',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      kitchenId: 'kitchen_1',
      providerEvent: {
        type: 'CONNECTED'
      }
    };
    const context = {
      kitchen: {
        id: 'kitchen_1'
      },
      currentSession: {
        kitchenId: 'kitchen_1',
        status: 'PENDING_LINK'
      },
      providerSession: {
        qrMediaRef: 'media_qr_123',
        rawSecret: 'provider_secret'
      }
    };

    const result = await registerWhatsappSession(input, context);

    expect(result.event).toEqual({
      type: 'channel_connected',
      kitchenId: 'kitchen_1',
      channel: 'WHATSAPP'
    });
    expect(result.event.rawSecret).toBeUndefined();
  });

  it('returns the same result when the same messageId was already processed', async () => {
    const previousResult = {
      ok: true,
      session: {
        kitchenId: 'kitchen_1',
        status: 'PENDING_LINK',
        qrMediaRef: 'media_qr_old'
      }
    };
    const input = {
      messageId: 'wa_session_007',
      actor: {
        platformAccess: true,
        id: 'support_1'
      },
      kitchenId: 'kitchen_1'
    };
    const context = {
      kitchen: {
        id: 'kitchen_1'
      },
      providerSession: {
        qrMediaRef: 'media_qr_new'
      },
      processedEvents: [
        {
          messageId: 'wa_session_007',
          result: previousResult
        }
      ]
    };

    const result = await registerWhatsappSession(input, context);

    expect(result).toBe(previousResult);
  });
});
