import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  AuditLogInput,
  AuditLogRecord,
  ChatSessionMapping,
  DeliveryRecord,
  GroupRoutingPolicyRecord,
  HermesPlatformEventRecord,
  HermesSession,
  ManagerChatMetadata,
  NumberRuleInput,
  NumberRuleRecord,
  PostbackActionInput,
  PostbackActionRecord,
  PostbackActionRunRecord,
  PostbackActionType,
  PostbackRunStatus,
  WhatsAppAccountMetadata,
  WhatsAppChatRecord,
  WhatsAppChatType,
  WhatsAppContactRecord,
  WhatsAppGroupRoutingPolicy,
  WhatsAppHistorySyncBatchRecord,
  WhatsAppLidMappingRecord,
  WhatsAppMediaAssetRecord,
  WhatsAppMessageEvent,
  WhatsAppMessageCountRecord,
  WhatsAppMessageReceiptRecord,
  WhatsAppMessageUpdateRecord,
  WhatsAppStoredMessageRecord,
  WhatsAppSyncEventRecord,
  WhatsAppSyncSummary,
} from "../domain/types.js";
import type {
  AccountMetadataStore,
  AuditLogStore,
  BridgeDeliveryStore,
  ChatSessionRouterSnapshot,
  ChatSessionRouterStore,
  GroupRoutingPolicyStore,
  HermesPlatformEventStore,
  ManagerChatMetadataStore,
  NumberRuleStore,
  PostbackActionStore,
  WhatsAppSyncStore,
} from "./chat-session-router.js";

export class SqliteBridgeStateStore
  implements
    ChatSessionRouterStore,
    BridgeDeliveryStore,
    GroupRoutingPolicyStore,
    HermesPlatformEventStore,
    NumberRuleStore,
    AuditLogStore,
    AccountMetadataStore,
    ManagerChatMetadataStore,
    PostbackActionStore,
    WhatsAppSyncStore
{
  private readonly db: DatabaseSync;
  private readonly runRetentionDays: number;
  private readonly platformEventRetentionDays: number;

  constructor(filePath: string, options: { runRetentionDays?: number; platformEventRetentionDays?: number } = {}) {
    this.runRetentionDays = options.runRetentionDays ?? 30;
    this.platformEventRetentionDays = options.platformEventRetentionDays ?? 7;
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  load(): ChatSessionRouterSnapshot {
    return {
      mappings: this.db
        .prepare("SELECT * FROM hermes_chat_sessions ORDER BY created_at")
        .all()
        .map(rowToMapping),
      sessions: this.db.prepare("SELECT * FROM hermes_sessions ORDER BY created_at").all().map(rowToSession),
      processedMessages: this.db
        .prepare("SELECT processed_key FROM processed_messages ORDER BY processed_at")
        .all()
        .map((row) => String((row as { processed_key: string }).processed_key)),
    };
  }

  save(snapshot: ChatSessionRouterSnapshot): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM hermes_chat_sessions");
      this.db.exec("DELETE FROM hermes_sessions");
      this.db.exec("DELETE FROM processed_messages");

      const insertSession = this.db.prepare(`
        INSERT INTO hermes_sessions
          (id, session_key, account_id, chat_jid, chat_type, chat_id, created_at, last_activity_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const session of snapshot.sessions) {
        insertSession.run(
          session.id,
          session.sessionKey,
          session.accountId,
          session.chatJid,
          session.chatType,
          session.chatId,
          session.createdAt,
          session.lastActivityAt,
          session.status,
        );
      }

      const insertMapping = this.db.prepare(`
        INSERT INTO hermes_chat_sessions
          (session_key, account_id, chat_jid, chat_type, chat_id, hermes_session_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const mapping of snapshot.mappings) {
        insertMapping.run(
          mapping.sessionKey,
          mapping.accountId,
          mapping.chatJid,
          mapping.chatType,
          mapping.chatId,
          mapping.hermesSessionId,
          mapping.createdAt,
          mapping.updatedAt,
        );
      }

      const insertProcessed = this.db.prepare(
        "INSERT INTO processed_messages (processed_key, processed_at) VALUES (?, ?)",
      );
      const now = new Date().toISOString();
      for (const processedKey of snapshot.processedMessages) {
        insertProcessed.run(processedKey, now);
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listDeliveries(input: { accountId?: string; chatJid?: string } = {}): DeliveryRecord[] {
    const { clause, args } = syncWhereClause(input);
    return this.db
      .prepare(`SELECT * FROM delivery_records ${clause} ORDER BY created_at DESC`)
      .all(...args)
      .map(rowToDelivery);
  }

  getDelivery(id: string): DeliveryRecord | null {
    const row = this.db.prepare("SELECT * FROM delivery_records WHERE id = ?").get(id);
    return row ? rowToDelivery(row) : null;
  }

  saveDelivery(record: DeliveryRecord): void {
    this.db
      .prepare(`
        INSERT INTO delivery_records
          (id, account_id, chat_jid, chat_type, session_key, inbound_message_id, inbound_text, outbound_text, status, attempts, failure_stage, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          inbound_text = excluded.inbound_text,
          outbound_text = excluded.outbound_text,
          status = excluded.status,
          attempts = excluded.attempts,
          failure_stage = excluded.failure_stage,
          error = excluded.error,
          updated_at = excluded.updated_at
      `)
      .run(
        record.id,
        record.accountId,
        record.chatJid,
        record.chatType,
        record.sessionKey,
        record.inboundMessageId,
        record.inboundText ?? null,
        record.outboundText,
        record.status,
        record.attempts,
        record.failureStage ?? null,
        record.error ?? null,
        record.createdAt,
        record.updatedAt,
      );
  }

  listGroupPolicies(): GroupRoutingPolicyRecord[] {
    return this.db
      .prepare("SELECT * FROM group_routing_policies ORDER BY updated_at DESC")
      .all()
      .map(rowToGroupPolicy);
  }

  getGroupPolicy(accountId: string, groupJid: string): WhatsAppGroupRoutingPolicy {
    const row = this.db
      .prepare("SELECT policy FROM group_routing_policies WHERE account_id = ? AND group_jid = ?")
      .get(accountId, groupJid) as { policy?: WhatsAppGroupRoutingPolicy } | undefined;

    return row?.policy ?? "group";
  }

  setGroupPolicy(input: {
    accountId: string;
    groupJid: string;
    policy: WhatsAppGroupRoutingPolicy;
  }): GroupRoutingPolicyRecord {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT created_at FROM group_routing_policies WHERE account_id = ? AND group_jid = ?")
      .get(input.accountId, input.groupJid) as { created_at?: string } | undefined;
    const record: GroupRoutingPolicyRecord = {
      ...input,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO group_routing_policies
          (account_id, group_jid, policy, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id, group_jid) DO UPDATE SET
          policy = excluded.policy,
          updated_at = excluded.updated_at
      `)
      .run(record.accountId, record.groupJid, record.policy, record.createdAt, record.updatedAt);

    return record;
  }

  listNumberRules(accountId?: string): NumberRuleRecord[] {
    const query = accountId?.trim()
      ? this.db.prepare("SELECT * FROM number_rules WHERE account_id = ? ORDER BY created_at DESC")
      : this.db.prepare("SELECT * FROM number_rules ORDER BY created_at DESC");
    const rows = accountId?.trim() ? query.all(accountId.trim()) : query.all();
    return rows.map(rowToNumberRule);
  }

  getNumberRule(id: string): NumberRuleRecord | null {
    const row = this.db.prepare("SELECT * FROM number_rules WHERE id = ?").get(id);
    return row ? rowToNumberRule(row) : null;
  }

  createNumberRule(input: NumberRuleInput): NumberRuleRecord {
    const now = new Date().toISOString();
    const record: NumberRuleRecord = {
      id: randomUUID(),
      accountId: input.accountId,
      action: input.action,
      matchType: input.matchType,
      pattern: input.matchType === "all" ? "" : input.pattern ?? "",
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO number_rules
          (id, account_id, action, match_type, pattern, label, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.accountId,
        record.action,
        record.matchType,
        record.pattern,
        record.label ?? null,
        record.enabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  updateNumberRule(id: string, input: Partial<NumberRuleInput>): NumberRuleRecord | null {
    const existing = this.getNumberRule(id);
    if (!existing) {
      return null;
    }

    const record: NumberRuleRecord = {
      ...existing,
      ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.matchType !== undefined ? { matchType: input.matchType } : {}),
      ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
      ...(input.label !== undefined && input.label.trim() ? { label: input.label.trim() } : {}),
      enabled: input.enabled ?? existing.enabled,
      updatedAt: new Date().toISOString(),
    };

    if (input.label !== undefined && !input.label.trim()) {
      delete record.label;
    }

    if (record.matchType === "all") {
      record.pattern = "";
    }

    this.db
      .prepare(`
        UPDATE number_rules SET
          account_id = ?,
          action = ?,
          match_type = ?,
          pattern = ?,
          label = ?,
          enabled = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        record.accountId,
        record.action,
        record.matchType,
        record.pattern,
        record.label ?? null,
        record.enabled ? 1 : 0,
        record.updatedAt,
        record.id,
      );

    return record;
  }

  deleteNumberRule(id: string): boolean {
    const result = this.db.prepare("DELETE FROM number_rules WHERE id = ?").run(id);
    return result.changes > 0;
  }

  listAccountMetadata(): WhatsAppAccountMetadata[] {
    return this.db
      .prepare("SELECT * FROM whatsapp_account_metadata ORDER BY updated_at DESC")
      .all()
      .map(rowToAccountMetadata);
  }

  setAccountAlias(accountId: string, alias: string): WhatsAppAccountMetadata {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT created_at FROM whatsapp_account_metadata WHERE account_id = ?")
      .get(accountId) as { created_at?: string } | undefined;
    const record: WhatsAppAccountMetadata = {
      accountId,
      ...(alias.trim() ? { alias: alias.trim() } : {}),
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO whatsapp_account_metadata
          (account_id, alias, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
          alias = excluded.alias,
          updated_at = excluded.updated_at
      `)
      .run(record.accountId, record.alias ?? null, record.createdAt, record.updatedAt);

    return record;
  }

  listManagerChatMetadata(accountId?: string): ManagerChatMetadata[] {
    const { clause, args } = accountWhereClause(accountId);
    return this.db
      .prepare(`SELECT * FROM manager_chat_metadata ${clause} ORDER BY updated_at DESC`)
      .all(...args)
      .map(rowToManagerChatMetadata);
  }

  setManagerChatArchived(input: { accountId: string; chatJid: string; archived: boolean }): ManagerChatMetadata {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT created_at FROM manager_chat_metadata WHERE account_id = ? AND chat_jid = ?")
      .get(input.accountId, input.chatJid) as { created_at?: string } | undefined;
    const record: ManagerChatMetadata = {
      accountId: input.accountId,
      chatJid: input.chatJid,
      archived: input.archived,
      createdAt: existing?.created_at ?? now,
      updatedAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO manager_chat_metadata
          (account_id, chat_jid, archived, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id, chat_jid) DO UPDATE SET
          archived = excluded.archived,
          updated_at = excluded.updated_at
      `)
      .run(record.accountId, record.chatJid, record.archived ? 1 : 0, record.createdAt, record.updatedAt);

    return record;
  }

  listAuditLogs(limit = 200): AuditLogRecord[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    return this.db
      .prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?")
      .all(safeLimit)
      .map(rowToAuditLog);
  }

  recordAuditLog(input: AuditLogInput): AuditLogRecord {
    const record: AuditLogRecord = {
      id: randomUUID(),
      action: input.action,
      actor: input.actor?.trim() || "system",
      outcome: input.outcome ?? "success",
      ...(input.resourceType ? { resourceType: input.resourceType } : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.details ? { details: input.details } : {}),
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(`
        INSERT INTO audit_logs
          (id, action, actor, outcome, resource_type, resource_id, details_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.action,
        record.actor,
        record.outcome,
        record.resourceType ?? null,
        record.resourceId ?? null,
        record.details ? JSON.stringify(record.details) : null,
        record.createdAt,
      );

    return record;
  }

  coalesceAuditLog(input: AuditLogInput, windowMs: number): AuditLogRecord {
    const actor = input.actor?.trim() || "system";
    const outcome = input.outcome ?? "success";
    const cutoff = new Date(Date.now() - Math.max(windowMs, 0)).toISOString();
    const existing = this.db
      .prepare(`
        SELECT * FROM audit_logs
        WHERE action = ?
          AND actor = ?
          AND outcome = ?
          AND COALESCE(resource_type, '') = COALESCE(?, '')
          AND COALESCE(resource_id, '') = COALESCE(?, '')
          AND created_at >= ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .get(input.action, actor, outcome, input.resourceType ?? null, input.resourceId ?? null, cutoff);

    if (!existing) {
      return this.recordAuditLog(input);
    }

    const existingRecord = rowToAuditLog(existing);
    const details = mergeAuditDetails(existingRecord.details, input.details);
    this.db
      .prepare("UPDATE audit_logs SET details_json = ? WHERE id = ?")
      .run(details ? JSON.stringify(details) : null, existingRecord.id);

    return {
      ...existingRecord,
      ...(details ? { details } : {}),
    };
  }

  listPostbackActions(input: { accountId?: string; chatJid?: string } = {}): PostbackActionRecord[] {
    const filters: string[] = [];
    const args: string[] = [];
    if (input.accountId?.trim()) {
      filters.push("(account_id IS NULL OR account_id = ?)");
      args.push(input.accountId.trim());
    }
    if (input.chatJid?.trim()) {
      filters.push("(chat_jid IS NULL OR chat_jid = ?)");
      args.push(input.chatJid.trim());
    }
    const clause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM postback_actions ${clause} ORDER BY updated_at DESC`)
      .all(...args)
      .map(rowToPostbackAction);
  }

  getPostbackAction(id: string): PostbackActionRecord | null {
    const row = this.db.prepare("SELECT * FROM postback_actions WHERE id = ?").get(id);
    return row ? rowToPostbackAction(row) : null;
  }

  createPostbackAction(input: PostbackActionInput): PostbackActionRecord {
    const now = new Date().toISOString();
    const record: PostbackActionRecord = {
      id: randomUUID(),
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      trigger: input.trigger ?? "inbound_message",
      actionType: input.actionType,
      ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {}),
      ...(input.chatJid?.trim() ? { chatJid: input.chatJid.trim() } : {}),
      configJson: JSON.stringify(input.config ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO postback_actions
          (id, name, enabled, trigger, action_type, account_id, chat_jid, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.name,
        record.enabled ? 1 : 0,
        record.trigger,
        record.actionType,
        record.accountId ?? null,
        record.chatJid ?? null,
        record.configJson,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  updatePostbackAction(id: string, input: Partial<PostbackActionInput>): PostbackActionRecord | null {
    const existing = this.getPostbackAction(id);
    if (!existing) {
      return null;
    }

    const record: PostbackActionRecord = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
      ...(input.actionType !== undefined ? { actionType: input.actionType } : {}),
      ...(input.config !== undefined ? { configJson: JSON.stringify(input.config) } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (input.accountId !== undefined) {
      if (input.accountId.trim()) {
        record.accountId = input.accountId.trim();
      } else {
        delete record.accountId;
      }
    }
    if (input.chatJid !== undefined) {
      if (input.chatJid.trim()) {
        record.chatJid = input.chatJid.trim();
      } else {
        delete record.chatJid;
      }
    }

    this.db
      .prepare(`
        UPDATE postback_actions
        SET name = ?,
            enabled = ?,
            trigger = ?,
            action_type = ?,
            account_id = ?,
            chat_jid = ?,
            config_json = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        record.name,
        record.enabled ? 1 : 0,
        record.trigger,
        record.actionType,
        record.accountId ?? null,
        record.chatJid ?? null,
        record.configJson,
        record.updatedAt,
        id,
      );

    return record;
  }

  deletePostbackAction(id: string): boolean {
    const result = this.db.prepare("DELETE FROM postback_actions WHERE id = ?").run(id);
    return result.changes > 0;
  }

  listPostbackActionRuns(
    input: { actionId?: string; accountId?: string; chatJid?: string; limit?: number } = {},
  ): PostbackActionRunRecord[] {
    const filters: string[] = [];
    const args: string[] = [];
    if (input.actionId?.trim()) {
      filters.push("action_id = ?");
      args.push(input.actionId.trim());
    }
    if (input.accountId?.trim()) {
      filters.push("account_id = ?");
      args.push(input.accountId.trim());
    }
    if (input.chatJid?.trim()) {
      filters.push("chat_jid = ?");
      args.push(input.chatJid.trim());
    }
    const clause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM postback_action_runs ${clause} ORDER BY created_at DESC LIMIT ?`)
      .all(...args, safeLimit(input.limit))
      .map(rowToPostbackActionRun);
  }

  getPostbackActionRun(id: string): PostbackActionRunRecord | null {
    const row = this.db.prepare("SELECT * FROM postback_action_runs WHERE id = ?").get(id);
    return row ? rowToPostbackActionRun(row) : null;
  }

  savePostbackActionRun(record: PostbackActionRunRecord): void {
    this.db
      .prepare(`
        INSERT INTO postback_action_runs
          (id, action_id, action_name, action_type, account_id, chat_jid, inbound_message_id, status, attempts, request_json, response_status, response_body, error, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          attempts = excluded.attempts,
          request_json = excluded.request_json,
          response_status = excluded.response_status,
          response_body = excluded.response_body,
          error = excluded.error,
          updated_at = excluded.updated_at
      `)
      .run(
        record.id,
        record.actionId,
        record.actionName,
        record.actionType,
        record.accountId,
        record.chatJid,
        record.inboundMessageId,
        record.status,
        record.attempts,
        record.requestJson ?? null,
        record.responseStatus ?? null,
        record.responseBody ?? null,
        record.error ?? null,
        record.createdAt,
        record.updatedAt,
      );
  }

  cleanupPostbackRecords(input: { runRetentionDays?: number; platformEventRetentionDays?: number; now?: Date } = {}) {
    const now = input.now ?? new Date();
    const runRetentionDays = input.runRetentionDays ?? this.runRetentionDays;
    const platformEventRetentionDays = input.platformEventRetentionDays ?? this.platformEventRetentionDays;
    return {
      deletedRuns: cleanupByCreatedAt(this.db, "postback_action_runs", runRetentionDays, now),
      deletedPlatformEvents: cleanupByCreatedAt(this.db, "hermes_platform_events", platformEventRetentionDays, now),
    };
  }

  getPostbackMaintenanceStats() {
    const runStats = this.db
      .prepare("SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM postback_action_runs")
      .get() as { count: number; oldest?: string | null };
    const eventStats = this.db
      .prepare("SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM hermes_platform_events")
      .get() as { count: number; oldest?: string | null };
    return {
      postbackActionRuns: Number(runStats.count ?? 0),
      hermesPlatformEvents: Number(eventStats.count ?? 0),
      ...(runStats.oldest ? { oldestPostbackActionRun: String(runStats.oldest) } : {}),
      ...(eventStats.oldest ? { oldestHermesPlatformEvent: String(eventStats.oldest) } : {}),
    };
  }

  appendHermesPlatformEvent(event: WhatsAppMessageEvent): HermesPlatformEventRecord {
    const createdAt = new Date().toISOString();
    const payloadJson = JSON.stringify(event);
    const result = this.db
      .prepare(`
        INSERT INTO hermes_platform_events
          (account_id, chat_jid, chat_type, sender_jid, session_key, message_id, participant_jid, text, timestamp, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.accountId,
        event.chatJid,
        event.chatType,
        event.senderJid,
        event.sessionKey,
        event.messageId,
        event.participantJid ?? null,
        event.text,
        event.timestamp,
        payloadJson,
        createdAt,
      );

    return {
      sequence: Number(result.lastInsertRowid),
      accountId: event.accountId,
      chatJid: event.chatJid,
      chatType: event.chatType,
      senderJid: event.senderJid,
      sessionKey: event.sessionKey,
      messageId: event.messageId,
      ...(event.participantJid ? { participantJid: event.participantJid } : {}),
      text: event.text,
      timestamp: event.timestamp,
      payloadJson,
      createdAt,
    };
  }

  listHermesPlatformEvents(input: { afterSequence?: number; limit?: number } = {}): HermesPlatformEventRecord[] {
    return this.db
      .prepare(`
        SELECT *
        FROM hermes_platform_events
        WHERE sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
      `)
      .all(input.afterSequence ?? 0, safeLimit(input.limit))
      .map(rowToHermesPlatformEvent);
  }

  saveWhatsAppContact(record: WhatsAppContactRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_contacts
          (account_id, contact_jid, phone_number, lid_jid, name, notify_name, verified_name, raw_json, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, contact_jid) DO UPDATE SET
          phone_number = COALESCE(excluded.phone_number, whatsapp_contacts.phone_number),
          lid_jid = COALESCE(excluded.lid_jid, whatsapp_contacts.lid_jid),
          name = COALESCE(excluded.name, whatsapp_contacts.name),
          notify_name = COALESCE(excluded.notify_name, whatsapp_contacts.notify_name),
          verified_name = COALESCE(excluded.verified_name, whatsapp_contacts.verified_name),
          raw_json = COALESCE(excluded.raw_json, whatsapp_contacts.raw_json),
          last_seen_at = excluded.last_seen_at
      `)
      .run(
        record.accountId,
        record.contactJid,
        record.phoneNumber ?? null,
        record.lidJid ?? null,
        record.name ?? null,
        record.notifyName ?? null,
        record.verifiedName ?? null,
        record.rawJson ?? null,
        record.firstSeenAt,
        record.lastSeenAt,
      );
  }

  saveWhatsAppChat(record: WhatsAppChatRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_chats
          (account_id, chat_jid, chat_type, display_name, unread_count, last_message_at, archived, pinned, muted_until, raw_json, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, chat_jid) DO UPDATE SET
          chat_type = excluded.chat_type,
          display_name = COALESCE(excluded.display_name, whatsapp_chats.display_name),
          unread_count = COALESCE(excluded.unread_count, whatsapp_chats.unread_count),
          last_message_at = COALESCE(excluded.last_message_at, whatsapp_chats.last_message_at),
          archived = COALESCE(excluded.archived, whatsapp_chats.archived),
          pinned = COALESCE(excluded.pinned, whatsapp_chats.pinned),
          muted_until = COALESCE(excluded.muted_until, whatsapp_chats.muted_until),
          raw_json = COALESCE(excluded.raw_json, whatsapp_chats.raw_json),
          last_seen_at = excluded.last_seen_at
      `)
      .run(
        record.accountId,
        record.chatJid,
        record.chatType,
        record.displayName ?? null,
        record.unreadCount ?? null,
        record.lastMessageAt ?? null,
        record.archived === undefined ? null : Number(record.archived),
        record.pinned === undefined ? null : Number(record.pinned),
        record.mutedUntil ?? null,
        record.rawJson ?? null,
        record.firstSeenAt,
        record.lastSeenAt,
      );
  }

  saveWhatsAppMessage(record: WhatsAppStoredMessageRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_messages
          (account_id, chat_jid, message_id, sender_jid, from_me, timestamp, message_type, text, media_json, reaction_json, raw_json, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, chat_jid, message_id) DO UPDATE SET
          sender_jid = COALESCE(excluded.sender_jid, whatsapp_messages.sender_jid),
          from_me = excluded.from_me,
          timestamp = excluded.timestamp,
          message_type = COALESCE(excluded.message_type, whatsapp_messages.message_type),
          text = COALESCE(excluded.text, whatsapp_messages.text),
          media_json = COALESCE(excluded.media_json, whatsapp_messages.media_json),
          reaction_json = COALESCE(excluded.reaction_json, whatsapp_messages.reaction_json),
          raw_json = COALESCE(excluded.raw_json, whatsapp_messages.raw_json),
          received_at = excluded.received_at
      `)
      .run(
        record.accountId,
        record.chatJid,
        record.messageId,
        record.senderJid ?? null,
        Number(record.fromMe),
        record.timestamp,
        record.messageType ?? null,
        record.text ?? null,
        record.mediaJson ?? null,
        record.reactionJson ?? null,
        record.rawJson ?? null,
        record.receivedAt,
      );
  }

  saveWhatsAppMessageReceipt(record: WhatsAppMessageReceiptRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_message_receipts
          (id, account_id, chat_jid, message_id, participant_jid, receipt_type, timestamp, raw_json, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          participant_jid = COALESCE(excluded.participant_jid, whatsapp_message_receipts.participant_jid),
          receipt_type = COALESCE(excluded.receipt_type, whatsapp_message_receipts.receipt_type),
          timestamp = COALESCE(excluded.timestamp, whatsapp_message_receipts.timestamp),
          raw_json = COALESCE(excluded.raw_json, whatsapp_message_receipts.raw_json),
          received_at = excluded.received_at
      `)
      .run(
        record.id,
        record.accountId,
        record.chatJid,
        record.messageId,
        record.participantJid ?? null,
        record.receiptType ?? null,
        record.timestamp ?? null,
        record.rawJson ?? null,
        record.receivedAt,
      );
  }

  saveWhatsAppMessageUpdate(record: WhatsAppMessageUpdateRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_message_updates
          (id, account_id, chat_jid, message_id, update_type, raw_json, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          chat_jid = COALESCE(excluded.chat_jid, whatsapp_message_updates.chat_jid),
          message_id = COALESCE(excluded.message_id, whatsapp_message_updates.message_id),
          update_type = excluded.update_type,
          raw_json = COALESCE(excluded.raw_json, whatsapp_message_updates.raw_json),
          received_at = excluded.received_at
      `)
      .run(
        record.id,
        record.accountId,
        record.chatJid ?? null,
        record.messageId ?? null,
        record.updateType,
        record.rawJson ?? null,
        record.receivedAt,
      );
  }

  saveWhatsAppMediaAsset(record: WhatsAppMediaAssetRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_media_assets
          (id, account_id, chat_jid, message_id, media_type, mimetype, file_name, caption, url, direct_path, local_path, raw_json, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          media_type = excluded.media_type,
          mimetype = COALESCE(excluded.mimetype, whatsapp_media_assets.mimetype),
          file_name = COALESCE(excluded.file_name, whatsapp_media_assets.file_name),
          caption = COALESCE(excluded.caption, whatsapp_media_assets.caption),
          url = COALESCE(excluded.url, whatsapp_media_assets.url),
          direct_path = COALESCE(excluded.direct_path, whatsapp_media_assets.direct_path),
          local_path = COALESCE(excluded.local_path, whatsapp_media_assets.local_path),
          raw_json = COALESCE(excluded.raw_json, whatsapp_media_assets.raw_json),
          received_at = excluded.received_at
      `)
      .run(
        record.id,
        record.accountId,
        record.chatJid,
        record.messageId,
        record.mediaType,
        record.mimetype ?? null,
        record.fileName ?? null,
        record.caption ?? null,
        record.url ?? null,
        record.directPath ?? null,
        record.localPath ?? null,
        record.rawJson ?? null,
        record.receivedAt,
      );
  }

  saveWhatsAppLidMapping(record: WhatsAppLidMappingRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_lid_mappings
          (account_id, lid_jid, pn_jid, source, raw_json, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, lid_jid) DO UPDATE SET
          pn_jid = excluded.pn_jid,
          source = excluded.source,
          raw_json = COALESCE(excluded.raw_json, whatsapp_lid_mappings.raw_json),
          last_seen_at = excluded.last_seen_at
      `)
      .run(
        record.accountId,
        record.lidJid,
        record.pnJid,
        record.source,
        record.rawJson ?? null,
        record.firstSeenAt,
        record.lastSeenAt,
      );
  }

  saveWhatsAppHistorySyncBatch(record: WhatsAppHistorySyncBatchRecord): void {
    this.db
      .prepare(`
        INSERT INTO whatsapp_history_sync_batches
          (id, account_id, sync_type, chat_count, contact_count, message_count, raw_json, received_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          sync_type = COALESCE(excluded.sync_type, whatsapp_history_sync_batches.sync_type),
          chat_count = excluded.chat_count,
          contact_count = excluded.contact_count,
          message_count = excluded.message_count,
          raw_json = COALESCE(excluded.raw_json, whatsapp_history_sync_batches.raw_json),
          received_at = excluded.received_at
      `)
      .run(
        record.id,
        record.accountId,
        record.syncType ?? null,
        record.chatCount,
        record.contactCount,
        record.messageCount,
        record.rawJson ?? null,
        record.receivedAt,
      );
  }

  saveWhatsAppSyncEvent(record: WhatsAppSyncEventRecord): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO whatsapp_sync_events
          (id, account_id, event_type, payload_hash, raw_json, received_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.accountId,
        record.eventType,
        record.payloadHash,
        record.rawJson ?? null,
        record.receivedAt,
      );
  }

  getWhatsAppSyncSummary(accountId?: string): WhatsAppSyncSummary {
    return {
      contacts: this.countRows("whatsapp_contacts", accountId),
      chats: this.countRows("whatsapp_chats", accountId),
      messages: this.countRows("whatsapp_messages", accountId),
      messageReceipts: this.countRows("whatsapp_message_receipts", accountId),
      messageUpdates: this.countRows("whatsapp_message_updates", accountId),
      mediaAssets: this.countRows("whatsapp_media_assets", accountId),
      lidMappings: this.countRows("whatsapp_lid_mappings", accountId),
      historySyncBatches: this.countRows("whatsapp_history_sync_batches", accountId),
      syncEvents: this.countRows("whatsapp_sync_events", accountId),
    };
  }

  listWhatsAppContacts(accountId?: string, limit = 200): WhatsAppContactRecord[] {
    const { clause, args } = accountWhereClause(accountId);
    return this.db
      .prepare(`SELECT * FROM whatsapp_contacts ${clause} ORDER BY last_seen_at DESC LIMIT ?`)
      .all(...args, safeLimit(limit))
      .map(rowToWhatsAppContact);
  }

  listWhatsAppChats(accountId?: string, limit = 200): WhatsAppChatRecord[] {
    const { clause, args } = accountWhereClause(accountId);
    return this.db
      .prepare(`SELECT * FROM whatsapp_chats ${clause} ORDER BY COALESCE(last_message_at, last_seen_at) DESC LIMIT ?`)
      .all(...args, safeLimit(limit))
      .map(rowToWhatsAppChat);
  }

  incrementWhatsAppChatUnreadForMessage(input: {
    accountId: string;
    chatJid: string;
    chatType: WhatsAppChatType;
    messageId: string;
    timestamp: string;
    receivedAt: string;
  }): WhatsAppChatRecord | undefined {
    this.db
      .prepare(`
        INSERT INTO whatsapp_chats
          (account_id, chat_jid, chat_type, unread_count, last_message_at, first_seen_at, last_seen_at)
        SELECT ?, ?, ?, 1, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM whatsapp_messages
          WHERE account_id = ? AND chat_jid = ? AND message_id = ?
        )
        ON CONFLICT(account_id, chat_jid) DO UPDATE SET
          chat_type = excluded.chat_type,
          unread_count = COALESCE(whatsapp_chats.unread_count, 0) + excluded.unread_count,
          last_message_at = COALESCE(excluded.last_message_at, whatsapp_chats.last_message_at),
          last_seen_at = excluded.last_seen_at
      `)
      .run(
        input.accountId,
        input.chatJid,
        input.chatType,
        input.timestamp,
        input.receivedAt,
        input.receivedAt,
        input.accountId,
        input.chatJid,
        input.messageId,
      );

    const row = this.db
      .prepare("SELECT * FROM whatsapp_chats WHERE account_id = ? AND chat_jid = ?")
      .get(input.accountId, input.chatJid);
    return row ? rowToWhatsAppChat(row) : undefined;
  }

  markWhatsAppChatRead(input: { accountId: string; chatJid: string }): WhatsAppChatRecord | undefined {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE whatsapp_chats
        SET unread_count = 0, last_seen_at = ?
        WHERE account_id = ? AND chat_jid = ?
      `)
      .run(now, input.accountId, input.chatJid);

    const row = this.db
      .prepare("SELECT * FROM whatsapp_chats WHERE account_id = ? AND chat_jid = ?")
      .get(input.accountId, input.chatJid);
    return row ? rowToWhatsAppChat(row) : undefined;
  }

  listWhatsAppMessages(input: { accountId?: string; chatJid?: string; limit?: number } = {}): WhatsAppStoredMessageRecord[] {
    const filters: string[] = [];
    const args: string[] = [];
    if (input.accountId?.trim()) {
      filters.push("account_id = ?");
      args.push(input.accountId.trim());
    }
    if (input.chatJid?.trim()) {
      filters.push("chat_jid = ?");
      args.push(input.chatJid.trim());
    }
    const clause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return this.db
      .prepare(`SELECT * FROM whatsapp_messages ${clause} ORDER BY timestamp DESC LIMIT ?`)
      .all(...args, safeLimit(input.limit))
      .map(rowToWhatsAppMessage);
  }

  listWhatsAppMessageCounts(accountId?: string): WhatsAppMessageCountRecord[] {
    const { clause, args } = accountWhereClause(accountId);
    const contentFilter = "TRIM(COALESCE(text, '')) <> '' OR media_json IS NOT NULL";
    const whereClause = clause ? `${clause} AND (${contentFilter})` : `WHERE ${contentFilter}`;
    return this.db
      .prepare(`
        SELECT account_id, chat_jid, COUNT(*) AS message_count
        FROM whatsapp_messages
        ${whereClause}
        GROUP BY account_id, chat_jid
      `)
      .all(...args)
      .map(rowToWhatsAppMessageCount);
  }

  listWhatsAppMessageReceipts(input: { accountId?: string; chatJid?: string; limit?: number } = {}): WhatsAppMessageReceiptRecord[] {
    const { clause, args } = syncWhereClause(input);
    return this.db
      .prepare(`SELECT * FROM whatsapp_message_receipts ${clause} ORDER BY COALESCE(timestamp, received_at) DESC LIMIT ?`)
      .all(...args, safeLimit(input.limit))
      .map(rowToWhatsAppMessageReceipt);
  }

  listWhatsAppMessageUpdates(input: { accountId?: string; chatJid?: string; limit?: number } = {}): WhatsAppMessageUpdateRecord[] {
    const { clause, args } = syncWhereClause(input);
    return this.db
      .prepare(`SELECT * FROM whatsapp_message_updates ${clause} ORDER BY received_at DESC LIMIT ?`)
      .all(...args, safeLimit(input.limit))
      .map(rowToWhatsAppMessageUpdate);
  }

  listWhatsAppMediaAssets(input: { accountId?: string; chatJid?: string; limit?: number } = {}): WhatsAppMediaAssetRecord[] {
    const { clause, args } = syncWhereClause(input);
    return this.db
      .prepare(`SELECT * FROM whatsapp_media_assets ${clause} ORDER BY received_at DESC LIMIT ?`)
      .all(...args, safeLimit(input.limit))
      .map(rowToWhatsAppMediaAsset);
  }

  listWhatsAppLidMappings(accountId?: string, limit = 200): WhatsAppLidMappingRecord[] {
    const { clause, args } = accountWhereClause(accountId);
    return this.db
      .prepare(`SELECT * FROM whatsapp_lid_mappings ${clause} ORDER BY last_seen_at DESC LIMIT ?`)
      .all(...args, safeLimit(limit))
      .map(rowToWhatsAppLidMapping);
  }

  listWhatsAppHistorySyncBatches(accountId?: string, limit = 200): WhatsAppHistorySyncBatchRecord[] {
    const { clause, args } = accountWhereClause(accountId);
    return this.db
      .prepare(`SELECT * FROM whatsapp_history_sync_batches ${clause} ORDER BY received_at DESC LIMIT ?`)
      .all(...args, safeLimit(limit))
      .map(rowToWhatsAppHistorySyncBatch);
  }

  listWhatsAppSyncEvents(accountId?: string, limit = 200): WhatsAppSyncEventRecord[] {
    const { clause, args } = accountWhereClause(accountId);
    return this.db
      .prepare(`SELECT * FROM whatsapp_sync_events ${clause} ORDER BY received_at DESC LIMIT ?`)
      .all(...args, safeLimit(limit))
      .map(rowToWhatsAppSyncEvent);
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hermes_sessions (
        id TEXT PRIMARY KEY,
        session_key TEXT NOT NULL,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hermes_chat_sessions (
        session_key TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        hermes_session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_messages (
        processed_key TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS delivery_records (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        session_key TEXT NOT NULL,
        inbound_message_id TEXT NOT NULL,
        inbound_text TEXT,
        outbound_text TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        failure_stage TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS group_routing_policies (
        account_id TEXT NOT NULL,
        group_jid TEXT NOT NULL,
        policy TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, group_jid)
      );

      CREATE TABLE IF NOT EXISTS number_rules (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        action TEXT NOT NULL,
        match_type TEXT NOT NULL,
        pattern TEXT NOT NULL DEFAULT '',
        label TEXT,
        enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS number_rules_account_idx
        ON number_rules(account_id, enabled);

      CREATE TABLE IF NOT EXISTS whatsapp_account_metadata (
        account_id TEXT PRIMARY KEY,
        alias TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS manager_chat_metadata (
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, chat_jid)
      );

      CREATE INDEX IF NOT EXISTS manager_chat_metadata_account_idx
        ON manager_chat_metadata(account_id, archived, updated_at DESC);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        outcome TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
        ON audit_logs(created_at DESC);

      CREATE TABLE IF NOT EXISTS postback_actions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        trigger TEXT NOT NULL,
        action_type TEXT NOT NULL,
        account_id TEXT,
        chat_jid TEXT,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS postback_actions_trigger_idx
        ON postback_actions(trigger, enabled, account_id, chat_jid);

      CREATE TABLE IF NOT EXISTS postback_action_runs (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL,
        action_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        inbound_message_id TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        request_json TEXT,
        response_status INTEGER,
        response_body TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS postback_action_runs_lookup_idx
        ON postback_action_runs(account_id, chat_jid, created_at DESC);

      CREATE TABLE IF NOT EXISTS hermes_platform_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        sender_jid TEXT NOT NULL,
        session_key TEXT NOT NULL,
        message_id TEXT NOT NULL,
        participant_jid TEXT,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS hermes_platform_events_sequence_idx
        ON hermes_platform_events(sequence);

      CREATE TABLE IF NOT EXISTS whatsapp_contacts (
        account_id TEXT NOT NULL,
        contact_jid TEXT NOT NULL,
        phone_number TEXT,
        lid_jid TEXT,
        name TEXT,
        notify_name TEXT,
        verified_name TEXT,
        raw_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (account_id, contact_jid)
      );

      CREATE INDEX IF NOT EXISTS whatsapp_contacts_account_last_seen_idx
        ON whatsapp_contacts(account_id, last_seen_at DESC);

      CREATE TABLE IF NOT EXISTS whatsapp_chats (
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        display_name TEXT,
        unread_count INTEGER,
        last_message_at TEXT,
        archived INTEGER,
        pinned INTEGER,
        muted_until TEXT,
        raw_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (account_id, chat_jid)
      );

      CREATE INDEX IF NOT EXISTS whatsapp_chats_account_last_message_idx
        ON whatsapp_chats(account_id, last_message_at DESC);

      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sender_jid TEXT,
        from_me INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        message_type TEXT,
        text TEXT,
        media_json TEXT,
        reaction_json TEXT,
        raw_json TEXT,
        received_at TEXT NOT NULL,
        PRIMARY KEY (account_id, chat_jid, message_id)
      );

      CREATE INDEX IF NOT EXISTS whatsapp_messages_chat_timestamp_idx
        ON whatsapp_messages(account_id, chat_jid, timestamp DESC);

      CREATE TABLE IF NOT EXISTS whatsapp_message_receipts (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        message_id TEXT NOT NULL,
        participant_jid TEXT,
        receipt_type TEXT,
        timestamp TEXT,
        raw_json TEXT,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS whatsapp_message_receipts_chat_idx
        ON whatsapp_message_receipts(account_id, chat_jid, received_at DESC);

      CREATE TABLE IF NOT EXISTS whatsapp_message_updates (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_jid TEXT,
        message_id TEXT,
        update_type TEXT NOT NULL,
        raw_json TEXT,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS whatsapp_message_updates_chat_idx
        ON whatsapp_message_updates(account_id, chat_jid, received_at DESC);

      CREATE TABLE IF NOT EXISTS whatsapp_media_assets (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        message_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        mimetype TEXT,
        file_name TEXT,
        caption TEXT,
        url TEXT,
        direct_path TEXT,
        local_path TEXT,
        raw_json TEXT,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS whatsapp_media_assets_chat_idx
        ON whatsapp_media_assets(account_id, chat_jid, received_at DESC);

      CREATE TABLE IF NOT EXISTS whatsapp_lid_mappings (
        account_id TEXT NOT NULL,
        lid_jid TEXT NOT NULL,
        pn_jid TEXT NOT NULL,
        source TEXT NOT NULL,
        raw_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (account_id, lid_jid)
      );

      CREATE INDEX IF NOT EXISTS whatsapp_lid_mappings_pn_idx
        ON whatsapp_lid_mappings(account_id, pn_jid);

      CREATE TABLE IF NOT EXISTS whatsapp_history_sync_batches (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        sync_type TEXT,
        chat_count INTEGER NOT NULL,
        contact_count INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        raw_json TEXT,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS whatsapp_history_sync_batches_account_idx
        ON whatsapp_history_sync_batches(account_id, received_at DESC);

      CREATE TABLE IF NOT EXISTS whatsapp_sync_events (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        raw_json TEXT,
        received_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS whatsapp_sync_events_account_idx
        ON whatsapp_sync_events(account_id, received_at DESC);
    `);
    this.ensureColumn("delivery_records", "inbound_text", "TEXT");
    this.ensureColumn("delivery_records", "failure_stage", "TEXT");
    this.cleanupPostbackRecords();
    this.cleanupBlockedNumberRuleDeliveries();
  }

  private cleanupBlockedNumberRuleDeliveries() {
    this.db
      .prepare(`
        UPDATE delivery_records
        SET status = 'ignored',
            failure_stage = NULL
        WHERE error LIKE 'Blocked by number rule%'
          AND (status != 'ignored' OR failure_stage IS NOT NULL)
      `)
      .run();
  }

  private ensureColumn(table: string, column: string, type: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  private countRows(table: string, accountId?: string): number {
    if (accountId?.trim()) {
      const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id = ?`).get(accountId.trim()) as {
        count?: number;
      };
      return Number(row?.count ?? 0);
    }

    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number };
    return Number(row?.count ?? 0);
  }
}

function rowToMapping(row: unknown): ChatSessionMapping {
  const value = row as Record<string, unknown>;
  return {
    sessionKey: requiredString(value, "session_key"),
    accountId: requiredString(value, "account_id"),
    chatJid: requiredString(value, "chat_jid"),
    chatType: requiredString(value, "chat_type") as ChatSessionMapping["chatType"],
    chatId: requiredString(value, "chat_id"),
    hermesSessionId: requiredString(value, "hermes_session_id"),
    createdAt: requiredString(value, "created_at"),
    updatedAt: requiredString(value, "updated_at"),
  };
}

function rowToSession(row: unknown): HermesSession {
  const value = row as Record<string, unknown>;
  return {
    id: requiredString(value, "id"),
    sessionKey: requiredString(value, "session_key"),
    accountId: requiredString(value, "account_id"),
    chatJid: requiredString(value, "chat_jid"),
    chatType: requiredString(value, "chat_type") as HermesSession["chatType"],
    chatId: requiredString(value, "chat_id"),
    createdAt: requiredString(value, "created_at"),
    lastActivityAt: requiredString(value, "last_activity_at"),
    status: requiredString(value, "status") as HermesSession["status"],
  };
}

function rowToDelivery(row: unknown): DeliveryRecord {
  const value = row as Record<string, string | number | null>;
  const failureStage = value.failure_stage;
  return {
    id: String(value.id),
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    chatType: String(value.chat_type) as DeliveryRecord["chatType"],
    sessionKey: String(value.session_key),
    inboundMessageId: String(value.inbound_message_id),
    ...(value.inbound_text ? { inboundText: String(value.inbound_text) } : {}),
    outboundText: String(value.outbound_text),
    status: String(value.status) as DeliveryRecord["status"],
    attempts: Number(value.attempts),
    ...(failureStage === "hermes" || failureStage === "whatsapp" ? { failureStage } : {}),
    ...(value.error ? { error: String(value.error) } : {}),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function rowToGroupPolicy(row: unknown): GroupRoutingPolicyRecord {
  const value = row as Record<string, unknown>;
  return {
    accountId: requiredString(value, "account_id"),
    groupJid: requiredString(value, "group_jid"),
    policy: requiredString(value, "policy") as WhatsAppGroupRoutingPolicy,
    createdAt: requiredString(value, "created_at"),
    updatedAt: requiredString(value, "updated_at"),
  };
}

function rowToNumberRule(row: unknown): NumberRuleRecord {
  const value = row as Record<string, string | number | null>;
  return {
    id: String(value.id),
    accountId: String(value.account_id),
    action: String(value.action) as NumberRuleRecord["action"],
    matchType: String(value.match_type) as NumberRuleRecord["matchType"],
    pattern: String(value.pattern ?? ""),
    ...(value.label ? { label: String(value.label) } : {}),
    enabled: Boolean(value.enabled),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function rowToAccountMetadata(row: unknown): WhatsAppAccountMetadata {
  const value = row as Record<string, string | null>;
  return {
    accountId: String(value.account_id),
    ...(value.alias ? { alias: String(value.alias) } : {}),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function rowToManagerChatMetadata(row: unknown): ManagerChatMetadata {
  const value = row as Record<string, string | number | null>;
  return {
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    archived: Boolean(value.archived),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function rowToAuditLog(row: unknown): AuditLogRecord {
  const value = row as Record<string, string | null>;
  const detailsJson = value.details_json;
  return {
    id: String(value.id),
    action: String(value.action),
    actor: String(value.actor),
    outcome: String(value.outcome) as AuditLogRecord["outcome"],
    ...(value.resource_type ? { resourceType: String(value.resource_type) } : {}),
    ...(value.resource_id ? { resourceId: String(value.resource_id) } : {}),
    ...(detailsJson ? { details: parseDetailsJson(detailsJson) } : {}),
    createdAt: String(value.created_at),
  };
}

function rowToPostbackAction(row: unknown): PostbackActionRecord {
  const value = row as Record<string, string | number | null>;
  return {
    id: String(value.id),
    name: String(value.name),
    enabled: Boolean(value.enabled),
    trigger: String(value.trigger) as PostbackActionRecord["trigger"],
    actionType: String(value.action_type) as PostbackActionRecord["actionType"],
    ...(value.account_id ? { accountId: String(value.account_id) } : {}),
    ...(value.chat_jid ? { chatJid: String(value.chat_jid) } : {}),
    configJson: String(value.config_json ?? "{}"),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function rowToPostbackActionRun(row: unknown): PostbackActionRunRecord {
  const value = row as Record<string, string | number | null>;
  return {
    id: String(value.id),
    actionId: String(value.action_id),
    actionName: String(value.action_name),
    actionType: String(value.action_type) as PostbackActionRunRecord["actionType"],
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    inboundMessageId: String(value.inbound_message_id),
    status: String(value.status) as PostbackActionRunRecord["status"],
    attempts: Number(value.attempts),
    ...(value.request_json ? { requestJson: String(value.request_json) } : {}),
    ...(value.response_status !== null && value.response_status !== undefined ? { responseStatus: Number(value.response_status) } : {}),
    ...(value.response_body ? { responseBody: String(value.response_body) } : {}),
    ...(value.error ? { error: String(value.error) } : {}),
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at),
  };
}

function rowToHermesPlatformEvent(row: unknown): HermesPlatformEventRecord {
  const value = row as Record<string, string | number | null>;
  return {
    sequence: Number(value.sequence),
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    chatType: String(value.chat_type) as HermesPlatformEventRecord["chatType"],
    senderJid: String(value.sender_jid),
    sessionKey: String(value.session_key),
    messageId: String(value.message_id),
    ...(value.participant_jid ? { participantJid: String(value.participant_jid) } : {}),
    text: String(value.text),
    timestamp: String(value.timestamp),
    payloadJson: String(value.payload_json),
    createdAt: String(value.created_at),
  };
}

function rowToWhatsAppContact(row: unknown): WhatsAppContactRecord {
  const value = row as Record<string, string | null>;
  return {
    accountId: String(value.account_id),
    contactJid: String(value.contact_jid),
    ...(value.phone_number ? { phoneNumber: String(value.phone_number) } : {}),
    ...(value.lid_jid ? { lidJid: String(value.lid_jid) } : {}),
    ...(value.name ? { name: String(value.name) } : {}),
    ...(value.notify_name ? { notifyName: String(value.notify_name) } : {}),
    ...(value.verified_name ? { verifiedName: String(value.verified_name) } : {}),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    firstSeenAt: String(value.first_seen_at),
    lastSeenAt: String(value.last_seen_at),
  };
}

function rowToWhatsAppChat(row: unknown): WhatsAppChatRecord {
  const value = row as Record<string, string | number | null>;
  return {
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    chatType: String(value.chat_type) as WhatsAppChatRecord["chatType"],
    ...(value.display_name ? { displayName: String(value.display_name) } : {}),
    ...(value.unread_count !== null && value.unread_count !== undefined ? { unreadCount: Number(value.unread_count) } : {}),
    ...(value.last_message_at ? { lastMessageAt: String(value.last_message_at) } : {}),
    ...(value.archived !== null && value.archived !== undefined ? { archived: Boolean(value.archived) } : {}),
    ...(value.pinned !== null && value.pinned !== undefined ? { pinned: Boolean(value.pinned) } : {}),
    ...(value.muted_until ? { mutedUntil: String(value.muted_until) } : {}),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    firstSeenAt: String(value.first_seen_at),
    lastSeenAt: String(value.last_seen_at),
  };
}

function rowToWhatsAppMessage(row: unknown): WhatsAppStoredMessageRecord {
  const value = row as Record<string, string | number | null>;
  return {
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    messageId: String(value.message_id),
    ...(value.sender_jid ? { senderJid: String(value.sender_jid) } : {}),
    fromMe: Boolean(value.from_me),
    timestamp: String(value.timestamp),
    ...(value.message_type ? { messageType: String(value.message_type) } : {}),
    ...(value.text ? { text: String(value.text) } : {}),
    ...(value.media_json ? { mediaJson: String(value.media_json) } : {}),
    ...(value.reaction_json ? { reactionJson: String(value.reaction_json) } : {}),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    receivedAt: String(value.received_at),
  };
}

function rowToWhatsAppMessageCount(row: unknown): WhatsAppMessageCountRecord {
  const value = row as Record<string, string | number | null>;
  return {
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    messageCount: Number(value.message_count),
  };
}

function rowToWhatsAppMessageReceipt(row: unknown): WhatsAppMessageReceiptRecord {
  const value = row as Record<string, string | null>;
  return {
    id: String(value.id),
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    messageId: String(value.message_id),
    ...(value.participant_jid ? { participantJid: String(value.participant_jid) } : {}),
    ...(value.receipt_type ? { receiptType: String(value.receipt_type) } : {}),
    ...(value.timestamp ? { timestamp: String(value.timestamp) } : {}),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    receivedAt: String(value.received_at),
  };
}

function rowToWhatsAppMessageUpdate(row: unknown): WhatsAppMessageUpdateRecord {
  const value = row as Record<string, string | null>;
  return {
    id: String(value.id),
    accountId: String(value.account_id),
    ...(value.chat_jid ? { chatJid: String(value.chat_jid) } : {}),
    ...(value.message_id ? { messageId: String(value.message_id) } : {}),
    updateType: String(value.update_type),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    receivedAt: String(value.received_at),
  };
}

function rowToWhatsAppMediaAsset(row: unknown): WhatsAppMediaAssetRecord {
  const value = row as Record<string, string | null>;
  return {
    id: String(value.id),
    accountId: String(value.account_id),
    chatJid: String(value.chat_jid),
    messageId: String(value.message_id),
    mediaType: String(value.media_type) as WhatsAppMediaAssetRecord["mediaType"],
    ...(value.mimetype ? { mimetype: String(value.mimetype) } : {}),
    ...(value.file_name ? { fileName: String(value.file_name) } : {}),
    ...(value.caption ? { caption: String(value.caption) } : {}),
    ...(value.url ? { url: String(value.url) } : {}),
    ...(value.direct_path ? { directPath: String(value.direct_path) } : {}),
    ...(value.local_path ? { localPath: String(value.local_path) } : {}),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    receivedAt: String(value.received_at),
  };
}

function rowToWhatsAppLidMapping(row: unknown): WhatsAppLidMappingRecord {
  const value = row as Record<string, string | null>;
  return {
    accountId: String(value.account_id),
    lidJid: String(value.lid_jid),
    pnJid: String(value.pn_jid),
    source: String(value.source),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    firstSeenAt: String(value.first_seen_at),
    lastSeenAt: String(value.last_seen_at),
  };
}

function rowToWhatsAppHistorySyncBatch(row: unknown): WhatsAppHistorySyncBatchRecord {
  const value = row as Record<string, string | number | null>;
  return {
    id: String(value.id),
    accountId: String(value.account_id),
    ...(value.sync_type ? { syncType: String(value.sync_type) } : {}),
    chatCount: Number(value.chat_count),
    contactCount: Number(value.contact_count),
    messageCount: Number(value.message_count),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    receivedAt: String(value.received_at),
  };
}

function rowToWhatsAppSyncEvent(row: unknown): WhatsAppSyncEventRecord {
  const value = row as Record<string, string | null>;
  return {
    id: String(value.id),
    accountId: String(value.account_id),
    eventType: String(value.event_type) as WhatsAppSyncEventRecord["eventType"],
    payloadHash: String(value.payload_hash),
    ...(value.raw_json ? { rawJson: String(value.raw_json) } : {}),
    receivedAt: String(value.received_at),
  };
}

function accountWhereClause(accountId?: string) {
  if (!accountId?.trim()) {
    return { clause: "", args: [] as string[] };
  }

  return { clause: "WHERE account_id = ?", args: [accountId.trim()] };
}

function syncWhereClause(input: { accountId?: string; chatJid?: string }) {
  const filters: string[] = [];
  const args: string[] = [];
  if (input.accountId?.trim()) {
    filters.push("account_id = ?");
    args.push(input.accountId.trim());
  }
  if (input.chatJid?.trim()) {
    filters.push("chat_jid = ?");
    args.push(input.chatJid.trim());
  }

  return {
    clause: filters.length ? `WHERE ${filters.join(" AND ")}` : "",
    args,
  };
}

function safeLimit(limit: number | undefined) {
  return Math.min(Math.max(Math.trunc(limit ?? 200), 1), 1000);
}

function cleanupByCreatedAt(db: DatabaseSync, tableName: "postback_action_runs" | "hermes_platform_events", retentionDays: number, now: Date) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return 0;
  }
  const cutoff = new Date(now.getTime() - Math.trunc(retentionDays) * 24 * 60 * 60 * 1000).toISOString();
  return Number(db.prepare(`DELETE FROM ${tableName} WHERE created_at < ?`).run(cutoff).changes);
}

function parseDetailsJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeAuditDetails(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !incoming) {
    return undefined;
  }

  const merged = {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
  if (existing && Object.prototype.hasOwnProperty.call(existing, "previousTitle")) {
    merged.previousTitle = existing.previousTitle;
  }
  if (existing && Object.prototype.hasOwnProperty.call(existing, "previousCustomIcon")) {
    merged.previousCustomIcon = existing.previousCustomIcon;
  }
  merged.changeCount = readChangeCount(existing) + 1;
  return merged;
}

function readChangeCount(details: Record<string, unknown> | undefined) {
  const value = details?.changeCount;
  return typeof value === "number" && Number.isFinite(value) ? value : 1;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string database column ${key}`);
  }

  return value;
}
