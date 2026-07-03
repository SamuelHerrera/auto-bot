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
