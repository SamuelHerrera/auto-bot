import { createError } from "./errors";

export function requireFields(input: Record<string, unknown>, fieldNames: string[]) {
  const missingFields = fieldNames.filter((fieldName) => {
    const value = input[fieldName];

    return value === null || value === undefined || value === "";
  });

  if (missingFields.length > 0) {
    throw createError(400, "missing_fields", { missingFields });
  }
}

export function rejectUnsupportedFields(input: Record<string, unknown>, allowedFields: string[]) {
  const unsupportedField = Object.keys(input).find((fieldName) => !allowedFields.includes(fieldName));

  if (unsupportedField) {
    throw createError(400, "unsupported_field", { field: unsupportedField });
  }
}
