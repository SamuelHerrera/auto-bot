import type { AuditLogFilter, AuditLogOutcome, AuditLogRecord } from "./models";

export function auditLogMatchesFilters(entry: AuditLogRecord, outcomeFilter: AuditLogFilter, search: string) {
  if (outcomeFilter !== "all" && entry.outcome !== outcomeFilter) {
    return false;
  }

  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [
    entry.action,
    entry.actor,
    entry.outcome,
    entry.resourceType ?? "",
    entry.resourceId ?? "",
    entry.details ? JSON.stringify(entry.details) : "",
  ].some((value) => value.toLowerCase().includes(query));
}

export function getAuditLogCounts(auditLogs: AuditLogRecord[]) {
  return auditLogs.reduce(
    (counts, entry) => ({
      ...counts,
      [entry.outcome]: counts[entry.outcome] + 1,
    }),
    { success: 0, failure: 0, ignored: 0 } satisfies Record<AuditLogOutcome, number>,
  );
}

export function getAuditLogIcon(entry: AuditLogRecord) {
  if (entry.outcome === "failure") {
    return "mdi:alert-circle-outline";
  }

  if (entry.outcome === "ignored") {
    return "mdi:debug-step-over";
  }

  if (entry.action.includes("rule")) {
    return "mdi:shield-check-outline";
  }

  if (entry.action.includes("message")) {
    return "mdi:message-text-outline";
  }

  return "mdi:check-circle-outline";
}
