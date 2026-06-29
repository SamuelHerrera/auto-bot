import { FormEvent, useEffect, useState } from "react";

type AccountStatus = "disconnected" | "connecting" | "connected";

interface WhatsAppAccount {
  accountId: string;
  status: AccountStatus;
  connectedAt?: string;
}

interface SessionMapping {
  chatId: string;
  hermesSessionId: string;
  createdAt: string;
  updatedAt: string;
}

interface HermesSession {
  id: string;
  chatId: string;
  createdAt: string;
  lastActivityAt: string;
  status: "active" | "reset";
}

interface ApiError {
  error: string;
}

const storageKeys = {
  apiToken: "whatsapp-manager-ui.api-token",
  apiUrl: "whatsapp-manager-ui.api-url",
};

const defaultApiUrl =
  import.meta.env.VITE_WHATSAPP_MANAGER_API_URL?.trim() || "http://127.0.0.1:3000";
const appTitle =
  import.meta.env.VITE_WHATSAPP_MANAGER_UI_TITLE?.trim() || "WhatsApp Account Console";

export function App() {
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem(storageKeys.apiUrl) || defaultApiUrl);
  const [apiToken, setApiToken] = useState(() => localStorage.getItem(storageKeys.apiToken) || "");
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [mappings, setMappings] = useState<SessionMapping[]>([]);
  const [selectedSession, setSelectedSession] = useState<HermesSession | null>(null);
  const [activeChatId, setActiveChatId] = useState("");
  const [accountIdInput, setAccountIdInput] = useState("");
  const [chatIdInput, setChatIdInput] = useState("");
  const [remapSessionId, setRemapSessionId] = useState("");
  const [outboundChatId, setOutboundChatId] = useState("");
  const [outboundText, setOutboundText] = useState("");
  const [statusMessage, setStatusMessage] = useState("Enter the API token, then sync the current WhatsApp workspace.");
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
      const [accountResponse, mappingResponse] = await Promise.all([
        request<{ items: WhatsAppAccount[] }>("/whatsapp/accounts"),
        request<{ items: SessionMapping[] }>("/sessions"),
      ]);

      setAccounts(accountResponse.items);
      setMappings(mappingResponse.items);

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
      setErrorMessage("Provide an account ID before connecting a WhatsApp account.");
      return;
    }

    await runAction(async () => {
      await request("/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify({ accountId: accountIdInput.trim() }),
      });

      setAccountIdInput("");
      setStatusMessage("WhatsApp account connected.");
      await refreshData(false);
    });
  }

  async function disconnectAccount(accountId: string) {
    await runAction(async () => {
      await request(`/whatsapp/accounts/${encodeURIComponent(accountId)}/disconnect`, {
        method: "POST",
      });

      setStatusMessage(`Account ${accountId} disconnected.`);
      await refreshData(false);
    });
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chatIdInput.trim()) {
      setErrorMessage("Provide a WhatsApp chat ID before creating or loading a session.");
      return;
    }

    await runAction(async () => {
      const session = await request<HermesSession>(
        `/chats/${encodeURIComponent(chatIdInput.trim())}/session`,
        { method: "POST" },
      );

      setSelectedSession(session);
      setActiveChatId(chatIdInput.trim());
      setStatusMessage(`Hermes session ready for ${chatIdInput.trim()}.`);
      setChatIdInput("");
      await refreshData(false);
    });
  }

  async function inspectSession(chatId: string) {
    await runAction(async () => {
      const session = await request<HermesSession>(`/chats/${encodeURIComponent(chatId)}/session`);
      setSelectedSession(session);
      setActiveChatId(chatId);
      setStatusMessage(`Loaded session for ${chatId}.`);
    });
  }

  async function resetSession(chatId: string) {
    await runAction(async () => {
      const session = await request<HermesSession>(
        `/chats/${encodeURIComponent(chatId)}/session/reset`,
        { method: "POST" },
      );

      setSelectedSession(session);
      setActiveChatId(chatId);
      setStatusMessage(`Session reset for ${chatId}.`);
      await refreshData(false);
    });
  }

  async function remapSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeChatId) {
      setErrorMessage("Select a chat mapping before remapping the Hermes session.");
      return;
    }

    if (!remapSessionId.trim()) {
      setErrorMessage("Provide the target Hermes session ID.");
      return;
    }

    await runAction(async () => {
      await request(`/chats/${encodeURIComponent(activeChatId)}/session/remap`, {
        method: "POST",
        body: JSON.stringify({ hermesSessionId: remapSessionId.trim() }),
      });

      setRemapSessionId("");
      setStatusMessage(`Session remapped for ${activeChatId}.`);
      await refreshData(false);
      await inspectSession(activeChatId);
    });
  }

  async function sendOutboundMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!outboundChatId.trim() || !outboundText.trim()) {
      setErrorMessage("Provide both a chat ID and message text before queueing an outbound message.");
      return;
    }

    await runAction(async () => {
      await request("/messages/outbound", {
        method: "POST",
        body: JSON.stringify({
          chatId: outboundChatId.trim(),
          text: outboundText.trim(),
        }),
      });

      setOutboundText("");
      setStatusMessage(`Outbound message queued for ${outboundChatId.trim()}.`);
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

  const connectedAccounts = accounts.filter((account) => account.status === "connected").length;

  return (
    <div className="shell">
      <div className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Operator surface</span>
          <h1>{appTitle}</h1>
          <p>
            Manage WhatsApp accounts, inspect live chat-to-Hermes mappings, and test routing from a
            dedicated browser UI instead of driving the workspace only from the terminal.
          </p>
        </div>
        <div className="hero-metrics">
          <MetricCard label="Connected accounts" value={String(connectedAccounts)} />
          <MetricCard label="Tracked mappings" value={String(mappings.length)} />
          <MetricCard label="API endpoint" value={stripProtocol(apiUrl)} />
        </div>
      </div>

      <div className="top-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Connection</span>
              <h2>Workspace settings</h2>
            </div>
            <button className="secondary-button" onClick={() => void refreshData()} disabled={isBusy}>
              Sync
            </button>
          </div>

          <form className="stack" onSubmit={(event) => event.preventDefault()}>
            <label className="field">
              <span>API base URL</span>
              <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
            </label>
            <label className="field">
              <span>API token</span>
              <input
                type="password"
                value={apiToken}
                onChange={(event) => setApiToken(event.target.value)}
                placeholder="local-dev-token"
              />
            </label>
          </form>

          <div className="status-strip">
            <span className="status-label">Status</span>
            <p>{errorMessage || statusMessage}</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Accounts</span>
              <h2>WhatsApp fleet</h2>
            </div>
          </div>

          <form className="inline-form" onSubmit={connectAccount}>
            <input
              value={accountIdInput}
              onChange={(event) => setAccountIdInput(event.target.value)}
              placeholder="ops-main-phone"
            />
            <button type="submit" disabled={isBusy}>
              Connect account
            </button>
          </form>

          <div className="account-grid">
            {accounts.length === 0 ? (
              <EmptyState
                title="No accounts tracked yet"
                description="Connect the first WhatsApp account to seed the operator workspace."
              />
            ) : (
              accounts.map((account) => (
                <article key={account.accountId} className="account-card">
                  <div className="account-card-header">
                    <div>
                      <span className={`badge badge-${account.status}`}>{account.status}</span>
                      <h3>{account.accountId}</h3>
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => void disconnectAccount(account.accountId)}
                      disabled={isBusy || account.status === "disconnected"}
                    >
                      Disconnect
                    </button>
                  </div>
                  <p className="mono">
                    {account.connectedAt ? formatTimestamp(account.connectedAt) : "No active session"}
                  </p>
                </article>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="content-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Sessions</span>
              <h2>Chat routing map</h2>
            </div>
          </div>

          <form className="inline-form" onSubmit={createSession}>
            <input
              value={chatIdInput}
              onChange={(event) => setChatIdInput(event.target.value)}
              placeholder="15551234567@s.whatsapp.net"
            />
            <button type="submit" disabled={isBusy}>
              Create or load
            </button>
          </form>

          <div className="mapping-list">
            {mappings.length === 0 ? (
              <EmptyState
                title="No chat mappings yet"
                description="Inbound traffic or manual session creation will populate this table."
              />
            ) : (
              mappings.map((mapping) => (
                <button
                  key={mapping.chatId}
                  className={`mapping-card${activeChatId === mapping.chatId ? " mapping-card-active" : ""}`}
                  onClick={() => void inspectSession(mapping.chatId)}
                >
                  <div>
                    <h3>{mapping.chatId}</h3>
                    <p className="mono">{mapping.hermesSessionId}</p>
                  </div>
                  <div className="mapping-card-meta">
                    <span>Updated {formatTimestamp(mapping.updatedAt)}</span>
                    <span>Created {formatTimestamp(mapping.createdAt)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-kicker">Inspector</span>
              <h2>Session controls</h2>
            </div>
            {activeChatId ? (
              <button className="secondary-button" onClick={() => void resetSession(activeChatId)} disabled={isBusy}>
                Reset
              </button>
            ) : null}
          </div>

          {selectedSession ? (
            <div className="stack">
              <div className="detail-card">
                <div className="detail-row">
                  <span>Session ID</span>
                  <strong className="mono">{selectedSession.id}</strong>
                </div>
                <div className="detail-row">
                  <span>Chat ID</span>
                  <strong className="mono">{selectedSession.chatId}</strong>
                </div>
                <div className="detail-row">
                  <span>Status</span>
                  <strong>{selectedSession.status}</strong>
                </div>
                <div className="detail-row">
                  <span>Created</span>
                  <strong>{formatTimestamp(selectedSession.createdAt)}</strong>
                </div>
                <div className="detail-row">
                  <span>Last activity</span>
                  <strong>{formatTimestamp(selectedSession.lastActivityAt)}</strong>
                </div>
              </div>

              <form className="stack" onSubmit={remapSession}>
                <label className="field">
                  <span>Remap to Hermes session ID</span>
                  <input
                    value={remapSessionId}
                    onChange={(event) => setRemapSessionId(event.target.value)}
                    placeholder="hermes_existing_session"
                  />
                </label>
                <button type="submit" disabled={isBusy}>
                  Remap session
                </button>
              </form>
            </div>
          ) : (
            <EmptyState
              title="No session selected"
              description="Choose a mapping or create a new chat session to inspect its Hermes state."
            />
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="panel-kicker">Outbound</span>
            <h2>Manual message queue</h2>
          </div>
        </div>

        <form className="outbound-form" onSubmit={sendOutboundMessage}>
          <input
            value={outboundChatId}
            onChange={(event) => setOutboundChatId(event.target.value)}
            placeholder="Destination chat ID"
          />
          <textarea
            value={outboundText}
            onChange={(event) => setOutboundText(event.target.value)}
            placeholder="Send a test message through the WhatsApp gateway"
            rows={4}
          />
          <button type="submit" disabled={isBusy}>
            Queue outbound message
          </button>
        </form>
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
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

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function stripProtocol(value: string) {
  return value.replace(/^https?:\/\//, "");
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
