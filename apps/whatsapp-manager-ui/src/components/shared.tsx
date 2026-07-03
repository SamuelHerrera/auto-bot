import { ButtonHTMLAttributes } from "react";
import { Icon } from "@iconify/react";

import { getAccountTabLabel, isPendingAccountId } from "../domain/accounts";
import type { WhatsAppAccount } from "../domain/models";

export function AccountTabLabel({ account }: { account: WhatsAppAccount }) {
  const alias = account.alias?.trim();

  if (!alias || isPendingAccountId(account.accountId)) {
    return <span className="workspace-tab-label">{getAccountTabLabel(account)}</span>;
  }

  return (
    <span className="workspace-tab-label workspace-tab-label-stacked">
      <strong>{alias}</strong>
      <small>{account.accountId}</small>
    </span>
  );
}

export function TabButton({
  active,
  children,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  count?: number;
  icon: string;
  children: string;
  onClick: () => void;
}) {
  const label = typeof count === "number" ? `${children}, ${count}` : children;

  return (
    <button className={`nav-button icon-tab-button${active ? " nav-button-active" : ""}`} onClick={onClick} aria-label={label} title={label}>
      <Icon icon={icon} aria-hidden="true" />
      <span>{children}</span>
      {typeof count === "number" ? <span className="tab-count">{count}</span> : null}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  title = label,
  variant = "primary",
  ...buttonProps
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: string;
  label: string;
  title?: string;
  variant?: "primary" | "secondary" | "text" | "danger";
}) {
  const className = [
    "icon-button",
    variant === "secondary" ? "secondary-button" : "",
    variant === "text" || variant === "danger" ? "text-button" : "",
    variant === "danger" ? "danger-button" : "",
    buttonProps.className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <button {...buttonProps} className={className} aria-label={label} title={title}>
      <Icon icon={icon} aria-hidden="true" />
      {buttonProps.children}
    </button>
  );
}

export function StatusIndicator({ detail, tone }: { detail: string; tone: "live" | "syncing" | "error" }) {
  return (
    <span
      className={`status-indicator status-indicator-${tone}`}
      aria-label={`Status: ${detail}`}
      aria-live="polite"
      role="status"
      tabIndex={0}
    >
      <span className="status-indicator-dot" />
      <span className="status-tooltip">{detail}</span>
    </span>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className={`metric-row${tone ? ` metric-row-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
