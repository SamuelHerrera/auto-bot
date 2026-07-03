import { useEffect, useRef, useState } from "react";

import { mergeLinkingStatus } from "../domain/accounts";
import type { WhatsAppAccount } from "../domain/models";

export function useLinkSession() {
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkingStatus, setLinkingStatus] = useState<WhatsAppAccount | null>(null);
  const [linkingBaselineAccountIds, setLinkingBaselineAccountIds] = useState<string[]>([]);
  const isLinkDialogOpenRef = useRef(isLinkDialogOpen);
  const linkingStatusRef = useRef(linkingStatus);
  const linkingBaselineAccountIdsRef = useRef(linkingBaselineAccountIds);
  const linkingStartedAtRef = useRef<string | null>(null);

  useEffect(() => {
    isLinkDialogOpenRef.current = isLinkDialogOpen;
  }, [isLinkDialogOpen]);

  useEffect(() => {
    linkingStatusRef.current = linkingStatus;
  }, [linkingStatus]);

  useEffect(() => {
    linkingBaselineAccountIdsRef.current = linkingBaselineAccountIds;
  }, [linkingBaselineAccountIds]);

  function startLinkSession(account: WhatsAppAccount, baselineAccountIds: string[], linkingStartedAt: string) {
    linkingStatusRef.current = account;
    linkingBaselineAccountIdsRef.current = baselineAccountIds;
    linkingStartedAtRef.current = linkingStartedAt;
    isLinkDialogOpenRef.current = true;
    setLinkingStatus(account);
    setLinkingBaselineAccountIds(baselineAccountIds);
    setIsLinkDialogOpen(true);
  }

  function updateLinkingStatus(account: WhatsAppAccount) {
    const nextStatus = mergeLinkingStatus(linkingStatusRef.current, account);
    linkingStatusRef.current = nextStatus;
    setLinkingStatus(nextStatus);
  }

  function clearLinkSession() {
    linkingStatusRef.current = null;
    linkingBaselineAccountIdsRef.current = [];
    linkingStartedAtRef.current = null;
    isLinkDialogOpenRef.current = false;
    setLinkingStatus(null);
    setLinkingBaselineAccountIds([]);
    setIsLinkDialogOpen(false);
  }

  return {
    clearLinkSession,
    isLinkDialogOpen,
    isLinkDialogOpenRef,
    linkingBaselineAccountIdsRef,
    linkingStartedAtRef,
    linkingStatus,
    linkingStatusRef,
    startLinkSession,
    updateLinkingStatus,
  };
}
