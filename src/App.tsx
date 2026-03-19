import { memo, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "conflicted";

type ChangedFile = {
  path: string;
  kind: ChangeKind;
};

type RepositoryStatus = {
  stagedChanges: ChangedFile[];
  unstagedChanges: ChangedFile[];
};

type RepositoryState = {
  name: string;
  path: string;
  gitDir: string;
  currentBranch: string | null;
  localBranches: string[];
  upstreamStatus: UpstreamStatus | null;
  headShortSha: string | null;
  isBare: boolean;
  status: RepositoryStatus;
  recentCommits: CommitSummary[];
};

type UpstreamStatus = {
  remoteName: string;
  branchName: string;
  ahead: number;
  behind: number;
};

type CommitSummary = {
  fullSha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  authoredAt: number;
  lane: number;
  parentLanes: number[];
  visibleLaneCount: number;
  isHead: boolean;
};

type CommitDetail = {
  fullSha: string;
  shortSha: string;
  summary: string;
  message: string;
  authorName: string;
  authorEmail: string | null;
  authoredAt: number;
  committerName: string;
  committerEmail: string | null;
  committedAt: number;
  parentShas: string[];
  fileChanges: CommitFileChange[];
  fileListNotice: string | null;
};

type CommitFileChange = {
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
};

type FeedbackTone = "error" | "warning" | "info" | "success";

type FeedbackState = {
  title: string;
  message: string;
  tone: FeedbackTone;
};

type WorkspaceTab = {
  id: number;
  title: string;
  repository: RepositoryState | null;
  feedback: FeedbackState | null;
  selectedHistoryEntryId: string | null;
  commitMessage: string;
  selectedCommitDetail: CommitDetail | null;
  commitDetailError: string | null;
  commitDetailCache: Record<string, CommitDetail>;
};

const WORKING_TREE_HISTORY_ENTRY_ID = "working-tree";

const CHANGE_LABELS: Record<ChangeKind, string> = {
  added: "Nuevo",
  modified: "Modificado",
  deleted: "Eliminado",
  renamed: "Renombrado",
  typechange: "Tipo cambiado",
  conflicted: "Conflicto",
};

const NAV_ITEMS = [
  { label: "Historial", glyph: "◉", count: "1" },
  { label: "Working tree", glyph: "⌘", count: "2" },
  { label: "Remoto", glyph: "⇅", count: "0" },
  { label: "Ramas", glyph: "⑂", count: "0" },
  { label: "Equipo", glyph: "◌", count: "" },
];

function createEmptyTab(id: number): WorkspaceTab {
  return {
    id,
    title: "Nuevo tab",
    repository: null,
    feedback: null,
    selectedHistoryEntryId: null,
    commitMessage: "",
    selectedCommitDetail: null,
    commitDetailError: null,
    commitDetailCache: {},
  };
}

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

function App() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([createEmptyTab(1)]);
  const [activeTabId, setActiveTabId] = useState(1);
  const [nextTabId, setNextTabId] = useState(2);
  const [isOpening, setIsOpening] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeStatusAction, setActiveStatusAction] = useState<string | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [activeRemoteOperation, setActiveRemoteOperation] = useState<
    "fetch" | "pull" | "push" | null
  >(null);
  const [isLoadingCommitDetail, setIsLoadingCommitDetail] = useState(false);
  const latestCommitDetailRequestRef = useRef(0);

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
  const commitDetailCache = activeTab?.commitDetailCache ?? {};

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
      title: nextRepository.name,
      repository: nextRepository,
      feedback: null,
    }));
  }

  function handleCreateTab() {
    const newId = nextTabId;
    setTabs((currentTabs) => [...currentTabs, createEmptyTab(newId)]);
    setActiveTabId(newId);
    setNextTabId((value) => value + 1);
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

  async function handleRefreshRepository() {
    if (!repository || !activeTab) {
      return;
    }

    setIsRefreshing(true);

    try {
      await loadRepository(activeTab.id, repository.path, "refresh_repository");
    } catch (error) {
      showErrorFeedback(
        activeTab.id,
        "No se pudo refrescar",
        error,
        "No fue posible refrescar el estado del repositorio.",
      );
    } finally {
      setIsRefreshing(false);
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

  async function handleRemoteOperation(operation: "fetch" | "pull" | "push") {
    if (!repository || !activeTab) {
      return;
    }

    const labels = {
      fetch: "fetch",
      pull: "pull",
      push: "push",
    };

    setActiveRemoteOperation(operation);

    try {
      const nextRepository = await invoke<RepositoryState>(`${operation}_remote`, {
        path: repository.path,
      });

      patchTab(activeTab.id, {
        repository: nextRepository,
        title: nextRepository.name,
        feedback: null,
      });
    } catch (error) {
      showErrorFeedback(
        activeTab.id,
        `No se pudo ejecutar ${labels[operation]}`,
        error,
        `No fue posible ejecutar ${labels[operation]} en el repositorio activo.`,
      );
    } finally {
      setActiveRemoteOperation(null);
    }
  }

  async function loadCommitDetail(tabId: number, path: string, commitSha: string) {
    const cachedDetail = commitDetailCache[commitSha];
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
  }, [activeTab?.id, repository, selectedCommitSha]);

  const hasLocalChanges = Boolean(
    repository &&
      (repository.status.stagedChanges.length > 0 ||
        repository.status.unstagedChanges.length > 0),
  );
  const hasStagedChanges = Boolean(repository && repository.status.stagedChanges.length > 0);
  const remoteOperationLabels = {
    fetch: "Fetch",
    pull: "Pull",
    push: "Push",
  };
  const totalChanges =
    (repository?.status.stagedChanges.length ?? 0) + (repository?.status.unstagedChanges.length ?? 0);
  const workingTreeSummary = repository ? summarizeWorkingTree(repository.status) : null;
  const isWorkingTreeSelected = selectedHistoryEntryId === WORKING_TREE_HISTORY_ENTRY_ID;

  return (
    <main className="desktop-shell">
      <header className="window-chrome">
        <div className="workspace-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`workspace-tab${tab.id === activeTabId ? " workspace-tab--active" : ""}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span className="workspace-tab__dot">⑂</span>
              {tab.repository ? tab.repository.name : "Sin repo"}
            </button>
          ))}
          <button
            type="button"
            className="workspace-tab workspace-tab--add"
            onClick={handleCreateTab}
            aria-label="Abrir una nueva pestaña"
          >
            +
          </button>
        </div>
      </header>

      <section className="command-bar">
        <div className="repo-breadcrumb">
          <div className="repo-breadcrumb__group">
            <span className="meta-caption">repository</span>
            <strong>{repository?.name ?? "sin cargar"}</strong>
          </div>
          <div className="repo-breadcrumb__group">
            <span className="meta-caption">branch</span>
            <strong>{repository?.currentBranch ?? "-"}</strong>
          </div>
        </div>

        <div className="toolbar-actions">
          <ToolbarButton
            label={isRefreshing ? "Refreshing" : "Refresh"}
            hint="Sync repository state"
            onClick={handleRefreshRepository}
            disabled={!repository || isRefreshing}
          />
          <ToolbarButton
            label={isOpening ? "Opening" : "Open"}
            hint="Select local repository"
            onClick={() => void handleOpenRepository()}
            disabled={isOpening}
            primary={!repository}
          />
          {(["fetch", "pull", "push"] as const).map((operation) => (
            <ToolbarButton
              key={operation}
              label={
                activeRemoteOperation === operation
                  ? `${remoteOperationLabels[operation]}…`
                  : remoteOperationLabels[operation]
              }
              hint={operation}
              onClick={() => void handleRemoteOperation(operation)}
              disabled={!repository || activeRemoteOperation !== null}
            />
          ))}
        </div>
      </section>

      <div className="workspace-frame">
        <aside className="activity-rail">
          <div className="activity-rail__stack">
            {NAV_ITEMS.map((item, index) => (
              <button
                key={item.label}
                type="button"
                className={`rail-button${index === 0 ? " rail-button--active" : ""}`}
              >
                <span className="rail-button__glyph">{item.glyph}</span>
                <span className="rail-button__label">{item.count}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="history-pane">
          <div className="history-toolbar">
            <div className="history-toolbar__meta history-toolbar__meta--full">
              <span className="table-heading">Branch / Tag</span>
              <span className="table-heading">Graph</span>
              <span className="table-heading table-heading--wide">Commit message</span>
            </div>
          </div>

          {appFeedback ? (
            <div className="pane-banner">
              <FeedbackNotice
                title={appFeedback.title}
                message={appFeedback.message}
                tone={appFeedback.tone}
              />
            </div>
          ) : null}

            {repository ? (
              <>
                <div className="repository-strip">
                  <div className="repository-strip__branch">
                    <span className="branch-pill">{repository.currentBranch ?? "detached"}</span>
                    <span className="repository-strip__path">{repository.path}</span>
                  </div>
                  <div className="repository-strip__head">
                    <span>HEAD {repository.headShortSha ?? "none"}</span>
                    <span>{repository.isBare ? "bare" : "working tree"}</span>
                  </div>
                </div>

                {repository.recentCommits.length > 0 ? (
                  <ul className="history-list">
                    {workingTreeSummary && workingTreeSummary.total > 0 ? (
                      <li>
                        <button
                          className={`history-row history-row--workspace${isWorkingTreeSelected ? " history-row--selected" : ""}`}
                          type="button"
                          onClick={handleSelectWorkingTree}
                        >
                          <div className="history-row__branch" />
                          <div className="commit-graph" aria-hidden="true" />
                          <div className="history-row__content history-row__content--workspace">
                            <div className="workspace-stats">
                              {workingTreeSummary.modified > 0 ? (
                                <span className="workspace-stat workspace-stat--modified">
                                  ✎ {workingTreeSummary.modified}
                                </span>
                              ) : null}
                              {workingTreeSummary.added > 0 ? (
                                <span className="workspace-stat workspace-stat--added">
                                  + {workingTreeSummary.added}
                                </span>
                              ) : null}
                              {workingTreeSummary.deleted > 0 ? (
                                <span className="workspace-stat workspace-stat--deleted">
                                  − {workingTreeSummary.deleted}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      </li>
                    ) : null}
                    {repository.recentCommits.map((commit) => (
                      <HistoryRow
                        key={commit.fullSha}
                        commit={commit}
                        isSelected={commit.fullSha === selectedCommitSha}
                        branchName={repository.currentBranch}
                        onSelect={handleSelectCommit}
                      />
                    ))}
                  </ul>
                ) : (
                  <EmptyWorkspace
                    title="Sin historial todavía"
                    copy="El repositorio está abierto, pero aún no hay commits visibles para poblar el grafo."
                  />
                )}
              </>
            ) : (
              <EmptyWorkspace
                title="Tab listo para un repositorio"
                copy="Crea tantos tabs como necesites con `+` y carga un repositorio Git distinto en cada uno."
                actionLabel={isOpening ? "Abriendo..." : "Abrir repositorio"}
                onAction={() => void handleOpenRepository()}
                isActionDisabled={isOpening}
              />
            )}
          </section>

          <aside className="inspector-pane">
            {!repository ? (
              <section className="inspector-card inspector-card--summary">
                <p className="inspector-copy">
                  Selecciona un repositorio en este tab y luego un commit para ver su detalle aquí.
                </p>
              </section>
            ) : isWorkingTreeSelected ? (
              <>
                <section className="inspector-card">
                  <div className="inspector-card__header">
                    <span className="meta-caption">new commit</span>
                    <span className="summary-chip">{hasStagedChanges ? "ready" : "no staged"}</span>
                  </div>

                  <form
                    className="stack-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleCreateCommit();
                    }}
                  >
                    <label htmlFor="commit-message">Mensaje</label>
                    <textarea
                      id="commit-message"
                      className="app-textarea"
                      value={commitMessage}
                      onChange={(event) =>
                        patchTab(activeTab.id, { commitMessage: event.target.value })
                      }
                      placeholder="feat: describe los cambios staged"
                      rows={4}
                    />
                    <button
                      className="action-button action-button--wide"
                      type="submit"
                      disabled={!hasStagedChanges || isCommitting || !commitMessage.trim()}
                    >
                      {isCommitting ? "Creando commit..." : "Crear commit"}
                    </button>
                  </form>
                </section>

                <section className="inspector-card inspector-card--files">
                  <div className="inspector-card__header">
                    <span className="meta-caption">changed files</span>
                    <span className="summary-chip">{hasLocalChanges ? "active" : "clean"}</span>
                  </div>

                  <div className="file-columns">
                    <StatusColumn
                      title="Staged"
                      emptyMessage="No hay archivos staged."
                      changes={repository.status.stagedChanges}
                      bulkActionLabel="Unstage all"
                      isBulkActionPending={activeStatusAction === "unstage-all"}
                      onBulkAction={() =>
                        void handleStatusAction(
                          "unstage_all_files",
                          "unstage-all",
                          "No fue posible sacar todos los archivos del área de stage.",
                        )
                      }
                      rowActionLabel="Unstage"
                      activeActionKey={activeStatusAction}
                      rowActionPrefix="unstage"
                      onRowAction={(filePath) =>
                        void handleStatusActionForPath(
                          "unstage_file",
                          "unstage",
                          filePath,
                          `No fue posible sacar "${filePath}" del área de stage.`,
                        )
                      }
                    />
                    <StatusColumn
                      title="Unstaged"
                      emptyMessage="No hay cambios unstaged."
                      changes={repository.status.unstagedChanges}
                      bulkActionLabel="Stage all"
                      isBulkActionPending={activeStatusAction === "stage-all"}
                      onBulkAction={() =>
                        void handleStatusAction(
                          "stage_all_files",
                          "stage-all",
                          "No fue posible hacer stage de todos los cambios visibles.",
                        )
                      }
                      rowActionLabel="Stage"
                      activeActionKey={activeStatusAction}
                      rowActionPrefix="stage"
                      onRowAction={(filePath) =>
                        void handleStatusActionForPath(
                          "stage_file",
                          "stage",
                          filePath,
                          `No fue posible hacer stage de "${filePath}".`,
                        )
                      }
                    />
                  </div>
                </section>
              </>
            ) : (
              <section className="inspector-card inspector-card--summary">
                <div className="inspector-card__header">
                  <span className="meta-caption">commit detail</span>
                  {selectedCommitSha ? (
                    <span className="summary-chip">{selectedCommitSha.slice(0, 6)}</span>
                  ) : (
                    <span className="summary-chip">{totalChanges} files</span>
                  )}
                </div>

                {isLoadingCommitDetail && !selectedCommitDetail ? (
                  <p className="muted-copy">Cargando detalle del commit seleccionado...</p>
                ) : commitDetailError ? (
                  <FeedbackNotice
                    title="Detalle no disponible"
                    message={commitDetailError}
                    tone="error"
                  />
                ) : selectedCommitDetail ? (
                  <CommitDetailPanel detail={selectedCommitDetail} />
                ) : (
                  <p className="inspector-copy">
                    Selecciona un commit de la historia para ver su detalle aquí.
                  </p>
                )}
              </section>
            )}
          </aside>
        </div>

      <footer className="status-footer">
        <div className="status-footer__left">
          <span className="status-led" />
          {repository
            ? `${repository.name} listo para trabajar`
            : "Tab vacío: abre un repositorio o crea otro con +"}
        </div>
        <div className="status-footer__right">
          <span>tabs: {tabs.length}</span>
          <span>{repository?.currentBranch ?? "-"}</span>
          <span>{repository?.headShortSha ?? "0000000"}</span>
        </div>
      </footer>
    </main>
  );
}

type ToolbarButtonProps = {
  label: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
};

function ToolbarButton({ label, hint, onClick, disabled, primary = false }: ToolbarButtonProps) {
  return (
    <button
      className={`toolbar-button${primary ? " toolbar-button--primary" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
    >
      {label}
    </button>
  );
}

type EmptyWorkspaceProps = {
  title: string;
  copy: string;
  actionLabel?: string;
  onAction?: () => void;
  isActionDisabled?: boolean;
};

function EmptyWorkspace({
  title,
  copy,
  actionLabel,
  onAction,
  isActionDisabled = false,
}: EmptyWorkspaceProps) {
  return (
    <div className="empty-workspace">
      <span className="empty-workspace__eyebrow">gitgud desktop</span>
      <h1>{title}</h1>
      <p>{copy}</p>
      {actionLabel && onAction ? (
        <button
          className="action-button action-button--hero"
          type="button"
          onClick={onAction}
          disabled={isActionDisabled}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

type StatusColumnProps = {
  title: string;
  emptyMessage: string;
  changes: ChangedFile[];
  bulkActionLabel: string;
  isBulkActionPending: boolean;
  onBulkAction: () => void;
  rowActionLabel: string;
  activeActionKey: string | null;
  rowActionPrefix: string;
  onRowAction: (filePath: string) => void;
};

function StatusColumn({
  title,
  emptyMessage,
  changes,
  bulkActionLabel,
  isBulkActionPending,
  onBulkAction,
  rowActionLabel,
  activeActionKey,
  rowActionPrefix,
  onRowAction,
}: StatusColumnProps) {
  return (
    <section className="file-column">
      <div className="file-column__header">
        <h3>{title}</h3>
        <button
          className="action-button action-button--subtle"
          type="button"
          onClick={onBulkAction}
          disabled={changes.length === 0 || isBulkActionPending || activeActionKey !== null}
        >
          {isBulkActionPending ? "..." : bulkActionLabel}
        </button>
      </div>

      {changes.length > 0 ? (
        <ul className="file-list">
          {changes.map((change) => (
            <li key={`${title}-${change.path}`} className="file-row">
              <div className="file-row__meta">
                <span className={`change-kind change-kind--${change.kind}`}>
                  {CHANGE_LABELS[change.kind]}
                </span>
                <p className="file-path">{change.path}</p>
              </div>
              <button
                className="file-row__action"
                type="button"
                onClick={() => onRowAction(change.path)}
                disabled={activeActionKey !== null}
              >
                {activeActionKey === `${rowActionPrefix}:${change.path}` ? "..." : rowActionLabel}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-copy">{emptyMessage}</p>
      )}
    </section>
  );
}

type FeedbackNoticeProps = FeedbackState;

function FeedbackNotice({ title, message, tone }: FeedbackNoticeProps) {
  return (
    <div
      className={`feedback-card feedback-card--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="feedback-label">{title}</span>
      <p>{message}</p>
    </div>
  );
}

type HistoryRowProps = {
  commit: CommitSummary;
  isSelected: boolean;
  branchName: string | null;
  onSelect: (commitSha: string) => void;
};

const HistoryRow = memo(function HistoryRow({
  commit,
  isSelected,
  branchName,
  onSelect,
}: HistoryRowProps) {
  return (
    <li>
      <button
        className={`history-row${commit.isHead ? " history-row--head" : ""}${isSelected ? " history-row--selected" : ""}`}
        type="button"
        onClick={() => onSelect(commit.fullSha)}
      >
        <div className="history-row__branch">
          {commit.isHead ? <span className="branch-pill">{branchName ?? "HEAD"}</span> : null}
        </div>
        <CommitGraph commit={commit} />
        <div className="history-row__content">
          <p className="history-summary">{commit.summary}</p>
          <div className="history-row__meta">
            <span>{commit.authorName}</span>
            <span>{formatDateTime(commit.authoredAt)}</span>
            <span>{commit.shortSha}</span>
          </div>
        </div>
      </button>
    </li>
  );
});

type CommitDetailPanelProps = {
  detail: CommitDetail;
};

function CommitDetailPanel({ detail }: CommitDetailPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopySha() {
    try {
      await navigator.clipboard.writeText(detail.fullSha);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 1500);
    }
  }

  return (
    <div className="commit-detail">
      <div className="commit-detail__meta">
        <div className="commit-detail__byline">
          <span>{detail.authorName}</span>
          <span>{formatCompactDateTime(detail.authoredAt)}</span>
        </div>
        <button
          className={`commit-detail__sha${copyState === "copied" ? " commit-detail__sha--copied" : ""}`}
          type="button"
          onClick={() => void handleCopySha()}
          title={copyState === "copied" ? "SHA copiado" : "Copiar SHA completo"}
        >
          {detail.fullSha.slice(0, 6)}
        </button>
      </div>

      <div className="commit-detail__message">
        <p>{detail.message}</p>
      </div>

      <div className="detail-files">
        <div className="detail-files__header">
          <h3>Archivos modificados</h3>
          <span>{detail.fileChanges.length}</span>
        </div>

        {detail.fileChanges.length > 0 ? (
          <ul className="file-list">
            {detail.fileChanges.map((change) => (
              <li key={`${detail.fullSha}-${change.path}`} className="file-row">
                <div className="file-row__meta">
                  <span className={`change-kind change-kind--${change.kind}`}>
                    {CHANGE_LABELS[change.kind]}
                  </span>
                  <p className="file-path">
                    {change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : detail.fileListNotice ? (
          <FeedbackNotice
            title="Archivos no visibles"
            message={detail.fileListNotice}
            tone="warning"
          />
        ) : (
          <p className="muted-copy">No se reportaron archivos para este commit.</p>
        )}
      </div>
    </div>
  );
}

type CommitGraphProps = {
  commit: CommitSummary;
};

const CommitGraph = memo(function CommitGraph({ commit }: CommitGraphProps) {
  const laneWidth = 24;
  const graphHeight = 52;
  const topY = 6;
  const nodeY = 18;
  const bottomY = 46;
  const width = Math.max(commit.visibleLaneCount, 1) * laneWidth;
  const lanes = Array.from({ length: Math.max(commit.visibleLaneCount, 1) }, (_, lane) => lane);
  const nodeX = commit.lane * laneWidth + laneWidth / 2;

  return (
    <div className="commit-graph" aria-hidden="true">
      <svg width={width} height={graphHeight} viewBox={`0 0 ${width} ${graphHeight}`}>
        {lanes.map((lane) => {
          const x = lane * laneWidth + laneWidth / 2;

          return (
            <line
              key={`lane-${commit.shortSha}-${lane}`}
              x1={x}
              y1={topY}
              x2={x}
              y2={bottomY}
              className="commit-graph__lane"
            />
          );
        })}

        {commit.parentLanes.map((lane, index) => {
          const parentX = lane * laneWidth + laneWidth / 2;
          const path =
            lane === commit.lane
              ? `M ${nodeX} ${nodeY} L ${parentX} ${bottomY}`
              : `M ${nodeX} ${nodeY} C ${nodeX} ${nodeY + 16}, ${parentX} ${bottomY - 16}, ${parentX} ${bottomY}`;

          return (
            <path
              key={`edge-${commit.shortSha}-${lane}-${index}`}
              d={path}
              className="commit-graph__edge"
            />
          );
        })}

        {commit.isHead ? (
          <circle cx={nodeX} cy={nodeY} r={8.5} className="commit-graph__head-halo" />
        ) : null}
        <circle cx={nodeX} cy={nodeY} r={5.5} className="commit-graph__node" />
      </svg>
    </div>
  );
});

function formatDateTime(timestamp: number) {
  return DATE_TIME_FORMATTER.format(new Date(timestamp * 1000));
}

function formatCompactDateTime(timestamp: number) {
  return COMPACT_DATE_TIME_FORMATTER.format(new Date(timestamp * 1000));
}

function summarizeWorkingTree(status: RepositoryStatus) {
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

export default App;
