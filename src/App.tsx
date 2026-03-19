import { startTransition, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import {
  AUTO_REFRESH_INTERVAL_MS,
  PERSISTED_SESSION_KEY,
  WORKING_TREE_HISTORY_ENTRY_ID,
  createEmptyTab,
  parsePersistedSession,
  reorderTabs,
  sortTabsForDisplay,
  summarizeWorkingTree,
} from "./app/utils";
import type {
  CommitDetail,
  FeedbackState,
  RepositoryState,
  WorkspaceTab,
  TabContextMenuState,
} from "./app/types";
import { InspectorPanel } from "./components/InspectorPanel";
import { RepositoryToolbar } from "./components/RepositoryToolbar";
import { TabBar } from "./components/TabBar";
import { TimelinePanel } from "./components/TimelinePanel";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";

type RemoteOperation = "fetch" | "pull" | "push";
type RemoteOperationStatus = "idle" | "loading" | "success" | "error";

function App() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([createEmptyTab(1)]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [nextTabId, setNextTabId] = useState(2);
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const [activeStatusAction, setActiveStatusAction] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [activeRemoteOperation, setActiveRemoteOperation] = useState<RemoteOperation | null>(null);
  const [remoteOperationStatuses, setRemoteOperationStatuses] = useState<
    Record<RemoteOperation, RemoteOperationStatus>
  >({
    fetch: "idle",
    pull: "idle",
    push: "idle",
  });
  const [isLoadingCommitDetail, setIsLoadingCommitDetail] = useState(false);
  const latestCommitDetailRequestRef = useRef(0);
  const hasRestoredSessionRef = useRef(false);
  const refreshInFlightRef = useRef<Set<number>>(new Set());
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const remoteFeedbackTimeoutRef = useRef<number | null>(null);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const repository = activeTab?.repository ?? null;
  const appFeedback = activeTab?.feedback ?? null;
  const selectedHistoryEntryId = activeTab?.selectedHistoryEntryId ?? null;
  const commitMessage = activeTab?.commitMessage ?? "";
  const selectedCommitSha =
    selectedHistoryEntryId && selectedHistoryEntryId !== WORKING_TREE_HISTORY_ENTRY_ID
      ? selectedHistoryEntryId
      : null;
  const selectedCommitDetail = activeTab?.selectedCommitDetail ?? null;
  const commitDetailError = activeTab?.commitDetailError ?? null;

  function updateTab(tabId: number, updater: (tab: WorkspaceTab) => WorkspaceTab) {
    setTabs((currentTabs) => currentTabs.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }

  function patchTab(tabId: number, patch: Partial<WorkspaceTab>) {
    updateTab(tabId, (tab) => ({ ...tab, ...patch }));
  }

  function showErrorFeedback(
    tabId: number,
    title: string,
    error: unknown,
    fallbackMessage: string,
    preserveRepository = true,
  ) {
    updateTab(tabId, (tab) => ({
      ...tab,
      repository: preserveRepository ? tab.repository : null,
      title: preserveRepository ? tab.title : "Nuevo tab",
      feedback: {
        title,
        message: error instanceof Error ? error.message : fallbackMessage,
        tone: "error",
      },
    }));
  }

  async function loadRepository(
    tabId: number,
    path: string,
    command: "open_repository" | "refresh_repository",
  ) {
    const nextRepository = await invoke<RepositoryState>(command, { path });
    updateTab(tabId, (tab) => ({
      ...tab,
      title: tab.customTitle ?? nextRepository.name,
      repository: nextRepository,
      feedback: null,
    }));
  }

  const refreshTabRepository = useCallback(
    async (tabId: number, options?: { silent?: boolean }) => {
      const targetTab = tabs.find((tab) => tab.id === tabId);
      const targetRepository = targetTab?.repository;

      if (!targetTab || !targetRepository || refreshInFlightRef.current.has(tabId)) {
        return;
      }

      refreshInFlightRef.current.add(tabId);

      try {
        await loadRepository(tabId, targetRepository.path, "refresh_repository");
      } catch (error) {
        if (!options?.silent) {
          showErrorFeedback(
            tabId,
            "No se pudo refrescar",
            error,
            "No fue posible refrescar el estado del repositorio.",
          );
        }
      } finally {
        refreshInFlightRef.current.delete(tabId);
      }
    },
    [tabs],
  );

  function handleCreateTab() {
    const newId = nextTabId;
    setTabs((currentTabs) => [...currentTabs, createEmptyTab(newId)]);
    setActiveTabId(newId);
    setNextTabId((value) => value + 1);
  }

  function handleTogglePinned(tabId: number) {
    setTabs((currentTabs) => {
      const nextTabs = currentTabs.map((tab) =>
        tab.id === tabId ? { ...tab, isPinned: !tab.isPinned } : tab,
      );
      return sortTabsForDisplay(nextTabs);
    });
  }

  function handleDragStart(tabId: number) {
    if (renamingTabId !== null) {
      return;
    }

    setDraggedTabId(tabId);
    setTabContextMenu(null);
  }

  function handleDragEnd() {
    setDraggedTabId(null);
  }

  function handleDropOnTab(targetTabId: number) {
    if (draggedTabId === null || draggedTabId === targetTabId) {
      setDraggedTabId(null);
      return;
    }

    setTabs((currentTabs) => reorderTabs(currentTabs, draggedTabId, targetTabId));
    setDraggedTabId(null);
  }

  function handleCloseTab(tabId: number) {
    setTabs((currentTabs) => {
      const targetTab = currentTabs.find((tab) => tab.id === tabId);

      if (!targetTab || targetTab.isPinned || currentTabs.length === 1) {
        return currentTabs;
      }

      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);

      if (activeTabId === tabId) {
        const closedTabIndex = currentTabs.findIndex((tab) => tab.id === tabId);
        const fallbackTab =
          nextTabs[closedTabIndex] ?? nextTabs[Math.max(closedTabIndex - 1, 0)] ?? nextTabs[0];

        if (fallbackTab) {
          setActiveTabId(fallbackTab.id);
        }
      }

      return nextTabs;
    });
    setTabContextMenu(null);
  }

  function handleStartRenaming(tabId: number) {
    const targetTab = tabs.find((tab) => tab.id === tabId);

    if (!targetTab) {
      return;
    }

    setRenameDraft((targetTab.customTitle?.trim() || targetTab.repository?.name || targetTab.title) ?? "");
    setRenamingTabId(tabId);
    setTabContextMenu(null);
  }

  function handleCommitRename() {
    if (renamingTabId === null) {
      return;
    }

    const normalizedTitle = renameDraft.trim();
    updateTab(renamingTabId, (tab) => ({
      ...tab,
      customTitle: normalizedTitle.length > 0 ? normalizedTitle : null,
      title: normalizedTitle.length > 0 ? normalizedTitle : tab.repository?.name ?? "Nuevo tab",
    }));
    setRenamingTabId(null);
    setRenameDraft("");
  }

  function handleCancelRename() {
    setRenamingTabId(null);
    setRenameDraft("");
  }

  function handleTabContextMenu(event: MouseEvent<HTMLButtonElement>, tabId: number) {
    event.preventDefault();
    setRenamingTabId(null);
    setRenameDraft("");
    setActiveTabId(tabId);
    setTabContextMenu({
      tabId,
      x: event.clientX,
      y: event.clientY,
    });
  }

  async function handleOpenRepository(tabId = activeTabId) {
    setIsOpening(true);
    patchTab(tabId, { feedback: null });

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Selecciona un repositorio Git local",
      });

      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }

      await loadRepository(tabId, selectedPath, "open_repository");
    } catch (error) {
      showErrorFeedback(
        tabId,
        "Repositorio no disponible",
        error,
        "No fue posible abrir el repositorio seleccionado.",
        false,
      );
    } finally {
      setIsOpening(false);
    }
  }

  async function handleStatusAction(command: string, actionKey: string, fallbackMessage: string) {
    if (!repository || !activeTab) {
      return;
    }

    setActiveStatusAction(actionKey);

    try {
      const nextRepository = await invoke<RepositoryState>(command, {
        path: repository.path,
      });

      patchTab(activeTab.id, {
        repository: nextRepository,
        title: nextRepository.name,
        feedback: null,
      });
    } catch (error) {
      showErrorFeedback(activeTab.id, "No se pudo actualizar el stage", error, fallbackMessage);
    } finally {
      setActiveStatusAction(null);
    }
  }

  async function handleStatusActionForPath(
    command: string,
    actionPrefix: string,
    filePath: string,
    fallbackMessage: string,
  ) {
    if (!repository || !activeTab) {
      return;
    }

    const actionKey = `${actionPrefix}:${filePath}`;
    setActiveStatusAction(actionKey);

    try {
      const nextRepository = await invoke<RepositoryState>(command, {
        path: repository.path,
        filePath,
      });

      patchTab(activeTab.id, {
        repository: nextRepository,
        title: nextRepository.name,
        feedback: null,
      });
    } catch (error) {
      showErrorFeedback(activeTab.id, "No se pudo actualizar el stage", error, fallbackMessage);
    } finally {
      setActiveStatusAction(null);
    }
  }

  async function handleCreateCommit() {
    if (!repository || !activeTab) {
      return;
    }

    setIsCommitting(true);

    try {
      const nextRepository = await invoke<RepositoryState>("create_commit", {
        path: repository.path,
        message: commitMessage,
      });

      patchTab(activeTab.id, {
        repository: nextRepository,
        title: nextRepository.name,
        commitMessage: "",
        feedback: null,
      });
    } catch (error) {
      showErrorFeedback(
        activeTab.id,
        "Commit rechazado",
        error,
        "No fue posible crear el commit en el repositorio activo.",
      );
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleRemoteOperation(operation: RemoteOperation) {
    if (!repository || !activeTab) {
      return;
    }

    if (remoteFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(remoteFeedbackTimeoutRef.current);
      remoteFeedbackTimeoutRef.current = null;
    }

    setActiveRemoteOperation(operation);
    setRemoteOperationStatuses({
      fetch: "idle",
      pull: "idle",
      push: "idle",
    });
    setRemoteOperationStatuses((current) => ({
      ...current,
      [operation]: "loading",
    }));

    try {
      const nextRepository = await invoke<RepositoryState>(`${operation}_remote`, {
        path: repository.path,
      });

      patchTab(activeTab.id, {
        repository: nextRepository,
        title: nextRepository.name,
        feedback: null,
      });
      setRemoteOperationStatuses((current) => ({
        ...current,
        [operation]: "success",
      }));
    } catch (error) {
      showErrorFeedback(
        activeTab.id,
        `No se pudo ejecutar ${operation}`,
        error,
        `No fue posible ejecutar ${operation} en el repositorio activo.`,
      );
      setRemoteOperationStatuses((current) => ({
        ...current,
        [operation]: "error",
      }));
    } finally {
      setActiveRemoteOperation(null);

      remoteFeedbackTimeoutRef.current = window.setTimeout(() => {
        setRemoteOperationStatuses({
          fetch: "idle",
          pull: "idle",
          push: "idle",
        });
        remoteFeedbackTimeoutRef.current = null;
      }, 2200);
    }
  }

  async function loadCommitDetail(tabId: number, path: string, commitSha: string) {
    const targetTab = tabs.find((tab) => tab.id === tabId);
    const cachedDetail = targetTab?.commitDetailCache[commitSha];

    if (cachedDetail) {
      patchTab(tabId, {
        selectedCommitDetail: cachedDetail,
        commitDetailError: null,
      });
      setIsLoadingCommitDetail(false);
      return;
    }

    const requestId = latestCommitDetailRequestRef.current + 1;
    latestCommitDetailRequestRef.current = requestId;
    setIsLoadingCommitDetail(true);

    try {
      const detail = await invoke<CommitDetail>("read_commit_detail", {
        path,
        commitSha,
      });

      if (latestCommitDetailRequestRef.current !== requestId) {
        return;
      }

      updateTab(tabId, (tab) => ({
        ...tab,
        selectedCommitDetail: detail,
        commitDetailError: null,
        commitDetailCache: {
          ...tab.commitDetailCache,
          [commitSha]: detail,
        },
      }));
    } catch (error) {
      if (latestCommitDetailRequestRef.current !== requestId) {
        return;
      }

      patchTab(tabId, {
        selectedCommitDetail: null,
        commitDetailError:
          error instanceof Error
            ? error.message
            : "No fue posible cargar el detalle del commit seleccionado.",
      });
    } finally {
      if (latestCommitDetailRequestRef.current === requestId) {
        setIsLoadingCommitDetail(false);
      }
    }
  }

  const handleSelectCommit = useCallback(
    (commitSha: string) => {
      if (!activeTab?.id) {
        return;
      }

      startTransition(() => {
        setTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.id === activeTab.id
              ? {
                  ...tab,
                  selectedHistoryEntryId: commitSha,
                  commitDetailError: null,
                }
              : tab,
          ),
        );
      });
    },
    [activeTab?.id],
  );

  const handleSelectWorkingTree = useCallback(() => {
    if (!activeTab?.id) {
      return;
    }

    patchTab(activeTab.id, {
      selectedHistoryEntryId: WORKING_TREE_HISTORY_ENTRY_ID,
      selectedCommitDetail: null,
      commitDetailError: null,
    });
  }, [activeTab?.id]);

  useEffect(() => {
    if (renamingTabId === null) {
      return;
    }

    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingTabId]);

  useEffect(() => {
    let isCancelled = false;

    async function restorePersistedRepositories() {
      const persistedSession = parsePersistedSession(localStorage.getItem(PERSISTED_SESSION_KEY));

      if (!persistedSession || persistedSession.tabs.length === 0) {
        hasRestoredSessionRef.current = true;
        return;
      }

      const restoredRepositories = await Promise.allSettled(
        persistedSession.tabs.map((tab) =>
          tab.repositoryPath
            ? invoke<RepositoryState>("open_repository", { path: tab.repositoryPath })
            : Promise.resolve(null),
        ),
      );

      if (isCancelled) {
        return;
      }

      const restoredTabs = restoredRepositories.flatMap((result, index) => {
        const persistedTab = persistedSession.tabs[index];

        if (!persistedTab) {
          return [];
        }

        if (persistedTab.repositoryPath === null) {
          return [
            {
              ...createEmptyTab(index + 1),
              isPinned: persistedTab.isPinned,
              customTitle: persistedTab.customTitle,
              title: persistedTab.customTitle ?? "Nuevo tab",
            },
          ];
        }

        if (result.status !== "fulfilled" || result.value === null) {
          return [];
        }

        return [
          {
            ...createEmptyTab(index + 1),
            isPinned: persistedTab.isPinned,
            customTitle: persistedTab.customTitle,
            title: persistedTab.customTitle ?? result.value.name,
            repository: result.value,
          },
        ];
      });

      const failedRepositoryCount =
        persistedSession.tabs.filter((tab) => tab.repositoryPath !== null).length -
        restoredTabs.filter((tab) => tab.repository !== null).length;

      if (restoredTabs.length === 0) {
        const fallbackTab = createEmptyTab(1);

        if (failedRepositoryCount > 0) {
          fallbackTab.feedback = {
            title: "Repositorios no restaurados",
            message:
              failedRepositoryCount === 1
                ? "No fue posible reabrir el repositorio guardado de la sesion anterior."
                : `No fue posible reabrir ${failedRepositoryCount} repositorios guardados de la sesion anterior.`,
            tone: "warning",
          };
        }

        setTabs([fallbackTab]);
        setActiveTabId(1);
        setNextTabId(2);
        hasRestoredSessionRef.current = true;
        return;
      }

      const boundedActiveRepositoryIndex = Math.min(
        Math.max(persistedSession.activeTabIndex, 0),
        restoredTabs.length - 1,
      );
      const activeRepositoryId = restoredTabs[boundedActiveRepositoryIndex]?.id ?? restoredTabs[0].id;
      const nextTabs = [...restoredTabs];

      if (failedRepositoryCount > 0) {
        nextTabs[0] = {
          ...nextTabs[0],
          feedback: {
            title: "Restauracion parcial",
            message:
              failedRepositoryCount === 1
                ? "Un repositorio guardado no pudo reabrirse automaticamente."
                : `${failedRepositoryCount} repositorios guardados no pudieron reabrirse automaticamente.`,
            tone: "warning",
          } satisfies FeedbackState,
        };
      }

      setTabs(sortTabsForDisplay(nextTabs));
      setActiveTabId(activeRepositoryId);
      setNextTabId(nextTabs.length + 1);
      hasRestoredSessionRef.current = true;
    }

    void restorePersistedRepositories();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (remoteFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(remoteFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setRemoteOperationStatuses({
      fetch: "idle",
      pull: "idle",
      push: "idle",
    });

    if (remoteFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(remoteFeedbackTimeoutRef.current);
      remoteFeedbackTimeoutRef.current = null;
    }
  }, [activeTabId, repository?.path]);

  useEffect(() => {
    if (!hasRestoredSessionRef.current) {
      return;
    }

    const activeTabIndex = Math.max(
      tabs.findIndex((tab) => tab.id === activeTabId),
      0,
    );

    const persistedSession = {
      tabs: tabs.map((tab) => ({
        repositoryPath: tab.repository?.path ?? null,
        isPinned: tab.isPinned,
        customTitle: tab.customTitle,
      })),
      activeTabIndex,
    };

    localStorage.setItem(PERSISTED_SESSION_KEY, JSON.stringify(persistedSession));
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (!hasRestoredSessionRef.current || !activeTab?.repository) {
      return;
    }

    void refreshTabRepository(activeTab.id, { silent: true });
  }, [activeTab?.id, activeTab?.repository?.path, refreshTabRepository]);

  useEffect(() => {
    if (!tabContextMenu) {
      return;
    }

    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setTabContextMenu(null);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (tabContextMenuRef.current?.contains(target)) {
        return;
      }

      setTabContextMenu(null);
    }

    function handleWindowBlur() {
      setTabContextMenu(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("keydown", handleEscapeKey);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("keydown", handleEscapeKey);
    };
  }, [tabContextMenu]);

  useEffect(() => {
    if (!hasRestoredSessionRef.current) {
      return;
    }

    const intervalId = window.setInterval(() => {
      tabs.forEach((tab) => {
        if (!tab.repository) {
          return;
        }

        void refreshTabRepository(tab.id, { silent: true });
      });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshTabRepository, tabs]);

  useEffect(() => {
    if (!hasRestoredSessionRef.current) {
      return;
    }

    function handleWindowFocus() {
      if (!activeTab?.repository) {
        return;
      }

      void refreshTabRepository(activeTab.id, { silent: true });
    }

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [activeTab?.id, activeTab?.repository?.path, refreshTabRepository]);

  useEffect(() => {
    if (!activeTab) {
      return;
    }

    if (!repository) {
      patchTab(activeTab.id, {
        selectedHistoryEntryId: null,
        selectedCommitDetail: null,
        commitDetailError: null,
      });
      return;
    }

    const hasWorkingTreeEntry =
      repository.status.stagedChanges.length + repository.status.unstagedChanges.length > 0;
    const hasSelectedCommit =
      selectedHistoryEntryId !== null &&
      selectedHistoryEntryId !== WORKING_TREE_HISTORY_ENTRY_ID &&
      repository.recentCommits.some((commit) => commit.fullSha === selectedHistoryEntryId);

    let nextSelectedHistoryEntryId: string | null = selectedHistoryEntryId;

    if (selectedHistoryEntryId === WORKING_TREE_HISTORY_ENTRY_ID && hasWorkingTreeEntry) {
      nextSelectedHistoryEntryId = WORKING_TREE_HISTORY_ENTRY_ID;
    } else if (hasSelectedCommit) {
      nextSelectedHistoryEntryId = selectedHistoryEntryId;
    } else if (repository.recentCommits.length > 0) {
      nextSelectedHistoryEntryId = repository.recentCommits[0].fullSha;
    } else if (hasWorkingTreeEntry) {
      nextSelectedHistoryEntryId = WORKING_TREE_HISTORY_ENTRY_ID;
    } else {
      nextSelectedHistoryEntryId = null;
    }

    if (nextSelectedHistoryEntryId !== selectedHistoryEntryId) {
      patchTab(activeTab.id, {
        selectedHistoryEntryId: nextSelectedHistoryEntryId,
        selectedCommitDetail:
          nextSelectedHistoryEntryId === null ||
          nextSelectedHistoryEntryId === WORKING_TREE_HISTORY_ENTRY_ID
            ? null
            : activeTab.selectedCommitDetail,
        commitDetailError: null,
      });
    }
  }, [activeTab, repository, selectedHistoryEntryId]);

  useEffect(() => {
    if (!activeTab || !repository || !selectedCommitSha) {
      return;
    }

    void loadCommitDetail(activeTab.id, repository.path, selectedCommitSha);
  }, [activeTab?.id, repository, selectedCommitSha, tabs]);

  const hasStagedChanges = Boolean(repository && repository.status.stagedChanges.length > 0);
  const workingTreeSummary = repository ? summarizeWorkingTree(repository.status) : null;
  const isWorkingTreeSelected = selectedHistoryEntryId === WORKING_TREE_HISTORY_ENTRY_ID;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-surface font-body text-on-surface">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        draggedTabId={draggedTabId}
        renamingTabId={renamingTabId}
        renameDraft={renameDraft}
        renameInputRef={renameInputRef}
        tabContextMenu={tabContextMenu}
        tabContextMenuRef={tabContextMenuRef}
        onSelectTab={setActiveTabId}
        onCreateTab={handleCreateTab}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDropOnTab={handleDropOnTab}
        onTabContextMenu={handleTabContextMenu}
        onRenameDraftChange={setRenameDraft}
        onCommitRename={handleCommitRename}
        onCancelRename={handleCancelRename}
        onStartRenaming={handleStartRenaming}
        onTogglePinned={handleTogglePinned}
        onCloseTab={handleCloseTab}
        onCloseContextMenu={() => setTabContextMenu(null)}
        onOpenRepository={() => void handleOpenRepository()}
      />

      <RepositoryToolbar
        repository={repository}
        activeRemoteOperation={activeRemoteOperation}
        remoteOperationStatuses={remoteOperationStatuses}
        onRemoteOperation={(operation) => void handleRemoteOperation(operation)}
      />

      <div className="flex flex-1 overflow-hidden">
        <WorkspaceSidebar repository={repository} />

        <main className="flex flex-1 overflow-hidden bg-surface-container-low">
          <TimelinePanel
            repository={repository}
            appFeedback={appFeedback}
            workingTreeSummary={workingTreeSummary}
            isWorkingTreeSelected={isWorkingTreeSelected}
            selectedCommitSha={selectedCommitSha}
            isOpening={isOpening}
            currentBranch={repository?.currentBranch ?? null}
            recentCommits={repository?.recentCommits ?? []}
            onSelectWorkingTree={handleSelectWorkingTree}
            onSelectCommit={handleSelectCommit}
            onOpenRepository={() => void handleOpenRepository()}
          />

          <InspectorPanel
            repository={repository}
            activeTab={activeTab}
            isWorkingTreeSelected={isWorkingTreeSelected}
            hasStagedChanges={hasStagedChanges}
            commitMessage={commitMessage}
            isCommitting={isCommitting}
            activeStatusAction={activeStatusAction}
            isLoadingCommitDetail={isLoadingCommitDetail}
            selectedCommitDetail={selectedCommitDetail}
            commitDetailError={commitDetailError}
            onCommitMessageChange={(value) => {
              if (!activeTab) {
                return;
              }

              patchTab(activeTab.id, { commitMessage: value });
            }}
            onCreateCommit={() => void handleCreateCommit()}
            onBulkStatusAction={(command, actionKey, fallbackMessage) =>
              void handleStatusAction(command, actionKey, fallbackMessage)
            }
            onFileStatusAction={(command, actionPrefix, filePath, fallbackMessage) =>
              void handleStatusActionForPath(command, actionPrefix, filePath, fallbackMessage)
            }
          />
        </main>
      </div>
    </div>
  );
}

export default App;
