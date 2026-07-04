import { normalizeMexicanPhone, normalizeMexicanText } from "../../shared/normalize";
import { repositories } from "../../infrastructure/container";
import {
  cacheResult,
  findCachedResult,
  findContextProcessedEvent,
  runInWriteTransaction,
  writeAuditEvent
} from "./live-helpers";

function getTrustedClientActor(actor: any) {
  if (actor?.role !== "CLIENT" || typeof actor.phone !== "string" || actor.phone.trim() === "") {
    return null;
  }

  return {
    role: "CLIENT",
    phone: normalizeMexicanPhone(actor.phone)
  };
}

export async function upsertClient(input: any, context: any) {
  const trustedActor = getTrustedClientActor(input.actor);

  if (!trustedActor) {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  const processedEvent = findContextProcessedEvent(input, context, "upsertClient");

  if (processedEvent.status === "hit") {
    return processedEvent.result;
  }

  if (processedEvent.status === "mismatch") {
    return {
      ok: false,
      error: "action_not_allowed"
    };
  }

  if (
    input.profile.phone &&
    normalizeMexicanPhone(input.profile.phone) !== trustedActor.phone
  ) {
    return {
      ok: false,
      error: "confirmation_required",
      field: "phone"
    };
  }

  const submittedAddress = input.profile.address;
  const matchingAddress = context.existingClient?.addresses.find((address: any) => {
    return submittedAddress &&
      normalizeMexicanText(address.street) === normalizeMexicanText(submittedAddress.street) &&
      normalizeMexicanText(address.exteriorNumber) === normalizeMexicanText(submittedAddress.exteriorNumber) &&
      normalizeMexicanText(address.neighborhood) === normalizeMexicanText(submittedAddress.neighborhood);
  });
  const existingAddresses = context.existingClient?.addresses ?? [];
  const addresses = submittedAddress
    ? matchingAddress
      ? [matchingAddress]
      : [...existingAddresses, submittedAddress]
    : [];

  return {
    ok: true,
    client: {
      kitchenId: input.kitchenId,
      phone: trustedActor.phone,
      ...(input.profile.name ? { name: input.profile.name } : {}),
      addresses
    },
    ...(Object.keys(input.profile).length > 0
      ? {
          auditEvent: {
            type: "client_upserted",
            kitchenId: input.kitchenId,
            actorRole: input.actor.role,
            actorPhone: trustedActor.phone,
            messageId: input.messageId
          }
        }
      : {})
  };
}

export async function executeUpsertClient(input: any, deps: any = repositories) {
  return runInWriteTransaction(deps, async (transactionDeps) => {
    const cached = await findCachedResult(transactionDeps, input, "upsertClient");

    if (cached.status === "hit") {
      return cached.result;
    }

    if (cached.status === "mismatch") {
      return {
        ok: false,
        error: "action_not_allowed"
      };
    }

    const existingClient = await transactionDeps.clients.findByPhone(input.kitchenId, input.actor.phone);
    const result: any = await upsertClient(input, {
      existingClient
    });

    if (!result.ok) {
      return result;
    }

    await transactionDeps.clients.upsertClient({
      kitchenId: input.kitchenId,
      phone: input.actor.phone,
      profile: input.profile
    });

    await writeAuditEvent(transactionDeps, result.auditEvent);
    await cacheResult(transactionDeps, input, "upsertClient", result);

    return result;
  });
}
