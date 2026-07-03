import { getAccountActivity, getAccountStatusDetail } from "../domain/accounts";
import { buildChatMessages } from "../domain/chats";
import { formatTimestamp } from "../domain/formatting";
import type { ChatSummary, DeliveryRecord, NumberRule, SessionMapping, WhatsAppAccount } from "../domain/models";
import { Metric } from "./shared";

export function HomeView({
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
              <dd>
                {latestChat
                  ? `${latestChat.displayName ?? latestChat.phoneNumber ?? latestChat.chatJid} · ${formatTimestamp(latestChat.updatedAt)}`
                  : "No chat activity"}
              </dd>
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
