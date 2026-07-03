import { formatCountLabel, formatTimestamp } from "../domain/formatting";
import type { ChatMessage, ChatSummary } from "../domain/models";
import { EmptyState } from "./shared";

export function MessagesView({
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
                    <strong>{chat.displayName ?? chat.phoneNumber ?? chat.chatJid}</strong>
                    <small>{chat.lastText ?? chat.phoneNumber ?? chat.pnJid ?? chat.chatJid}</small>
                  </span>
                  <span className="chat-meta">
                    <span>{formatTimestamp(chat.updatedAt)}</span>
                    <span>{formatCountLabel(chat.messageCount, "message")}</span>
                    {chat.unreadCount ? <span className="unread-pill">{chat.unreadCount}</span> : null}
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
              <header className="chat-thread-header">
                <div>
                  <strong>{activeChat.displayName ?? activeChat.phoneNumber ?? activeChat.chatJid}</strong>
                  <span>{activeChat.phoneNumber ?? activeChat.pnJid ?? activeChat.chatJid}</span>
                </div>
                <small>{activeChat.source === "mixed" ? "Synced + routed" : activeChat.source}</small>
              </header>
              <div className="message-list">
                {activeChatMessages.length === 0 ? (
                  <EmptyState
                    title="No messages stored"
                    description="This chat is known from sync metadata, but WhatsApp did not provide message content yet."
                  />
                ) : (
                  activeChatMessages.map((message) => (
                    <article key={message.id} className={`message-row message-row-${message.direction}`}>
                      <div className="message-bubble">
                        {message.media?.length ? (
                          <div className="message-media-stack">
                            {message.media.map((item) => (
                              <span key={item.id} className="message-media-chip">
                                {item.mediaType}
                                {item.localPath ? " saved" : ""}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <p>{message.text}</p>
                        {message.updates?.length ? (
                          <div className="message-update-line">
                            {message.updates.map((update) => update.updateType).join(", ")}
                          </div>
                        ) : null}
                        <footer>
                          <time>{formatTimestamp(message.timestamp)}</time>
                          {message.status ? <span className={`delivery-status delivery-status-${message.status}`}>{message.status}</span> : null}
                          {message.receipts?.length ? <span>{latestReceiptLabel(message)}</span> : null}
                        </footer>
                        {message.record && "error" in message.record && message.record.error ? <p className="error-text">{message.record.error}</p> : null}
                      </div>
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

function latestReceiptLabel(message: ChatMessage) {
  const latest = [...(message.receipts ?? [])]
    .sort((a, b) => Date.parse(b.timestamp ?? b.receivedAt) - Date.parse(a.timestamp ?? a.receivedAt))[0];
  return latest?.receiptType ?? "received";
}
