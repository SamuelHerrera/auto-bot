import { FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";

import { AccountTabLabel, EmptyState, IconButton, LinkAccountDialog, LogsView, NumberChooserPanel, NumberWorkspace, SettingsView, StatusIndicator } from "./components";
import { accountMatchesSearch, findCompletedLinkedAccount, getAccountStatusDetail, isPendingAccountId, mergeLinkingStatus } from "./domain/accounts";
import { buildChatMessages, buildChatSummaries } from "./domain/chats";
import { areStringArraysEqual } from "./domain/collections";
import type { AuditLogRecord, BrandingSettings, DeliveryRecord, NumberRule, NumberRuleAction, NumberRuleMatchType, NumberSubview, RefreshScope, SessionMapping, WhatsAppAccount } from "./domain/models";
import { buildEventUrl, normalizeError, request } from "./services/api-client";
import { brandingStorageKeys, defaultAppIcon, defaultAppTitle, getInitialBranding, normalizeBranding, setFavicon } from "./services/branding";
import { getFallbackTabId, getInitialWorkspaceState, persistWorkspaceState } from "./services/workspace-storage";

export function App() {
  const [initialWorkspace] = useState(getInitialWorkspaceState);
  const [branding, setBranding] = useState<BrandingSettings>(getInitialBranding);
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [hasLoadedAccounts, setHasLoadedAccounts] = useState(false);
  const [mappings, setMappings] = useState<SessionMapping[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [numberRules, setNumberRules] = useState<NumberRule[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [activeNumberView, setActiveNumberView] = useState<NumberSubview>("home");
  const [accountSearch, setAccountSearch] = useState("");
  const [openAccountTabs, setOpenAccountTabs] = useState<string[]>(initialWorkspace.openAccountTabs);
  const [isNumberPanelOpen, setIsNumberPanelOpen] = useState(false);
  const [isSettingsTabOpen, setIsSettingsTabOpen] = useState(initialWorkspace.isSettingsTabOpen);
  const [isLogsTabOpen, setIsLogsTabOpen] = useState(initialWorkspace.isLogsTabOpen);
  const [activeTabId, setActiveTabId] = useState(initialWorkspace.activeTabId);
  const [activeAccountId, setActiveAccountId] = useState(initialWorkspace.activeAccountId);
  const [activeChatJid, setActiveChatJid] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkingStatus, setLinkingStatus] = useState<WhatsAppAccount | null>(null);
  const [linkingBaselineAccountIds, setLinkingBaselineAccountIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("Live");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [ruleAction, setRuleAction] = useState<NumberRuleAction>("allow");
  const [ruleMatchType, setRuleMatchType] = useState<NumberRuleMatchType>("exact");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleLabel, setRuleLabel] = useState("");
  const [accountAliasDrafts, setAccountAliasDrafts] = useState<Record<string, string>>({});
  const accountsRef = useRef(accounts);
  const isLinkDialogOpenRef = useRef(isLinkDialogOpen);
  const linkingStatusRef = useRef(linkingStatus);
  const linkingBaselineAccountIdsRef = useRef(linkingBaselineAccountIds);
  const linkingStartedAtRef = useRef<string | null>(null);
  const workspaceTabsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    isLinkDialogOpenRef.current = isLinkDialogOpen;
  }, [isLinkDialogOpen]);

  useEffect(() => {
    linkingStatusRef.current = linkingStatus;
  }, [linkingStatus]);

  useEffect(() => {
    linkingBaselineAccountIdsRef.current = linkingBaselineAccountIds;
  }, [linkingBaselineAccountIds]);

  useEffect(() => {
    document.title = branding.title;
    setFavicon(branding.iconSrc);
  }, [branding]);

  useEffect(() => {
    void refreshData(false);
  }, []);

  useEffect(() => {
    const events = new EventSource(buildEventUrl());
    events.addEventListener("accounts", () => {
      void refreshData(false, false, ["accounts"]);
    });
    events.addEventListener("activity", () => {
      void refreshData(false, false, ["activity"]);
    });
    events.addEventListener("rules", () => {
      void refreshData(false, false, ["rules"]);
    });
    events.addEventListener("logs", () => {
      void refreshData(false, false, ["logs"]);
    });
    events.addEventListener("sync", () => {
      void refreshData(false, false);
    });
    events.onerror = () => {
      setStatusMessage("Live updates reconnecting.");
    };

    return () => events.close();
  }, []);

  useEffect(() => {
    persistWorkspaceState({
      activeAccountId,
      activeTabId,
      isLogsTabOpen,
      isSettingsTabOpen,
      openAccountTabs,
    });
  }, [activeAccountId, activeTabId, isLogsTabOpen, isSettingsTabOpen, openAccountTabs]);

  useEffect(() => {
    const tabStrip = workspaceTabsRef.current;

    if (!tabStrip) {
      return;
    }

    const scrollElement = tabStrip;

    function handleWorkspaceTabsWheel(event: WheelEvent) {
      const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

      if (!horizontalDelta || scrollElement.scrollWidth <= scrollElement.clientWidth) {
        return;
      }

      const nextScrollLeft = Math.max(0, Math.min(scrollElement.scrollLeft + horizontalDelta, scrollElement.scrollWidth - scrollElement.clientWidth));

      if (nextScrollLeft !== scrollElement.scrollLeft) {
        scrollElement.scrollLeft = nextScrollLeft;
        event.preventDefault();
      }
    }

    scrollElement.addEventListener("wheel", handleWorkspaceTabsWheel, { passive: false });

    return () => {
      scrollElement.removeEventListener("wheel", handleWorkspaceTabsWheel);
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedAccounts) {
      return;
    }

    const availableAccountIds = new Set(accounts.map((account) => account.accountId));
    const validOpenTabs = openAccountTabs.filter((accountId) => availableAccountIds.has(accountId));

    if (!areStringArraysEqual(openAccountTabs, validOpenTabs)) {
      setOpenAccountTabs(validOpenTabs);
    }

    const isActiveAccountTab = activeTabId && activeTabId !== "settings" && activeTabId !== "logs";
    const isActiveTabAvailable =
      !activeTabId ||
      (activeTabId === "settings" && isSettingsTabOpen) ||
      (activeTabId === "logs" && isLogsTabOpen) ||
      (isActiveAccountTab && availableAccountIds.has(activeTabId));

    if (!isActiveTabAvailable) {
      const nextTabId = getFallbackTabId(validOpenTabs, isSettingsTabOpen, isLogsTabOpen);
      setActiveTabId(nextTabId);
      setActiveAccountId(nextTabId && nextTabId !== "settings" && nextTabId !== "logs" ? nextTabId : validOpenTabs[0] ?? "");
      setActiveChatJid("");
      return;
    }

    if (isActiveAccountTab && availableAccountIds.has(activeTabId) && activeAccountId !== activeTabId) {
      setActiveAccountId(activeTabId);
      setActiveChatJid("");
      return;
    }

    if (activeAccountId && !availableAccountIds.has(activeAccountId)) {
      setActiveAccountId(validOpenTabs[0] ?? "");
      setActiveChatJid("");
    }
  }, [
    accounts,
    activeAccountId,
    activeTabId,
    hasLoadedAccounts,
    isLogsTabOpen,
    isSettingsTabOpen,
    openAccountTabs,
  ]);

  async function refreshData(
    showMessage = true,
    showBusy = true,
    scopes: RefreshScope[] = ["accounts", "activity", "rules", "logs"],
  ) {
    if (showBusy) {
      setIsBusy(true);
    }
    setErrorMessage("");

    try {
      const shouldRefreshAccounts = scopes.includes("accounts");
      const shouldRefreshActivity = scopes.includes("activity");
      const shouldRefreshRules = scopes.includes("rules");
      const shouldRefreshLogs = scopes.includes("logs");
      const [accountResponse, mappingResponse, deliveryResponse, ruleResponse, linkStatus, auditLogResponse] = await Promise.all([
        shouldRefreshAccounts ? request<{ items: WhatsAppAccount[] }>("/whatsapp/accounts") : Promise.resolve(null),
        shouldRefreshActivity ? request<{ items: SessionMapping[] }>("/sessions") : Promise.resolve(null),
        shouldRefreshActivity ? request<{ items: DeliveryRecord[] }>("/deliveries") : Promise.resolve(null),
        shouldRefreshRules ? request<{ items: NumberRule[] }>("/number-rules") : Promise.resolve(null),
        shouldRefreshAccounts ? request<WhatsAppAccount>("/whatsapp/status") : Promise.resolve(null),
        shouldRefreshLogs ? request<{ items: AuditLogRecord[] }>("/audit-logs?limit=200") : Promise.resolve(null),
      ]);

      const refreshedAccounts = accountResponse?.items;

      if (accountResponse) {
        setAccounts(accountResponse.items);
        setHasLoadedAccounts(true);
      }
      if (mappingResponse) {
        setMappings(mappingResponse.items.filter((mapping) => mapping.chatType === "direct"));
      }
      if (deliveryResponse) {
        setDeliveries(deliveryResponse.items.filter((delivery) => delivery.chatType === "direct"));
      }
      if (ruleResponse) {
        setNumberRules(ruleResponse.items);
      }
      if (auditLogResponse) {
        setAuditLogs(auditLogResponse.items);
      }
      const currentAccounts = refreshedAccounts ?? accountsRef.current;
      const currentLinkingStatus = linkingStatusRef.current;
      const currentBaselineAccountIds = linkingBaselineAccountIdsRef.current;
      const isCurrentLinkDialogOpen = isLinkDialogOpenRef.current;
      const completedLinkedAccount = findCompletedLinkedAccount(
        currentAccounts,
        linkStatus,
        currentLinkingStatus,
        currentBaselineAccountIds,
        linkingStartedAtRef.current,
      );
      if (completedLinkedAccount && (currentLinkingStatus || isCurrentLinkDialogOpen)) {
        clearLinkSession();
        setActiveAccountId(completedLinkedAccount.accountId);
        openAccountTab(completedLinkedAccount.accountId);
        setStatusMessage(`Account ${completedLinkedAccount.accountId} linked.`);
      } else if ((currentLinkingStatus || isCurrentLinkDialogOpen) && (linkStatus?.qrCode || linkStatus?.status === "connecting")) {
        updateLinkingStatus(linkStatus);
      } else if (linkStatus && (currentLinkingStatus || isCurrentLinkDialogOpen)) {
        clearLinkSession();
        if (linkStatus.status === "connected") {
          setActiveAccountId(linkStatus.accountId);
          openAccountTab(linkStatus.accountId);
          setStatusMessage(`Account ${linkStatus.accountId} linked.`);
        }
      }

      if (showMessage) {
        setStatusMessage("Workspace synced.");
      }
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      if (showBusy) {
        setIsBusy(false);
      }
    }
  }

  function startLinkSession(account: WhatsAppAccount, baselineAccountIds: string[], linkingStartedAt: string) {
    linkingStatusRef.current = account;
    linkingBaselineAccountIdsRef.current = baselineAccountIds;
    linkingStartedAtRef.current = linkingStartedAt;
    isLinkDialogOpenRef.current = true;
    setLinkingStatus(account);
    setLinkingBaselineAccountIds(baselineAccountIds);
    setIsLinkDialogOpen(true);
  }

  function updateLinkingStatus(account: WhatsAppAccount) {
    const nextStatus = mergeLinkingStatus(linkingStatusRef.current, account);
    linkingStatusRef.current = nextStatus;
    setLinkingStatus(nextStatus);
  }

  function clearLinkSession() {
    linkingStatusRef.current = null;
    linkingBaselineAccountIdsRef.current = [];
    linkingStartedAtRef.current = null;
    isLinkDialogOpenRef.current = false;
    setLinkingStatus(null);
    setLinkingBaselineAccountIds([]);
    setIsLinkDialogOpen(false);
  }

  async function connectAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      const baselineAccountIds = accounts
        .filter((account) => !isPendingAccountId(account.accountId))
        .map((account) => account.accountId);
      const linkingStartedAt = new Date().toISOString();
      const account = await request<WhatsAppAccount>("/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (account.qrCode || account.status === "connecting") {
        startLinkSession(account, baselineAccountIds, linkingStartedAt);
      } else if (account.status === "connected") {
        clearLinkSession();
        setActiveAccountId(account.accountId);
        openAccountTab(account.accountId);
      }
      setStatusMessage(
        account.qrCode
          ? "QR ready."
          : "Link session started. Waiting for WhatsApp QR.",
      );
    });
  }

  async function closeLinkDialog() {
    const accountId = linkingStatusRef.current?.accountId;
    clearLinkSession();

    if (!accountId || !isPendingAccountId(accountId)) {
      return;
    }

    try {
      await request<WhatsAppAccount>(`/whatsapp/accounts/${encodeURIComponent(accountId)}/disconnect`, {
        method: "POST",
      });
    } catch (error) {
      setErrorMessage(normalizeError(error));
    }
  }

  async function disconnectAccount(accountId: string) {
    await runAction(async () => {
      const result = await request<WhatsAppAccount>(`/whatsapp/accounts/${encodeURIComponent(accountId)}/disconnect`, {
        method: "POST",
      });

      setAccounts((currentAccounts) => currentAccounts.filter((account) => account.accountId !== accountId));
      closeAccountTab(accountId);
      if (activeAccountId === accountId) {
        setActiveAccountId("");
        setActiveChatJid("");
      }
      setStatusMessage(
        result.lastError
          ? `Account ${accountId} disconnected locally. ${result.lastError}`
          : `Account ${accountId} disconnected.`,
      );
    });
  }

  async function retryDelivery(deliveryId: string) {
    await runAction(async () => {
      await request<DeliveryRecord>(`/deliveries/${encodeURIComponent(deliveryId)}/retry`, {
        method: "POST",
      });
      setStatusMessage("Delivery retry completed.");
    });
  }

  async function createNumberRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      const accountId = activeAccountId || accounts[0]?.accountId || "";
      if (!accountId) {
        throw new Error("Select an account before adding a rule.");
      }

      await request<NumberRule>("/number-rules", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          action: ruleAction,
          matchType: ruleMatchType,
          pattern: ruleMatchType === "all" ? "" : rulePattern,
          label: ruleLabel,
          enabled: true,
        }),
      });
      setRulePattern("");
      setRuleLabel("");
      setStatusMessage("Number rule saved.");
    });
  }

  async function updateNumberRule(rule: NumberRule, enabled: boolean) {
    await runAction(async () => {
      await request<NumberRule>(`/number-rules/${encodeURIComponent(rule.id)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setStatusMessage(enabled ? "Rule enabled." : "Rule disabled.");
    });
  }

  async function deleteNumberRule(ruleId: string) {
    await runAction(async () => {
      await request<void>(`/number-rules/${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
      });
      setStatusMessage("Number rule deleted.");
    });
  }

  async function saveAccountAlias(accountId: string, alias: string) {
    await runAction(async () => {
      const metadata = await request<{ accountId: string; alias?: string }>(`/whatsapp/accounts/${encodeURIComponent(accountId)}`, {
        method: "PATCH",
        body: JSON.stringify({ alias }),
      });
      setAccounts((currentAccounts) =>
        currentAccounts.map((account) => {
          if (account.accountId !== accountId) {
            return account;
          }

          const { alias: _alias, ...accountWithoutAlias } = account;
          return metadata.alias ? { ...accountWithoutAlias, alias: metadata.alias } : accountWithoutAlias;
        }),
      );
      setAccountAliasDrafts((drafts) => ({ ...drafts, [accountId]: metadata.alias ?? "" }));
      setStatusMessage(metadata.alias ? `Alias saved for ${accountId}.` : `Alias cleared for ${accountId}.`);
    });
  }

  async function saveBranding(nextBranding: BrandingSettings) {
    await runAction(async () => {
      const normalizedBranding = normalizeBranding(nextBranding);
      setBranding(normalizedBranding);
      localStorage.setItem(brandingStorageKeys.title, normalizedBranding.title);
      localStorage.setItem(brandingStorageKeys.iconSrc, normalizedBranding.iconSrc);
      await request<AuditLogRecord>("/audit-logs", {
        method: "POST",
        body: JSON.stringify({
          action: "ui-branding.update",
          resourceType: "ui-settings",
          resourceId: "branding",
          details: {
            title: normalizedBranding.title,
            customIcon: normalizedBranding.iconSrc !== defaultAppIcon,
          },
        }),
      });
      setStatusMessage("Branding updated.");
    });
  }

  async function resetBranding() {
    await runAction(async () => {
      const defaultBranding = { title: defaultAppTitle, iconSrc: defaultAppIcon };
      setBranding(defaultBranding);
      localStorage.removeItem(brandingStorageKeys.title);
      localStorage.removeItem(brandingStorageKeys.iconSrc);
      await request<AuditLogRecord>("/audit-logs", {
        method: "POST",
        body: JSON.stringify({
          action: "ui-branding.reset",
          resourceType: "ui-settings",
          resourceId: "branding",
        }),
      });
      setStatusMessage("Branding reset.");
    });
  }

  async function runAction(action: () => Promise<void>) {
    setIsBusy(true);
    setErrorMessage("");

    try {
      await action();
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setIsBusy(false);
    }
  }

  function openAccount(accountId: string) {
    openAccountTab(accountId);
    setActiveAccountId(accountId);
    setActiveChatJid("");
    setActiveNumberView("home");
    setIsNumberPanelOpen(false);
    setStatusMessage(`Opened ${accountId}.`);
  }

  function openAccountTab(accountId: string) {
    setOpenAccountTabs((currentTabs) => (currentTabs.includes(accountId) ? currentTabs : [...currentTabs, accountId]));
    setActiveTabId(accountId);
  }

  function openLogsTab() {
    setIsLogsTabOpen(true);
    setActiveTabId("logs");
  }

  function closeLogsTab() {
    setIsLogsTabOpen(false);
    if (activeTabId === "logs") {
      const nextTabId = getFallbackTabId(openAccountTabs, isSettingsTabOpen, false);
      setActiveTabId(nextTabId);
      setActiveAccountId(nextTabId && nextTabId !== "settings" ? nextTabId : activeAccountId);
    }
  }

  function openSettingsTab() {
    setIsSettingsTabOpen(true);
    setActiveTabId("settings");
  }

  function closeSettingsTab() {
    setIsSettingsTabOpen(false);
    if (activeTabId === "settings") {
      const nextTabId = getFallbackTabId(openAccountTabs, false, isLogsTabOpen);
      setActiveTabId(nextTabId);
      setActiveAccountId(nextTabId && nextTabId !== "logs" ? nextTabId : activeAccountId);
    }
  }

  function closeAccountTab(accountId: string) {
    setOpenAccountTabs((currentTabs) => currentTabs.filter((tabAccountId) => tabAccountId !== accountId));
    if (activeTabId === accountId) {
      const nextAccountId = openAccountTabs.find((tabAccountId) => tabAccountId !== accountId);
      setActiveTabId(nextAccountId ?? getFallbackTabId([], isSettingsTabOpen, isLogsTabOpen));
      setActiveAccountId(nextAccountId ?? "");
      setActiveChatJid("");
    }
  }

  const connectedAccounts = accounts.filter((account) => account.status === "connected").length;
  const filteredAccounts = accounts.filter((account) => accountMatchesSearch(account, accountSearch));
  const selectedTabAccountId = activeTabId === "logs" || activeTabId === "settings" ? activeAccountId : activeTabId;
  const tabAccounts = openAccountTabs
    .map((accountId) => accounts.find((account) => account.accountId === accountId))
    .filter((account): account is WhatsAppAccount => Boolean(account));
  const activeAccount = accounts.find((account) => account.accountId === activeAccountId) ?? null;
  const activeChats = buildChatSummaries(activeAccountId, mappings, deliveries);
  const activeAccountDeliveries = deliveries.filter((delivery) => delivery.accountId === activeAccountId);
  const activeAccountMappings = mappings.filter((mapping) => mapping.accountId === activeAccountId);
  const activeChat = activeChats.find((chat) => chat.chatJid === activeChatJid) ?? activeChats[0] ?? null;
  const activeChatMessages = activeChat
    ? buildChatMessages(deliveries.filter(
        (delivery) => delivery.accountId === activeAccountId && delivery.chatJid === activeChat.chatJid,
      ))
    : [];
  const pendingQrAccount =
    linkingStatus ??
    accounts.find((account) => account.accountId === activeAccountId && account.qrCode) ??
    accounts.find((account) => account.qrCode) ??
    null;
  const failedDeliveries = deliveries.filter((delivery) => delivery.status === "failed");
  const activeAccountFailedDeliveries = failedDeliveries.filter((delivery) => delivery.accountId === activeAccountId);
  const statusTone = errorMessage ? "error" : isBusy ? "syncing" : "live";
  const workspaceTabs = (
    <div ref={workspaceTabsRef} className="workspace-tabs" role="tablist" aria-label="Open workspaces">
      {tabAccounts.map((account) => (
        <div
          key={account.accountId}
          className={`workspace-tab${activeTabId === account.accountId ? " workspace-tab-active" : ""}`}
          title={getAccountStatusDetail(account)}
        >
          <button
            className="workspace-tab-main"
            onClick={() => {
              setActiveTabId(account.accountId);
              setActiveAccountId(account.accountId);
              setActiveChatJid("");
            }}
          >
            <span className={`status-dot status-dot-${account.status}`} />
            <AccountTabLabel account={account} />
          </button>
          <IconButton icon="mdi:close" label={`Close ${account.accountId}`} className="tab-close" variant="text" onClick={() => closeAccountTab(account.accountId)} />
        </div>
      ))}
      {isSettingsTabOpen ? (
        <div className={`workspace-tab${activeTabId === "settings" ? " workspace-tab-active" : ""}`}>
          <button
            className="workspace-tab-main"
            onClick={() => {
              setActiveTabId("settings");
            }}
            aria-label="Settings"
            title="Settings"
          >
            <Icon icon="mdi:cog-outline" aria-hidden="true" />
            <span>Settings</span>
          </button>
          <IconButton icon="mdi:close" label="Close settings" className="tab-close" variant="text" onClick={closeSettingsTab} />
        </div>
      ) : null}
      {isLogsTabOpen ? (
        <div className={`workspace-tab${activeTabId === "logs" ? " workspace-tab-active" : ""}`}>
          <button
            className="workspace-tab-main"
            onClick={() => {
              setActiveTabId("logs");
            }}
            aria-label="Logs"
            title="Logs"
          >
            <Icon icon="mdi:clipboard-text-clock-outline" aria-hidden="true" />
            <span>Logs</span>
          </button>
          <IconButton icon="mdi:close" label="Close logs" className="tab-close" variant="text" onClick={closeLogsTab} />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src={branding.iconSrc} alt="" aria-hidden="true" />
          <h1>{branding.title}</h1>
        </div>
        {workspaceTabs}
        <div className="topbar-actions">
          <StatusIndicator detail={errorMessage || statusMessage} tone={statusTone} />
          <IconButton icon="mdi:magnify" label="Find number" className="number-select-button" variant="secondary" onClick={() => setIsNumberPanelOpen(true)}>
            <span className="button-count">{connectedAccounts}/{accounts.length}</span>
          </IconButton>
          <details className="action-menu topbar-menu">
            <summary aria-label="App actions" title="App actions">
              <Icon icon="mdi:dots-vertical" aria-hidden="true" />
            </summary>
            <div className="action-menu-list">
              <form className="menu-action-form" onSubmit={connectAccount}>
                <button type="submit" disabled={isBusy}>
                  <Icon icon="mdi:link-plus" aria-hidden="true" />
                  <span>Link number</span>
                </button>
              </form>
              <button type="button" onClick={openSettingsTab}>
                <Icon icon="mdi:cog-outline" aria-hidden="true" />
                <span>Settings</span>
              </button>
              <button type="button" onClick={openLogsTab}>
                <Icon icon="mdi:clipboard-text-clock-outline" aria-hidden="true" />
                <span>Logs</span>
              </button>
            </div>
          </details>
        </div>
      </header>

      <main className="admin-layout">
        <section className="admin-panel">
          {activeTabId === "settings" && isSettingsTabOpen ? (
            <SettingsView
              branding={branding}
              defaultBranding={{ title: defaultAppTitle, iconSrc: defaultAppIcon }}
              isBusy={isBusy}
              onReset={() => void resetBranding()}
              onSave={(nextBranding) => void saveBranding(nextBranding)}
            />
          ) : null}

          {activeTabId === "logs" && isLogsTabOpen ? (
            <LogsView
              auditLogs={auditLogs}
            />
          ) : null}

          {activeTabId !== "logs" && activeTabId !== "settings" && activeTabId ? (
            <NumberWorkspace
              account={activeAccount}
              activeChat={activeChat}
              activeChatJid={activeChat?.chatJid ?? ""}
              activeChatMessages={activeChatMessages}
              activeView={activeNumberView}
              chats={activeChats}
              deliveries={activeAccountDeliveries}
              failedDeliveries={activeAccountFailedDeliveries}
              isBusy={isBusy}
              mappings={activeAccountMappings}
              matchType={ruleMatchType}
              aliasDraft={activeAccount ? accountAliasDrafts[activeAccount.accountId] ?? activeAccount.alias ?? "" : ""}
              onActionChange={setRuleAction}
              onAliasChange={(value) => {
                if (!activeAccount) {
                  return;
                }
                setAccountAliasDrafts((drafts) => ({ ...drafts, [activeAccount.accountId]: value }));
              }}
              onAliasSave={(alias) => {
                if (!activeAccount) {
                  return;
                }
                void saveAccountAlias(activeAccount.accountId, alias);
              }}
              onCreateRule={createNumberRule}
              onDeleteRule={(ruleId) => void deleteNumberRule(ruleId)}
              onDisconnect={(accountId) => void disconnectAccount(accountId)}
              onEnabledChange={(rule, enabled) => void updateNumberRule(rule, enabled)}
              onLabelChange={setRuleLabel}
              onMatchTypeChange={setRuleMatchType}
              onPatternChange={setRulePattern}
              onRetry={(deliveryId) => void retryDelivery(deliveryId)}
              onSelectChat={setActiveChatJid}
              onViewChange={setActiveNumberView}
              pattern={rulePattern}
              ruleAction={ruleAction}
              ruleLabel={ruleLabel}
              rules={numberRules.filter((rule) => rule.accountId === activeAccountId)}
            />
          ) : null}

          {!activeTabId ? (
            <EmptyState title="No workspace open" description="Open Settings, Logs, or choose a number from the header." />
          ) : null}
        </section>
      </main>

      {isNumberPanelOpen ? (
        <NumberChooserPanel
          accounts={filteredAccounts}
          allAccountCount={accounts.length}
          connectedAccounts={connectedAccounts}
          onClose={() => setIsNumberPanelOpen(false)}
          onOpenAccount={openAccount}
          search={accountSearch}
          selectedAccountId={selectedTabAccountId}
          setSearch={setAccountSearch}
        />
      ) : null}

      {isLinkDialogOpen ? (
        <LinkAccountDialog
          account={pendingQrAccount}
          isBusy={isBusy}
          onClose={() => void closeLinkDialog()}
        />
      ) : null}
    </div>
  );
}
