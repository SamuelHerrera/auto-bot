import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type AccountStatus = "disconnected" | "connecting" | "connected";
type NumberSubview = "messages" | "rules" | "failures";
type NumberRuleAction = "allow" | "deny";
type NumberRuleMatchType = "all" | "exact" | "regex";

interface WhatsAppAccount {
  accountId: string;
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

const storageKeys = {
  apiToken: "whatsapp-manager-ui.api-token",
  apiUrl: "whatsapp-manager-ui.api-url-override",
};

const explicitApiUrl = import.meta.env.VITE_WHATSAPP_MANAGER_API_URL?.trim();
const defaultApiToken =
  import.meta.env.VITE_WHATSAPP_MANAGER_API_TOKEN?.trim() || "local-dev-token";
const appTitle =
  import.meta.env.VITE_WHATSAPP_MANAGER_UI_TITLE?.trim() || "WhatsApp Account Console";

export function App() {
  const [apiUrl, setApiUrl] = useState(getInitialApiUrl);
  const [apiToken, setApiToken] = useState(() => localStorage.getItem(storageKeys.apiToken) || defaultApiToken);
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [mappings, setMappings] = useState<SessionMapping[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [numberRules, setNumberRules] = useState<NumberRule[]>([]);
  const [activeNumberView, setActiveNumberView] = useState<NumberSubview>("messages");
  const [accountSearch, setAccountSearch] = useState("");
  const [openAccountTabs, setOpenAccountTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState("settings");
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeChatJid, setActiveChatJid] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkingStatus, setLinkingStatus] = useState<WhatsAppAccount | null>(null);
  const [statusMessage, setStatusMessage] = useState("Live");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [ruleAction, setRuleAction] = useState<NumberRuleAction>("allow");
  const [ruleMatchType, setRuleMatchType] = useState<NumberRuleMatchType>("exact");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleLabel, setRuleLabel] = useState("");

  useEffect(() => {
    if (apiUrl.trim()) {
      localStorage.setItem(storageKeys.apiUrl, apiUrl);
      return;
    }

    localStorage.removeItem(storageKeys.apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    localStorage.setItem(storageKeys.apiToken, apiToken);
  }, [apiToken]);

  useEffect(() => {
    if (apiToken.trim()) {
      void refreshData(false);
    }
  }, []);

  useEffect(() => {
    if (!apiToken.trim()) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshData(false, false);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [apiToken, apiUrl]);

  useEffect(() => {
    const firstAccount = accounts[0];
    if (!activeAccountId && firstAccount) {
      setActiveAccountId(firstAccount.accountId);
    }
  }, [accounts, activeAccountId]);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    headers.set("authorization", `Bearer ${apiToken}`);

    const response = await fetch(`${apiUrl.trim()}${path}`, {
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

  async function refreshData(showMessage = true, showBusy = true) {
    if (!apiToken.trim()) {
      setErrorMessage("An API token is required before the UI can manage accounts.");
      return;
    }

    if (showBusy) {
      setIsBusy(true);
    }
    setErrorMessage("");

    try {
      const [accountResponse, mappingResponse, deliveryResponse, ruleResponse, linkStatus] = await Promise.all([
        request<{ items: WhatsAppAccount[] }>("/whatsapp/accounts"),
        request<{ items: SessionMapping[] }>("/sessions"),
        request<{ items: DeliveryRecord[] }>("/deliveries"),
        request<{ items: NumberRule[] }>("/number-rules"),
        request<WhatsAppAccount>("/whatsapp/status"),
      ]);

      setAccounts(accountResponse.items);
      setMappings(mappingResponse.items.filter((mapping) => mapping.chatType === "direct"));
      setDeliveries(deliveryResponse.items.filter((delivery) => delivery.chatType === "direct"));
      setNumberRules(ruleResponse.items);
      if (linkStatus.qrCode || linkStatus.status === "connecting") {
        setLinkingStatus(linkStatus);
      } else if (linkingStatus || isLinkDialogOpen) {
        setLinkingStatus(null);
        if (linkStatus.status === "connected") {
          setIsLinkDialogOpen(false);
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

  async function connectAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      const account = await request<WhatsAppAccount>("/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify({}),
      });

      setIsLinkDialogOpen(true);
      if (account.qrCode || account.status === "connecting") {
        setLinkingStatus(account);
      } else if (account.status === "connected") {
        setActiveAccountId(account.accountId);
        openAccountTab(account.accountId);
      }
      setStatusMessage(
        account.qrCode
          ? "QR ready."
          : "Link session started. Waiting for WhatsApp QR.",
      );
      await refreshData(false);
    });
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
      await refreshData(false);
    });
  }

  async function retryDelivery(deliveryId: string) {
    await runAction(async () => {
      await request<DeliveryRecord>(`/deliveries/${encodeURIComponent(deliveryId)}/retry`, {
        method: "POST",
      });
      setStatusMessage("Delivery retry completed.");
      await refreshData(false);
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
      await refreshData(false);
    });
  }

  async function updateNumberRule(rule: NumberRule, enabled: boolean) {
    await runAction(async () => {
      await request<NumberRule>(`/number-rules/${encodeURIComponent(rule.id)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setStatusMessage(enabled ? "Rule enabled." : "Rule disabled.");
      await refreshData(false);
    });
  }

  async function deleteNumberRule(ruleId: string) {
    await runAction(async () => {
      await request<void>(`/number-rules/${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
      });
      setStatusMessage("Number rule deleted.");
      await refreshData(false);
    });
  }

  async function runAction(action: () => Promise<void>) {
    if (!apiToken.trim()) {
      setErrorMessage("An API token is required before the UI can manage accounts.");
      return;
    }

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
    setActiveNumberView("messages");
    setStatusMessage(`Opened ${accountId}.`);
  }

  function openAccountTab(accountId: string) {
    setOpenAccountTabs((currentTabs) => (currentTabs.includes(accountId) ? currentTabs : [...currentTabs, accountId]));
    setActiveTabId(accountId);
  }

  function closeAccountTab(accountId: string) {
    setOpenAccountTabs((currentTabs) => currentTabs.filter((tabAccountId) => tabAccountId !== accountId));
    if (activeTabId === accountId) {
      const nextAccountId = openAccountTabs.find((tabAccountId) => tabAccountId !== accountId);
      setActiveTabId(nextAccountId ?? "settings");
      setActiveAccountId(nextAccountId ?? "");
      setActiveChatJid("");
    }
  }

  const connectedAccounts = accounts.filter((account) => account.status === "connected").length;
  const filteredAccounts = accounts.filter((account) =>
    account.accountId.toLowerCase().includes(accountSearch.trim().toLowerCase()),
  );
  const selectedTabAccountId = activeTabId === "settings" ? activeAccountId : activeTabId;
  const tabAccounts = openAccountTabs
    .map((accountId) => accounts.find((account) => account.accountId === accountId))
    .filter((account): account is WhatsAppAccount => Boolean(account));
  const activeAccount = accounts.find((account) => account.accountId === activeAccountId) ?? null;
  const activeChats = buildChatSummaries(activeAccountId, mappings, deliveries);
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

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src="/wa-mark.svg" alt="" aria-hidden="true" />
          <h1>{appTitle}</h1>
        </div>
        <StatusIndicator detail={errorMessage || statusMessage} tone={statusTone} />
      </header>

      <main className="admin-layout">
        <aside className="account-sidebar">
          <div className="sidebar-action-row">
            <div>
              <span className="panel-kicker">Numbers</span>
              <strong>{connectedAccounts}/{accounts.length} online</strong>
            </div>
            <form onSubmit={connectAccount}>
              <button type="submit" disabled={isBusy}>
                + Link
              </button>
            </form>
          </div>

          <label className="compact-field sidebar-search">
            <span>Search</span>
            <input
              value={accountSearch}
              onChange={(event) => setAccountSearch(event.target.value)}
              placeholder="Find number"
            />
          </label>

          <div className="account-list sidebar-account-list">
            {filteredAccounts.length === 0 ? (
              <EmptyState
                title={accounts.length === 0 ? "No numbers" : "No matches"}
                description={accounts.length === 0 ? "Use Link to pair a WhatsApp number." : "Adjust the search."}
              />
            ) : (
              filteredAccounts.map((account) => (
                <button
                  key={account.accountId}
                  className={`account-open sidebar-account-button${
                    account.accountId === selectedTabAccountId ? " account-row-active" : ""
                  }`}
                  onClick={() => openAccount(account.accountId)}
                  title={getAccountStatusDetail(account)}
                >
                  <span className={`status-dot status-dot-${account.status}`} />
                  <span>
                    <strong>{account.accountId}</strong>
                    <small>{account.status}</small>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="admin-panel">
          <div className="workspace-tabs" role="tablist" aria-label="Open workspaces">
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
                  <span>{account.accountId}</span>
                </button>
                <button className="tab-close" aria-label={`Close ${account.accountId}`} onClick={() => closeAccountTab(account.accountId)}>
                  x
                </button>
              </div>
            ))}
            <button
              className={`workspace-tab${activeTabId === "settings" ? " workspace-tab-active" : ""}`}
              onClick={() => setActiveTabId("settings")}
            >
              Settings
            </button>
          </div>

          {activeTabId === "settings" ? (
            <SettingsView
              apiToken={apiToken}
              apiUrl={apiUrl}
              defaultApiUrl={getDefaultApiUrl()}
              onApiTokenChange={setApiToken}
              onApiUrlChange={setApiUrl}
              onResetApiUrl={() => setApiUrl("")}
            />
          ) : null}

          {activeTabId !== "settings" ? (
            <NumberWorkspace
              account={activeAccount}
              activeChat={activeChat}
              activeChatJid={activeChat?.chatJid ?? ""}
              activeChatMessages={activeChatMessages}
              activeView={activeNumberView}
              chats={activeChats}
              failedDeliveries={activeAccountFailedDeliveries}
              isBusy={isBusy}
              matchType={ruleMatchType}
              onActionChange={setRuleAction}
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
        </section>
      </main>

      {isLinkDialogOpen ? (
        <LinkAccountDialog
          account={pendingQrAccount}
          isBusy={isBusy}
          onClose={() => setIsLinkDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AccountsView({
  accounts,
  connectedAccounts,
  isBusy,
  isLinkDialogOpen,
  onConnect,
  onDisconnect,
  onDismissLinkDialog,
  onOpenAccount,
  pendingQrAccount,
}: {
  accounts: WhatsAppAccount[];
  connectedAccounts: number;
  isBusy: boolean;
  isLinkDialogOpen: boolean;
  onConnect: (event: FormEvent<HTMLFormElement>) => void;
  onDisconnect: (accountId: string) => void;
  onDismissLinkDialog: () => void;
  onOpenAccount: (accountId: string) => void;
  pendingQrAccount: WhatsAppAccount | null;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Accounts</span>
          <h2>Pair and monitor numbers</h2>
        </div>
        <div className="account-heading-actions">
          <span className="count-pill">{connectedAccounts}/{accounts.length} online</span>
          <form onSubmit={onConnect}>
            <button type="submit" disabled={isBusy}>
              + Link
            </button>
          </form>
        </div>
      </div>

      <div className="account-list account-list-table">
        {accounts.length === 0 ? (
          <EmptyState title="No accounts" description="Use + Link to create a WhatsApp pairing session." />
        ) : (
          accounts.map((account) => (
            <div key={account.accountId} className="account-row">
              <button className="account-open" onClick={() => onOpenAccount(account.accountId)}>
                <span className={`status-dot status-dot-${account.status}`} />
                <span>
                  <strong>{account.accountId}</strong>
                  <small>{getAccountActivity(account)}</small>
                </span>
              </button>
              <span className={`badge badge-${account.status}`}>{account.status}</span>
              <button
                className="text-button danger-button"
                onClick={() => onDisconnect(account.accountId)}
                disabled={isBusy || account.status === "disconnected"}
              >
                Disconnect
              </button>
            </div>
          ))
        )}
      </div>

      {isLinkDialogOpen ? (
        <LinkAccountDialog
          account={pendingQrAccount}
          isBusy={isBusy}
          onClose={onDismissLinkDialog}
        />
      ) : null}
    </>
  );
}

function NumberWorkspace({
  account,
  activeChat,
  activeChatJid,
  activeChatMessages,
  activeView,
  chats,
  failedDeliveries,
  isBusy,
  matchType,
  onActionChange,
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
  activeChat: ChatSummary | null;
  activeChatJid: string;
  activeChatMessages: ChatMessage[];
  activeView: NumberSubview;
  chats: ChatSummary[];
  failedDeliveries: DeliveryRecord[];
  isBusy: boolean;
  matchType: NumberRuleMatchType;
  onActionChange: (value: NumberRuleAction) => void;
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
  if (!account) {
    return <EmptyState title="Number unavailable" description="Select another number from the left rail." />;
  }

  return (
    <>
      <div className="number-header">
        <div>
          <span className="panel-kicker">Number</span>
          <h2>{account.accountId}</h2>
          <p>{getAccountActivity(account)}</p>
        </div>
        <div className="number-header-actions">
          <span className={`badge badge-${account.status}`} title={getAccountStatusDetail(account)}>
            {account.status}
          </span>
          <button
            className="text-button danger-button"
            onClick={() => onDisconnect(account.accountId)}
            disabled={isBusy || account.status === "disconnected"}
          >
            Disconnect
          </button>
        </div>
      </div>

      <div className="subnav" aria-label="Number sections">
        <TabButton active={activeView === "messages"} onClick={() => onViewChange("messages")}>
          Messages
        </TabButton>
        <TabButton active={activeView === "rules"} onClick={() => onViewChange("rules")}>
          Rules
        </TabButton>
        <TabButton active={activeView === "failures"} onClick={() => onViewChange("failures")}>
          Failures
        </TabButton>
      </div>

      {activeView === "messages" ? (
        <MessagesView
          activeAccount={account}
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
    </>
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
            <h3 id="link-dialog-title">{account?.accountId ?? "WhatsApp QR"}</h3>
          </div>
          <button className="text-button" onClick={onClose} aria-label="Close link dialog">
            Close
          </button>
        </div>

        <div className="dialog-body">
          {account?.qrCode ? (
            <div className="dialog-qr-only">
              <div className="qr-panel qr-panel-large" aria-label={`Pairing QR for ${account.accountId}`}>
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

function MessagesView({
  activeAccount,
  activeAccountId,
  activeChat,
  activeChatJid,
  activeChatMessages,
  chats,
  onSelectChat,
}: {
  activeAccount: WhatsAppAccount | null;
  activeAccountId: string;
  activeChat: ChatSummary | null;
  activeChatJid: string;
  activeChatMessages: ChatMessage[];
  chats: ChatSummary[];
  onSelectChat: (chatJid: string) => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Messages</span>
          <h2>Direct chat activity</h2>
        </div>
      </div>

      <div className="summary-strip">
        <Metric label="Chats" value={String(chats.length)} />
        <Metric label="Messages" value={String(activeChatMessages.length)} />
        <Metric label="Account" value={activeAccount?.status ?? "none"} />
      </div>

      <div className="chat-workspace">
        <section className="chat-list-pane">
          <div className="section-heading">
            <div>
              <span className="panel-kicker">Direct chats</span>
              <h3>Known conversations</h3>
            </div>
          </div>

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
                    <span>{chat.failedCount ? `${chat.failedCount} failed` : `${chat.deliveryCount} deliveries`}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="chat-detail-pane">
          <div className="section-heading">
            <div>
              <span className="panel-kicker">Transcript</span>
              <h3>{activeChat?.chatJid ?? "No chat selected"}</h3>
            </div>
          </div>

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
    </>
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
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Rules</span>
          <h2>Approved number controls</h2>
        </div>
      </div>

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
        <button type="submit" disabled={isBusy || !activeAccountId || (matchType !== "all" && !pattern.trim())}>
          Add rule
        </button>
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
              <button className="text-button danger-button" onClick={() => onDelete(rule.id)} disabled={isBusy}>
                Delete
              </button>
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
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Failures</span>
          <h2>Delivery recovery</h2>
        </div>
        <span className="count-pill">{failedDeliveries.length} failed</span>
      </div>

      <div className="compact-list">
        {failedDeliveries.length === 0 ? (
          <EmptyState title="No failures" description="Failed Hermes or WhatsApp deliveries will appear here." />
        ) : (
          failedDeliveries.map((delivery) => (
            <article key={delivery.id} className="retry-row">
              <div className="retry-row-header">
                <strong>{delivery.chatJid}</strong>
                <button onClick={() => onRetry(delivery.id)} disabled={isBusy}>
                  Retry
                </button>
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
  apiToken,
  apiUrl,
  defaultApiUrl,
  onApiTokenChange,
  onApiUrlChange,
  onResetApiUrl,
}: {
  apiToken: string;
  apiUrl: string;
  defaultApiUrl: string;
  onApiTokenChange: (value: string) => void;
  onApiUrlChange: (value: string) => void;
  onResetApiUrl: () => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Settings</span>
          <h2>API connection</h2>
        </div>
      </div>

      <div className="settings-grid">
        <label className="field">
          <span>API base URL override</span>
          <input
            value={apiUrl}
            onChange={(event) => onApiUrlChange(event.target.value)}
            placeholder="Same origin"
          />
        </label>
        <label className="field">
          <span>API token</span>
          <input
            type="password"
            value={apiToken}
            onChange={(event) => onApiTokenChange(event.target.value)}
            placeholder="local-dev-token"
          />
        </label>
        <div className="settings-note">
          <span className="panel-kicker">Default</span>
          <p>{defaultApiUrl || "Same origin through the UI server"}</p>
          <button className="secondary-button" onClick={onResetApiUrl}>
            Use same origin
          </button>
        </div>
      </div>
    </>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button className={`nav-button${active ? " nav-button-active" : ""}`} onClick={onClick}>
      {children}
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
      ...(current?.hermesSessionId ? { hermesSessionId: current.hermesSessionId } : {}),
      ...(lastText ? { lastText } : {}),
    });
  }

  return [...chats.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function getRuleDisplayValue(rule: NumberRule) {
  if (rule.matchType === "all") {
    return "All numbers";
  }

  return `${rule.matchType === "exact" ? "Full match" : "Regex"} ${rule.pattern}`;
}

function getInitialApiUrl() {
  const fallback = getDefaultApiUrl();
  if (explicitApiUrl) {
    return explicitApiUrl;
  }

  const stored = localStorage.getItem(storageKeys.apiUrl);
  if (!stored) {
    return fallback;
  }

  try {
    const storedUrl = new URL(stored);
    if (storedUrl.hostname === window.location.hostname) {
      return stored;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function getDefaultApiUrl() {
  return "";
}

function maxTimestamp(left: string | undefined, right: string) {
  if (!left) {
    return right;
  }

  return Date.parse(left) > Date.parse(right) ? left : right;
}

function upsertAccount(accounts: WhatsAppAccount[], nextAccount: WhatsAppAccount) {
  const accountIndex = accounts.findIndex((account) => account.accountId === nextAccount.accountId);

  if (accountIndex === -1) {
    return [nextAccount, ...accounts];
  }

  return accounts.map((account, index) => (index === accountIndex ? nextAccount : account));
}

function getAccountActivity(account: WhatsAppAccount) {
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
