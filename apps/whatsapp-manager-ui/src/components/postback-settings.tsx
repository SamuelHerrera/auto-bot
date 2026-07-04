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
  callbackDeliveryMode: "api" | "platform";
  replyToWhatsApp: boolean;
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
  const [callbackDeliveryMode, setCallbackDeliveryMode] = useState<"api" | "platform">("api");
  const [replyToWhatsApp, setReplyToWhatsApp] = useState(true);
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
      callbackDeliveryMode,
      replyToWhatsApp,
    };
    if (editingAction) {
      onSave(editingAction, draft);
    } else {
      onCreate(draft);
    }
    closeForm();
  }

  function editAction(action: PostbackAction) {
    const config = parseActionConfig(action);
    setEditingActionId(action.id);
    setName(action.name);
    setActionType(action.actionType);
    setAccountId(scopedAccountId ?? action.accountId ?? "");
    setChatJid(action.chatJid ?? "");
    setUrl(typeof config.url === "string" ? config.url : "");
    setCallbackDeliveryMode(config.deliveryMode === "platform" ? "platform" : "api");
    setReplyToWhatsApp(typeof config.replyToWhatsApp === "boolean" ? config.replyToWhatsApp : true);
    setIsFormOpen(true);
  }

  function clearForm() {
    setEditingActionId("");
    setName("");
    setActionType("http");
    setAccountId(scopedAccountId ?? "");
    setChatJid("");
    setUrl("");
    setCallbackDeliveryMode("api");
    setReplyToWhatsApp(true);
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

      <div className="postback-list">
        {actions.map((action) => (
          <article className="postback-row" key={action.id}>
            <div>
              <strong>{action.name}</strong>
              <span>{getActionSummary(action)}</span>
            </div>
            <label className="switch-label">
              <input type="checkbox" checked={action.enabled} onChange={(event) => onToggle(action, event.target.checked)} />
              <span>{action.enabled ? "Enabled" : "Disabled"}</span>
            </label>
            <div className="postback-row-actions">
              <IconButton icon="mdi:pencil-outline" label={`Edit ${action.name}`} variant="secondary" onClick={() => editAction(action)} disabled={isBusy} />
              <IconButton icon="mdi:play-outline" label={`Test ${action.name}`} variant="secondary" onClick={() => onTest(action)} disabled={isBusy} />
              <IconButton icon="mdi:trash-can-outline" label={`Delete ${action.name}`} variant="danger" onClick={() => onDelete(action.id)} disabled={isBusy} />
            </div>
          </article>
        ))}
        {actions.length === 0 ? <p className="muted-copy">No postback actions configured for this account.</p> : null}
      </div>

      {isFormOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <section className="postback-dialog" role="dialog" aria-modal="true" aria-labelledby="postback-dialog-title">
            <form onSubmit={submit}>
              <div className="dialog-header">
                <div>
                  <span className="panel-kicker">Postback</span>
                  <h3 id="postback-dialog-title">{editingAction ? "Edit postback" : "Create postback"}</h3>
                  <p className="dialog-subtitle">{scopedAccountId ?? "All accounts"}</p>
                </div>
                <IconButton icon="mdi:close" label="Close postback dialog" variant="text" onClick={closeForm} type="button" />
              </div>

              <div className="dialog-body postback-dialog-body">
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
                    <>
                      <label className="field">
                        <span>Callback mode</span>
                        <select value={callbackDeliveryMode} onChange={(event) => setCallbackDeliveryMode(event.target.value as "api" | "platform")}>
                          <option value="api">Direct callback - immediate reply</option>
                          <option value="platform">Platform queue - adapter replies later</option>
                        </select>
                      </label>
                      <label className="toggle-row">
                        <input type="checkbox" checked={replyToWhatsApp} onChange={(event) => setReplyToWhatsApp(event.target.checked)} disabled={callbackDeliveryMode === "platform"} />
                        <span>Send callback reply back to WhatsApp</span>
                      </label>
                    </>
                  )}
                </div>
                <div className="dialog-actions">
                  <IconButton icon="mdi:close" label="Cancel" type="button" variant="secondary" onClick={closeForm} disabled={isBusy}>
                    Cancel
                  </IconButton>
                  <IconButton icon={editingAction ? "mdi:content-save-outline" : "mdi:plus"} label={editingAction ? "Save postback" : "Create postback"} type="submit" disabled={isBusy || !name.trim()}>
                    {editingAction ? "Save" : "Create"}
                  </IconButton>
                </div>
              </div>
            </form>
          </section>
        </div>
      ) : null}
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
  const config = parseActionConfig(action);
  const mode = action.actionType === "agent"
    ? config.deliveryMode === "platform" ? "Platform queue" : "Direct callback"
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
