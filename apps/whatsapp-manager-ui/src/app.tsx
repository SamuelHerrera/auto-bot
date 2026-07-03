import { ButtonHTMLAttributes, FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { QRCodeSVG } from "qrcode.react";

type AccountStatus = "disconnected" | "connecting" | "connected";
type NumberSubview = "home" | "messages" | "rules" | "failures";
type NumberRuleAction = "allow" | "deny";
type NumberRuleMatchType = "all" | "exact" | "regex";
type RefreshScope = "accounts" | "activity" | "rules" | "logs";

interface WhatsAppAccount {
  accountId: string;
  alias?: string;
  status: AccountStatus;
  connectedAt?: string;
  disconnectedAt?: string;
  qrCode?: string;
  lastError?: string;
}

interface SessionMapping {
  sessionKey: string;
  accountId: string;
  chatJid: string;
  chatType: "direct" | "group";
  chatId: string;
  hermesSessionId: string;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRecord {
  id: string;
  accountId: string;
  chatJid: string;
  chatType: "direct" | "group";
  sessionKey: string;
  inboundMessageId: string;
  inboundText?: string;
  outboundText: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  failureStage?: "hermes" | "whatsapp";
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface NumberRule {
  id: string;
  accountId: string;
  action: NumberRuleAction;
  matchType: NumberRuleMatchType;
  pattern: string;
  label?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiError {
  error: string;
}

interface ChatSummary {
  accountId: string;
  chatJid: string;
  sessionKey?: string;
  hermesSessionId?: string;
  createdAt?: string;
  updatedAt: string;
  deliveryCount: number;
  failedCount: number;
  messageCount: number;
  lastText?: string;
}

interface ChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  status: DeliveryRecord["status"];
  timestamp: string;
  record: DeliveryRecord;
}

interface AuditLogRecord {
  id: string;
  action: string;
  actor: string;
  outcome: "success" | "failure";
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

interface BrandingSettings {
  title: string;
  iconSrc: string;
}

const brandingStorageKeys = {
  title: "whatsapp-manager-ui.branding-title",
  iconSrc: "whatsapp-manager-ui.branding-icon-src",
};

const workspaceStorageKeys = {
  activeAccountId: "whatsapp-manager-ui.workspace-active-account-id",
  activeTabId: "whatsapp-manager-ui.workspace-active-tab-id",
  isLogsTabOpen: "whatsapp-manager-ui.workspace-logs-open",
  isSettingsTabOpen: "whatsapp-manager-ui.workspace-settings-open",
  openAccountTabs: "whatsapp-manager-ui.workspace-account-tabs",
};

interface WorkspaceState {
  activeAccountId: string;
  activeTabId: string;
  isLogsTabOpen: boolean;
  isSettingsTabOpen: boolean;
  openAccountTabs: string[];
}

const defaultApiToken =
  import.meta.env.VITE_WHATSAPP_MANAGER_API_TOKEN?.trim() || "local-dev-token";
const defaultAppTitle =
  import.meta.env.VITE_WHATSAPP_MANAGER_UI_TITLE?.trim() || "Auto Bot WhatsApp Bridge";
const defaultAppIcon = "/auto-bot-mark.svg";

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

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("authorization", `Bearer ${defaultApiToken}`);

    const response = await fetch(path, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = (await safeJson<ApiError>(response)) ?? { error: response.statusText };
      throw new Error(body.error || `Request failed with ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const body = await response.text();
      throw new Error(`Expected JSON from ${path}, got ${contentType || "unknown content type"}: ${body.slice(0, 80)}`);
    }

    return response.json() as Promise<T>;
  }

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

function NumberWorkspace({
  account,
  aliasDraft,
  activeChat,
  activeChatJid,
  activeChatMessages,
  activeView,
  chats,
  deliveries,
  failedDeliveries,
  isBusy,
  mappings,
  matchType,
  onActionChange,
  onAliasChange,
  onAliasSave,
  onCreateRule,
  onDeleteRule,
  onDisconnect,
  onEnabledChange,
  onLabelChange,
  onMatchTypeChange,
  onPatternChange,
  onRetry,
  onSelectChat,
  onViewChange,
  pattern,
  ruleAction,
  ruleLabel,
  rules,
}: {
  account: WhatsAppAccount | null;
  aliasDraft: string;
  activeChat: ChatSummary | null;
  activeChatJid: string;
  activeChatMessages: ChatMessage[];
  activeView: NumberSubview;
  chats: ChatSummary[];
  deliveries: DeliveryRecord[];
  failedDeliveries: DeliveryRecord[];
  isBusy: boolean;
  mappings: SessionMapping[];
  matchType: NumberRuleMatchType;
  onActionChange: (value: NumberRuleAction) => void;
  onAliasChange: (value: string) => void;
  onAliasSave: (alias: string) => void;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteRule: (ruleId: string) => void;
  onDisconnect: (accountId: string) => void;
  onEnabledChange: (rule: NumberRule, enabled: boolean) => void;
  onLabelChange: (value: string) => void;
  onMatchTypeChange: (value: NumberRuleMatchType) => void;
  onPatternChange: (value: string) => void;
  onRetry: (deliveryId: string) => void;
  onSelectChat: (chatJid: string) => void;
  onViewChange: (view: NumberSubview) => void;
  pattern: string;
  ruleAction: NumberRuleAction;
  ruleLabel: string;
  rules: NumberRule[];
}) {
  const [isAliasDialogOpen, setIsAliasDialogOpen] = useState(false);

  if (!account) {
    return <EmptyState title="Number unavailable" description="Select another number from the left rail." />;
  }

  return (
    <>
      <div className="number-header">
        <div className="subnav" aria-label="Number sections">
          <TabButton active={activeView === "home"} icon="mdi:view-dashboard-outline" onClick={() => onViewChange("home")}>
            Home
          </TabButton>
          <TabButton active={activeView === "messages"} count={chats.length} icon="mdi:message-text-outline" onClick={() => onViewChange("messages")}>
            Messages
          </TabButton>
          <TabButton active={activeView === "rules"} count={rules.length} icon="mdi:shield-check-outline" onClick={() => onViewChange("rules")}>
            Rules
          </TabButton>
          <TabButton active={activeView === "failures"} count={failedDeliveries.length} icon="mdi:alert-circle-outline" onClick={() => onViewChange("failures")}>
            Failures
          </TabButton>
        </div>
        <div className="number-header-actions">
          <span className={`badge badge-${account.status}`} title={getAccountStatusDetail(account)}>
            {account.status}
          </span>
          <details className="action-menu">
            <summary aria-label="Account actions" title="Account actions">
              <Icon icon="mdi:dots-vertical" aria-hidden="true" />
            </summary>
            <div className="action-menu-list">
              <button
                type="button"
                onClick={() => setIsAliasDialogOpen(true)}
                disabled={isPendingAccountId(account.accountId)}
              >
                <Icon icon="mdi:pencil-outline" aria-hidden="true" />
                <span>Rename</span>
              </button>
              <button
                type="button"
                className="action-menu-danger"
                onClick={() => onDisconnect(account.accountId)}
                disabled={isBusy || account.status === "disconnected"}
              >
                <Icon icon="mdi:link-off" aria-hidden="true" />
                <span>Disconnect</span>
              </button>
            </div>
          </details>
        </div>
      </div>

      {activeView === "home" ? (
        <HomeView
          account={account}
          chats={chats}
          deliveries={deliveries}
          failedDeliveries={failedDeliveries}
          mappings={mappings}
          rules={rules}
        />
      ) : null}

      {activeView === "messages" ? (
        <MessagesView
          activeAccountId={account.accountId}
          activeChat={activeChat}
          activeChatJid={activeChatJid}
          activeChatMessages={activeChatMessages}
          chats={chats}
          onSelectChat={onSelectChat}
        />
      ) : null}

      {activeView === "rules" ? (
        <RulesView
          activeAccountId={account.accountId}
          isBusy={isBusy}
          matchType={matchType}
          onActionChange={onActionChange}
          onCreate={onCreateRule}
          onDelete={onDeleteRule}
          onEnabledChange={onEnabledChange}
          onLabelChange={onLabelChange}
          onMatchTypeChange={onMatchTypeChange}
          onPatternChange={onPatternChange}
          pattern={pattern}
          ruleAction={ruleAction}
          ruleLabel={ruleLabel}
          rules={rules}
        />
      ) : null}

      {activeView === "failures" ? (
        <FailuresView failedDeliveries={failedDeliveries} isBusy={isBusy} onRetry={onRetry} />
      ) : null}

      {isAliasDialogOpen ? (
        <AliasDialog
          account={account}
          aliasDraft={aliasDraft}
          isBusy={isBusy}
          onAliasChange={onAliasChange}
          onClose={() => setIsAliasDialogOpen(false)}
          onSave={(alias) => {
            onAliasSave(alias);
            setIsAliasDialogOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function AccountTabLabel({ account }: { account: WhatsAppAccount }) {
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

function AliasDialog({
  account,
  aliasDraft,
  isBusy,
  onAliasChange,
  onClose,
  onSave,
}: {
  account: WhatsAppAccount;
  aliasDraft: string;
  isBusy: boolean;
  onAliasChange: (value: string) => void;
  onClose: () => void;
  onSave: (alias: string) => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="alias-dialog" role="dialog" aria-modal="true" aria-labelledby="alias-dialog-title">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave(aliasDraft);
          }}
        >
          <div className="dialog-header">
            <div>
              <span className="panel-kicker">Alias</span>
              <h3 id="alias-dialog-title">Edit display name</h3>
              <p className="dialog-subtitle">{account.accountId}</p>
            </div>
            <IconButton icon="mdi:close" label="Close alias dialog" variant="text" onClick={onClose} type="button" />
          </div>

          <div className="dialog-body alias-dialog-body">
            <label className="field">
              <span>Alias</span>
              <input
                autoFocus
                value={aliasDraft}
                onChange={(event) => onAliasChange(event.target.value)}
                placeholder="Optional display name"
                maxLength={80}
              />
            </label>
            <div className="dialog-actions">
              <IconButton icon="mdi:close" label="Cancel" type="button" variant="secondary" onClick={onClose} />
              <IconButton icon="mdi:content-save-outline" label="Save alias" type="submit" disabled={isBusy} />
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}

function NumberChooserPanel({
  accounts,
  allAccountCount,
  connectedAccounts,
  onClose,
  onOpenAccount,
  search,
  selectedAccountId,
  setSearch,
}: {
  accounts: WhatsAppAccount[];
  allAccountCount: number;
  connectedAccounts: number;
  onClose: () => void;
  onOpenAccount: (accountId: string) => void;
  search: string;
  selectedAccountId: string;
  setSearch: (value: string) => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="number-panel" role="dialog" aria-modal="true" aria-labelledby="number-panel-title">
        <div className="dialog-header">
          <div>
            <span className="panel-kicker">Numbers</span>
            <h3 id="number-panel-title">Open a managed number</h3>
            <p className="dialog-subtitle">{connectedAccounts}/{allAccountCount} online</p>
          </div>
          <IconButton icon="mdi:close" label="Close numbers panel" variant="text" onClick={onClose} />
        </div>

        <div className="number-panel-body">
          <label className="field number-panel-search">
            <span className="visually-hidden">Search</span>
            <Icon icon="mdi:magnify" aria-hidden="true" />
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find number"
            />
          </label>

          <div className="number-choice-list">
            {accounts.length === 0 ? (
              <EmptyState
                title={allAccountCount === 0 ? "No numbers" : "No matches"}
                description={allAccountCount === 0 ? "Use Link to pair a WhatsApp number." : "Adjust the search."}
              />
            ) : (
              accounts.map((account) => (
                <button
                  key={account.accountId}
                  className={`number-choice${account.accountId === selectedAccountId ? " number-choice-active" : ""}`}
                  onClick={() => onOpenAccount(account.accountId)}
                  title={getAccountStatusDetail(account)}
                >
                  <span className={`status-dot status-dot-${account.status}`} />
                  <span>
                    <strong>{getAccountPrimaryLabel(account)}</strong>
                    <small>{getAccountDetailLine(account)}</small>
                  </span>
                  <span className={`badge badge-${account.status}`}>{account.status}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function LinkAccountDialog({
  account,
  isBusy,
  onClose,
}: {
  account: WhatsAppAccount | null;
  isBusy: boolean;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="link-dialog" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title">
        <div className="dialog-header">
          <div>
            <span className="panel-kicker">Link account</span>
            <h3 id="link-dialog-title">{account?.qrCode ? "Scan QR code" : "Preparing link"}</h3>
            {account && !isPendingAccountId(account.accountId) ? (
              <p className="dialog-subtitle">{account.accountId}</p>
            ) : null}
          </div>
          <IconButton icon="mdi:close" label="Close link dialog" variant="text" onClick={onClose} />
        </div>

        <div className="dialog-body">
          {account?.qrCode ? (
            <div className="dialog-qr-only">
              <div className="qr-panel qr-panel-large" aria-label="WhatsApp pairing QR">
                <QRCodeSVG value={account.qrCode} size={264} marginSize={2} />
              </div>
              <p>Scan from WhatsApp linked devices.</p>
            </div>
          ) : (
            <div className="dialog-qr-only">
              <EmptyState
                title={isBusy ? "Requesting QR" : "Waiting for QR"}
                description="The pairing code will appear here when WhatsApp returns it."
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function HomeView({
  account,
  chats,
  deliveries,
  failedDeliveries,
  mappings,
  rules,
}: {
  account: WhatsAppAccount;
  chats: ChatSummary[];
  deliveries: DeliveryRecord[];
  failedDeliveries: DeliveryRecord[];
  mappings: SessionMapping[];
  rules: NumberRule[];
}) {
  const messageCount = buildChatMessages(deliveries.filter((delivery) => delivery.chatType === "direct")).length;
  const sentDeliveries = deliveries.filter((delivery) => delivery.status === "sent").length;
  const pendingDeliveries = deliveries.filter((delivery) => delivery.status === "pending").length;
  const latestChat = chats[0] ?? null;
  const enabledRules = rules.filter((rule) => rule.enabled).length;

  return (
    <>
      <div className="summary-strip summary-strip-home">
        <Metric label="Chats" value={String(chats.length)} />
        <Metric label="Messages" value={String(messageCount)} />
        {failedDeliveries.length ? (
          <Metric label="Failures" value={String(failedDeliveries.length)} tone="danger" />
        ) : (
          <Metric label="Failures" value="0" />
        )}
        <Metric label="Routes" value={String(mappings.length)} />
      </div>

      <div className="home-grid">
        <section className="home-section">
          <div className="section-heading section-heading-compact">
            <div>
              <span className="panel-kicker">Connection</span>
              <h3>{account.status}</h3>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Number</dt>
              <dd>{account.accountId}</dd>
            </div>
            <div>
              <dt>Alias</dt>
              <dd>{account.alias?.trim() || "Not set"}</dd>
            </div>
            <div>
              <dt>Activity</dt>
              <dd>{getAccountActivity(account)}</dd>
            </div>
            <div>
              <dt>Status detail</dt>
              <dd>{getAccountStatusDetail(account)}</dd>
            </div>
          </dl>
        </section>

        <section className="home-section">
          <div className="section-heading section-heading-compact">
            <div>
              <span className="panel-kicker">Messages</span>
              <h3>Delivery overview</h3>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Sent</dt>
              <dd>{sentDeliveries}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{pendingDeliveries}</dd>
            </div>
            <div>
              <dt>Failed</dt>
              <dd>{failedDeliveries.length}</dd>
            </div>
            <div>
              <dt>Latest chat</dt>
              <dd>{latestChat ? `${latestChat.chatJid} · ${formatTimestamp(latestChat.updatedAt)}` : "No chat activity"}</dd>
            </div>
          </dl>
        </section>

        <section className="home-section">
          <div className="section-heading section-heading-compact">
            <div>
              <span className="panel-kicker">Controls</span>
              <h3>Rules</h3>
            </div>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Total rules</dt>
              <dd>{rules.length}</dd>
            </div>
            <div>
              <dt>Enabled</dt>
              <dd>{enabledRules}</dd>
            </div>
            <div>
              <dt>Disabled</dt>
              <dd>{rules.length - enabledRules}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}

function MessagesView({
  activeAccountId,
  activeChat,
  activeChatJid,
  activeChatMessages,
  chats,
  onSelectChat,
}: {
  activeAccountId: string;
  activeChat: ChatSummary | null;
  activeChatJid: string;
  activeChatMessages: ChatMessage[];
  chats: ChatSummary[];
  onSelectChat: (chatJid: string) => void;
}) {
  return (
    <div className="messages-view">
      <div className="chat-workspace">
        <section className="chat-list-pane">
          <div className="chat-list">
            {!activeAccountId ? (
              <EmptyState title="Select an account" description="Chats are scoped to one managed WhatsApp number." />
            ) : chats.length === 0 ? (
              <EmptyState title="No chats yet" description="Chats appear after inbound WhatsApp activity is routed." />
            ) : (
              chats.map((chat) => (
                <button
                  key={chat.chatJid}
                  className={`chat-row${chat.chatJid === activeChatJid ? " chat-row-active" : ""}`}
                  onClick={() => onSelectChat(chat.chatJid)}
                >
                  <span>
                    <strong>{chat.chatJid}</strong>
                    <small>{chat.lastText ?? chat.hermesSessionId ?? "No message preview"}</small>
                  </span>
                  <span className="chat-meta">
                    <span>{formatTimestamp(chat.updatedAt)}</span>
                    <span>{formatCountLabel(chat.messageCount, "message")}</span>
                    {chat.failedCount ? <span>{chat.failedCount} failed</span> : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="chat-detail-pane">
          {activeChat ? (
            <div className="chat-detail-content">
              <dl className="detail-list">
                <div>
                  <dt>Hermes session</dt>
                  <dd>{activeChat.hermesSessionId ?? "Not created"}</dd>
                </div>
                <div>
                  <dt>Session key</dt>
                  <dd>{activeChat.sessionKey ?? "Not available"}</dd>
                </div>
                <div>
                  <dt>Last activity</dt>
                  <dd>{formatTimestamp(activeChat.updatedAt)}</dd>
                </div>
              </dl>

              <div className="message-list">
                {activeChatMessages.length === 0 ? (
                  <EmptyState
                    title="No stored messages"
                    description="Only routed delivery records are available in this version."
                  />
                ) : (
                  activeChatMessages.map((message) => (
                    <article key={message.id} className={`message-row message-row-${message.direction}`}>
                      <div>
                        <strong>{message.direction === "inbound" ? "WhatsApp" : "Hermes"}</strong>
                        <time>{formatTimestamp(message.timestamp)}</time>
                      </div>
                      <p>{message.text}</p>
                      <span className={`delivery-status delivery-status-${message.status}`}>{message.status}</span>
                      {message.record.error ? <p className="error-text">{message.record.error}</p> : null}
                    </article>
                  ))
                )}
              </div>
            </div>
          ) : (
            <EmptyState title="Open a chat" description="Select a direct chat to see stored messages and metadata." />
          )}
        </section>
      </div>
    </div>
  );
}

function RulesView({
  activeAccountId,
  isBusy,
  matchType,
  onActionChange,
  onCreate,
  onDelete,
  onEnabledChange,
  onLabelChange,
  onMatchTypeChange,
  onPatternChange,
  pattern,
  ruleAction,
  ruleLabel,
  rules,
}: {
  activeAccountId: string;
  isBusy: boolean;
  matchType: NumberRuleMatchType;
  onActionChange: (value: NumberRuleAction) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (ruleId: string) => void;
  onEnabledChange: (rule: NumberRule, enabled: boolean) => void;
  onLabelChange: (value: string) => void;
  onMatchTypeChange: (value: NumberRuleMatchType) => void;
  onPatternChange: (value: string) => void;
  pattern: string;
  ruleAction: NumberRuleAction;
  ruleLabel: string;
  rules: NumberRule[];
}) {
  return (
    <>
      <form className="rule-form" onSubmit={onCreate}>
        <label className="compact-field">
          <span>Action</span>
          <select value={ruleAction} onChange={(event) => onActionChange(event.target.value as NumberRuleAction)}>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </label>
        <label className="compact-field">
          <span>Match</span>
          <select value={matchType} onChange={(event) => onMatchTypeChange(event.target.value as NumberRuleMatchType)}>
            <option value="exact">Full match</option>
            <option value="regex">Regex</option>
            <option value="all">All numbers</option>
          </select>
        </label>
        <label className="compact-field">
          <span>Pattern</span>
          <input
            value={matchType === "all" ? "" : pattern}
            onChange={(event) => onPatternChange(event.target.value)}
            placeholder={matchType === "regex" ? "^1555" : "15551234567"}
            disabled={matchType === "all"}
          />
        </label>
        <label className="compact-field">
          <span>Label</span>
          <input value={ruleLabel} onChange={(event) => onLabelChange(event.target.value)} placeholder="Ops allowlist" />
        </label>
        <IconButton
          icon="mdi:plus"
          label="Add rule"
          type="submit"
          disabled={isBusy || !activeAccountId || (matchType !== "all" && !pattern.trim())}
        />
      </form>

      <div className="rule-list">
        {!activeAccountId ? (
          <EmptyState title="Select an account" description="Number rules are stored per WhatsApp account." />
        ) : rules.length === 0 ? (
          <EmptyState title="No number rules" description="Add allow or deny rules for this account." />
        ) : (
          rules.map((rule) => (
            <article key={rule.id} className="rule-row">
              <div className="rule-row-main">
                <span className={`badge badge-rule-${rule.action}`}>{rule.action}</span>
                <span>
                  <strong>{rule.label || getRuleDisplayValue(rule)}</strong>
                  <small>{rule.label ? getRuleDisplayValue(rule) : formatTimestamp(rule.updatedAt)}</small>
                </span>
              </div>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => onEnabledChange(rule, event.target.checked)}
                  disabled={isBusy}
                />
                <span>Enabled</span>
              </label>
              <IconButton icon="mdi:trash-can-outline" label="Delete rule" variant="danger" onClick={() => onDelete(rule.id)} disabled={isBusy} />
            </article>
          ))
        )}
      </div>
    </>
  );
}

function FailuresView({
  failedDeliveries,
  isBusy,
  onRetry,
}: {
  failedDeliveries: DeliveryRecord[];
  isBusy: boolean;
  onRetry: (deliveryId: string) => void;
}) {
  return (
    <>
      <div className="compact-list">
        {failedDeliveries.length === 0 ? (
          <EmptyState title="No failures" description="Failed Hermes or WhatsApp deliveries will appear here." />
        ) : (
          failedDeliveries.map((delivery) => (
            <article key={delivery.id} className="retry-row">
              <div className="retry-row-header">
                <strong>{delivery.chatJid}</strong>
                <IconButton icon="mdi:refresh" label="Retry delivery" onClick={() => onRetry(delivery.id)} disabled={isBusy} />
              </div>
              <p>{delivery.error ?? "Delivery failed."}</p>
              <span className="mono">{delivery.failureStage ?? "unknown"} / {delivery.id}</span>
            </article>
          ))
        )}
      </div>
    </>
  );
}

function SettingsView({
  branding,
  defaultBranding,
  isBusy,
  onReset,
  onSave,
}: {
  branding: BrandingSettings;
  defaultBranding: BrandingSettings;
  isBusy: boolean;
  onReset: () => void;
  onSave: (branding: BrandingSettings) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(branding.title);
  const [draftIconSrc, setDraftIconSrc] = useState(branding.iconSrc);

  useEffect(() => {
    setDraftTitle(branding.title);
    setDraftIconSrc(branding.iconSrc);
  }, [branding]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      title: draftTitle,
      iconSrc: draftIconSrc,
    });
  }

  function uploadIcon(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDraftIconSrc(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Settings</span>
          <h2>Branding</h2>
        </div>
      </div>

      <form className="branding-form" onSubmit={submit}>
        <div className="branding-preview">
          <img src={draftIconSrc || defaultBranding.iconSrc} alt="" aria-hidden="true" />
          <strong>{draftTitle.trim() || defaultBranding.title}</strong>
        </div>

        <label className="field">
          <span>App title</span>
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder={defaultBranding.title}
          />
        </label>

        <label className="field">
          <span>Icon URL</span>
          <input
            value={draftIconSrc}
            onChange={(event) => setDraftIconSrc(event.target.value)}
            placeholder={defaultBranding.iconSrc}
          />
        </label>

        <label className="field">
          <span>Upload icon</span>
          <input
            accept="image/*"
            type="file"
            onChange={(event) => uploadIcon(event.target.files?.[0])}
          />
        </label>

        <div className="settings-actions">
          <IconButton icon="mdi:content-save-outline" label="Save branding" type="submit" disabled={isBusy || !draftTitle.trim()} />
          <IconButton icon="mdi:restore" label="Reset branding" type="button" variant="secondary" onClick={onReset} disabled={isBusy} />
        </div>
      </form>
    </>
  );
}

function LogsView({
  auditLogs,
}: {
  auditLogs: AuditLogRecord[];
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Audit</span>
          <h2>App logs</h2>
        </div>
      </div>

      <div className="audit-log-list">
        {auditLogs.length === 0 ? (
          <EmptyState title="No audit events" description="Changes will appear here after actions are recorded." />
        ) : (
          auditLogs.map((entry) => (
            <article key={entry.id} className="audit-log-row">
              <div className="audit-log-main">
                <span className={`badge badge-audit-${entry.outcome}`}>{entry.outcome}</span>
                <span>
                  <strong>{entry.action}</strong>
                  <small>{entry.resourceType ? `${entry.resourceType} / ${entry.resourceId ?? "unknown"}` : entry.actor}</small>
                </span>
              </div>
              <time>{formatTimestamp(entry.createdAt)}</time>
              {entry.details ? <pre>{JSON.stringify(entry.details, null, 2)}</pre> : null}
            </article>
          ))
        )}
      </div>
    </>
  );
}

function TabButton({
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

function IconButton({
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

function StatusIndicator({ detail, tone }: { detail: string; tone: "live" | "syncing" | "error" }) {
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

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className={`metric-row${tone ? ` metric-row-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildChatSummaries(
  accountId: string,
  mappings: SessionMapping[],
  deliveries: DeliveryRecord[],
): ChatSummary[] {
  if (!accountId) {
    return [];
  }

  const chats = new Map<string, ChatSummary>();

  for (const mapping of mappings.filter((item) => item.accountId === accountId && item.chatType === "direct")) {
    chats.set(mapping.chatJid, {
      accountId: mapping.accountId,
      chatJid: mapping.chatJid,
      sessionKey: mapping.sessionKey,
      hermesSessionId: mapping.hermesSessionId,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
      deliveryCount: 0,
      failedCount: 0,
      messageCount: 0,
    });
  }

  for (const delivery of deliveries.filter((item) => item.accountId === accountId && item.chatType === "direct")) {
    const current = chats.get(delivery.chatJid);
    const updatedAt = maxTimestamp(current?.updatedAt, delivery.updatedAt);
    const lastText = delivery.outboundText || delivery.inboundText || current?.lastText;
    chats.set(delivery.chatJid, {
      accountId: delivery.accountId,
      chatJid: delivery.chatJid,
      sessionKey: current?.sessionKey ?? delivery.sessionKey,
      createdAt: current?.createdAt ?? delivery.createdAt,
      updatedAt,
      deliveryCount: (current?.deliveryCount ?? 0) + 1,
      failedCount: (current?.failedCount ?? 0) + (delivery.status === "failed" ? 1 : 0),
      messageCount: (current?.messageCount ?? 0) + countDeliveryMessages(delivery),
      ...(current?.hermesSessionId ? { hermesSessionId: current.hermesSessionId } : {}),
      ...(lastText ? { lastText } : {}),
    });
  }

  return [...chats.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function countDeliveryMessages(delivery: DeliveryRecord): number {
  return Number(Boolean(delivery.inboundText?.trim())) + Number(Boolean(delivery.outboundText.trim()));
}

function buildChatMessages(deliveries: DeliveryRecord[]): ChatMessage[] {
  return deliveries
    .flatMap((delivery): ChatMessage[] => {
      const messages: ChatMessage[] = [];
      if (delivery.inboundText?.trim()) {
        messages.push({
          id: `${delivery.id}:inbound`,
          direction: "inbound",
          text: delivery.inboundText,
          status: delivery.status,
          timestamp: delivery.createdAt,
          record: delivery,
        });
      }
      if (delivery.outboundText.trim()) {
        messages.push({
          id: `${delivery.id}:outbound`,
          direction: "outbound",
          text: delivery.outboundText,
          status: delivery.status,
          timestamp: delivery.updatedAt,
          record: delivery,
        });
      }
      return messages;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function formatCountLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function getRuleDisplayValue(rule: NumberRule) {
  if (rule.matchType === "all") {
    return "All numbers";
  }

  return `${rule.matchType === "exact" ? "Full match" : "Regex"} ${rule.pattern}`;
}

function buildEventUrl() {
  const url = new URL("/events", window.location.origin);
  url.searchParams.set("token", defaultApiToken);
  return `${url.pathname}${url.search}`;
}

function getInitialBranding(): BrandingSettings {
  return normalizeBranding({
    title: localStorage.getItem(brandingStorageKeys.title) || defaultAppTitle,
    iconSrc: localStorage.getItem(brandingStorageKeys.iconSrc) || defaultAppIcon,
  });
}

function getInitialWorkspaceState(): WorkspaceState {
  const isSettingsTabOpen = localStorage.getItem(workspaceStorageKeys.isSettingsTabOpen) === "true";
  const isLogsTabOpen = localStorage.getItem(workspaceStorageKeys.isLogsTabOpen) === "true";
  const openAccountTabs = parseStoredStringArray(localStorage.getItem(workspaceStorageKeys.openAccountTabs));
  const storedActiveTabId = localStorage.getItem(workspaceStorageKeys.activeTabId) ?? "";
  const storedActiveAccountId = localStorage.getItem(workspaceStorageKeys.activeAccountId) ?? "";
  const canRestoreActiveTab =
    !storedActiveTabId ||
    openAccountTabs.includes(storedActiveTabId) ||
    (storedActiveTabId === "settings" && isSettingsTabOpen) ||
    (storedActiveTabId === "logs" && isLogsTabOpen);

  const activeTabId = canRestoreActiveTab
    ? storedActiveTabId
    : getFallbackTabId(openAccountTabs, isSettingsTabOpen, isLogsTabOpen);

  return {
    activeAccountId: openAccountTabs.includes(storedActiveAccountId) ? storedActiveAccountId : openAccountTabs[0] ?? "",
    activeTabId,
    isLogsTabOpen,
    isSettingsTabOpen,
    openAccountTabs,
  };
}

function persistWorkspaceState(workspace: WorkspaceState) {
  localStorage.setItem(workspaceStorageKeys.activeAccountId, workspace.activeAccountId);
  localStorage.setItem(workspaceStorageKeys.activeTabId, workspace.activeTabId);
  localStorage.setItem(workspaceStorageKeys.isLogsTabOpen, String(workspace.isLogsTabOpen));
  localStorage.setItem(workspaceStorageKeys.isSettingsTabOpen, String(workspace.isSettingsTabOpen));
  localStorage.setItem(workspaceStorageKeys.openAccountTabs, JSON.stringify(workspace.openAccountTabs));
}

function parseStoredStringArray(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function getFallbackTabId(openAccountTabs: string[], isSettingsTabOpen: boolean, isLogsTabOpen: boolean) {
  return openAccountTabs[0] ?? (isSettingsTabOpen ? "settings" : isLogsTabOpen ? "logs" : "");
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function normalizeBranding(branding: BrandingSettings): BrandingSettings {
  return {
    title: branding.title.trim() || defaultAppTitle,
    iconSrc: branding.iconSrc.trim() || defaultAppIcon,
  };
}

function setFavicon(iconSrc: string) {
  const existingIcon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  const icon = existingIcon ?? document.createElement("link");
  icon.rel = "icon";
  icon.type = iconSrc.startsWith("data:image/svg") || iconSrc.endsWith(".svg") ? "image/svg+xml" : "image/png";
  icon.href = iconSrc;
  if (!existingIcon) {
    document.head.appendChild(icon);
  }
}

function maxTimestamp(left: string | undefined, right: string) {
  if (!left) {
    return right;
  }

  return Date.parse(left) > Date.parse(right) ? left : right;
}

function findCompletedLinkedAccount(
  accounts: WhatsAppAccount[],
  linkStatus: WhatsAppAccount | null,
  linkingStatus: WhatsAppAccount | null,
  baselineAccountIds: string[],
  linkingStartedAt: string | null,
) {
  if (
    linkStatus?.status === "connected" &&
    !isPendingAccountId(linkStatus.accountId) &&
    isLinkedAccountFromCurrentSession(linkStatus, baselineAccountIds, linkingStartedAt)
  ) {
    return linkStatus;
  }

  if (!linkingStatus?.qrCode) {
    return null;
  }

  return accounts.find(
    (account) =>
      account.status === "connected" &&
      !isPendingAccountId(account.accountId) &&
      isLinkedAccountFromCurrentSession(account, baselineAccountIds, linkingStartedAt),
  ) ?? null;
}

function isLinkedAccountFromCurrentSession(
  account: WhatsAppAccount,
  baselineAccountIds: string[],
  linkingStartedAt: string | null,
) {
  if (!baselineAccountIds.includes(account.accountId)) {
    return true;
  }

  if (!account.connectedAt || !linkingStartedAt) {
    return false;
  }

  return Date.parse(account.connectedAt) >= Date.parse(linkingStartedAt);
}

function mergeLinkingStatus(currentStatus: WhatsAppAccount | null, nextStatus: WhatsAppAccount) {
  if (
    currentStatus?.qrCode &&
    !nextStatus.qrCode &&
    currentStatus.accountId === nextStatus.accountId &&
    nextStatus.status === "connecting"
  ) {
    return {
      ...nextStatus,
      qrCode: currentStatus.qrCode,
    };
  }

  return nextStatus;
}

function getAccountTabLabel(account: WhatsAppAccount) {
  if (isPendingAccountId(account.accountId)) {
    return "Linking number";
  }

  return account.alias?.trim() || account.accountId;
}

function getAccountPrimaryLabel(account: WhatsAppAccount) {
  return getAccountTabLabel(account);
}

function getAccountDetailLine(account: WhatsAppAccount) {
  const activity = getAccountActivity(account);
  if (!account.alias?.trim() || isPendingAccountId(account.accountId)) {
    return activity;
  }

  return `${account.accountId} · ${activity}`;
}

function accountMatchesSearch(account: WhatsAppAccount, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [account.accountId, account.alias ?? ""].some((value) => value.toLowerCase().includes(query));
}

function isPendingAccountId(accountId: string) {
  return accountId.startsWith("pending-");
}

function getAccountActivity(account: WhatsAppAccount) {
  if (isPendingAccountId(account.accountId)) {
    return account.qrCode ? "Waiting for QR scan." : "Opening pairing session.";
  }

  if (account.connectedAt) {
    return `Connected ${formatTimestamp(account.connectedAt)}`;
  }

  if (account.disconnectedAt) {
    return `Disconnected ${formatTimestamp(account.disconnectedAt)}`;
  }

  return "No active WhatsApp session yet.";
}

function getAccountStatusDetail(account: WhatsAppAccount) {
  if (account.status === "connected") {
    return account.connectedAt ? `Connected at ${formatTimestamp(account.connectedAt)}` : "Connected to WhatsApp.";
  }

  if (account.status === "connecting") {
    return account.qrCode ? "Waiting for the WhatsApp QR scan." : "Opening a WhatsApp pairing session.";
  }

  if (account.lastError) {
    return account.lastError;
  }

  return account.disconnectedAt
    ? `Disconnected at ${formatTimestamp(account.disconnectedAt)}`
    : "Disconnected from WhatsApp.";
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
