import type { DeliveryRecord } from "./models";

export function getDeliveryStatus(delivery: DeliveryRecord): DeliveryRecord["status"] {
  if (isNumberRuleBlockedDelivery(delivery)) {
    return "ignored";
  }

  return delivery.status;
}

export function isFailedDelivery(delivery: DeliveryRecord) {
  return getDeliveryStatus(delivery) === "failed";
}

export function isNumberRuleBlockedDelivery(delivery: DeliveryRecord) {
  return delivery.error?.startsWith("Blocked by number rule") ?? false;
}
