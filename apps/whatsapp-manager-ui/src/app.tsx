import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type AccountStatus = "disconnected" | "connecting" | "connected";
type ActiveView = "accounts" | "messages" | "failures" | "settings";

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
  const [activeView, setActiveView] = useState<ActiveView>("accounts");
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeChatJid, setActiveChatJid] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkingStatus, setLinkingStatus] = useState<WhatsAppAccount | null>(null);
  const [statusMessage, setStatusMessage] = useState("Workspace ready. Sync or register an account.");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

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
    if (
      !apiToken.trim() ||
      (!isLinkDialogOpen && !linkingStatus && !accounts.some((account) => account.status === "connecting"))
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshData(false);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [accounts, apiToken, apiUrl, isLinkDialogOpen, linkingStatus]);

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

    return response.json() as Promise<T>;
  }

  async function refreshData(showMessage = true) {
    if (!apiToken.trim()) {
      setErrorMessage("An API token is required before the UI can manage accounts.");
      return;
    }

    setIsBusy(true);
    setErrorMessage("");

    try {
      const [accountResponse, mappingResponse, deliveryResponse, linkStatus] = await Promise.all([
        request<{ items: WhatsAppAccount[] }>("/whatsapp/accounts"),
        request<{ items: SessionMapping[] }>("/sessions"),
        request<{ items: DeliveryRecord[] }>("/deliveries"),
        request<WhatsAppAccount>("/whatsapp/status"),
      ]);

      setAccounts(accountResponse.items);
      setMappings(mappingResponse.items.filter((mapping) => mapping.chatType === "direct"));
      setDeliveries(deliveryResponse.items.filter((delivery) => delivery.chatType === "direct"));
      if (linkStatus.qrCode || linkStatus.status === "connecting") {
        setLinkingStatus(linkStatus);
      } else if (linkingStatus || isLinkDialogOpen) {
        setLinkingStatus(null);
        if (linkStatus.status === "connected") {
          setIsLinkDialogOpen(false);
          setActiveAccountId(linkStatus.accountId);
          setStatusMessage(`Account ${linkStatus.accountId} linked.`);
        }
      }

      if (showMessage) {
        setStatusMessage("Workspace synced.");
      }
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      setIsBusy(false);
    }
  }

  async function connectAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      const account = await request<WhatsAppAccount>("/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify({}),
      });

      setActiveView("accounts");
      setIsLinkDialogOpen(true);
      if (account.qrCode || account.status === "connecting") {
        setLinkingStatus(account);
      } else if (account.status === "connected") {
        setActiveAccountId(account.accountId);
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
    setActiveAccountId(accountId);
    setActiveChatJid("");
    setActiveView("messages");
    setStatusMessage(`Opened ${accountId}.`);
  }

  const connectedAccounts = accounts.filter((account) => account.status === "connected").length;
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

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">WhatsApp manager</span>
          <h1>{appTitle}</h1>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => void refreshData()} disabled={isBusy}>
            Sync
          </button>
        </div>
      </header>

      <section className={`notice-strip${errorMessage ? " notice-strip-error" : ""}`} aria-live="polite">
        <span className="status-label">Status</span>
        <p>{errorMessage || statusMessage}</p>
      </section>

      <main className="admin-layout">
        <nav className="admin-nav" aria-label="Admin sections">
          <TabButton active={activeView === "accounts"} onClick={() => setActiveView("accounts")}>
            Accounts
          </TabButton>
          <TabButton active={activeView === "messages"} onClick={() => setActiveView("messages")}>
            Messages
          </TabButton>
          <TabButton active={activeView === "failures"} onClick={() => setActiveView("failures")}>
            Failures
          </TabButton>
          <TabButton active={activeView === "settings"} onClick={() => setActiveView("settings")}>
            Settings
          </TabButton>
        </nav>

        <section className="admin-panel">
          {activeView === "accounts" ? (
            <AccountsView
              accounts={accounts}
              connectedAccounts={connectedAccounts}
              isBusy={isBusy}
              isLinkDialogOpen={isLinkDialogOpen}
              onConnect={connectAccount}
              onDisconnect={disconnectAccount}
              onDismissLinkDialog={() => setIsLinkDialogOpen(false)}
              onOpenAccount={openAccount}
              pendingQrAccount={pendingQrAccount}
            />
          ) : null}

          {activeView === "messages" ? (
            <MessagesView
              accounts={accounts}
              activeAccount={activeAccount}
              activeAccountId={activeAccountId}
              activeChat={activeChat}
              activeChatJid={activeChat?.chatJid ?? ""}
              activeChatMessages={activeChatMessages}
              chats={activeChats}
              onSelectAccount={(accountId) => {
                setActiveAccountId(accountId);
                setActiveChatJid("");
              }}
              onSelectChat={setActiveChatJid}
            />
          ) : null}

          {activeView === "failures" ? (
            <FailuresView
              failedDeliveries={failedDeliveries}
              isBusy={isBusy}
              onRetry={(deliveryId) => void retryDelivery(deliveryId)}
            />
          ) : null}

          {activeView === "settings" ? (
            <SettingsView
              apiToken={apiToken}
              apiUrl={apiUrl}
              defaultApiUrl={getDefaultApiUrl()}
              onApiTokenChange={setApiToken}
              onApiUrlChange={setApiUrl}
              onResetApiUrl={() => setApiUrl("")}
            />
          ) : null}
        </section>
      </main>
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
  accounts,
  activeAccount,
  activeAccountId,
  activeChat,
  activeChatJid,
  activeChatMessages,
  chats,
  onSelectAccount,
  onSelectChat,
}: {
  accounts: WhatsAppAccount[];
  activeAccount: WhatsAppAccount | null;
  activeAccountId: string;
  activeChat: ChatSummary | null;
  activeChatJid: string;
  activeChatMessages: ChatMessage[];
  chats: ChatSummary[];
  onSelectAccount: (accountId: string) => void;
  onSelectChat: (chatJid: string) => void;
}) {
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="panel-kicker">Messages</span>
          <h2>Direct chat activity</h2>
        </div>
        <label className="select-field">
          <span>Account</span>
          <select value={activeAccountId} onChange={(event) => onSelectAccount(event.target.value)}>
            <option value="">Select account</option>
            {accounts.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.accountId}
              </option>
            ))}
          </select>
        </label>
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
