import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent } from "react";
import { Icon } from "@iconify/react";

import { auditLogMatchesFilters, getAuditLogCounts, getAuditLogDisplay } from "../domain/audit-logs";
import { formatTimestamp } from "../domain/formatting";
import type { AuditLogFilter, AuditLogRecord } from "../domain/models";
import { EmptyState, TabButton } from "./shared";

const logPageSize = 40;
const estimatedLogRowHeight = 38;
const virtualOverscan = 360;
const logSentinelHeight = 24;

export function LogsView({
  auditLogs,
}: {
  auditLogs: AuditLogRecord[];
}) {
  const [outcomeFilter, setOutcomeFilter] = useState<AuditLogFilter>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(logPageSize);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});
  const [openLogIds, setOpenLogIds] = useState<Set<string>>(() => new Set());
  const logListRef = useRef<HTMLDivElement | null>(null);
  const visibleLogs = useMemo(
    () => auditLogs.filter((entry) => auditLogMatchesFilters(entry, outcomeFilter, search)),
    [auditLogs, outcomeFilter, search],
  );
  const pagedLogs = visibleLogs.slice(0, visibleCount);
  const counts = getAuditLogCounts(auditLogs);
  const hasMoreLogs = visibleCount < visibleLogs.length;
  const virtualLayout = useMemo(
    () => buildVirtualLogLayout(pagedLogs, rowHeights, hasMoreLogs),
    [hasMoreLogs, pagedLogs, rowHeights],
  );
  const virtualWindow = useMemo(
    () => getVirtualLogWindow(virtualLayout.offsets, virtualLayout.heights, scrollTop, viewportHeight),
    [scrollTop, viewportHeight, virtualLayout.heights, virtualLayout.offsets],
  );
  const virtualLogs = pagedLogs.slice(virtualWindow.startIndex, virtualWindow.endIndex);

  useEffect(() => {
    setVisibleCount(logPageSize);
    setScrollTop(0);
    if (logListRef.current) {
      logListRef.current.scrollTop = 0;
    }
  }, [outcomeFilter, search, auditLogs]);

  useEffect(() => {
    const element = logListRef.current;
    if (!element) {
      return;
    }
    const scrollElement = element;

    function updateViewportHeight() {
      setViewportHeight(scrollElement.clientHeight);
    }

    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(scrollElement);

    return () => observer.disconnect();
  }, []);

  const updateRowHeight = useCallback((entryId: string, height: number) => {
    setRowHeights((currentHeights) => {
      if (currentHeights[entryId] === height) {
        return currentHeights;
      }

      return {
        ...currentHeights,
        [entryId]: height,
      };
    });
  }, []);

  const updateOpenLog = useCallback((entryId: string, isOpen: boolean) => {
    setOpenLogIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (isOpen) {
        nextIds.add(entryId);
      } else {
        nextIds.delete(entryId);
      }
      return nextIds;
    });
  }, []);

  function loadNextPage() {
    setVisibleCount((currentCount) => Math.min(currentCount + logPageSize, visibleLogs.length));
  }

  function handleLogScroll(event: UIEvent<HTMLDivElement>) {
    setScrollTop(event.currentTarget.scrollTop);

    if (!hasMoreLogs) {
      return;
    }

    const element = event.currentTarget;
    const remainingScroll = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (remainingScroll < 180) {
      loadNextPage();
    }
  }

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

      <div ref={logListRef} className="audit-log-list" onScroll={handleLogScroll}>
        {auditLogs.length === 0 ? (
          <EmptyState title="No audit events" description="Changes will appear here after actions are recorded." />
        ) : visibleLogs.length === 0 ? (
          <EmptyState title="No matching logs" description="Adjust the filters or search." />
        ) : (
          <div className="audit-log-virtualizer" style={{ height: virtualLayout.totalHeight }}>
            {virtualLogs.map((entry, index) => {
              const entryIndex = virtualWindow.startIndex + index;
              return (
                <VirtualLogRow
                  key={entry.id}
                  entry={entry}
                  isOpen={openLogIds.has(entry.id)}
                  top={virtualLayout.offsets[entryIndex] ?? 0}
                  onMeasure={updateRowHeight}
                  onOpenChange={updateOpenLog}
                />
              );
            })}
            {hasMoreLogs ? (
              <div
                className="audit-log-sentinel"
                aria-hidden="true"
                style={{ top: virtualLayout.sentinelOffset }}
              />
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

function VirtualLogRow({
  entry,
  isOpen,
  onMeasure,
  onOpenChange,
  top,
}: {
  entry: AuditLogRecord;
  isOpen: boolean;
  onMeasure: (entryId: string, height: number) => void;
  onOpenChange: (entryId: string, isOpen: boolean) => void;
  top: number;
}) {
  const rowRef = useRef<HTMLDetailsElement | null>(null);
  const display = getAuditLogDisplay(entry);
  const summary = getAuditLogSummary(display.title, display.description);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const rowElement = row;

    function measure() {
      onMeasure(entry.id, Math.ceil(rowElement.getBoundingClientRect().height));
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rowElement);

    return () => observer.disconnect();
  }, [entry.id, onMeasure]);

  return (
    <details
      ref={rowRef}
      className={`audit-log-row audit-log-row-${entry.outcome}`}
      open={isOpen}
      onToggle={(event) => onOpenChange(entry.id, event.currentTarget.open)}
      style={{ transform: `translateY(${top}px)` }}
    >
      <summary>
        <span className={`audit-log-icon audit-log-icon-${entry.outcome}`}>
          <Icon icon={display.icon} aria-hidden="true" />
        </span>
        <span className="audit-log-main">{summary}</span>
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
}

function getAuditLogSummary(title: string, description: string) {
  const trimmedDescription = description.trim();
  if (!trimmedDescription) {
    return title;
  }

  return `${title}: ${lowercaseFirst(trimmedDescription.replace(/[.?!]$/, ""))}.`;
}

function lowercaseFirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function buildVirtualLogLayout(
  entries: AuditLogRecord[],
  rowHeights: Record<string, number>,
  hasMoreLogs: boolean,
) {
  const offsets: number[] = [];
  const heights: number[] = [];
  let totalHeight = 0;

  for (const entry of entries) {
    const height = rowHeights[entry.id] ?? estimatedLogRowHeight;
    offsets.push(totalHeight);
    heights.push(height);
    totalHeight += height;
  }

  const sentinelOffset = totalHeight;
  if (hasMoreLogs) {
    totalHeight += logSentinelHeight;
  }

  return {
    heights,
    offsets,
    sentinelOffset,
    totalHeight,
  };
}

function getVirtualLogWindow(
  offsets: number[],
  heights: number[],
  scrollTop: number,
  viewportHeight: number,
) {
  const visibleTop = Math.max(0, scrollTop - virtualOverscan);
  const visibleBottom = scrollTop + viewportHeight + virtualOverscan;
  let startIndex = 0;
  let endIndex = offsets.length;

  while (
    startIndex < offsets.length &&
    (offsets[startIndex] ?? 0) + (heights[startIndex] ?? estimatedLogRowHeight) < visibleTop
  ) {
    startIndex += 1;
  }

  endIndex = startIndex;
  while (endIndex < offsets.length && (offsets[endIndex] ?? 0) <= visibleBottom) {
    endIndex += 1;
  }

  return {
    startIndex,
    endIndex,
  };
}
