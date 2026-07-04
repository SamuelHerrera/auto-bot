export const HERMES_LOCAL_IDENTITY_HEADER = "x-hermes-local-identity";

export type HermesLocalIdentityRole =
  | "CLIENT"
  | "KITCHEN"
  | "DELIVERER"
  | "PLATFORM_SUPPORT";

export type HermesLocalIdentity = {
  role?: HermesLocalIdentityRole;
  id?: string;
  phone?: string;
  kitchenId?: string;
  contactId?: string;
  platformAccess?: boolean;
};

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

export function normalizeHermesLocalIdentity(value: unknown): HermesLocalIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const roleValue = normalizeOptionalString((value as any).role)?.toUpperCase();
  const role = roleValue && ["CLIENT", "KITCHEN", "DELIVERER", "PLATFORM_SUPPORT"].includes(roleValue)
    ? roleValue as HermesLocalIdentityRole
    : undefined;
  const kitchenIdValue = (value as any).kitchenId;
  const kitchenId =
    kitchenIdValue !== undefined &&
    kitchenIdValue !== null &&
    String(kitchenIdValue).trim() !== ""
      ? String(kitchenIdValue).trim()
      : undefined;

  return {
    ...(role ? { role } : {}),
    ...(normalizeOptionalString((value as any).id) ? { id: normalizeOptionalString((value as any).id) } : {}),
    ...(normalizeOptionalString((value as any).phone) ? { phone: normalizeOptionalString((value as any).phone) } : {}),
    ...(kitchenId ? { kitchenId } : {}),
    ...(normalizeOptionalString((value as any).contactId) ? { contactId: normalizeOptionalString((value as any).contactId) } : {}),
    ...((value as any).platformAccess === true ? { platformAccess: true } : {})
  };
}
