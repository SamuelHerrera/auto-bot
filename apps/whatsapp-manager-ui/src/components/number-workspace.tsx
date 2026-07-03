import { FormEvent, useState } from "react";
import { Icon } from "@iconify/react";

import { getAccountStatusDetail, isPendingAccountId } from "../domain/accounts";
import type { ChatMessage, ChatSummary, DeliveryRecord, NumberRule, NumberRuleAction, NumberRuleMatchType, NumberSubview, PostbackAction, PostbackActionRun, SessionMapping, WhatsAppAccount } from "../domain/models";
import { FailuresView } from "./number-failures-view";
import { HomeView } from "./number-home-view";
import { MessagesView } from "./number-messages-view";
import { RulesView } from "./number-rules-view";
import { PostbackRunHistory, PostbackSettings } from "./postback-settings";
import type { PostbackActionDraft } from "./postback-settings";
import { EmptyState, IconButton, TabButton } from "./shared";

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
  postbackActions,
  postbackRuns,
  onActionChange,
  onAliasChange,
  onAliasSave,
  onCreatePostbackAction,
  onCreateRule,
  onDeletePostbackAction,
  onDeleteRule,
  onDisconnect,
  onEnabledChange,
  onLabelChange,
  onMatchTypeChange,
  onPatternChange,
  onRetry,
  onSavePostbackAction,
  onSelectChat,
  onSetChatArchived,
  onTestPostbackAction,
  onTogglePostbackAction,
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
  postbackActions: PostbackAction[];
  postbackRuns: PostbackActionRun[];
  onActionChange: (value: NumberRuleAction) => void;
  onAliasChange: (value: string) => void;
  onAliasSave: (alias: string) => void;
  onCreatePostbackAction: (input: PostbackActionDraft) => void;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => void;
  onDeletePostbackAction: (actionId: string) => void;
  onDeleteRule: (ruleId: string) => void;
  onDisconnect: (accountId: string) => void;
  onEnabledChange: (rule: NumberRule, enabled: boolean) => void;
  onLabelChange: (value: string) => void;
  onMatchTypeChange: (value: NumberRuleMatchType) => void;
  onPatternChange: (value: string) => void;
  onRetry: (deliveryId: string) => void;
  onSavePostbackAction: (action: PostbackAction, input: PostbackActionDraft) => void;
  onSelectChat: (chatJid: string) => void;
  onSetChatArchived: (chat: ChatSummary, archived: boolean) => void;
  onTestPostbackAction: (action: PostbackAction) => void;
  onTogglePostbackAction: (action: PostbackAction, enabled: boolean) => void;
  onViewChange: (view: NumberSubview) => void;
  pattern: string;
  ruleAction: NumberRuleAction;
  ruleLabel: string;
  rules: NumberRule[];
}) {
  const [isAliasDialogOpen, setIsAliasDialogOpen] = useState(false);
  const mainInteractedChatCount = chats.filter((chat) => !chat.managerArchived && chat.messageCount > 0).length;

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
          <TabButton active={activeView === "messages"} count={mainInteractedChatCount} icon="mdi:message-text-outline" onClick={() => onViewChange("messages")}>
            Messages
          </TabButton>
          <TabButton active={activeView === "rules"} count={rules.length} icon="mdi:shield-check-outline" onClick={() => onViewChange("rules")}>
            Rules
          </TabButton>
          <TabButton active={activeView === "postbacks"} count={postbackActions.length} icon="mdi:webhook" onClick={() => onViewChange("postbacks")}>
            Postbacks
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
            onSetChatArchived={onSetChatArchived}
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

      {activeView === "postbacks" ? (
        <div className="number-view-scroll postback-account-view">
          <PostbackSettings
            accountId={account.accountId}
            actions={postbackActions}
            isBusy={isBusy}
            numberRules={rules}
            onCreate={onCreatePostbackAction}
            onDelete={onDeletePostbackAction}
            onSave={onSavePostbackAction}
            onTest={onTestPostbackAction}
            onToggle={onTogglePostbackAction}
          />
          <PostbackRunHistory runs={postbackRuns} />
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
