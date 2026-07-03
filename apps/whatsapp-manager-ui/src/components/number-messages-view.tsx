import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";

import { formatCountLabel, formatTimestamp } from "../domain/formatting";
import type { ChatMessage, ChatSummary } from "../domain/models";
import { EmptyState, IconButton } from "./shared";

export function MessagesView({
  activeAccountId,
  activeChat,
  activeChatJid,
  activeChatMessages,
  chats,
  onSelectChat,
  onSetChatArchived,
}: {
  activeAccountId: string;
  activeChat: ChatSummary | null;
  activeChatJid: string;
  activeChatMessages: ChatMessage[];
  chats: ChatSummary[];
  onSelectChat: (chatJid: string) => void;
  onSetChatArchived: (chat: ChatSummary, archived: boolean) => void;
}) {
  const [chatListMode, setChatListMode] = useState<"main" | "archived">("main");
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const interactedChats = chats.filter((chat) => chat.messageCount > 0);
  const activeChats = interactedChats.filter((chat) => !chat.managerArchived);
  const archivedChats = interactedChats.filter((chat) => chat.managerArchived);
  const isShowingArchived = chatListMode === "archived";
  const visibleChats = isShowingArchived ? archivedChats : activeChats;
  const visibleActiveChat = activeChat && visibleChats.some((chat) => chat.chatJid === activeChat.chatJid) ? activeChat : null;
  const emptyTitle = isShowingArchived ? "No archived chats" : "No chats yet";
  const emptyDescription = isShowingArchived
    ? "Archived app-manager chats appear here."
    : "Chats appear after inbound WhatsApp activity is routed.";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const messageList = messageListRef.current;
      if (messageList) {
        messageList.scrollTop = messageList.scrollHeight;
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeChatJid, activeChatMessages.length]);

  return (
    <div className="messages-view">
      <div className="chat-workspace">
        <section className="chat-list-pane">
          <div className="chat-list-toolbar">
            <div className="segmented-control" aria-label="Chat visibility">
              <button
                type="button"
                className={!isShowingArchived ? "segmented-control-active" : ""}
                onClick={() => {
                  setChatListMode("main");
                  onSelectChat(activeChats[0]?.chatJid ?? "");
                }}
              >
                Main
              </button>
              <button
                type="button"
                className={isShowingArchived ? "segmented-control-active" : ""}
                onClick={() => {
                  setChatListMode("archived");
                  onSelectChat(archivedChats[0]?.chatJid ?? "");
                }}
              >
                Archived
              </button>
            </div>
          </div>
          <div className="chat-list">
            {!activeAccountId ? (
              <EmptyState title="Select an account" description="Chats are scoped to one managed WhatsApp number." />
            ) : visibleChats.length === 0 ? (
              <EmptyState title={emptyTitle} description={emptyDescription} />
            ) : (
              visibleChats.map((chat) => (
                <div
                  key={chat.chatJid}
                  className={`chat-row${chat.chatJid === activeChatJid ? " chat-row-active" : ""}`}
                >
                  <button type="button" className="chat-row-main" onClick={() => onSelectChat(chat.chatJid)}>
                    <span className="chat-row-label">
                      <strong>{chat.displayName ?? chat.phoneNumber ?? chat.chatJid}</strong>
                      <small>{chat.lastText ?? chat.phoneNumber ?? chat.pnJid ?? chat.chatJid}</small>
                    </span>
                    <span className="chat-meta">
                      <span className="chat-meta-primary">{formatTimestamp(chat.updatedAt)}</span>
                      <span className="chat-meta-secondary">
                        <span>{formatCountLabel(chat.messageCount, "message")}</span>
                        {chat.unreadCount ? <span className="unread-pill">{chat.unreadCount}</span> : null}
                        {chat.failedCount ? <span>{chat.failedCount} failed</span> : null}
                      </span>
                    </span>
                  </button>
                  <details className="action-menu chat-row-menu">
                    <summary aria-label="Chat actions" title="Chat actions">
                      <Icon icon="mdi:dots-vertical" aria-hidden="true" />
                    </summary>
                    <div className="action-menu-list">
                      <button
                        type="button"
                        onClick={() => onSetChatArchived(chat, !chat.managerArchived)}
                      >
                        <Icon
                          icon={chat.managerArchived ? "mdi:archive-arrow-up-outline" : "mdi:archive-arrow-down-outline"}
                          aria-hidden="true"
                        />
                        <span>{chat.managerArchived ? "Restore" : "Archive"}</span>
                      </button>
                    </div>
                  </details>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="chat-detail-pane">
          {visibleActiveChat ? (
            <div className="chat-detail-content">
              <header className="chat-thread-header">
                <div className="chat-thread-title">
                  <strong>{visibleActiveChat.displayName ?? visibleActiveChat.phoneNumber ?? visibleActiveChat.chatJid}</strong>
                  <span>{visibleActiveChat.phoneNumber ?? visibleActiveChat.pnJid ?? visibleActiveChat.chatJid}</span>
                </div>
                <div className="chat-thread-actions">
                  <small>{visibleActiveChat.source === "mixed" ? "Synced + routed" : visibleActiveChat.source}</small>
                  <IconButton
                    icon={visibleActiveChat.managerArchived ? "mdi:archive-arrow-up-outline" : "mdi:archive-arrow-down-outline"}
                    label={visibleActiveChat.managerArchived ? "Restore in app manager" : "Archive in app manager"}
                    variant="secondary"
                    type="button"
                    onClick={() => onSetChatArchived(visibleActiveChat, !visibleActiveChat.managerArchived)}
                  />
                </div>
              </header>
              <div className="message-list" ref={messageListRef}>
                {activeChatMessages.length === 0 ? (
                  <EmptyState
                    title="No messages stored"
                    description="This chat is known from sync metadata, but WhatsApp did not provide message content yet."
                  />
                ) : (
                  activeChatMessages.map((message) => (
                    <article
                      key={message.id}
                      className={`message-row message-row-${message.kind === "event" ? "event" : message.direction}`}
                    >
                      {message.kind === "event" ? (
                        <div className="message-event-banner">
                          <span>{message.text}</span>
                          <time>{formatTimestamp(message.timestamp)}</time>
                        </div>
                      ) : (
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
                          <footer>
                            <time>{formatTimestamp(message.timestamp)}</time>
                            {message.status ? <span className={`delivery-status delivery-status-${message.status}`}>{message.status}</span> : null}
                            {message.receipts?.length ? <span>{latestReceiptLabel(message)}</span> : null}
                            {hasMetadata(message) ? <MessageMetadataPopover message={message} /> : null}
                          </footer>
                          {message.record && "error" in message.record && message.record.error ? <p className="error-text">{message.record.error}</p> : null}
                        </div>
                      )}
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

function hasMetadata(message: ChatMessage) {
  return Boolean(
    message.updates?.length ||
      message.receipts?.length ||
      message.media?.length ||
      message.messageType ||
      message.source === "sync",
  );
}

function MessageMetadataPopover({ message }: { message: ChatMessage }) {
  const rows = [
    ...(message.updates ?? []).map((update) => ({
      label: updateLabel(update.updateType),
      value: formatTimestamp(update.receivedAt),
    })),
    ...(message.receipts ?? []).map((receipt) => ({
      label: `Receipt: ${receipt.receiptType ?? "received"}`,
      value: formatTimestamp(receipt.timestamp ?? receipt.receivedAt),
    })),
    ...(message.media ?? []).map((media) => ({
      label: `Media: ${media.mediaType}${media.localPath ? " saved" : ""}`,
      value: media.fileName ?? media.mimetype ?? media.localPath ?? "metadata stored",
    })),
    ...(message.messageType ? [{ label: "Message type", value: message.messageType }] : []),
    { label: "Source", value: message.source === "sync" ? "WhatsApp sync" : "Outbound delivery" },
    ...readMessageIds(message).map((messageId) => ({ label: "Message ID", value: messageId })),
  ];

  return (
    <span className="message-metadata">
      <button type="button" className="message-metadata-trigger" aria-label="Message metadata" title="Message metadata">
        <Icon icon="mdi:information-outline" aria-hidden="true" />
      </button>
      <span className="message-metadata-panel" role="tooltip">
        {rows.map((row, index) => (
          <span key={`${row.label}:${index}`} className="message-metadata-row">
            <strong>{row.label}</strong>
            <span>{row.value}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

function readMessageIds(message: ChatMessage) {
  const record = message.record;
  if (!record || !("messageId" in record) || typeof record.messageId !== "string") {
    return [];
  }

  return [record.messageId];
}

function updateLabel(updateType: string) {
  if (updateType === "messages.update") {
    return "Message metadata updated";
  }
  if (updateType === "messages.delete") {
    return "Message deleted";
  }
  if (updateType === "messages.reaction") {
    return "Reaction updated";
  }
  if (updateType === "messages.media-update") {
    return "Media updated";
  }

  return updateType;
}
