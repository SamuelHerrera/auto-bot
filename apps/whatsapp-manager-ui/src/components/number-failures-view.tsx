import type { DeliveryRecord } from "../domain/models";
import { EmptyState, IconButton } from "./shared";

export function FailuresView({
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
          <EmptyState title="No failures" description="Failed inbound processing or WhatsApp deliveries will appear here." />
        ) : (
          failedDeliveries.map((delivery) => (
            <article key={delivery.id} className="retry-row">
              <div className="retry-row-header">
                <strong>{delivery.chatJid}</strong>
                <IconButton icon="mdi:refresh" label="Retry delivery" onClick={() => onRetry(delivery.id)} disabled={isBusy} />
              </div>
              <p>{delivery.error ?? "Delivery failed."}</p>
              <span className="mono">{formatFailureStage(delivery.failureStage)} / {delivery.id}</span>
            </article>
          ))
        )}
      </div>
    </>
  );
}

function formatFailureStage(stage: DeliveryRecord["failureStage"]) {
  if (stage === "agent") {
    return "inbound";
  }
  return stage ?? "unknown";
}
