import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";

import type { BrandingSettings, NumberRule, PostbackAction, PostbackActionRun, PostbackActionType, PostbackMaintenance, RuntimeStatus } from "../domain/models";
import { IconButton } from "./shared";

const titleAutosaveDelayMs = 1200;

export function SettingsView({
  branding,
  defaultBranding,
  isBusy,
  postbackActions,
  postbackMaintenance,
  postbackRuns,
  numberRules,
  runtimeStatus,
  onSave,
  onCleanupPostbackRecords,
  onCreatePostbackAction,
  onDeletePostbackAction,
  onResetWorkspaceState,
  onSavePostbackAction,
  onTestPostbackAction,
  onTogglePostbackAction,
}: {
  branding: BrandingSettings;
  defaultBranding: BrandingSettings;
  isBusy: boolean;
  postbackActions: PostbackAction[];
  postbackMaintenance: PostbackMaintenance | null;
  postbackRuns: PostbackActionRun[];
  numberRules: NumberRule[];
  runtimeStatus: RuntimeStatus | null;
  onSave: (branding: BrandingSettings) => void;
  onCleanupPostbackRecords: () => void;
  onCreatePostbackAction: (input: PostbackActionDraft) => void;
  onDeletePostbackAction: (actionId: string) => void;
  onResetWorkspaceState: () => void;
  onSavePostbackAction: (action: PostbackAction, input: PostbackActionDraft) => void;
  onTestPostbackAction: (action: PostbackAction) => void;
  onTogglePostbackAction: (action: PostbackAction, enabled: boolean) => void;
}) {
  const [draftTitle, setDraftTitle] = useState(branding.title);
  const [draftIconSrc, setDraftIconSrc] = useState(branding.iconSrc);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    setDraftTitle(branding.title);
    setDraftIconSrc(branding.iconSrc);
  }, [branding]);

  useEffect(() => {
    if (draftTitle === branding.title && draftIconSrc === branding.iconSrc) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onSaveRef.current({ title: draftTitle, iconSrc: draftIconSrc });
    }, titleAutosaveDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [branding.iconSrc, branding.title, draftIconSrc, draftTitle]);

  function uploadIcon(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setDraftIconSrc(reader.result);
        onSaveRef.current({ title: draftTitle, iconSrc: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

  function clearIcon() {
    setDraftIconSrc(defaultBranding.iconSrc);
    onSaveRef.current({ title: draftTitle, iconSrc: defaultBranding.iconSrc });
    if (iconInputRef.current) {
      iconInputRef.current.value = "";
    }
  }

  return (
    <>
      <section className="branding-form">
        <div className="branding-preview">
          <img src={draftIconSrc || defaultBranding.iconSrc} alt="" aria-hidden="true" />
          <strong>{draftTitle.trim() || defaultBranding.title}</strong>
        </div>

        <label className="field">
          <span>App title</span>
          <input
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder={defaultBranding.title}
          />
        </label>

        <label className="field">
          <span>Upload icon</span>
          <input
            accept="image/*"
            ref={iconInputRef}
            type="file"
            onChange={uploadIcon}
          />
        </label>

        <div className="settings-actions">
          <IconButton icon="mdi:image-remove-outline" label="Clear icon" type="button" variant="secondary" onClick={clearIcon} disabled={isBusy || draftIconSrc === defaultBranding.iconSrc}>
            Clear icon
          </IconButton>
          <IconButton icon="mdi:tab-remove" label="Reset browser workspace state" type="button" variant="secondary" onClick={onResetWorkspaceState} disabled={isBusy}>
            Reset workspace
          </IconButton>
        </div>
      </section>
      <PostbackSettings
        actions={postbackActions}
        isBusy={isBusy}
        maintenance={postbackMaintenance}
        numberRules={numberRules}
        runs={postbackRuns}
        runtimeStatus={runtimeStatus}
        onCleanup={onCleanupPostbackRecords}
        onCreate={onCreatePostbackAction}
        onDelete={onDeletePostbackAction}
        onSave={onSavePostbackAction}
        onTest={onTestPostbackAction}
        onToggle={onTogglePostbackAction}
      />
    </>
  );
}

export interface PostbackActionDraft {
  name: string;
  actionType: PostbackActionType;
  accountId: string;
  chatJid: string;
  url: string;
  hermesDeliveryMode: "api" | "platform";
  replyToWhatsApp: boolean;
}

function PostbackSettings({
  actions,
  isBusy,
  maintenance,
  numberRules,
  runs,
  runtimeStatus,
  onCleanup,
  onCreate,
  onDelete,
  onSave,
  onTest,
  onToggle,
}: {
  actions: PostbackAction[];
  isBusy: boolean;
  maintenance: PostbackMaintenance | null;
  numberRules: NumberRule[];
  runs: PostbackActionRun[];
  runtimeStatus: RuntimeStatus | null;
  onCleanup: () => void;
  onCreate: (input: PostbackActionDraft) => void;
  onDelete: (actionId: string) => void;
  onSave: (action: PostbackAction, input: PostbackActionDraft) => void;
  onTest: (action: PostbackAction) => void;
  onToggle: (action: PostbackAction, enabled: boolean) => void;
}) {
  const [editingActionId, setEditingActionId] = useState("");
  const [name, setName] = useState("");
  const [actionType, setActionType] = useState<PostbackActionType>("http");
  const [accountId, setAccountId] = useState("");
  const [chatJid, setChatJid] = useState("");
  const [url, setUrl] = useState("");
  const [hermesDeliveryMode, setHermesDeliveryMode] = useState<"api" | "platform">("api");
  const [replyToWhatsApp, setReplyToWhatsApp] = useState(true);
  const recentRuns = useMemo(() => runs.slice(0, 8), [runs]);
  const editingAction = actions.find((action) => action.id === editingActionId) ?? null;
  const nativeAdapter = runtimeStatus?.hermesNativeAdapter;
  const nativeActions = actions.filter((action) => action.actionType === "hermes" && parseActionConfig(action).deliveryMode === "platform");
  const nativeWarnings = nativeActions
    .map((action) => getNativeActionRuleWarning(action, numberRules))
    .filter(Boolean);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = { name, actionType, accountId, chatJid, url, hermesDeliveryMode, replyToWhatsApp };
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
    setAccountId(action.accountId ?? "");
    setChatJid(action.chatJid ?? "");
    setUrl(typeof config.url === "string" ? config.url : "");
    setHermesDeliveryMode(config.deliveryMode === "platform" ? "platform" : "api");
    setReplyToWhatsApp(typeof config.replyToWhatsApp === "boolean" ? config.replyToWhatsApp : true);
  }

  function clearForm() {
    setEditingActionId("");
    setName("");
    setActionType("http");
    setAccountId("");
    setChatJid("");
    setUrl("");
    setHermesDeliveryMode("api");
    setReplyToWhatsApp(true);
  }

  return (
    <section className="postback-settings">
      <div className="section-heading-row">
        <div>
          <h2>Postbacks</h2>
          <p>Configure inbound chat actions for Hermes and external webhooks.</p>
        </div>
      </div>

      <div className="postback-status-grid">
        <div className={`postback-status ${nativeAdapter?.ready ? "postback-status-ok" : "postback-status-warn"}`}>
          <strong>Native Hermes adapter</strong>
          <span>{nativeAdapter?.ready ? "Ready" : "Needs runtime config"}</span>
          <small>
            API URL {nativeAdapter?.apiUrlConfigured ? "set" : "missing"} | token {nativeAdapter?.apiTokenConfigured ? "set" : "missing"} | users {nativeAdapter?.allowAllUsers || nativeAdapter?.allowedUsersConfigured ? "allowed" : "restricted"}
          </small>
        </div>
        <div className="postback-status">
          <strong>Retention</strong>
          <span>{maintenance?.stats.postbackActionRuns ?? 0} runs | {maintenance?.stats.hermesPlatformEvents ?? 0} platform events</span>
          <small>
            Runs {maintenance?.retention.postbackRunRetentionDays ?? "-"}d | events {maintenance?.retention.hermesPlatformEventRetentionDays ?? "-"}d
          </small>
          <IconButton icon="mdi:broom" label="Clean old postback records" type="button" variant="secondary" onClick={onCleanup} disabled={isBusy}>
            Clean
          </IconButton>
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
            <option value="hermes">Hermes turn</option>
          </select>
        </label>
        <label className="field">
          <span>Account scope</span>
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="All accounts" />
        </label>
        <label className="field">
          <span>Chat scope</span>
          <input value={chatJid} onChange={(event) => setChatJid(event.target.value)} placeholder="All chats" />
        </label>
        {actionType === "http" ? (
          <label className="field postback-url-field">
            <span>Webhook URL</span>
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/webhook" />
          </label>
        ) : (
          <>
            <label className="field">
              <span>Hermes mode</span>
              <select value={hermesDeliveryMode} onChange={(event) => setHermesDeliveryMode(event.target.value as "api" | "platform")}>
                <option value="api">Manager API adapter</option>
                <option value="platform">Native platform adapter</option>
              </select>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={replyToWhatsApp} onChange={(event) => setReplyToWhatsApp(event.target.checked)} disabled={hermesDeliveryMode === "platform"} />
              <span>Send Hermes reply back to WhatsApp</span>
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
        {actions.length === 0 ? <p className="muted-copy">No postback actions configured.</p> : null}
      </div>

      <div className="postback-runs">
        <h3>Recent runs</h3>
        {recentRuns.map((run) => (
          <div className={`postback-run postback-run-${run.status}`} key={run.id}>
            <span>{run.actionName}</span>
            <strong>{run.status}</strong>
            <small>{run.accountId} | {run.chatJid}</small>
          </div>
        ))}
        {recentRuns.length === 0 ? <p className="muted-copy">No postback runs yet.</p> : null}
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
    ? config.deliveryMode === "platform" ? "Hermes native" : "Hermes API"
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
