import { useEffect, useRef, useState } from "react";

import { areStringArraysEqual } from "../domain/collections";
import type { WhatsAppAccount } from "../domain/models";
import { getFallbackTabId, getInitialWorkspaceState, getPreferredAccountTabId, persistWorkspaceState } from "../services/workspace-storage";

export function useWorkspaceTabs({
  accounts,
  hasLoadedAccounts,
  onAccountViewReset,
}: {
  accounts: WhatsAppAccount[];
  hasLoadedAccounts: boolean;
  onAccountViewReset: () => void;
}) {
  const [initialWorkspace] = useState(getInitialWorkspaceState);
  const [openAccountTabs, setOpenAccountTabs] = useState<string[]>(initialWorkspace.openAccountTabs);
  const [isSettingsTabOpen, setIsSettingsTabOpen] = useState(initialWorkspace.isSettingsTabOpen);
  const [isLogsTabOpen, setIsLogsTabOpen] = useState(initialWorkspace.isLogsTabOpen);
  const [activeTabId, setActiveTabId] = useState(initialWorkspace.activeTabId);
  const [activeAccountId, setActiveAccountId] = useState(initialWorkspace.activeAccountId);
  const workspaceTabsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persistWorkspaceState({
      activeAccountId,
      activeTabId,
      isLogsTabOpen,
      isSettingsTabOpen,
      openAccountTabs,
    });
  }, [activeAccountId, activeTabId, isLogsTabOpen, isSettingsTabOpen, openAccountTabs]);

  useEffect(() => {
    const tabStrip = workspaceTabsRef.current;

    if (!tabStrip) {
      return;
    }

    const scrollElement = tabStrip;

    function handleWorkspaceTabsWheel(event: WheelEvent) {
      const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

      if (!horizontalDelta || scrollElement.scrollWidth <= scrollElement.clientWidth) {
        return;
      }

      const nextScrollLeft = Math.max(0, Math.min(scrollElement.scrollLeft + horizontalDelta, scrollElement.scrollWidth - scrollElement.clientWidth));

      if (nextScrollLeft !== scrollElement.scrollLeft) {
        scrollElement.scrollLeft = nextScrollLeft;
        event.preventDefault();
      }
    }

    scrollElement.addEventListener("wheel", handleWorkspaceTabsWheel, { passive: false });

    return () => {
      scrollElement.removeEventListener("wheel", handleWorkspaceTabsWheel);
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedAccounts) {
      return;
    }

    const availableAccountIds = new Set(accounts.map((account) => account.accountId));
    const allAccountIds = accounts.map((account) => account.accountId);
    const connectedAccountIds = accounts.filter((account) => account.status === "connected").map((account) => account.accountId);
    const preferredAccountId = getPreferredAccountTabId(allAccountIds, connectedAccountIds);
    const validOpenTabs = openAccountTabs.filter((accountId) => availableAccountIds.has(accountId));
    const repairedOpenTabs = validOpenTabs.length > 0 || !preferredAccountId ? validOpenTabs : [preferredAccountId];

    if (!areStringArraysEqual(openAccountTabs, repairedOpenTabs)) {
      setOpenAccountTabs(repairedOpenTabs);
    }

    const isActiveAccountTab = activeTabId && activeTabId !== "settings" && activeTabId !== "logs";
    const isActiveTabAvailable =
      !activeTabId ||
      (activeTabId === "settings" && isSettingsTabOpen) ||
      (activeTabId === "logs" && isLogsTabOpen) ||
      (isActiveAccountTab && availableAccountIds.has(activeTabId));

    if (!isActiveTabAvailable) {
      const nextTabId = preferredAccountId || getFallbackTabId(repairedOpenTabs, isSettingsTabOpen, isLogsTabOpen);
      setActiveTabId(nextTabId);
      setActiveAccountId(nextTabId && nextTabId !== "settings" && nextTabId !== "logs" ? nextTabId : repairedOpenTabs[0] ?? "");
      onAccountViewReset();
      return;
    }

    if (isActiveAccountTab && availableAccountIds.has(activeTabId) && activeAccountId !== activeTabId) {
      setActiveAccountId(activeTabId);
      onAccountViewReset();
      return;
    }

    if (activeAccountId && !availableAccountIds.has(activeAccountId)) {
      setActiveAccountId(preferredAccountId || repairedOpenTabs[0] || "");
      onAccountViewReset();
    }
  }, [
    accounts,
    activeAccountId,
    activeTabId,
    hasLoadedAccounts,
    isLogsTabOpen,
    isSettingsTabOpen,
    onAccountViewReset,
    openAccountTabs,
  ]);

  function openAccountTab(accountId: string) {
    setOpenAccountTabs((currentTabs) => (currentTabs.includes(accountId) ? currentTabs : [...currentTabs, accountId]));
    setActiveTabId(accountId);
  }

  function selectAccountTab(accountId: string) {
    setActiveTabId(accountId);
    setActiveAccountId(accountId);
    onAccountViewReset();
  }

  function openLogsTab() {
    setIsLogsTabOpen(true);
    setActiveTabId("logs");
  }

  function closeLogsTab() {
    setIsLogsTabOpen(false);
    if (activeTabId === "logs") {
      const nextTabId = getFallbackTabId(openAccountTabs, isSettingsTabOpen, false);
      setActiveTabId(nextTabId);
      setActiveAccountId(nextTabId && nextTabId !== "settings" ? nextTabId : activeAccountId);
    }
  }

  function openSettingsTab() {
    setIsSettingsTabOpen(true);
    setActiveTabId("settings");
  }

  function closeSettingsTab() {
    setIsSettingsTabOpen(false);
    if (activeTabId === "settings") {
      const nextTabId = getFallbackTabId(openAccountTabs, false, isLogsTabOpen);
      setActiveTabId(nextTabId);
      setActiveAccountId(nextTabId && nextTabId !== "logs" ? nextTabId : activeAccountId);
    }
  }

  function closeAccountTab(accountId: string) {
    setOpenAccountTabs((currentTabs) => currentTabs.filter((tabAccountId) => tabAccountId !== accountId));
    if (activeTabId === accountId) {
      const nextAccountId = openAccountTabs.find((tabAccountId) => tabAccountId !== accountId);
      setActiveTabId(nextAccountId ?? getFallbackTabId([], isSettingsTabOpen, isLogsTabOpen));
      setActiveAccountId(nextAccountId ?? "");
      onAccountViewReset();
    }
  }

  return {
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
  };
}
