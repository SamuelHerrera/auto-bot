import { FormEvent, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type AccountStatus = "disconnected" | "connecting" | "connected";

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
  chatType: "direct" | "group";
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
  apiUrl: "whatsapp-manager-ui.api-url",
};

const defaultApiUrl =
  import.meta.env.VITE_WHATSAPP_MANAGER_API_URL?.trim() || getDefaultApiUrl();
const defaultApiToken =
  import.meta.env.VITE_WHATSAPP_MANAGER_API_TOKEN?.trim() || "local-dev-token";
const appTitle =
  import.meta.env.VITE_WHATSAPP_MANAGER_UI_TITLE?.trim() || "WhatsApp Account Console";

export function App() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(storageKeys.apiUrl) || defaultApiUrl);
  const [apiToken, setApiToken] = useState(() => localStorage.getItem(storageKeys.apiToken) || defaultApiToken);
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [mappings, setMappings] = useState<SessionMapping[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [activeAccountId, setActiveAccountId] = useState("");
  const [activeChatJid, setActiveChatJid] = useState("");
  const [accountIdInput, setAccountIdInput] = useState("");
  const [statusMessage, setStatusMessage] = useState("Workspace ready. Sync or register an account.");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKeys.apiUrl, apiUrl);
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
    if (!apiToken.trim() || !accounts.some((account) => account.status === "connecting")) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshData(false);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [accounts, apiToken, apiUrl]);

  useEffect(() => {
    const firstAccount = accounts[0];
    if (!activeAccountId && firstAccount) {
      setActiveAccountId(firstAccount.accountId);
    }
  }, [accounts, activeAccountId]);

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${apiToken}`,
        ...(init?.headers ?? {}),
      },
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
      const [accountResponse, mappingResponse, deliveryResponse] = await Promise.all([
        request<{ items: WhatsAppAccount[] }>("/whatsapp/accounts"),
        request<{ items: SessionMapping[] }>("/sessions"),
        request<{ items: DeliveryRecord[] }>("/deliveries"),
      ]);

      setAccounts(accountResponse.items);
      setMappings(mappingResponse.items);
      setDeliveries(deliveryResponse.items);

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
    if (!accountIdInput.trim()) {
      setErrorMessage("Provide an account ID before registering a WhatsApp account.");
      return;
    }

    const accountId = accountIdInput.trim();
    await runAction(async () => {
      const account = await request<WhatsAppAccount>("/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify({ accountId }),
      });

      setAccounts((currentAccounts) => upsertAccount(currentAccounts, account));
      setAccountIdInput("");
      setActiveAccountId(accountId);
      setActiveChatJid("");
      setStatusMessage(
        account.qrCode
          ? `QR ready for ${accountId}.`
          : `Registration started for ${accountId}. Waiting for WhatsApp QR.`,
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
    setStatusMessage(`Opened ${accountId}.`);
  }

  const connectedAccounts = accounts.filter((account) => account.status === "connected").length;
  const activeAccount = accounts.find((account) => account.accountId === activeAccountId) ?? null;
  const activeChats = buildChatSummaries(activeAccountId, mappings, deliveries);
  const activeChat = activeChats.find((chat) => chat.chatJid === activeChatJid) ?? null;
  const activeChatMessages = activeChat
    ? buildChatMessages(deliveries.filter(
        (delivery) => delivery.accountId === activeAccountId && delivery.chatJid === activeChat.chatJid,
      ))
    : [];
  const pendingQrAccount =
    accounts.find((account) => account.accountId === activeAccountId && account.qrCode) ??
    accounts.find((account) => account.qrCode) ??
    null;
  const activeFailedCount = deliveries.filter(
    (delivery) => delivery.accountId === activeAccountId && delivery.status === "failed",
  ).length;

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">WhatsApp manager</span>
          <h1>{appTitle}</h1>
        </div>
        <button className="secondary-button" onClick={() => void refreshData()} disabled={isBusy}>
          Sync
        </button>
      </header>

      <section className="connection-strip" aria-label="Workspace connection">
        <label className="field compact-field">
          <span>API base URL</span>
          <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
        </label>
        <label className="field compact-field">
          <span>API token</span>
          <input
            type="password"
            value={apiToken}
            onChange={(event) => setApiToken(event.target.value)}
            placeholder="local-dev-token"
          />
        </label>
        <div className={`status-strip${errorMessage ? " status-strip-error" : ""}`}>
          <span className="status-label">Status</span>
          <p>{errorMessage || statusMessage}</p>
        </div>
      </section>

      <main className="workspace simple-workspace">
        <aside className="account-rail" aria-label="Accounts">
          <div className="section-heading">
            <div>
              <span className="panel-kicker">Accounts</span>
              <h2>Accounts</h2>
            </div>
            <span className="count-pill">{connectedAccounts}/{accounts.length} online</span>
          </div>

          <form className="register-form" onSubmit={connectAccount}>
            <label className="field">
              <span>Register account</span>
              <input
                value={accountIdInput}
                onChange={(event) => setAccountIdInput(event.target.value)}
                placeholder="account-name"
              />
            </label>
            <button type="submit" disabled={isBusy}>
              Generate QR
            </button>
          </form>

          <div className="account-list">
            {accounts.length === 0 ? (
              <EmptyState title="No accounts" description="Register an account to create a QR pairing session." />
            ) : (
              accounts.map((account) => (
                <div
                  key={account.accountId}
                  className={`account-row${account.accountId === activeAccountId ? " account-row-active" : ""}`}
                >
                  <button className="account-open" onClick={() => openAccount(account.accountId)}>
                    <span className={`status-dot status-dot-${account.status}`} />
                    <span>
                      <strong>{account.accountId}</strong>
                      <small>{account.status}</small>
                    </span>
                  </button>
                  <button
                    className="text-button danger-button"
                    onClick={() => void disconnectAccount(account.accountId)}
                    disabled={isBusy || account.status === "disconnected"}
                  >
                    Disconnect
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        <section className="account-workspace" aria-label="Selected account workspace">
          <div className="account-summary">
            <div>
              <span className="panel-kicker">Open account</span>
              <h2>{activeAccount?.accountId ?? "No account selected"}</h2>
              <p>
                {activeAccount
                  ? getAccountActivity(activeAccount)
                  : "Choose an account to see chats and message metadata."}
              </p>
            </div>
            {activeAccount ? <span className={`badge badge-${activeAccount.status}`}>{activeAccount.status}</span> : null}
          </div>

          {pendingQrAccount ? (
            <section className="registration-band">
              <div className="qr-layout">
                <div className="qr-panel" aria-label={`Pairing QR for ${pendingQrAccount.accountId}`}>
                  <QRCodeSVG value={pendingQrAccount.qrCode ?? ""} size={164} marginSize={2} />
                </div>
                <div>
                  <span className="panel-kicker">Registration</span>
                  <h3>{pendingQrAccount.accountId}</h3>
                  <p>Scan this code from WhatsApp to finish pairing this account.</p>
                </div>
              </div>
            </section>
          ) : null}

          <div className="summary-strip">
            <Metric label="Chats" value={String(activeChats.length)} />
            <Metric label="Deliveries" value={String(deliveries.filter((delivery) => delivery.accountId === activeAccountId).length)} />
            {activeFailedCount > 0 ? (
              <Metric label="Failures" value={String(activeFailedCount)} tone="danger" />
            ) : (
              <Metric label="Failures" value="0" />
            )}
          </div>

          <div className="chat-workspace">
            <section className="chat-list-pane">
              <div className="section-heading">
                <div>
                  <span className="panel-kicker">Chats</span>
                  <h3>Known chats</h3>
                </div>
              </div>

              <div className="chat-list">
                {!activeAccount ? (
                  <EmptyState title="Select an account" description="Chats are scoped to the opened account." />
                ) : activeChats.length === 0 ? (
                  <EmptyState title="No chats yet" description="Chats appear after inbound WhatsApp activity is routed." />
                ) : (
                  activeChats.map((chat) => (
                    <button
                      key={chat.chatJid}
                      className={`chat-row${chat.chatJid === activeChatJid ? " chat-row-active" : ""}`}
                      onClick={() => setActiveChatJid(chat.chatJid)}
                    >
                      <span>
                        <strong>{chat.chatJid}</strong>
                        <small>{chat.lastText ?? chat.hermesSessionId ?? "No message preview"}</small>
                      </span>
                      <span className="chat-meta">
                        <span>{chat.chatType}</span>
                        <span>{formatTimestamp(chat.updatedAt)}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="chat-detail-pane">
              <div className="section-heading">
                <div>
                  <span className="panel-kicker">Chat detail</span>
                  <h3>{activeChat?.chatJid ?? "No chat selected"}</h3>
                </div>
              </div>

              {activeChat ? (
                <div className="chat-detail-content">
                  <dl className="detail-list">
                    <div>
                      <dt>Type</dt>
                      <dd>{activeChat.chatType}</dd>
                    </div>
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
                    <div>
                      <dt>Failed deliveries</dt>
                      <dd>{activeChat.failedCount}</dd>
                    </div>
                  </dl>

                  <div className="message-list">
                    <div className="message-list-header">
                      <span className="panel-kicker">Messages</span>
                      <span className="count-pill">{activeChatMessages.length}</span>
                    </div>
                    {activeChatMessages.length === 0 ? (
                      <EmptyState
                        title="No stored messages"
                        description="Only routed delivery records are available in this version."
                      />
                    ) : (
                      activeChatMessages.map((message) => (
                        <article key={message.id} className={`message-row message-row-${message.direction}`}>
                          <div>
                            <strong>{message.direction === "inbound" ? "Inbound" : "Hermes reply"}</strong>
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
                <EmptyState title="Open a chat" description="Select a chat to see stored messages and metadata." />
              )}
            </section>
          </div>
        </section>
      </main>
    </div>
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

  for (const mapping of mappings.filter((item) => item.accountId === accountId)) {
    chats.set(mapping.chatJid, {
      accountId: mapping.accountId,
      chatJid: mapping.chatJid,
      chatType: mapping.chatType,
      sessionKey: mapping.sessionKey,
      hermesSessionId: mapping.hermesSessionId,
      createdAt: mapping.createdAt,
      updatedAt: mapping.updatedAt,
      deliveryCount: 0,
      failedCount: 0,
    });
  }

  for (const delivery of deliveries.filter((item) => item.accountId === accountId)) {
    const current = chats.get(delivery.chatJid);
    const updatedAt = maxTimestamp(current?.updatedAt, delivery.updatedAt);
    const lastText = delivery.outboundText || delivery.inboundText || current?.lastText;
    chats.set(delivery.chatJid, {
      accountId: delivery.accountId,
      chatJid: delivery.chatJid,
      chatType: delivery.chatType,
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

function getDefaultApiUrl() {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:3000";
  }

  return `${window.location.protocol}//${window.location.hostname}:3000`;
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
