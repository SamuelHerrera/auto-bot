import { Prisma } from "@prisma/client";

export function serializeValue<T>(value: T): T | string | number | null | undefined | object {
  if (typeof value === "bigint") {
    return value.toString();
  }

  const prismaDecimal = Prisma?.Decimal;

  if (prismaDecimal && (prismaDecimal.isDecimal?.(value) || value instanceof prismaDecimal)) {
    return Number(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, currentValue]) => [
        key,
        serializeValue(currentValue)
      ])
    );
  }

  return value;
}

export function serializeResult<T>(value: T) {
  return serializeValue(value);
}
