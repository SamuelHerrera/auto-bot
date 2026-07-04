import { useState } from "react";
import type { FormEvent } from "react";

import type { NumberRule, PostbackAction, PostbackActionType } from "../domain/models";
import { IconButton } from "./shared";

export interface PostbackActionDraft {
  name: string;
  actionType: PostbackActionType;
  accountId: string;
  chatJid: string;
  url: string;
}

export function PostbackSettings({
  actions,
  accountId: scopedAccountId,
  isBusy,
  numberRules,
  onCreate,
  onDelete,
  onSave,
  onTest,
  onToggle,
}: {
  actions: PostbackAction[];
  accountId?: string;
  isBusy: boolean;
  numberRules: NumberRule[];
  onCreate: (input: PostbackActionDraft) => void;
  onDelete: (actionId: string) => void;
  onSave: (action: PostbackAction, input: PostbackActionDraft) => void;
  onTest: (action: PostbackAction) => void;
  onToggle: (action: PostbackAction, enabled: boolean) => void;
}) {
  const [editingActionId, setEditingActionId] = useState("");
  const [name, setName] = useState("");
  const [actionType, setActionType] = useState<PostbackActionType>("http");
  const [accountId, setAccountId] = useState(scopedAccountId ?? "");
  const [chatJid, setChatJid] = useState("");
  const [url, setUrl] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const editingAction = actions.find((action) => action.id === editingActionId) ?? null;
  const nativeActions = actions.filter((action) => action.actionType === "agent" && parseActionConfig(action).deliveryMode === "platform");
  const nativeWarnings = nativeActions
    .map((action) => getNativeActionRuleWarning(action, numberRules))
    .filter(Boolean);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = {
      name,
      actionType,
      accountId: scopedAccountId ?? accountId,
      chatJid,
      url,
    };
    if (editingAction) {
      onSave(editingAction, draft);
    } else {
      onCreate(draft);
      closeForm();
    }
  }

  function deleteAction(action: PostbackAction) {
    onDelete(action.id);
    if (action.id === editingActionId) {
      closeForm();
    }
  }

  function editAction(action: PostbackAction) {
    const config = parseActionConfig(action);
    setEditingActionId(action.id);
    setName(action.name);
    setActionType(action.actionType);
    setAccountId(scopedAccountId ?? action.accountId ?? "");
    setChatJid(action.chatJid ?? "");
    setUrl(typeof config.url === "string" ? config.url : "");
    setIsFormOpen(true);
  }

  function clearForm() {
    setEditingActionId("");
    setName("");
    setActionType("http");
    setAccountId(scopedAccountId ?? "");
    setChatJid("");
    setUrl("");
  }

  function openCreateForm() {
    clearForm();
    setIsFormOpen(true);
  }

  function closeForm() {
    clearForm();
    setIsFormOpen(false);
  }

  return (
    <section className="postback-settings">
      <div className="section-heading-row">
        <div>
          <h2>Postbacks</h2>
          <p>Configure inbound chat actions for this WhatsApp account.</p>
        </div>
        <IconButton icon="mdi:plus" label="Create postback" onClick={openCreateForm} disabled={isBusy}>
          Create
        </IconButton>
      </div>

      {nativeWarnings.length > 0 ? (
        <div className="postback-warning-list">
          {nativeWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}

      <div className="postback-master-detail">
        <div className="postback-list" aria-label="Postback actions">
          {actions.map((action) => (
            <article className={`postback-row${action.id === editingActionId ? " postback-row-active" : ""}`} key={action.id}>
              <button className="postback-row-main" type="button" onClick={() => editAction(action)} aria-pressed={action.id === editingActionId}>
                <strong>{action.name}</strong>
                <span>{getActionSummary(action)}</span>
              </button>
              <label className="switch-label">
                <input type="checkbox" checked={action.enabled} onChange={(event) => onToggle(action, event.target.checked)} />
                <span>{action.enabled ? "Enabled" : "Disabled"}</span>
              </label>
              <div className="postback-row-actions">
                <IconButton icon="mdi:trash-can-outline" label={`Delete ${action.name}`} variant="danger" onClick={() => deleteAction(action)} disabled={isBusy} />
              </div>
            </article>
          ))}
          {actions.length === 0 ? <p className="muted-copy">No postback actions configured for this account.</p> : null}
        </div>

        <section className="postback-detail-panel" aria-labelledby="postback-detail-title">
          {isFormOpen ? (
            <form onSubmit={submit}>
              <div className="postback-detail-header">
                <div>
                  <span className="panel-kicker">Postback</span>
                  <h3 id="postback-detail-title">{editingAction ? "Edit postback" : "Create postback"}</h3>
                  <p className="dialog-subtitle">{scopedAccountId ?? "All accounts"}</p>
                </div>
                <IconButton icon="mdi:close" label="Close postback form" variant="text" onClick={closeForm} type="button" />
              </div>

              <div className="postback-form">
                <label className="field">
                  <span>Name</span>
                  <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Notify CRM" />
                </label>
                <label className="field">
                  <span>Action</span>
                  <select value={actionType} onChange={(event) => setActionType(event.target.value as PostbackActionType)}>
                    <option value="http">HTTP webhook</option>
                    <option value="agent">Agent callback</option>
                  </select>
                </label>
                {scopedAccountId ? null : (
                  <label className="field">
                    <span>Account scope</span>
                    <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="All accounts" />
                  </label>
                )}
                <label className="field">
                  <span>Chat scope</span>
                  <input value={chatJid} onChange={(event) => setChatJid(event.target.value)} placeholder="All chats in this account" />
                </label>
                {actionType === "http" ? (
                  <label className="field postback-url-field">
                    <span>Webhook URL</span>
                    <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhook" />
                  </label>
                ) : (
                  <div className="postback-mode-note">
                    Platform queue - adapter replies later
                  </div>
                )}
              </div>
              <div className="postback-detail-actions">
                <IconButton icon="mdi:close" label="Cancel" type="button" variant="secondary" onClick={closeForm} disabled={isBusy}>
                  Cancel
                </IconButton>
                {editingAction ? (
                  <IconButton icon="mdi:play-outline" label={`Test ${editingAction.name}`} type="button" variant="secondary" onClick={() => onTest(editingAction)} disabled={isBusy}>
                    Test
                  </IconButton>
                ) : null}
                <IconButton icon={editingAction ? "mdi:content-save-outline" : "mdi:plus"} label={editingAction ? "Save postback" : "Create postback"} type="submit" disabled={isBusy || !name.trim()}>
                  {editingAction ? "Save" : "Create"}
                </IconButton>
              </div>
            </form>
          ) : (
            <div className="postback-detail-empty">
              <span className="panel-kicker">Postback</span>
              <h3 id="postback-detail-title">Select a postback</h3>
              <p>Choose an action from the list or create a new one.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function parseActionConfig(action: PostbackAction): Record<string, unknown> {
  try {
    const parsed = JSON.parse(action.configJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function getActionSummary(action: PostbackAction) {
  const mode = action.actionType === "agent"
    ? "Platform queue"
    : "HTTP";
  return `${mode} | ${action.accountId || "all accounts"} | ${action.chatJid || "all chats"}`;
}

function getNativeActionRuleWarning(action: PostbackAction, rules: NumberRule[]) {
  if (!action.accountId || !action.chatJid) {
    return "";
  }
  const chatJid = action.chatJid;
  const accountRules = rules.filter((rule) => rule.enabled && rule.accountId === action.accountId);
  const hasDenyAll = accountRules.some((rule) => rule.action === "deny" && rule.matchType === "all");
  if (!hasDenyAll) {
    return "";
  }
  const hasExactAllow = accountRules.some((rule) => rule.action === "allow" && rule.matchType === "exact" && rule.pattern === chatJid);
  const hasRegexAllow = accountRules.some((rule) => {
    if (rule.action !== "allow" || rule.matchType !== "regex") {
      return false;
    }
    try {
      return new RegExp(rule.pattern).test(chatJid);
    } catch {
      return false;
    }
  });
  return hasExactAllow || hasRegexAllow
    ? ""
    : `${action.name} is scoped to ${chatJid}, but ${action.accountId} has deny-all rules and no matching allow rule.`;
}
