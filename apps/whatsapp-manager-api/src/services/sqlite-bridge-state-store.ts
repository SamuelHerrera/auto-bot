import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  ChatSessionMapping,
  DeliveryRecord,
  GroupRoutingPolicyRecord,
  HermesSession,
  NumberRuleInput,
  NumberRuleRecord,
  WhatsAppGroupRoutingPolicy,
} from "../domain/types.js";
import type {
  BridgeDeliveryStore,
  ChatSessionRouterSnapshot,
  ChatSessionRouterStore,
  GroupRoutingPolicyStore,
  NumberRuleStore,
} from "./chat-session-router.js";

export class SqliteBridgeStateStore
  implements ChatSessionRouterStore, BridgeDeliveryStore, GroupRoutingPolicyStore, NumberRuleStore
{
  private readonly db: DatabaseSync;

  constructor(filePath: string) {
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

  listDeliveries(): DeliveryRecord[] {
    return this.db
      .prepare("SELECT * FROM delivery_records ORDER BY created_at DESC")
      .all()
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
    `);
    this.ensureColumn("delivery_records", "inbound_text", "TEXT");
    this.ensureColumn("delivery_records", "failure_stage", "TEXT");
  }

  private ensureColumn(table: string, column: string, type: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
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

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string database column ${key}`);
  }

  return value;
}
