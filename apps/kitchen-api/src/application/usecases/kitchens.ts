import { normalizeMexicanPhone } from "../../shared/normalize";
import { repositories } from "../../infrastructure/container";
import {
  cacheResult,
  findCachedResult,
  findContextProcessedEvent,
  runInWriteTransaction,
  writeAuditEvent
} from "./live-helpers";

function isTrustedPlatformSupportActor(actor: any) {
  return Boolean(actor?.platformAccess && typeof actor.id === "string" && actor.id.trim() !== "");
}

function isTrustedKitchenActor(actor: any, kitchenId: string) {
  return Boolean(
    actor?.role === "KITCHEN" &&
      typeof actor.kitchenId === "string" &&
      actor.kitchenId === kitchenId &&
      typeof actor.contactId === "string" &&
      actor.contactId.trim() !== ""
  );
}

export async function registerKitchen(input: any, context: any) {
  if (!isTrustedPlatformSupportActor(input.actor)) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "registerKitchen");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  if (!input.tenant.name) {
    return {
      ok: false,
      error: "missing_fields",
      missingFields: ["tenant.name"]
    };
  }

  return {
    ok: true,
    kitchen: {
      name: input.tenant.name,
      description: JSON.stringify({
        businessVoice: input.tenant.businessVoice ?? "friendly",
        receptionistEnabled: true
      }),
      setupStatus: "PENDING_SETUP"
    },
    auditEvent: {
      type: "kitchen_registered",
      actorScope: "PLATFORM_SUPPORT",
      actorId: input.actor.id,
      kitchenName: input.tenant.name,
      messageId: input.messageId
    }
  };
}

export async function registerWhatsappSession(input: any, context: any) {
  if (!isTrustedPlatformSupportActor(input.actor)) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "registerWhatsappSession");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  if (context.kitchen.id !== input.kitchenId) {
    return {
      ok: false,
      error: "order_not_found"
    };
  }

  if (input.providerEvent?.type === "CONNECTED") {
    return {
      ok: true,
      session: {
        kitchenId: input.kitchenId,
        status: "CONNECTED"
      },
      event: {
        type: "channel_connected",
        kitchenId: input.kitchenId,
        channel: "WHATSAPP"
      }
    };
  }

  if (input.providerEvent?.type === "QR_EXPIRED") {
    return {
      ok: true,
      session: {
        kitchenId: input.kitchenId,
        status: "EXPIRED"
      }
    };
  }

  return {
    ok: true,
    session: {
      kitchenId: input.kitchenId,
      status: "PENDING_LINK",
      qrMediaRef: context.providerSession.qrMediaRef
    }
  };
}

export async function updateKitchenConfiguration(input: any, context: any) {
  if (!isTrustedKitchenActor(input.actor, input.kitchenId)) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "updateKitchenConfiguration");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const protectedFields = ["tenantId", "whatsappSessionSecret"];
  const protectedField = Object.keys(input.configuration).find((field) => protectedFields.includes(field));

  if (protectedField) {
    return {
      ok: false,
      error: "protected_field",
      field: protectedField
    };
  }

  const allowedFields = ["orderingStatus", "businessVoice", "paymentOptions", "deliverySettings", "schedule"];
  const unsupportedField = Object.keys(input.configuration).find((field) => !allowedFields.includes(field));

  if (unsupportedField) {
    return {
      ok: false,
      error: "unsupported_field",
      field: unsupportedField
    };
  }

  if (input.configuration.orderingStatus && !["OPEN", "CLOSED", "PAUSED"].includes(input.configuration.orderingStatus)) {
    return {
      ok: false,
      error: "invalid_configuration",
      field: "orderingStatus"
    };
  }

  if (input.configuration.paymentOptions?.some((option: string) => !["CASH", "TRANSFER"].includes(option))) {
    return {
      ok: false,
      error: "invalid_configuration",
      field: "paymentOptions"
    };
  }

  if (
    input.configuration.deliverySettings &&
    (typeof input.configuration.deliverySettings.enabled !== "boolean" ||
      (input.configuration.deliverySettings.fee !== undefined &&
        (typeof input.configuration.deliverySettings.fee !== "number" ||
          input.configuration.deliverySettings.fee < 0)))
  ) {
    return {
      ok: false,
      error: "invalid_configuration",
      field: "deliverySettings"
    };
  }

  if (
    input.configuration.schedule !== undefined &&
    (typeof input.configuration.schedule !== "string" || input.configuration.schedule.trim() === "")
  ) {
    return {
      ok: false,
      error: "invalid_configuration",
      field: "schedule"
    };
  }

  return {
    ok: true,
    kitchen: {
      ...context.kitchen,
      ...input.configuration
    },
    ...(input.actor.contactId
      ? {
          auditEvent: {
            type: "kitchen_configuration_updated",
            kitchenId: input.kitchenId,
            actorRole: input.actor.role,
            actorId: input.actor.contactId,
            messageId: input.messageId
          }
        }
      : {})
  };
}

export async function upsertAuthorizedContact(input: any, context: any) {
  if (!isTrustedKitchenActor(input.actor, input.kitchenId)) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "upsertAuthorizedContact");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  if (!["CLIENT", "KITCHEN", "DELIVERER"].includes(input.contact.role)) {
    return {
      ok: false,
      error: "invalid_role"
    };
  }

  const phone = normalizeMexicanPhone(input.contact.phone);
  const existingContact = context.contacts.find((contact: any) => {
    return contact.kitchenId === input.kitchenId && normalizeMexicanPhone(contact.phone) === phone;
  });
  const activeAdmins = context.contacts.filter((contact: any) => {
    return contact.kitchenId === input.kitchenId && contact.role === "KITCHEN" && contact.active;
  });

  if (input.contact.active === false && existingContact?.role === "KITCHEN" && activeAdmins.length === 1) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  return {
    ok: true,
    contact: {
      ...(existingContact ? { id: existingContact.id } : {}),
      kitchenId: input.kitchenId,
      phone,
      role: input.contact.role,
      name: input.contact.name,
      active: input.contact.active ?? true
    },
    ...(input.actor.contactId
      ? {
          auditEvent: {
            type: "authorized_contact_upserted",
            kitchenId: input.kitchenId,
            actorRole: input.actor.role,
            actorId: input.actor.contactId,
            messageId: input.messageId
          }
        }
      : {})
  };
}

export async function executeRegisterKitchen(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "registerKitchen");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const result: any = await registerKitchen(input, {});

    if (!result.ok) {
      return result;
    }

    await transactionDeps.kitchens.registerKitchen(result.kitchen);
    await writeAuditEvent(transactionDeps, {
      ...result.auditEvent,
      kitchenId: null
    });
    await cacheResult(transactionDeps, input, "registerKitchen", result);

    return result;
  });
}

export async function executeRegisterWhatsappSession(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "registerWhatsappSession");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const kitchen = await transactionDeps.kitchens.getById(input.kitchenId);
    const currentSession = await transactionDeps.sessions.getByKitchenId(input.kitchenId);
    const result: any = await registerWhatsappSession(input, {
      kitchen: kitchen ?? { id: null },
      currentSession,
      providerSession: input.providerSession ?? input.providerSessionData ?? { qrMediaRef: input.qrMediaRef }
    });

    if (!result.ok) {
      return result;
    }

    await transactionDeps.sessions.registerWhatsappSession({
      kitchenId: input.kitchenId,
      status: result.session.status,
      qrMediaRef: result.session.qrMediaRef
    });
    await transactionDeps.activityLogs.create({
      kitchenId: input.kitchenId,
      userId: input.actor.id ?? null,
      entityType: "kitchen",
      entityId: input.kitchenId,
      eventType: "WHATSAPP_SESSION_UPDATED",
      description: "register_whatsapp_session",
      metadata: result.event ?? result.session
    });
    await cacheResult(transactionDeps, input, "registerWhatsappSession", result);

    return result;
  });
}

export async function executeUpdateKitchenConfiguration(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "updateKitchenConfiguration");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const kitchen = await transactionDeps.kitchens.getById(input.kitchenId);
    const result: any = await updateKitchenConfiguration(input, {
      kitchen
    });

    if (!result.ok) {
      return result;
    }

    const persistedKitchen = await transactionDeps.kitchens.updateConfiguration({
      kitchenId: input.kitchenId,
      configuration: input.configuration
    });
    const finalResult = {
      ...result,
      kitchen: {
        id: persistedKitchen.id,
        ...(input.configuration.orderingStatus !== undefined ? { orderingStatus: persistedKitchen.orderingStatus } : {}),
        ...(input.configuration.businessVoice !== undefined ? { businessVoice: persistedKitchen.businessVoice } : {}),
        ...(input.configuration.paymentOptions !== undefined ? { paymentOptions: persistedKitchen.paymentOptions } : {}),
        ...(input.configuration.deliverySettings !== undefined ? { deliverySettings: persistedKitchen.deliverySettings } : {})
      }
    };

    await writeAuditEvent(transactionDeps, result.auditEvent);
    await cacheResult(transactionDeps, input, "updateKitchenConfiguration", finalResult);

    return finalResult;
  });
}

export async function executeUpsertAuthorizedContact(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "upsertAuthorizedContact");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const contacts = await transactionDeps.kitchens.listContacts(input.kitchenId);
    const result: any = await upsertAuthorizedContact(input, {
      contacts
    });

    if (!result.ok) {
      return result;
    }

    const persistedContact = await transactionDeps.kitchens.upsertAuthorizedContact({
      kitchenId: input.kitchenId,
      contact: result.contact
    });
    const finalResult = {
      ...result,
      contact: {
        ...(result.contact.id ? { id: result.contact.id } : {}),
        kitchenId: input.kitchenId,
        phone: persistedContact.phone,
        role: persistedContact.role,
        name: persistedContact.name,
        active: persistedContact.active
      }
    };

    await writeAuditEvent(transactionDeps, result.auditEvent);
    await cacheResult(transactionDeps, input, "upsertAuthorizedContact", finalResult);

    return finalResult;
  });
}
