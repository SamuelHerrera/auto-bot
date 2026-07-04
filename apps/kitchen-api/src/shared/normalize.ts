export function normalizeMexicanText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeMexicanPhone(phone: unknown) {
  let digits = String(phone ?? "").replace(/\D/g, "");

  if (digits.length === 13 && digits.startsWith("521")) {
    digits = `52${digits.slice(3)}`;
  }

  if (digits.length === 10) {
    digits = `52${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("52")) {
    return `+${digits}`;
  }

  return `+${digits}`;
}
