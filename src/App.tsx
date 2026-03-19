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

  const hasStagedChanges = Boolean(repository && repository.status.stagedChanges.length > 0);
  const workingTreeSummary = repository ? summarizeWorkingTree(repository.status) : null;
  const isWorkingTreeSelected = selectedHistoryEntryId === WORKING_TREE_HISTORY_ENTRY_ID;

    return (
    <div className="bg-surface text-on-surface font-body overflow-hidden h-screen flex flex-col">
      <header className="bg-[#060e20] text-[#00D1FF] font-headline tracking-tight flex justify-between items-center px-4 h-12 shrink-0 z-50 border-b border-outline-variant/10">
        <div className="flex items-center gap-6 h-full">
          <nav className="flex h-full items-end gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`h-8 px-4 flex items-center gap-2 text-sm transition-colors duration-150 ${tab.id === activeTabId ? "text-[#00D1FF] border-b-2 border-[#00D1FF] pb-1 hover:bg-[#192540]" : "text-[#dee5ff]/60 hover:bg-[#192540]"}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span className="material-symbols-outlined text-sm">terminal</span>
                {tab.repository ? tab.repository.name : "Sin repo"}
              </button>
            ))}
            <button
              type="button"
              className="text-[#dee5ff]/40 h-8 px-2 flex items-center hover:text-primary"
              onClick={handleCreateTab}
              aria-label="New tab"
            >
              <span className="material-symbols-outlined text-lg">add</span>
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <button className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#192540] transition-colors" onClick={() => void handleOpenRepository()}>
            <span className="material-symbols-outlined text-sm">folder_open</span>
          </button>
        </div>
      </header>

      <section className="bg-surface-container h-10 border-b border-outline-variant/10 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          {repository ? (
            <div className="flex items-center bg-surface-container-low rounded p-0.5">
              <button 
                onClick={() => void handleRemoteOperation("fetch")} 
                disabled={activeRemoteOperation !== null} 
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-label font-bold text-on-surface hover:bg-surface-container-highest transition-all ${activeRemoteOperation === 'fetch' ? 'opacity-50' : ''}`}
              >
                <span className="material-symbols-outlined text-secondary text-sm">download</span>FETCH
              </button>
              <div className="w-px h-4 bg-outline-variant/20 mx-1"></div>
              <button 
                onClick={() => void handleRemoteOperation("pull")} 
                disabled={activeRemoteOperation !== null} 
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-label font-bold text-on-surface hover:bg-surface-container-highest transition-all ${activeRemoteOperation === 'pull' ? 'opacity-50' : ''}`}
              >
                <span className="material-symbols-outlined text-primary text-sm">vertical_align_bottom</span>PULL
              </button>
              <div className="w-px h-4 bg-outline-variant/20 mx-1"></div>
              <button 
                onClick={() => void handleRemoteOperation("push")} 
                disabled={activeRemoteOperation !== null} 
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-label font-bold text-on-surface hover:bg-surface-container-highest transition-all ${activeRemoteOperation === 'push' ? 'opacity-50' : ''}`}
              >
                <span className="material-symbols-outlined text-tertiary text-sm">vertical_align_top</span>PUSH
              </button>
            </div>
          ) : null}
          {repository ? (
             <>
                <div className="h-6 w-px bg-outline-variant/20 mx-2"></div>
                <button className="flex items-center gap-1.5 px-3 py-1 text-xs font-label font-medium bg-surface-container-highest/50 border border-outline-variant/20 rounded-full text-on-surface-variant hover:border-primary/40">
                  <span className="material-symbols-outlined text-sm">mediation</span>{repository.currentBranch ?? "-"}
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1 text-xs font-label font-medium text-on-surface-variant hover:text-on-surface" onClick={handleRefreshRepository}>
                  <span className="material-symbols-outlined text-sm">sync</span>{isRefreshing ? "Syncing..." : "Sync"}
                </button>
             </>
          ) : null}
        </div>
        <div />
      </section>

      <div className="flex flex-1 overflow-hidden">
        <aside className="bg-[#091328] w-64 h-full flex flex-col pt-4 shrink-0 transition-all duration-200">
          <div className="px-6 mb-6">
            <h3 className="font-headline text-[10px] tracking-[0.2em] text-[#00D1FF] mb-1">WORKSPACE</h3>
            <p className="font-body text-[11px] text-[#a3aac4]/60">Active: {repository ? repository.name : "None"}</p>
          </div>
          <nav className="flex-1">
            <ul className="space-y-1">
              {NAV_ITEMS.map((item, index) => {
                 let icon = "account_tree";
                 if(item.label === "Historial") icon = "history";
                 if(item.label === "Working tree") icon = "inventory_2";
                 if(item.label === "Remoto") icon = "cloud_queue";
                 if(item.label === "Ramas") icon = "call_split";
                 return (
                  <li key={item.label}>
                    <button className={`w-full flex items-center justify-between px-6 py-3 font-medium text-sm transition-all ${index === 0 ? "text-[#00D1FF] border-l-2 border-[#00D1FF] bg-[#192540]" : "text-[#a3aac4] hover:bg-[#192540] hover:text-[#dee5ff]"}`}>
                      <div className="flex items-center gap-4">
                        <span className="material-symbols-outlined">{icon}</span>
                        {item.label}
                      </div>
                      {item.count && <span className="text-[10px] bg-surface-container-highest px-1.5 rounded text-on-surface-variant font-label">{item.count}</span>}
                    </button>
                  </li>
                 );
              })}
            </ul>
          </nav>
        </aside>

        <main className="flex-1 bg-surface-container-low flex overflow-hidden">
          <div className="flex-1 overflow-y-auto relative bg-[#060e20]">
            <div className="absolute left-10 inset-y-0 w-px bg-outline-variant/10"></div>
            
            {appFeedback && (
              <div className="p-4 border-b border-outline-variant/10">
                 <FeedbackNotice title={appFeedback.title} message={appFeedback.message} tone={appFeedback.tone} />
              </div>
            )}

            {repository ? (
              <div className="flex flex-col">
                 {workingTreeSummary && workingTreeSummary.total > 0 && (
                   <div 
                     className={`flex items-center group cursor-pointer border-l-4 ${isWorkingTreeSelected ? 'border-primary bg-surface-container-highest/60' : 'border-transparent hover:bg-surface-container-highest/40'}`}
                     onClick={handleSelectWorkingTree}
                   >
                     <div className="w-20 px-2 py-3 flex flex-col items-center shrink-0 relative">
                        <div className="w-3 h-3 rounded-full bg-primary border-4 border-surface shadow-[0_0_10px_rgba(105,218,255,0.5)] z-10"></div>
                     </div>
                     <div className="flex-1 py-3 pr-6 border-b border-outline-variant/5">
                        <div className="flex items-center justify-between mb-0.5">
                           <h4 className="font-headline text-sm font-medium text-on-surface">Working Tree</h4>
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                           {workingTreeSummary.modified > 0 && <span className="text-[10px] font-label text-secondary-dim font-bold">✎ {workingTreeSummary.modified}</span>}
                           {workingTreeSummary.added > 0 && <span className="text-[10px] font-label text-primary-dim font-bold">+ {workingTreeSummary.added}</span>}
                           {workingTreeSummary.deleted > 0 && <span className="text-[10px] font-label text-error-dim font-bold">- {workingTreeSummary.deleted}</span>}
                        </div>
                     </div>
                   </div>
                 )}
                 {repository.recentCommits.length > 0 ? (
                   repository.recentCommits.map((commit) => (
                      <HistoryRow
                        key={commit.fullSha}
                        commit={commit}
                        isSelected={commit.fullSha === selectedCommitSha}
                        branchName={repository.currentBranch}
                        onSelect={handleSelectCommit}
                      />
                   ))
                 ) : (
                   <div className="p-8">
                     <EmptyWorkspace
                       title="Sin historial todavía"
                       copy="El repositorio está abierto, pero aún no hay commits visibles para poblar el grafo."
                     />
                   </div>
                 )}
              </div>
            ) : (
               <div className="p-8 h-full flex items-center justify-center">
                 <EmptyWorkspace
                  title="Tab listo para un repositorio"
                  copy="Selecciona un repositorio local usando el icono de carpeta superior."
                  actionLabel={isOpening ? "Abriendo..." : "Abrir repositorio"}
                  onAction={() => void handleOpenRepository()}
                  isActionDisabled={isOpening}
                 />
               </div>
            )}
          </div>

          <aside className="w-[400px] bg-surface-container shrink-0 border-l border-outline-variant/10 flex flex-col overflow-y-auto">
             {!repository ? (
                <div className="p-6">
                   <p className="text-sm text-on-surface-variant font-label">Selecciona un repositorio en este tab y un commit para ver su detalle aquí.</p>
                </div>
             ) : isWorkingTreeSelected ? (
                <div className="flex flex-col gap-0">
                   <div className="p-4 border-b border-outline-variant/10">
                      <div className="flex items-center justify-between mb-4">
                         <span className="text-[10px] font-label tracking-[0.1em] text-on-surface-variant uppercase font-bold">New Commit</span>
                         <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-label tracking-wide ${hasStagedChanges ? 'bg-primary/20 text-primary' : 'bg-surface-container-low text-on-surface-variant'}`}>{hasStagedChanges ? "READY" : "NO STAGED"}</span>
                      </div>
                      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void handleCreateCommit(); }}>
                         <div className="relative">
                            <textarea
                               className="w-full bg-surface-container-lowest border border-outline-variant/20 h-24 p-3 text-xs rounded-lg text-on-surface outline-none focus:border-primary/50 resize-none font-body placeholder:text-on-surface-variant/50"
                               value={commitMessage}
                               onChange={(e) => patchTab(activeTab.id, { commitMessage: e.target.value })}
                               placeholder="feat: describe los cambios staged"
                            />
                         </div>
                         <button type="submit" disabled={!hasStagedChanges || isCommitting || !commitMessage.trim()} className="w-full bg-gradient-to-br from-primary to-primary-container text-on-primary py-2 rounded-lg text-xs font-bold font-label hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed shadow-lg shadow-primary/10">
                            {isCommitting ? "CREATING COMMIT..." : "COMMIT"}
                         </button>
                      </form>
                   </div>
                   
                   <div className="flex flex-col flex-1 p-4 gap-6">
                      <StatusColumn
                          title="Staged Files"
                          emptyMessage="No hay archivos staged."
                          changes={repository.status.stagedChanges}
                          bulkActionLabel="Unstage all"
                          isBulkActionPending={activeStatusAction === "unstage-all"}
                          onBulkAction={() => void handleStatusAction("unstage_all_files", "unstage-all", "No fue posible sacar todos los archivos.")}
                          rowActionLabel="remove"
                          activeActionKey={activeStatusAction}
                          onRowAction={(filePath) => void handleStatusActionForPath("unstage_file", "unstage", filePath, `No unstage ${filePath}`)}
                      />
                      <StatusColumn
                          title="Unstaged Changes"
                          emptyMessage="No hay cambios unstaged."
                          changes={repository.status.unstagedChanges}
                          bulkActionLabel="Stage all"
                          isBulkActionPending={activeStatusAction === "stage-all"}
                          onBulkAction={() => void handleStatusAction("stage_all_files", "stage-all", "No fue posible hacer stage.")}
                          rowActionLabel="add"
                          activeActionKey={activeStatusAction}
                          onRowAction={(filePath) => void handleStatusActionForPath("stage_file", "stage", filePath, `No stage ${filePath}`)}
                      />
                   </div>
                </div>
             ) : (
                <>
                   {isLoadingCommitDetail && !selectedCommitDetail ? (
                      <div className="p-6"><p className="text-sm text-on-surface-variant font-label animate-pulse">Cargando...</p></div>
                   ) : commitDetailError ? (
                      <div className="p-6"><FeedbackNotice title="Error" message={commitDetailError} tone="error" /></div>
                   ) : selectedCommitDetail ? (
                      <CommitDetailPanel detail={selectedCommitDetail} />
                   ) : (
                      <div className="p-6"><p className="text-sm text-on-surface-variant font-label">Selecciona un commit.</p></div>
                   )}
                </>
             )}
          </aside>
        </main>
      </div>
    </div>
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
    <div className="flex flex-col items-center justify-center text-center p-8 gap-4 h-full">
      <div className="w-16 h-16 rounded-full border border-outline-variant/20 bg-surface-container flex items-center justify-center text-outline-variant mb-2">
         <span className="material-symbols-outlined text-3xl">inbox</span>
      </div>
      <h1 className="text-xl font-headline font-bold text-on-surface">{title}</h1>
      <p className="text-sm text-on-surface-variant max-w-sm">{copy}</p>
      {actionLabel && onAction ? (
        <button
          className="mt-2 bg-surface-container-highest border border-outline-variant/20 hover:border-primary/40 text-on-surface px-6 py-2 rounded-lg text-sm font-label font-bold transition-all disabled:opacity-50"
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
  onRowAction,
}: StatusColumnProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-label font-bold text-on-surface-variant tracking-[0.2em] uppercase">{title} <span className="ml-1 px-1.5 bg-surface-container-highest rounded-sm text-on-surface">{changes.length}</span></h3>
        <button
          className="text-[10px] font-bold text-primary hover:text-primary-fixed uppercase tracking-wider disabled:opacity-50"
          type="button"
          onClick={onBulkAction}
          disabled={changes.length === 0 || isBulkActionPending || activeActionKey !== null}
        >
          {isBulkActionPending ? "Syncing..." : bulkActionLabel}
        </button>
      </div>

      {changes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {changes.map((change) => (
            <li key={`${title}-${change.path}`} className="group flex items-center justify-between p-2 rounded hover:bg-surface-variant transition-colors">
              <div className="flex items-center gap-3 overflow-hidden">
                <span className={`text-[10px] font-bold font-label uppercase truncate ${change.kind === 'added' ? 'text-secondary' : change.kind === 'deleted' ? 'text-error' : 'text-tertiary-fixed'}`}>
                  {CHANGE_LABELS[change.kind]}
                </span>
                <p className="text-xs font-body text-on-surface truncate">{change.path}</p>
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 w-6 h-6 flex flex-shrink-0 items-center justify-center bg-surface-container border border-outline-variant/20 rounded hover:bg-surface-container-highest hover:text-primary text-on-surface-variant transition-all disabled:opacity-50"
                type="button"
                onClick={() => onRowAction(change.path)}
                disabled={activeActionKey !== null}
                title={rowActionLabel}
              >
                <span className="material-symbols-outlined text-xs">{rowActionLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-on-surface-variant p-2">{emptyMessage}</p>
      )}
    </div>
  );
}

type FeedbackNoticeProps = FeedbackState;

function FeedbackNotice({ title, message, tone }: FeedbackNoticeProps) {
  const colors = {
    error: "bg-error-container/20 border-error-container text-error",
    warning: "bg-orange-500/10 border-orange-500/30 text-orange-400",
    info: "bg-primary/10 border-primary/30 text-primary-fixed",
    success: "bg-secondary/10 border-secondary/30 text-secondary-fixed",
  };
  return (
    <div className={`p-3 border rounded-lg ${colors[tone] || colors.info}`} role={tone === "error" ? "alert" : "status"}>
      <span className="block text-xs font-bold font-label uppercase tracking-widest mb-1">{title}</span>
      <p className="text-xs">{message}</p>
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
      <div 
        className={`flex group cursor-pointer border-l-4 ${isSelected ? "border-primary bg-surface-container-highest/60" : "border-transparent hover:bg-surface-container-highest/40"}`}
        onClick={() => onSelect(commit.fullSha)}
      >
        <div className="w-20 px-0 flex flex-col items-center shrink-0 relative py-0">
          <CommitGraph commit={commit} />
        </div>
        <div className="flex-1 py-3 pr-6 border-b border-outline-variant/5">
          <div className="flex items-center justify-between mb-0.5">
            <h4 className="font-headline text-sm font-medium text-on-surface/80 group-hover:text-on-surface truncate pr-2">{commit.summary}</h4>
            <span className="font-label text-[10px] text-on-surface-variant flex-shrink-0">{formatCompactDateTime(commit.authoredAt)}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {commit.isHead && (
              <div className="bg-surface-container-high border-l-2 border-primary px-1.5 py-[1px] rounded flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px] text-primary">call_split</span>
                <span className="text-[9px] font-label text-primary font-bold">{branchName ?? "HEAD"}</span>
              </div>
            )}
            <div className="text-[10px] font-label text-on-surface-variant truncate">{commit.authorName}</div>
            <div className="text-[10px] font-mono text-outline-variant ml-auto font-medium">{commit.shortSha}</div>
          </div>
        </div>
      </div>
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
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-6 border-b border-outline-variant/10 shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-container-highest border border-primary/20 flex items-center justify-center text-primary font-bold text-lg font-headline">
              {detail.authorName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-bold font-headline text-on-surface">{detail.authorName}</div>
              <div className="text-[10px] font-label text-on-surface-variant">Commited {formatDateTime(detail.authoredAt)}</div>
            </div>
          </div>
          <button
            className={`bg-surface-container-highest px-2 py-1 rounded font-label text-[10px] font-bold tracking-widest border transition-colors ${copyState === 'copied' ? 'text-secondary border-secondary/50' : 'text-primary border-primary/20 hover:bg-primary/10'}`}
            type="button"
            onClick={() => void handleCopySha()}
            title={copyState === "copied" ? "SHA copiado" : "Copiar SHA completo"}
          >
            {detail.fullSha.slice(0, 8)}
          </button>
        </div>
        <h2 className="text-base font-bold font-headline text-on-surface leading-tight mb-2 whitespace-pre-wrap">{detail.message}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 px-6 relative">
        <div className="flex items-center justify-between mb-4 sticky top-0 bg-surface-container backdrop-blur py-2 shadow-sm z-10">
          <h3 className="text-[10px] font-label font-bold text-on-surface-variant tracking-[0.2em] uppercase">FILES CHANGED ({detail.fileChanges.length})</h3>
        </div>

        {detail.fileChanges.length > 0 ? (
          <ul className="space-y-1">
            {detail.fileChanges.map((change) => (
              <li key={`${detail.fullSha}-${change.path}`} className="group flex items-center justify-between p-2 rounded hover:bg-surface-variant transition-colors">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-bold uppercase ${change.kind === 'added' ? 'text-secondary' : change.kind === 'deleted' ? 'text-error' : 'text-tertiary-fixed'}`}>
                    {CHANGE_LABELS[change.kind]}
                  </span>
                  <p className="text-xs font-body text-on-surface">
                    {change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : detail.fileListNotice ? (
          <FeedbackNotice title="Archivos no visibles" message={detail.fileListNotice} tone="warning" />
        ) : (
          <p className="text-xs text-on-surface-variant">No se reportaron archivos para este commit.</p>
        )}
      </div>
    </div>
  );
}

type CommitGraphProps = {
  commit: CommitSummary;
};

const CommitGraph = memo(function CommitGraph({ commit }: CommitGraphProps) {
  const laneWidth = 16;
  const graphHeight = 60;
  const topY = 0;
  const nodeY = 24;
  const bottomY = graphHeight;
  const width = Math.max(commit.visibleLaneCount, 1) * laneWidth + 24;
  const lanes = Array.from({ length: Math.max(commit.visibleLaneCount, 1) }, (_, lane) => lane);
  const nodeX = commit.lane * laneWidth + 20;

  const colors = ["#ff6f7e", "#6dfe9c", "#00cffc", "#f4b04d", "#bd7bfc"];

  return (
    <div className="flex justify-center h-full absolute inset-y-0 w-full" aria-hidden="true">
      <svg width={width} height={graphHeight} viewBox={`0 0 ${width} ${graphHeight}`} className="overflow-visible h-full">
        {lanes.map((lane) => {
          const x = lane * laneWidth + 20;
          return <line key={`lane-${commit.shortSha}-${lane}`} x1={x} y1={topY} x2={x} y2={bottomY} stroke={colors[lane % colors.length]} strokeWidth="2" strokeOpacity="0.4" fill="none" />;
        })}

        {commit.parentLanes.map((lane, index) => {
          const parentX = lane * laneWidth + 20;
          const path = lane === commit.lane
              ? `M ${nodeX} ${nodeY} L ${parentX} ${bottomY}`
              : `M ${nodeX} ${nodeY} C ${nodeX} ${nodeY + 16}, ${parentX} ${bottomY - 16}, ${parentX} ${bottomY}`;
          return <path key={`edge-${commit.shortSha}-${lane}-${index}`} d={path} stroke={colors[commit.lane % colors.length]} strokeWidth="2" strokeOpacity="0.8" fill="none" />;
        })}

        {commit.isHead ? (
           <circle cx={nodeX} cy={nodeY} r={6} fill="#0d1424" stroke={colors[commit.lane % colors.length]} strokeWidth="3" className="shadow-[0_0_10px_rgba(105,218,255,0.5)]" />
        ) : (
           <circle cx={nodeX} cy={nodeY} r={4} fill={colors[commit.lane % colors.length]} stroke="#060e20" strokeWidth="2" />
        )}
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
