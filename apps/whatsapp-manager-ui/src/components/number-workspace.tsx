import { FormEvent, useState } from "react";
import { Icon } from "@iconify/react";

import { getAccountActivity, getAccountStatusDetail, isPendingAccountId } from "../domain/accounts";
import { buildChatMessages } from "../domain/chats";
import { formatCountLabel, formatTimestamp } from "../domain/formatting";
import type { ChatMessage, ChatSummary, DeliveryRecord, NumberRule, NumberRuleAction, NumberRuleMatchType, NumberSubview, SessionMapping, WhatsAppAccount } from "../domain/models";
import { getRuleDisplayValue } from "../domain/rules";
import { EmptyState, IconButton, Metric, TabButton } from "./shared";

export function NumberWorkspace({
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
        <div className="number-view-scroll">
          <HomeView
            account={account}
            chats={chats}
            deliveries={deliveries}
            failedDeliveries={failedDeliveries}
            mappings={mappings}
            rules={rules}
          />
        </div>
      ) : null}

      {activeView === "messages" ? (
        <div className="number-view-scroll">
          <MessagesView
            activeAccountId={account.accountId}
            activeChat={activeChat}
            activeChatJid={activeChatJid}
            activeChatMessages={activeChatMessages}
            chats={chats}
            onSelectChat={onSelectChat}
          />
        </div>
      ) : null}

      {activeView === "rules" ? (
        <div className="number-view-scroll">
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
        </div>
      ) : null}

      {activeView === "failures" ? (
        <div className="number-view-scroll">
          <FailuresView failedDeliveries={failedDeliveries} isBusy={isBusy} onRetry={onRetry} />
        </div>
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
