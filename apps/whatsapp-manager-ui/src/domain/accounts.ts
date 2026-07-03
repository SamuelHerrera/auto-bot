import type { WhatsAppAccount } from "./models";
import { formatTimestamp } from "./formatting";

export function getAccountTabLabel(account: WhatsAppAccount) {
  if (isPendingAccountId(account.accountId)) {
    return "Linking number";
  }

  return account.alias?.trim() || account.accountId;
}

export function getAccountPrimaryLabel(account: WhatsAppAccount) {
  return getAccountTabLabel(account);
}

export function getAccountDetailLine(account: WhatsAppAccount) {
  const activity = getAccountActivity(account);
  if (!account.alias?.trim() || isPendingAccountId(account.accountId)) {
    return activity;
  }

  return `${account.accountId} · ${activity}`;
}

export function accountMatchesSearch(account: WhatsAppAccount, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) {
    return true;
  }

  return [account.accountId, account.alias ?? ""].some((value) => value.toLowerCase().includes(query));
}

export function isPendingAccountId(accountId: string) {
  return accountId.startsWith("pending-");
}

export function getAccountActivity(account: WhatsAppAccount) {
  if (isPendingAccountId(account.accountId)) {
    return account.qrCode ? "Waiting for QR scan." : "Opening pairing session.";
  }

  if (account.connectedAt) {
    return `Connected ${formatTimestamp(account.connectedAt)}`;
  }

  if (account.disconnectedAt) {
    return `Disconnected ${formatTimestamp(account.disconnectedAt)}`;
  }

  return "No active WhatsApp session yet.";
}

export function getAccountStatusDetail(account: WhatsAppAccount) {
  if (account.status === "connected") {
    return account.connectedAt ? `Connected at ${formatTimestamp(account.connectedAt)}` : "Connected to WhatsApp.";
  }

  if (account.status === "connecting") {
    return account.qrCode ? "Waiting for the WhatsApp QR scan." : "Opening a WhatsApp pairing session.";
  }

  if (account.lastError) {
    return account.lastError;
  }

  return account.disconnectedAt
    ? `Disconnected at ${formatTimestamp(account.disconnectedAt)}`
    : "Disconnected from WhatsApp.";
}

export function findCompletedLinkedAccount(
  accounts: WhatsAppAccount[],
  linkStatus: WhatsAppAccount | null,
  linkingStatus: WhatsAppAccount | null,
  baselineAccountIds: string[],
  linkingStartedAt: string | null,
) {
  if (
    linkStatus?.status === "connected" &&
    !isPendingAccountId(linkStatus.accountId) &&
    isLinkedAccountFromCurrentSession(linkStatus, baselineAccountIds, linkingStartedAt)
  ) {
    return linkStatus;
  }

  if (!linkingStatus?.qrCode) {
    return null;
  }

  return accounts.find(
    (account) =>
      account.status === "connected" &&
      !isPendingAccountId(account.accountId) &&
      isLinkedAccountFromCurrentSession(account, baselineAccountIds, linkingStartedAt),
  ) ?? null;
}

export function isLinkedAccountFromCurrentSession(
  account: WhatsAppAccount,
  baselineAccountIds: string[],
  linkingStartedAt: string | null,
) {
  if (!baselineAccountIds.includes(account.accountId)) {
    return true;
  }

  if (!account.connectedAt || !linkingStartedAt) {
    return false;
  }

  return Date.parse(account.connectedAt) >= Date.parse(linkingStartedAt);
}

export function mergeLinkingStatus(currentStatus: WhatsAppAccount | null, nextStatus: WhatsAppAccount) {
  if (
    currentStatus?.qrCode &&
    !nextStatus.qrCode &&
    currentStatus.accountId === nextStatus.accountId &&
    nextStatus.status === "connecting"
  ) {
    return {
      ...nextStatus,
      qrCode: currentStatus.qrCode,
    };
  }

  return nextStatus;
}
