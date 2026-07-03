import { FormEvent, RefObject } from "react";
import { Icon } from "@iconify/react";

import { getAccountStatusDetail } from "../domain/accounts";
import type { BrandingSettings, WhatsAppAccount } from "../domain/models";
import { AccountTabLabel, IconButton, StatusIndicator } from "./shared";

export function TopBar({
  accountsCount,
  activeTabId,
  branding,
  connectedAccounts,
  isBusy,
  isLogsTabOpen,
  isSettingsTabOpen,
  statusDetail,
  statusTone,
  tabAccounts,
  workspaceTabsRef,
  onCloseAccountTab,
  onCloseLogsTab,
  onCloseSettingsTab,
  onConnectAccount,
  onFindNumber,
  onOpenLogsTab,
  onOpenSettingsTab,
  onSelectAccountTab,
  onSelectLogsTab,
  onSelectSettingsTab,
}: {
  accountsCount: number;
  activeTabId: string;
  branding: BrandingSettings;
  connectedAccounts: number;
  isBusy: boolean;
  isLogsTabOpen: boolean;
  isSettingsTabOpen: boolean;
  statusDetail: string;
  statusTone: "live" | "syncing" | "error";
  tabAccounts: WhatsAppAccount[];
  workspaceTabsRef: RefObject<HTMLDivElement>;
  onCloseAccountTab: (accountId: string) => void;
  onCloseLogsTab: () => void;
  onCloseSettingsTab: () => void;
  onConnectAccount: (event: FormEvent<HTMLFormElement>) => void;
  onFindNumber: () => void;
  onOpenLogsTab: () => void;
  onOpenSettingsTab: () => void;
  onSelectAccountTab: (accountId: string) => void;
  onSelectLogsTab: () => void;
  onSelectSettingsTab: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <img src={branding.iconSrc} alt="" aria-hidden="true" />
        <h1>{branding.title}</h1>
      </div>
      <WorkspaceTabs
        activeTabId={activeTabId}
        isLogsTabOpen={isLogsTabOpen}
        isSettingsTabOpen={isSettingsTabOpen}
        tabAccounts={tabAccounts}
        workspaceTabsRef={workspaceTabsRef}
        onCloseAccountTab={onCloseAccountTab}
        onCloseLogsTab={onCloseLogsTab}
        onCloseSettingsTab={onCloseSettingsTab}
        onSelectAccountTab={onSelectAccountTab}
        onSelectLogsTab={onSelectLogsTab}
        onSelectSettingsTab={onSelectSettingsTab}
      />
      <div className="topbar-actions">
        <StatusIndicator detail={statusDetail} tone={statusTone} />
        <IconButton icon="mdi:magnify" label="Find number" className="number-select-button" variant="secondary" onClick={onFindNumber}>
          <span className="button-count">{connectedAccounts}/{accountsCount}</span>
        </IconButton>
        <details className="action-menu topbar-menu">
          <summary aria-label="App actions" title="App actions">
            <Icon icon="mdi:dots-vertical" aria-hidden="true" />
          </summary>
          <div className="action-menu-list">
            <form className="menu-action-form" onSubmit={onConnectAccount}>
              <button type="submit" disabled={isBusy}>
                <Icon icon="mdi:link-plus" aria-hidden="true" />
                <span>Link number</span>
              </button>
            </form>
            <button type="button" onClick={onOpenSettingsTab}>
              <Icon icon="mdi:cog-outline" aria-hidden="true" />
              <span>Settings</span>
            </button>
            <button type="button" onClick={onOpenLogsTab}>
              <Icon icon="mdi:clipboard-text-clock-outline" aria-hidden="true" />
              <span>Logs</span>
            </button>
          </div>
        </details>
      </div>
    </header>
  );
}

function WorkspaceTabs({
  activeTabId,
  isLogsTabOpen,
  isSettingsTabOpen,
  tabAccounts,
  workspaceTabsRef,
  onCloseAccountTab,
  onCloseLogsTab,
  onCloseSettingsTab,
  onSelectAccountTab,
  onSelectLogsTab,
  onSelectSettingsTab,
}: {
  activeTabId: string;
  isLogsTabOpen: boolean;
  isSettingsTabOpen: boolean;
  tabAccounts: WhatsAppAccount[];
  workspaceTabsRef: RefObject<HTMLDivElement>;
  onCloseAccountTab: (accountId: string) => void;
  onCloseLogsTab: () => void;
  onCloseSettingsTab: () => void;
  onSelectAccountTab: (accountId: string) => void;
  onSelectLogsTab: () => void;
  onSelectSettingsTab: () => void;
}) {
  return (
    <div ref={workspaceTabsRef} className="workspace-tabs" role="tablist" aria-label="Open workspaces">
      {tabAccounts.map((account) => (
        <div
          key={account.accountId}
          className={`workspace-tab${activeTabId === account.accountId ? " workspace-tab-active" : ""}`}
          title={getAccountStatusDetail(account)}
        >
          <button
            className="workspace-tab-main"
            onClick={() => onSelectAccountTab(account.accountId)}
          >
            <span className={`status-dot status-dot-${account.status}`} />
            <AccountTabLabel account={account} />
          </button>
          <IconButton icon="mdi:close" label={`Close ${account.accountId}`} className="tab-close" variant="text" onClick={() => onCloseAccountTab(account.accountId)} />
        </div>
      ))}
      {isSettingsTabOpen ? (
        <div className={`workspace-tab${activeTabId === "settings" ? " workspace-tab-active" : ""}`}>
          <button
            className="workspace-tab-main"
            onClick={onSelectSettingsTab}
            aria-label="Settings"
            title="Settings"
          >
            <Icon icon="mdi:cog-outline" aria-hidden="true" />
            <span>Settings</span>
          </button>
          <IconButton icon="mdi:close" label="Close settings" className="tab-close" variant="text" onClick={onCloseSettingsTab} />
        </div>
      ) : null}
      {isLogsTabOpen ? (
        <div className={`workspace-tab${activeTabId === "logs" ? " workspace-tab-active" : ""}`}>
          <button
            className="workspace-tab-main"
            onClick={onSelectLogsTab}
            aria-label="Logs"
            title="Logs"
          >
            <Icon icon="mdi:clipboard-text-clock-outline" aria-hidden="true" />
            <span>Logs</span>
          </button>
          <IconButton icon="mdi:close" label="Close logs" className="tab-close" variant="text" onClick={onCloseLogsTab} />
        </div>
      ) : null}
    </div>
  );
}
