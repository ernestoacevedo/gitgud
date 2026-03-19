import type {
  ChangeKind,
  PersistedSession,
  PersistedTab,
  RepositoryStatus,
  WorkspaceTab,
} from "./types";

export const WORKING_TREE_HISTORY_ENTRY_ID = "working-tree";
export const PERSISTED_SESSION_KEY = "gitgud.open-repositories";
export const AUTO_REFRESH_INTERVAL_MS = 15_000;

export const CHANGE_LABELS: Record<ChangeKind, string> = {
  added: "Nuevo",
  modified: "Modificado",
  deleted: "Eliminado",
  renamed: "Renombrado",
  typechange: "Tipo cambiado",
  conflicted: "Conflicto",
};

export const NAV_ITEMS = [
  { label: "Historial", glyph: "◉", count: "1" },
  { label: "Working tree", glyph: "⌘", count: "2" },
  { label: "Remoto", glyph: "⇅", count: "0" },
  { label: "Ramas", glyph: "⑂", count: "0" },
  { label: "Equipo", glyph: "◌", count: "" },
];

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-CL", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const COMPACT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function createEmptyTab(id: number): WorkspaceTab {
  return {
    id,
    title: "Nuevo tab",
    customTitle: null,
    isPinned: false,
    repository: null,
    feedback: null,
    selectedHistoryEntryId: null,
    commitMessage: "",
    selectedCommitDetail: null,
    commitDetailError: null,
    commitDetailCache: {},
  };
}

export function parsePersistedSession(rawValue: string | null): PersistedSession | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<PersistedSession>;
    const tabs = Array.isArray(parsedValue.tabs)
      ? parsedValue.tabs.flatMap((value) => {
          if (!value || typeof value !== "object") {
            return [];
          }

          const candidate = value as Partial<PersistedTab>;
          const repositoryPath =
            typeof candidate.repositoryPath === "string" ? candidate.repositoryPath : null;

          return [
            {
              repositoryPath,
              isPinned: candidate.isPinned === true,
              customTitle: typeof candidate.customTitle === "string" ? candidate.customTitle : null,
            },
          ];
        })
      : Array.isArray((parsedValue as { repositories?: unknown }).repositories)
        ? (parsedValue as { repositories: unknown[] }).repositories.flatMap((value) =>
            typeof value === "string"
              ? [{ repositoryPath: value, isPinned: false, customTitle: null }]
              : [],
          )
        : [];
    const activeTabIndex =
      typeof parsedValue.activeTabIndex === "number" && Number.isInteger(parsedValue.activeTabIndex)
        ? parsedValue.activeTabIndex
        : typeof (parsedValue as { activeRepositoryIndex?: unknown }).activeRepositoryIndex ===
              "number" &&
            Number.isInteger((parsedValue as { activeRepositoryIndex: number }).activeRepositoryIndex)
          ? (parsedValue as { activeRepositoryIndex: number }).activeRepositoryIndex
          : 0;

    return {
      tabs,
      activeTabIndex,
    };
  } catch {
    return null;
  }
}

export function sortTabsForDisplay<T extends { isPinned: boolean }>(tabs: T[]) {
  const pinnedTabs = tabs.filter((tab) => tab.isPinned);
  const unpinnedTabs = tabs.filter((tab) => !tab.isPinned);
  return [...pinnedTabs, ...unpinnedTabs];
}

export function reorderTabs(tabs: WorkspaceTab[], draggedTabId: number, targetTabId: number) {
  if (draggedTabId === targetTabId) {
    return tabs;
  }

  const draggedIndex = tabs.findIndex((tab) => tab.id === draggedTabId);
  const targetIndex = tabs.findIndex((tab) => tab.id === targetTabId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [draggedTab] = nextTabs.splice(draggedIndex, 1);
  nextTabs.splice(targetIndex, 0, draggedTab);

  return sortTabsForDisplay(nextTabs);
}

export function getTabLabel(tab: WorkspaceTab) {
  return tab.customTitle?.trim() || tab.repository?.name || tab.title;
}

export function formatDateTime(timestamp: number) {
  return DATE_TIME_FORMATTER.format(new Date(timestamp * 1000));
}

export function formatCompactDateTime(timestamp: number) {
  return COMPACT_DATE_TIME_FORMATTER.format(new Date(timestamp * 1000));
}

export function summarizeWorkingTree(status: RepositoryStatus) {
  const summary = {
    added: 0,
    modified: 0,
    deleted: 0,
    total: 0,
  };

  for (const change of [...status.stagedChanges, ...status.unstagedChanges]) {
    if (change.kind === "added") {
      summary.added += 1;
    } else if (change.kind === "deleted") {
      summary.deleted += 1;
    } else {
      summary.modified += 1;
    }

    summary.total += 1;
  }

  return summary;
}
