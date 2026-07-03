import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, LinkAccountDialog, LogsView, NumberChooserPanel, NumberWorkspace, SettingsView, TopBar } from "./components";
import { accountMatchesSearch, findCompletedLinkedAccount, isPendingAccountId } from "./domain/accounts";
import { buildChatMessages, buildChatSummaries, buildContactDisplayIndex } from "./domain/chats";
import type {
  AuditLogRecord,
  BrandingSettings,
  DeliveryRecord,
  ManagerChatMetadata,
  NumberRule,
  NumberRuleAction,
  NumberRuleMatchType,
  NumberSubview,
  RefreshScope,
  SessionMapping,
  WhatsAppAccount,
  WhatsAppContact,
  WhatsAppLidMapping,
  WhatsAppMessageCount,
  WhatsAppMediaAsset,
  WhatsAppMessageReceipt,
  WhatsAppMessageUpdate,
  WhatsAppSyncedChat,
  WhatsAppSyncedMessage,
} from "./domain/models";
import { useLinkSession } from "./hooks/use-link-session";
import { useWorkspaceTabs } from "./hooks/use-workspace-tabs";
import { buildEventUrl, normalizeError, request } from "./services/api-client";
import { brandingStorageKeys, defaultAppIcon, defaultAppTitle, getInitialBranding, normalizeBranding, setFavicon } from "./services/branding";

interface AppSseEvent {
  type: string;
  at: string;
  details?: Record<string, unknown>;
}

interface AccountMetadata {
  accountId: string;
  alias?: string;
}

export function App() {
  const [branding, setBranding] = useState<BrandingSettings>(getInitialBranding);
  const [accounts, setAccounts] = useState<WhatsAppAccount[]>([]);
  const [hasLoadedAccounts, setHasLoadedAccounts] = useState(false);
  const [mappings, setMappings] = useState<SessionMapping[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [managerChatMetadata, setManagerChatMetadata] = useState<ManagerChatMetadata[]>([]);
  const [contacts, setContacts] = useState<WhatsAppContact[]>([]);
  const [lidMappings, setLidMappings] = useState<WhatsAppLidMapping[]>([]);
  const [syncedChats, setSyncedChats] = useState<WhatsAppSyncedChat[]>([]);
  const [syncedMessages, setSyncedMessages] = useState<WhatsAppSyncedMessage[]>([]);
  const [syncedMessageCounts, setSyncedMessageCounts] = useState<WhatsAppMessageCount[]>([]);
  const [messageReceipts, setMessageReceipts] = useState<WhatsAppMessageReceipt[]>([]);
  const [messageUpdates, setMessageUpdates] = useState<WhatsAppMessageUpdate[]>([]);
  const [mediaAssets, setMediaAssets] = useState<WhatsAppMediaAsset[]>([]);
  const [numberRules, setNumberRules] = useState<NumberRule[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [activeNumberView, setActiveNumberView] = useState<NumberSubview>("home");
  const [accountSearch, setAccountSearch] = useState("");
  const [isNumberPanelOpen, setIsNumberPanelOpen] = useState(false);
  const [activeChatJid, setActiveChatJid] = useState("");
  const [statusMessage, setStatusMessage] = useState("Live");
  const [errorMessage, setErrorMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [ruleAction, setRuleAction] = useState<NumberRuleAction>("allow");
  const [ruleMatchType, setRuleMatchType] = useState<NumberRuleMatchType>("exact");
  const [rulePattern, setRulePattern] = useState("");
  const [ruleLabel, setRuleLabel] = useState("");
  const [accountAliasDrafts, setAccountAliasDrafts] = useState<Record<string, string>>({});
  const accountsRef = useRef(accounts);
  const pendingRefreshScopesRef = useRef<Set<RefreshScope>>(new Set());
  const refreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const activeAccountIdRef = useRef("");
  const activeNumberViewRef = useRef<NumberSubview>("home");
  const activeChatJidRef = useRef("");
  const isLogsTabOpenRef = useRef(false);
  const hasRequestedInitialDataRef = useRef(false);
  const loadedActivityAccountIdsRef = useRef<Set<string>>(new Set());
  const loadedChatDetailKeysRef = useRef<Set<string>>(new Set());
  const {
    clearLinkSession,
    isLinkDialogOpen,
    isLinkDialogOpenRef,
    linkingBaselineAccountIdsRef,
    linkingStartedAtRef,
    linkingStatus,
    linkingStatusRef,
    startLinkSession,
    updateLinkingStatus,
  } = useLinkSession();
  const resetActiveChat = useCallback(() => setActiveChatJid(""), []);
  const {
    activeAccountId,
    activeTabId,
    closeAccountTab,
    closeLogsTab,
    closeSettingsTab,
    isLogsTabOpen,
    isSettingsTabOpen,
    openAccountTab,
    openAccountTabs,
    openLogsTab,
    openSettingsTab,
    selectAccountTab,
    setActiveAccountId,
    setActiveTabId,
    workspaceTabsRef,
  } = useWorkspaceTabs({
    accounts,
    hasLoadedAccounts,
    onAccountViewReset: resetActiveChat,
  });

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  useEffect(() => {
    activeAccountIdRef.current = activeAccountId;
  }, [activeAccountId]);

  useEffect(() => {
    activeChatJidRef.current = activeChatJid;
  }, [activeChatJid]);

  useEffect(() => {
    activeNumberViewRef.current = activeNumberView;
  }, [activeNumberView]);

  useEffect(() => {
    isLogsTabOpenRef.current = isLogsTabOpen;
  }, [isLogsTabOpen]);

  useEffect(() => {
    document.title = branding.title;
    setFavicon(branding.iconSrc);
  }, [branding]);

  useEffect(() => {
    if (hasRequestedInitialDataRef.current) {
      return;
    }

    hasRequestedInitialDataRef.current = true;
    void refreshData(false, false, ["accounts", "rules", "logs"]);
  }, []);

  useEffect(() => {
    const events = new EventSource(buildEventUrl());
    events.addEventListener("accounts", (event) => {
      if (applyAccountsEvent(event)) {
        return;
      }

      queueRefreshData(["accounts"]);
    });
    events.addEventListener("activity", (event) => {
      if (applyActivityEvent(event)) {
        return;
      }

      queueRefreshData(["activity", "chat"]);
    });
    events.addEventListener("rules", (event) => {
      if (applyRulesEvent(event)) {
        return;
      }

      queueRefreshData(["rules"]);
    });
    events.addEventListener("logs", (event) => {
      if (applyLogsEvent(event)) {
        return;
      }

      if (isLogsTabOpenRef.current) {
        queueRefreshData(["logs"]);
      }
    });
    events.addEventListener("sync", () => {
      queueRefreshData(["accounts", "directory", "activity", "chat", "rules", "logs"]);
    });
    events.onerror = () => {
      setStatusMessage("Live updates reconnecting.");
    };

    return () => {
      events.close();
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!activeAccountId) {
      return;
    }

    if (loadedActivityAccountIdsRef.current.has(activeAccountId)) {
      return;
    }

    loadedActivityAccountIdsRef.current.add(activeAccountId);
    void refreshData(false, false, ["directory", "activity"]);
  }, [activeAccountId]);

  useEffect(() => {
    if (!activeAccountId || !activeChatJid || activeNumberView !== "messages") {
      return;
    }

    const chatDetailKey = `${activeAccountId}:${activeChatJid}`;
    if (loadedChatDetailKeysRef.current.has(chatDetailKey)) {
      return;
    }

    loadedChatDetailKeysRef.current.add(chatDetailKey);
    void refreshData(false, false, ["chat"]);
  }, [activeAccountId, activeChatJid, activeNumberView]);

  useEffect(() => {
    if (activeTabId !== "logs" || !isLogsTabOpen) {
      return;
    }

    void refreshData(false, false, ["logs"]);
  }, [activeTabId, isLogsTabOpen]);

  function queueRefreshData(scopes: RefreshScope[], delayMs = 150) {
    for (const scope of scopes) {
      pendingRefreshScopesRef.current.add(scope);
    }

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void flushQueuedRefresh();
    }, delayMs);
  }

  async function flushQueuedRefresh() {
    if (refreshInFlightRef.current) {
      if (pendingRefreshScopesRef.current.size > 0) {
        queueRefreshData([], 50);
      }
      return;
    }

    const scopes = [...pendingRefreshScopesRef.current];
    pendingRefreshScopesRef.current.clear();
    if (scopes.length === 0) {
      return;
    }

    refreshInFlightRef.current = true;
    try {
      await refreshData(false, false, scopes);
    } finally {
      refreshInFlightRef.current = false;
      if (pendingRefreshScopesRef.current.size > 0) {
        queueRefreshData([], 0);
      }
    }
  }

  async function refreshData(
    showMessage = true,
    showBusy = true,
    scopes: RefreshScope[] = ["accounts", "directory", "activity", "rules", "logs"],
  ) {
    if (showBusy) {
      setIsBusy(true);
    }
    setErrorMessage("");

    try {
      const shouldRefreshAccounts = scopes.includes("accounts");
      const activityAccountId = activeAccountIdRef.current;
      const directoryAccountId = activeAccountIdRef.current;
      const chatAccountId = activeAccountIdRef.current;
      const chatJid = activeChatJidRef.current;
      const shouldRefreshDirectory = scopes.includes("directory") && Boolean(directoryAccountId);
      const shouldRefreshActivity = scopes.includes("activity") && Boolean(activityAccountId);
      const shouldRefreshChat = scopes.includes("chat") && activeNumberViewRef.current === "messages" && Boolean(chatAccountId && chatJid);
      const shouldRefreshRules = scopes.includes("rules");
      const shouldRefreshLogs = scopes.includes("logs");
      const directoryAccountQuery = shouldRefreshDirectory ? toQueryString({ accountId: directoryAccountId }) : "";
      const activityAccountQuery = shouldRefreshActivity ? toQueryString({ accountId: activityAccountId }) : "";
      const chatQuery = shouldRefreshChat ? toQueryString({ accountId: chatAccountId, chatJid }) : "";
      const [
        accountResponse,
        mappingResponse,
        deliveryResponse,
        managerChatMetadataResponse,
        syncedChatResponse,
        contactResponse,
        lidMappingResponse,
        messageCountResponse,
        syncedMessageResponse,
        receiptResponse,
        updateResponse,
        mediaAssetResponse,
        ruleResponse,
        linkStatus,
        auditLogResponse,
      ] = await Promise.all([
        shouldRefreshAccounts ? request<{ items: WhatsAppAccount[] }>("/whatsapp/accounts") : Promise.resolve(null),
        shouldRefreshDirectory ? request<{ items: SessionMapping[] }>(`/sessions?${directoryAccountQuery}`) : Promise.resolve(null),
        shouldRefreshActivity ? request<{ items: DeliveryRecord[] }>(`/deliveries?${activityAccountQuery}`) : Promise.resolve(null),
        shouldRefreshDirectory ? request<{ items: ManagerChatMetadata[] }>(`/manager/chats?${directoryAccountQuery}`) : Promise.resolve(null),
        shouldRefreshDirectory ? request<{ items: WhatsAppSyncedChat[] }>(`/whatsapp/sync/chats?limit=1000&${directoryAccountQuery}`) : Promise.resolve(null),
        shouldRefreshDirectory ? request<{ items: WhatsAppContact[] }>(`/whatsapp/sync/contacts?limit=1000&${directoryAccountQuery}`) : Promise.resolve(null),
        shouldRefreshDirectory ? request<{ items: WhatsAppLidMapping[] }>(`/whatsapp/sync/lid-mappings?limit=1000&${directoryAccountQuery}`) : Promise.resolve(null),
        shouldRefreshActivity ? request<{ items: WhatsAppMessageCount[] }>(`/whatsapp/sync/message-counts?${activityAccountQuery}`) : Promise.resolve(null),
        shouldRefreshChat ? request<{ items: WhatsAppSyncedMessage[] }>(`/whatsapp/sync/messages?limit=1000&${chatQuery}`) : Promise.resolve(null),
        shouldRefreshChat ? optionalRequest<{ items: WhatsAppMessageReceipt[] }>(`/whatsapp/sync/message-receipts?limit=1000&${chatQuery}`) : Promise.resolve(null),
        shouldRefreshChat ? optionalRequest<{ items: WhatsAppMessageUpdate[] }>(`/whatsapp/sync/message-updates?limit=1000&${chatQuery}`) : Promise.resolve(null),
        shouldRefreshChat ? optionalRequest<{ items: WhatsAppMediaAsset[] }>(`/whatsapp/sync/media-assets?limit=1000&${chatQuery}`) : Promise.resolve(null),
        shouldRefreshRules ? request<{ items: NumberRule[] }>("/number-rules") : Promise.resolve(null),
        shouldRefreshAccounts ? request<WhatsAppAccount>("/whatsapp/status") : Promise.resolve(null),
        shouldRefreshLogs ? request<{ items: AuditLogRecord[] }>("/audit-logs?limit=200") : Promise.resolve(null),
      ]);

      const refreshedAccounts = accountResponse?.items;

      if (accountResponse) {
        setAccounts(accountResponse.items);
        setHasLoadedAccounts(true);
      }
      if (mappingResponse) {
        setMappings((current) => replaceByAccount(current, directoryAccountId, mappingResponse.items.filter((mapping) => mapping.chatType === "direct")));
      }
      if (deliveryResponse) {
        setDeliveries((current) => replaceByAccount(current, activityAccountId, deliveryResponse.items.filter((delivery) => delivery.chatType === "direct")));
      }
      if (managerChatMetadataResponse) {
        setManagerChatMetadata((current) => replaceByAccount(current, directoryAccountId, managerChatMetadataResponse.items));
      }
      if (syncedChatResponse) {
        setSyncedChats((current) => replaceByAccount(current, directoryAccountId, syncedChatResponse.items.filter((chat) => chat.chatType === "direct")));
      }
      if (contactResponse) {
        setContacts((current) => replaceByAccount(current, directoryAccountId, contactResponse.items));
      }
      if (lidMappingResponse) {
        setLidMappings((current) => replaceByAccount(current, directoryAccountId, lidMappingResponse.items));
      }
      if (messageCountResponse) {
        setSyncedMessageCounts((current) => replaceByAccount(current, activityAccountId, messageCountResponse.items));
      }
      if (syncedMessageResponse) {
        setSyncedMessages((current) => replaceByChat(current, chatAccountId, chatJid, syncedMessageResponse.items));
      }
      if (receiptResponse) {
        setMessageReceipts((current) => replaceByChat(current, chatAccountId, chatJid, receiptResponse.items));
      }
      if (updateResponse) {
        setMessageUpdates((current) => replaceByChat(current, chatAccountId, chatJid, updateResponse.items));
      }
      if (mediaAssetResponse) {
        setMediaAssets((current) => replaceByChat(current, chatAccountId, chatJid, mediaAssetResponse.items));
      }
      if (ruleResponse) {
        setNumberRules(ruleResponse.items);
      }
      if (auditLogResponse) {
        setAuditLogs(auditLogResponse.items);
      }
      const currentAccounts = refreshedAccounts ?? accountsRef.current;
      const currentLinkingStatus = linkingStatusRef.current;
      const currentBaselineAccountIds = linkingBaselineAccountIdsRef.current;
      const isCurrentLinkDialogOpen = isLinkDialogOpenRef.current;
      const completedLinkedAccount = findCompletedLinkedAccount(
        currentAccounts,
        linkStatus,
        currentLinkingStatus,
        currentBaselineAccountIds,
        linkingStartedAtRef.current,
      );
      if (completedLinkedAccount && (currentLinkingStatus || isCurrentLinkDialogOpen)) {
        clearLinkSession();
        setActiveAccountId(completedLinkedAccount.accountId);
        openAccountTab(completedLinkedAccount.accountId);
        setStatusMessage(`Account ${completedLinkedAccount.accountId} linked.`);
      } else if ((currentLinkingStatus || isCurrentLinkDialogOpen) && (linkStatus?.qrCode || linkStatus?.status === "connecting")) {
        updateLinkingStatus(linkStatus);
      } else if (linkStatus && (currentLinkingStatus || isCurrentLinkDialogOpen)) {
        clearLinkSession();
        if (linkStatus.status === "connected") {
          setActiveAccountId(linkStatus.accountId);
          openAccountTab(linkStatus.accountId);
          setStatusMessage(`Account ${linkStatus.accountId} linked.`);
        }
      }

      if (showMessage) {
        setStatusMessage("Workspace synced.");
      }
    } catch (error) {
      setErrorMessage(normalizeError(error));
    } finally {
      if (showBusy) {
        setIsBusy(false);
      }
    }
  }

  async function optionalRequest<T>(path: string): Promise<T | null> {
    try {
      return await request<T>(path);
    } catch {
      return null;
    }
  }

  function applyActivityEvent(event: Event) {
    const appEvent = parseAppSseEvent(event);
    const details = appEvent?.details;
    if (!details) {
      return false;
    }

    const deliveriesPayload = readArray<DeliveryRecord>(details.deliveries);
    const managerChatMetadataPayload = readArray<ManagerChatMetadata>(details.managerChatMetadata);
    const chatsPayload = readArray<WhatsAppSyncedChat>(details.chats).filter((chat) => chat.chatType === "direct");
    const contactsPayload = readArray<WhatsAppContact>(details.contacts);
    const lidMappingsPayload = readArray<WhatsAppLidMapping>(details.lidMappings);
    const messagesPayload = readArray<WhatsAppSyncedMessage>(details.messages);
    const receiptsPayload = readArray<WhatsAppMessageReceipt>(details.receipts);
    const updatesPayload = readArray<WhatsAppMessageUpdate>(details.updates);
    const mediaAssetsPayload = readArray<WhatsAppMediaAsset>(details.mediaAssets);

    const hasPayload =
      deliveriesPayload.length > 0 ||
      managerChatMetadataPayload.length > 0 ||
      chatsPayload.length > 0 ||
      contactsPayload.length > 0 ||
      lidMappingsPayload.length > 0 ||
      messagesPayload.length > 0 ||
      receiptsPayload.length > 0 ||
      updatesPayload.length > 0 ||
      mediaAssetsPayload.length > 0;

    if (!hasPayload) {
      return false;
    }

    if (deliveriesPayload.length > 0) {
      setDeliveries((current) => upsertByKey(current, deliveriesPayload.filter((delivery) => delivery.chatType === "direct"), deliveryKey));
    }
    if (managerChatMetadataPayload.length > 0) {
      setManagerChatMetadata((current) => upsertByKey(current, managerChatMetadataPayload, accountChatKey));
    }
    if (chatsPayload.length > 0) {
      setSyncedChats((current) => upsertByKey(current, chatsPayload, accountChatKey));
    }
    if (contactsPayload.length > 0) {
      setContacts((current) => upsertByKey(current, contactsPayload, contactKey));
    }
    if (lidMappingsPayload.length > 0) {
      setLidMappings((current) => upsertByKey(current, lidMappingsPayload, lidMappingKey));
    }
    if (receiptsPayload.length > 0) {
      setMessageReceipts((current) => upsertByKey(current, receiptsPayload, (receipt) => receipt.id));
    }
    if (updatesPayload.length > 0) {
      setMessageUpdates((current) => upsertByKey(current, updatesPayload, (update) => update.id));
    }
    if (mediaAssetsPayload.length > 0) {
      setMediaAssets((current) => upsertByKey(current, mediaAssetsPayload, (asset) => asset.id));
    }
    if (messagesPayload.length > 0) {
      let addedMessages: WhatsAppSyncedMessage[] = [];
      setSyncedMessages((current) => {
        const currentKeys = new Set(current.map(syncedMessageKey));
        addedMessages = messagesPayload.filter((message) => !currentKeys.has(syncedMessageKey(message)));
        return upsertByKey(current, messagesPayload, syncedMessageKey);
      });
      if (addedMessages.length > 0) {
        setSyncedMessageCounts((current) => applyMessageCountDeltas(current, addedMessages));
      }
    }

    return true;
  }

  function applyAccountsEvent(event: Event) {
    const appEvent = parseAppSseEvent(event);
    const details = appEvent?.details;
    if (!details) {
      return false;
    }

    const accountsPayload = readArray<WhatsAppAccount>(details.accounts);
    const accountMetadataPayload = readArray<AccountMetadata>(details.accountMetadata);
    const deletedAccountIds = readStringArray(details.deletedAccountIds);
    const hasPayload = accountsPayload.length > 0 || accountMetadataPayload.length > 0 || deletedAccountIds.length > 0;
    if (!hasPayload) {
      return false;
    }

    if (accountsPayload.length > 0) {
      setAccounts((current) => upsertAccounts(current, accountsPayload));
      setHasLoadedAccounts(true);
    }
    if (accountMetadataPayload.length > 0) {
      setAccounts((current) => applyAccountMetadata(current, accountMetadataPayload));
      setAccountAliasDrafts((drafts) => {
        const next = { ...drafts };
        for (const metadata of accountMetadataPayload) {
          next[metadata.accountId] = metadata.alias ?? "";
        }
        return next;
      });
    }
    if (deletedAccountIds.length > 0) {
      const deletedAccountIdSet = new Set(deletedAccountIds);
      setAccounts((current) => current.filter((account) => !deletedAccountIdSet.has(account.accountId)));
      if (deletedAccountIdSet.has(activeAccountIdRef.current)) {
        setActiveAccountId("");
      }
      setActiveChatJid((current) => deletedAccountIdSet.has(activeAccountIdRef.current) ? "" : current);
    }

    return true;
  }

  function parseAppSseEvent(event: Event): AppSseEvent | null {
    if (!("data" in event) || typeof event.data !== "string") {
      return null;
    }

    try {
      const parsed = JSON.parse(event.data);
      if (!isRecord(parsed) || typeof parsed.type !== "string" || typeof parsed.at !== "string") {
        return null;
      }

      return {
        type: parsed.type,
        at: parsed.at,
        ...(isRecord(parsed.details) ? { details: parsed.details } : {}),
      };
    } catch {
      return null;
    }
  }

  function toQueryString(params: Record<string, string>) {
    return new URLSearchParams(params).toString();
  }

  function replaceByAccount<T extends { accountId: string }>(current: T[], accountId: string, items: T[]) {
    return [
      ...items,
      ...current.filter((item) => item.accountId !== accountId),
    ];
  }

  function replaceByChat<T extends { accountId: string; chatJid?: string }>(current: T[], accountId: string, chatJid: string, items: T[]) {
    return [
      ...items,
      ...current.filter((item) => item.accountId !== accountId || item.chatJid !== chatJid),
    ];
  }

  function upsertByKey<T>(current: T[], items: T[], getKey: (item: T) => string) {
    const next = new Map(current.map((item) => [getKey(item), item]));
    for (const item of items) {
      next.set(getKey(item), item);
    }

    return [...next.values()];
  }

  function upsertAccounts(current: WhatsAppAccount[], accountsPayload: WhatsAppAccount[]) {
    const currentByAccountId = new Map(current.map((account) => [account.accountId, account]));
    const next = new Map(currentByAccountId);
    for (const account of accountsPayload) {
      const existing = currentByAccountId.get(account.accountId);
      next.set(account.accountId, {
        ...existing,
        ...account,
        ...(account.alias?.trim() ? { alias: account.alias } : existing?.alias?.trim() ? { alias: existing.alias } : {}),
      });
    }

    return [...next.values()];
  }

  function applyAccountMetadata(current: WhatsAppAccount[], metadataPayload: AccountMetadata[]) {
    const metadataByAccountId = new Map(metadataPayload.map((metadata) => [metadata.accountId, metadata]));
    return current.map((account) => {
      const metadata = metadataByAccountId.get(account.accountId);
      if (!metadata) {
        return account;
      }

      const { alias: _alias, ...accountWithoutAlias } = account;
      return metadata.alias?.trim() ? { ...accountWithoutAlias, alias: metadata.alias } : accountWithoutAlias;
    });
  }

  function applyRulesEvent(event: Event) {
    const appEvent = parseAppSseEvent(event);
    const details = appEvent?.details;
    if (!details) {
      return false;
    }

    const rulesPayload = readArray<NumberRule>(details.rules);
    const deletedRuleIds = readStringArray(details.deletedRuleIds);
    const hasPayload = rulesPayload.length > 0 || deletedRuleIds.length > 0;
    if (!hasPayload) {
      return false;
    }

    if (rulesPayload.length > 0) {
      setNumberRules((current) => upsertByKey(current, rulesPayload, (rule) => rule.id));
    }
    if (deletedRuleIds.length > 0) {
      const deletedRuleIdSet = new Set(deletedRuleIds);
      setNumberRules((current) => current.filter((rule) => !deletedRuleIdSet.has(rule.id)));
    }

    return true;
  }

  function applyLogsEvent(event: Event) {
    const appEvent = parseAppSseEvent(event);
    const details = appEvent?.details;
    if (!details) {
      return false;
    }

    const auditLogsPayload = readArray<AuditLogRecord>(details.auditLogs);
    if (auditLogsPayload.length === 0) {
      return false;
    }

    if (isLogsTabOpenRef.current) {
      setAuditLogs((current) => sortAuditLogs(upsertByKey(current, auditLogsPayload, (record) => record.id)).slice(0, 200));
    }

    return true;
  }

  function sortAuditLogs(logs: AuditLogRecord[]) {
    return [...logs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  function applyMessageCountDeltas(current: WhatsAppMessageCount[], messages: WhatsAppSyncedMessage[]) {
    const countDeltas = new Map<string, WhatsAppMessageCount>();
    for (const message of messages) {
      if (!isActualSyncedMessage(message)) {
        continue;
      }

      const key = accountChatKey(message);
      const currentDelta = countDeltas.get(key) ?? {
        accountId: message.accountId,
        chatJid: message.chatJid,
        messageCount: 0,
      };
      countDeltas.set(key, {
        ...currentDelta,
        messageCount: currentDelta.messageCount + 1,
      });
    }

    if (countDeltas.size === 0) {
      return current;
    }

    const countsByChat = new Map(current.map((item) => [accountChatKey(item), item]));
    for (const [key, delta] of countDeltas) {
      const existing = countsByChat.get(key);
      countsByChat.set(key, {
        accountId: delta.accountId,
        chatJid: delta.chatJid,
        messageCount: (existing?.messageCount ?? 0) + delta.messageCount,
      });
    }

    return [...countsByChat.values()];
  }

  function readArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? value as T[] : [];
  }

  function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function deliveryKey(delivery: DeliveryRecord) {
    return delivery.id;
  }

  function accountChatKey(item: { accountId: string; chatJid: string }) {
    return `${item.accountId}:${item.chatJid}`;
  }

  function contactKey(contact: WhatsAppContact) {
    return `${contact.accountId}:${contact.contactJid}`;
  }

  function lidMappingKey(mapping: WhatsAppLidMapping) {
    return `${mapping.accountId}:${mapping.lidJid}:${mapping.pnJid}`;
  }

  function syncedMessageKey(message: WhatsAppSyncedMessage) {
    return `${message.accountId}:${message.chatJid}:${message.messageId}`;
  }

  function isActualSyncedMessage(message: WhatsAppSyncedMessage) {
    return Boolean(message.text?.trim() || message.mediaJson);
  }

  async function connectAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      const baselineAccountIds = accounts
        .filter((account) => !isPendingAccountId(account.accountId))
        .map((account) => account.accountId);
      const linkingStartedAt = new Date().toISOString();
      const account = await request<WhatsAppAccount>("/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify({}),
      });

      setAccounts((currentAccounts) => upsertAccounts(currentAccounts, [account]));
      setHasLoadedAccounts(true);
      if (account.qrCode || account.status === "connecting") {
        startLinkSession(account, baselineAccountIds, linkingStartedAt);
      } else if (account.status === "connected") {
        clearLinkSession();
        setActiveAccountId(account.accountId);
        openAccountTab(account.accountId);
      }
      setStatusMessage(
        account.qrCode
          ? "QR ready."
          : "Link session started. Waiting for WhatsApp QR.",
      );
    });
  }

  async function closeLinkDialog() {
    const accountId = linkingStatusRef.current?.accountId;
    clearLinkSession();

    if (!accountId || !isPendingAccountId(accountId)) {
      return;
    }

    try {
      await request<WhatsAppAccount>(`/whatsapp/accounts/${encodeURIComponent(accountId)}/disconnect`, {
        method: "POST",
      });
    } catch (error) {
      setErrorMessage(normalizeError(error));
    }
  }

  async function disconnectAccount(accountId: string) {
    await runAction(async () => {
      const result = await request<WhatsAppAccount>(`/whatsapp/accounts/${encodeURIComponent(accountId)}/disconnect`, {
        method: "POST",
      });

      setAccounts((currentAccounts) => currentAccounts.filter((account) => account.accountId !== accountId));
      closeAccountTab(accountId);
      if (activeAccountId === accountId) {
        setActiveAccountId("");
        setActiveChatJid("");
      }
      setStatusMessage(
        result.lastError
          ? `Account ${accountId} disconnected locally. ${result.lastError}`
          : `Account ${accountId} disconnected.`,
      );
    });
  }

  async function retryDelivery(deliveryId: string) {
    await runAction(async () => {
      const delivery = await request<DeliveryRecord>(`/deliveries/${encodeURIComponent(deliveryId)}/retry`, {
        method: "POST",
      });
      setDeliveries((current) => upsertByKey(current, [delivery], deliveryKey));
      setStatusMessage("Delivery retry completed.");
    });
  }

  async function createNumberRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runAction(async () => {
      const accountId = activeAccountId || accounts[0]?.accountId || "";
      if (!accountId) {
        throw new Error("Select an account before adding a rule.");
      }

      const rule = await request<NumberRule>("/number-rules", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          action: ruleAction,
          matchType: ruleMatchType,
          pattern: ruleMatchType === "all" ? "" : rulePattern,
          label: ruleLabel,
          enabled: true,
        }),
      });
      setNumberRules((current) => upsertByKey(current, [rule], (item) => item.id));
      setRulePattern("");
      setRuleLabel("");
      setStatusMessage("Number rule saved.");
    });
  }

  async function updateNumberRule(rule: NumberRule, enabled: boolean) {
    await runAction(async () => {
      const updatedRule = await request<NumberRule>(`/number-rules/${encodeURIComponent(rule.id)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setNumberRules((current) => upsertByKey(current, [updatedRule], (item) => item.id));
      setStatusMessage(enabled ? "Rule enabled." : "Rule disabled.");
    });
  }

  async function deleteNumberRule(ruleId: string) {
    await runAction(async () => {
      await request<void>(`/number-rules/${encodeURIComponent(ruleId)}`, {
        method: "DELETE",
      });
      setNumberRules((current) => current.filter((rule) => rule.id !== ruleId));
      setStatusMessage("Number rule deleted.");
    });
  }

  async function saveAccountAlias(accountId: string, alias: string) {
    await runAction(async () => {
      const metadata = await request<{ accountId: string; alias?: string }>(`/whatsapp/accounts/${encodeURIComponent(accountId)}`, {
        method: "PATCH",
        body: JSON.stringify({ alias }),
      });
      setAccounts((currentAccounts) =>
        currentAccounts.map((account) => {
          if (account.accountId !== accountId) {
            return account;
          }

          const { alias: _alias, ...accountWithoutAlias } = account;
          return metadata.alias ? { ...accountWithoutAlias, alias: metadata.alias } : accountWithoutAlias;
        }),
      );
      setAccountAliasDrafts((drafts) => ({ ...drafts, [accountId]: metadata.alias ?? "" }));
      setStatusMessage(metadata.alias ? `Alias saved for ${accountId}.` : `Alias cleared for ${accountId}.`);
    });
  }

  async function updateManagerChatArchive(chat: { accountId: string; chatJid: string }, archived: boolean) {
    await runAction(async () => {
      const metadata = await request<ManagerChatMetadata>("/manager/chats", {
        method: "PATCH",
        body: JSON.stringify({
          accountId: chat.accountId,
          chatJid: chat.chatJid,
          archived,
        }),
      });
      setManagerChatMetadata((currentMetadata) => [
        metadata,
        ...currentMetadata.filter((item) => item.accountId !== metadata.accountId || item.chatJid !== metadata.chatJid),
      ]);
      if (activeChatJid === chat.chatJid && archived) {
        setActiveChatJid("");
      }
      setStatusMessage(archived ? "Chat hidden from main view." : "Chat restored to main view.");
    });
  }

  async function saveBranding(nextBranding: BrandingSettings) {
    const normalizedBranding = normalizeBranding(nextBranding);
    if (branding.title === normalizedBranding.title && branding.iconSrc === normalizedBranding.iconSrc) {
      return;
    }

    await runAction(async () => {
      if (branding.title === normalizedBranding.title && branding.iconSrc === normalizedBranding.iconSrc) {
        return;
      }

      setBranding(normalizedBranding);
      localStorage.setItem(brandingStorageKeys.title, normalizedBranding.title);
      localStorage.setItem(brandingStorageKeys.iconSrc, normalizedBranding.iconSrc);
      const brandingAccountId = activeAccountId || accounts[0]?.accountId;
      await request<AuditLogRecord>("/audit-logs", {
        method: "POST",
        body: JSON.stringify({
          action: "ui-branding.update",
          resourceType: "ui-settings",
          resourceId: "branding",
          details: {
            ...(brandingAccountId ? { accountId: brandingAccountId } : {}),
            previousTitle: branding.title,
            previousCustomIcon: branding.iconSrc !== defaultAppIcon,
            title: normalizedBranding.title,
            customIcon: normalizedBranding.iconSrc !== defaultAppIcon,
          },
        }),
      });
      setStatusMessage("Branding updated.");
    });
  }

  async function runAction(action: () => Promise<void>) {
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

  function openAccount(accountId: string) {
    openAccountTab(accountId);
    setActiveAccountId(accountId);
    setActiveChatJid("");
    setActiveNumberView("home");
    setIsNumberPanelOpen(false);
    setStatusMessage(`Opened ${accountId}.`);
  }

  const connectedAccounts = accounts.filter((account) => account.status === "connected").length;
  const filteredAccounts = accounts.filter((account) => accountMatchesSearch(account, accountSearch));
  const selectedTabAccountId = activeTabId === "logs" || activeTabId === "settings" ? activeAccountId : activeTabId;
  const tabAccounts = openAccountTabs
    .map((accountId) => accounts.find((account) => account.accountId === accountId))
    .filter((account): account is WhatsAppAccount => Boolean(account));
  const activeAccount = accounts.find((account) => account.accountId === activeAccountId) ?? null;
  const activeContactDisplayIndex = useMemo(
    () =>
      buildContactDisplayIndex(
        contacts.filter((contact) => contact.accountId === activeAccountId),
        lidMappings.filter((mapping) => mapping.accountId === activeAccountId),
      ),
    [activeAccountId, contacts, lidMappings],
  );
  const activeChats = useMemo(
    () =>
      buildChatSummaries(
        activeAccountId,
        mappings,
        deliveries,
        syncedChats,
        syncedMessages,
        activeContactDisplayIndex,
        managerChatMetadata,
        mediaAssets,
        syncedMessageCounts,
      ),
    [activeAccountId, activeContactDisplayIndex, deliveries, managerChatMetadata, mappings, mediaAssets, syncedChats, syncedMessageCounts, syncedMessages],
  );
  useEffect(() => {
    setActiveChatJid((currentChatJid) => {
      if (!activeAccountId) {
        return currentChatJid ? "" : currentChatJid;
      }

      if (currentChatJid && activeChats.some((chat) => chat.chatJid === currentChatJid)) {
        return currentChatJid;
      }

      return activeChats.find((chat) => !chat.managerArchived)?.chatJid ?? activeChats[0]?.chatJid ?? "";
    });
  }, [activeAccountId, activeChats]);
  const activeAccountDeliveries = deliveries.filter((delivery) => delivery.accountId === activeAccountId);
  const activeAccountMappings = mappings.filter((mapping) => mapping.accountId === activeAccountId);
  const activeChat = activeChats.find((chat) => chat.chatJid === activeChatJid) ?? null;
  const activeChatMessages = activeChat
    ? buildChatMessages(
        deliveries.filter((delivery) => delivery.accountId === activeAccountId && delivery.chatJid === activeChat.chatJid),
        syncedMessages.filter((message) => message.accountId === activeAccountId && message.chatJid === activeChat.chatJid),
        messageReceipts.filter((receipt) => receipt.accountId === activeAccountId && receipt.chatJid === activeChat.chatJid),
        messageUpdates.filter((update) => update.accountId === activeAccountId && update.chatJid === activeChat.chatJid),
        mediaAssets.filter((asset) => asset.accountId === activeAccountId && asset.chatJid === activeChat.chatJid),
      )
    : [];
  const pendingQrAccount =
    linkingStatus ??
    accounts.find((account) => account.accountId === activeAccountId && account.qrCode) ??
    accounts.find((account) => account.qrCode) ??
    null;
  const failedDeliveries = deliveries.filter((delivery) => delivery.status === "failed");
  const activeAccountFailedDeliveries = failedDeliveries.filter((delivery) => delivery.accountId === activeAccountId);
  const statusTone = errorMessage ? "error" : isBusy ? "syncing" : "live";

  return (
    <div className="shell">
      <TopBar
        accountsCount={accounts.length}
        activeTabId={activeTabId}
        branding={branding}
        connectedAccounts={connectedAccounts}
        isBusy={isBusy}
        isLogsTabOpen={isLogsTabOpen}
        isSettingsTabOpen={isSettingsTabOpen}
        statusDetail={errorMessage || statusMessage}
        statusTone={statusTone}
        tabAccounts={tabAccounts}
        workspaceTabsRef={workspaceTabsRef}
        onCloseAccountTab={closeAccountTab}
        onCloseLogsTab={closeLogsTab}
        onCloseSettingsTab={closeSettingsTab}
        onConnectAccount={connectAccount}
        onFindNumber={() => setIsNumberPanelOpen(true)}
        onOpenLogsTab={openLogsTab}
        onOpenSettingsTab={openSettingsTab}
        onSelectAccountTab={selectAccountTab}
        onSelectLogsTab={() => setActiveTabId("logs")}
        onSelectSettingsTab={() => setActiveTabId("settings")}
      />

      <main className="admin-layout">
        <section className="admin-panel">
          {activeTabId === "settings" && isSettingsTabOpen ? (
            <SettingsView
              branding={branding}
              defaultBranding={{ title: defaultAppTitle, iconSrc: defaultAppIcon }}
              isBusy={isBusy}
              onSave={(nextBranding) => void saveBranding(nextBranding)}
            />
          ) : null}

          {activeTabId === "logs" && isLogsTabOpen ? (
            <LogsView
              auditLogs={auditLogs}
            />
          ) : null}

          {activeTabId !== "logs" && activeTabId !== "settings" && activeTabId ? (
            <NumberWorkspace
              account={activeAccount}
              activeChat={activeChat}
              activeChatJid={activeChatJid}
              activeChatMessages={activeChatMessages}
              activeView={activeNumberView}
              chats={activeChats}
              deliveries={activeAccountDeliveries}
              failedDeliveries={activeAccountFailedDeliveries}
              isBusy={isBusy}
              mappings={activeAccountMappings}
              matchType={ruleMatchType}
              aliasDraft={activeAccount ? accountAliasDrafts[activeAccount.accountId] ?? activeAccount.alias ?? "" : ""}
              onActionChange={setRuleAction}
              onAliasChange={(value) => {
                if (!activeAccount) {
                  return;
                }
                setAccountAliasDrafts((drafts) => ({ ...drafts, [activeAccount.accountId]: value }));
              }}
              onAliasSave={(alias) => {
                if (!activeAccount) {
                  return;
                }
                void saveAccountAlias(activeAccount.accountId, alias);
              }}
              onCreateRule={createNumberRule}
              onDeleteRule={(ruleId) => void deleteNumberRule(ruleId)}
              onDisconnect={(accountId) => void disconnectAccount(accountId)}
              onEnabledChange={(rule, enabled) => void updateNumberRule(rule, enabled)}
              onLabelChange={setRuleLabel}
              onMatchTypeChange={setRuleMatchType}
              onPatternChange={setRulePattern}
              onRetry={(deliveryId) => void retryDelivery(deliveryId)}
              onSelectChat={setActiveChatJid}
              onSetChatArchived={(chat, archived) => void updateManagerChatArchive(chat, archived)}
              onViewChange={setActiveNumberView}
              pattern={rulePattern}
              ruleAction={ruleAction}
              ruleLabel={ruleLabel}
              rules={numberRules.filter((rule) => rule.accountId === activeAccountId)}
            />
          ) : null}

          {!activeTabId ? (
            <EmptyState title="No workspace open" description="Open Settings, Logs, or choose a number from the header." />
          ) : null}
        </section>
      </main>

      {isNumberPanelOpen ? (
        <NumberChooserPanel
          accounts={filteredAccounts}
          allAccountCount={accounts.length}
          connectedAccounts={connectedAccounts}
          onClose={() => setIsNumberPanelOpen(false)}
          onOpenAccount={openAccount}
          search={accountSearch}
          selectedAccountId={selectedTabAccountId}
          setSearch={setAccountSearch}
        />
      ) : null}

      {isLinkDialogOpen ? (
        <LinkAccountDialog
          account={pendingQrAccount}
          isBusy={isBusy}
          onClose={() => void closeLinkDialog()}
        />
      ) : null}
    </div>
  );
}
