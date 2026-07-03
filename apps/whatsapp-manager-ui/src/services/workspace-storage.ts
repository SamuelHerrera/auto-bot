import type { WorkspaceState } from "../domain/models";

const workspaceStorageKeys = {
  activeAccountId: "whatsapp-manager-ui.workspace-active-account-id",
  activeTabId: "whatsapp-manager-ui.workspace-active-tab-id",
  isLogsTabOpen: "whatsapp-manager-ui.workspace-logs-open",
  isSettingsTabOpen: "whatsapp-manager-ui.workspace-settings-open",
  openAccountTabs: "whatsapp-manager-ui.workspace-account-tabs",
};

export function getInitialWorkspaceState(): WorkspaceState {
  const isSettingsTabOpen = localStorage.getItem(workspaceStorageKeys.isSettingsTabOpen) === "true";
  const isLogsTabOpen = localStorage.getItem(workspaceStorageKeys.isLogsTabOpen) === "true";
  const openAccountTabs = parseStoredStringArray(localStorage.getItem(workspaceStorageKeys.openAccountTabs));
  const storedActiveTabId = localStorage.getItem(workspaceStorageKeys.activeTabId) ?? "";
  const storedActiveAccountId = localStorage.getItem(workspaceStorageKeys.activeAccountId) ?? "";
  const canRestoreActiveTab =
    !storedActiveTabId ||
    openAccountTabs.includes(storedActiveTabId) ||
    (storedActiveTabId === "settings" && isSettingsTabOpen) ||
    (storedActiveTabId === "logs" && isLogsTabOpen);

  const activeTabId = canRestoreActiveTab
    ? storedActiveTabId
    : getFallbackTabId(openAccountTabs, isSettingsTabOpen, isLogsTabOpen);

  return {
    activeAccountId: openAccountTabs.includes(storedActiveAccountId) ? storedActiveAccountId : openAccountTabs[0] ?? "",
    activeTabId,
    isLogsTabOpen,
    isSettingsTabOpen,
    openAccountTabs,
  };
}

export function persistWorkspaceState(workspace: WorkspaceState) {
  localStorage.setItem(workspaceStorageKeys.activeAccountId, workspace.activeAccountId);
  localStorage.setItem(workspaceStorageKeys.activeTabId, workspace.activeTabId);
  localStorage.setItem(workspaceStorageKeys.isLogsTabOpen, String(workspace.isLogsTabOpen));
  localStorage.setItem(workspaceStorageKeys.isSettingsTabOpen, String(workspace.isSettingsTabOpen));
  localStorage.setItem(workspaceStorageKeys.openAccountTabs, JSON.stringify(workspace.openAccountTabs));
}

export function clearWorkspaceState() {
  for (const key of Object.values(workspaceStorageKeys)) {
    localStorage.removeItem(key);
  }
}

export function getPreferredAccountTabId(accountIds: string[], connectedAccountIds: string[] = []) {
  return connectedAccountIds.find((accountId) => accountIds.includes(accountId)) ?? accountIds[0] ?? "";
}

export function getFallbackTabId(openAccountTabs: string[], isSettingsTabOpen: boolean, isLogsTabOpen: boolean) {
  return openAccountTabs[0] ?? (isSettingsTabOpen ? "settings" : isLogsTabOpen ? "logs" : "");
}

function parseStoredStringArray(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
