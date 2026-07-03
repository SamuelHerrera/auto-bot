import { useState } from "react";
import { Icon } from "@iconify/react";

import { auditLogMatchesFilters, getAuditLogCounts, getAuditLogDisplay } from "../domain/audit-logs";
import { formatTimestamp } from "../domain/formatting";
import type { AuditLogFilter, AuditLogRecord } from "../domain/models";
import { EmptyState, TabButton } from "./shared";

export function LogsView({
  auditLogs,
}: {
  auditLogs: AuditLogRecord[];
}) {
  const [outcomeFilter, setOutcomeFilter] = useState<AuditLogFilter>("all");
  const [search, setSearch] = useState("");
  const visibleLogs = auditLogs.filter((entry) => auditLogMatchesFilters(entry, outcomeFilter, search));
  const counts = getAuditLogCounts(auditLogs);

  return (
    <>
      <div className="log-filterbar">
        <div className="subnav log-filter-tabs" aria-label="Log filters">
          <TabButton active={outcomeFilter === "all"} count={auditLogs.length} icon="mdi:format-list-bulleted" onClick={() => setOutcomeFilter("all")}>
            All
          </TabButton>
          <TabButton active={outcomeFilter === "failure"} count={counts.failure} icon="mdi:alert-circle-outline" onClick={() => setOutcomeFilter("failure")}>
            Failures
          </TabButton>
          <TabButton active={outcomeFilter === "ignored"} count={counts.ignored} icon="mdi:debug-step-over" onClick={() => setOutcomeFilter("ignored")}>
            Ignored
          </TabButton>
          <TabButton active={outcomeFilter === "success"} count={counts.success} icon="mdi:check-circle-outline" onClick={() => setOutcomeFilter("success")}>
            Success
          </TabButton>
        </div>
        <label className="log-search">
          <span className="visually-hidden">Search logs</span>
          <Icon icon="mdi:magnify" aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search logs" />
        </label>
      </div>

      <div className="audit-log-list">
        {auditLogs.length === 0 ? (
          <EmptyState title="No audit events" description="Changes will appear here after actions are recorded." />
        ) : visibleLogs.length === 0 ? (
          <EmptyState title="No matching logs" description="Adjust the filters or search." />
        ) : (
          visibleLogs.map((entry) => {
            const display = getAuditLogDisplay(entry);

            return (
              <details key={entry.id} className={`audit-log-row audit-log-row-${entry.outcome}`}>
                <summary>
                  <span className={`audit-log-icon audit-log-icon-${entry.outcome}`}>
                    <Icon icon={display.icon} aria-hidden="true" />
                  </span>
                  <span className="audit-log-main">
                    <strong>{display.title}</strong>
                    <small>{display.description}</small>
                  </span>
                  <time>{formatTimestamp(entry.createdAt)}</time>
                </summary>
                <div className="audit-log-detail">
                  <dl className="audit-log-meta">
                    <div>
                      <dt>Actor</dt>
                      <dd>{entry.actor}</dd>
                    </div>
                    <div>
                      <dt>Resource</dt>
                      <dd>{entry.resourceType ? `${entry.resourceType} / ${entry.resourceId ?? "unknown"}` : "none"}</dd>
                    </div>
                    <div>
                      <dt>Action</dt>
                      <dd>{entry.action}</dd>
                    </div>
                    <div>
                      <dt>Outcome</dt>
                      <dd>{entry.outcome}</dd>
                    </div>
                  </dl>
                  {entry.details ? <pre>{JSON.stringify(entry.details, null, 2)}</pre> : <p>No JSON details.</p>}
                </div>
              </details>
            );
          })
        )}
      </div>
    </>
  );
}
