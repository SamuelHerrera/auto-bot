import { useMemo, useState } from "react";
import type { FormEvent } from "react";

import type { NumberRule, PostbackAction, PostbackActionRun, PostbackActionType } from "../domain/models";
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
  const editingAction = actions.find((action) => action.id === editingActionId) ?? null;
  const nativeActions = actions.filter((action) => action.actionType === "hermes" && parseActionConfig(action).deliveryMode === "platform");
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
    clearForm();
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

  return (
    <section className="postback-settings">
      <div className="section-heading-row">
        <div>
          <h2>Postbacks</h2>
          <p>Configure inbound chat actions for this WhatsApp account.</p>
        </div>
      </div>

      {nativeWarnings.length > 0 ? (
        <div className="postback-warning-list">
          {nativeWarnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}

      <form className="postback-form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Notify CRM" />
        </label>
        <label className="field">
          <span>Action</span>
          <select value={actionType} onChange={(event) => setActionType(event.target.value as PostbackActionType)}>
            <option value="http">HTTP webhook</option>
            <option value="hermes">Agent callback</option>
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
                <option value="api">Direct callback</option>
                <option value="platform">Platform event queue</option>
              </select>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={replyToWhatsApp} onChange={(event) => setReplyToWhatsApp(event.target.checked)} disabled={callbackDeliveryMode === "platform"} />
              <span>Send callback reply back to WhatsApp</span>
            </label>
          </>
        )}
        <div className="settings-actions">
          <IconButton icon={editingAction ? "mdi:content-save-outline" : "mdi:plus"} label={editingAction ? "Save postback" : "Create postback"} type="submit" disabled={isBusy || !name.trim()}>
            {editingAction ? "Save" : "Create"}
          </IconButton>
          {editingAction ? (
            <IconButton icon="mdi:close" label="Cancel edit" type="button" variant="secondary" onClick={clearForm} disabled={isBusy}>
              Cancel
            </IconButton>
          ) : null}
        </div>
      </form>

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
    </section>
  );
}

export function PostbackRunHistory({ runs }: { runs: PostbackActionRun[] }) {
  const recentRuns = useMemo(() => runs.slice(0, 25), [runs]);

  return (
    <section className="postback-settings">
      <div className="postback-runs">
        <div className="section-heading-row">
          <div>
            <h2>Run History</h2>
            <p>Postback runs are execution records for configured postback actions after inbound chat events.</p>
          </div>
        </div>
        {recentRuns.map((run) => (
          <div className={`postback-run postback-run-${run.status}`} key={run.id}>
            <span>{run.actionName}</span>
            <strong>{run.status}</strong>
            <small>{run.accountId} | {run.chatJid}</small>
          </div>
        ))}
        {recentRuns.length === 0 ? <p className="muted-copy">No postback actions have run for this account yet.</p> : null}
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
  const config = parseActionConfig(action);
  const mode = action.actionType === "hermes"
    ? config.deliveryMode === "platform" ? "Platform callback" : "Direct callback"
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
