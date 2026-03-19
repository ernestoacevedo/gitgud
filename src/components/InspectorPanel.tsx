import type { CommitDetail, RepositoryState, WorkspaceTab } from "../app/types";
import { CommitDetailPanel } from "./History";
import { FeedbackNotice, StatusColumn } from "./Shared";

type InspectorPanelProps = {
  repository: RepositoryState | null;
  activeTab: WorkspaceTab | undefined;
  isWorkingTreeSelected: boolean;
  hasStagedChanges: boolean;
  commitMessage: string;
  isCommitting: boolean;
  activeStatusAction: string | null;
  isLoadingCommitDetail: boolean;
  selectedCommitDetail: CommitDetail | null;
  commitDetailError: string | null;
  onCommitMessageChange: (value: string) => void;
  onCreateCommit: () => void;
  onBulkStatusAction: (command: string, actionKey: string, fallbackMessage: string) => void;
  onFileStatusAction: (
    command: string,
    actionPrefix: string,
    filePath: string,
    fallbackMessage: string,
  ) => void;
};

export function InspectorPanel({
  repository,
  activeTab,
  isWorkingTreeSelected,
  hasStagedChanges,
  commitMessage,
  isCommitting,
  activeStatusAction,
  isLoadingCommitDetail,
  selectedCommitDetail,
  commitDetailError,
  onCommitMessageChange,
  onCreateCommit,
  onBulkStatusAction,
  onFileStatusAction,
}: InspectorPanelProps) {
  return (
    <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l border-outline-variant/10 bg-surface-container">
      {!repository ? (
        <div className="p-6">
          <p className="text-sm font-label text-on-surface-variant">
            Selecciona un repositorio en este tab y un commit para ver su detalle aquí.
          </p>
        </div>
      ) : isWorkingTreeSelected ? (
        <WorkingTreeInspector
          repository={repository}
          activeTab={activeTab}
          hasStagedChanges={hasStagedChanges}
          commitMessage={commitMessage}
          isCommitting={isCommitting}
          activeStatusAction={activeStatusAction}
          onCommitMessageChange={onCommitMessageChange}
          onCreateCommit={onCreateCommit}
          onBulkStatusAction={onBulkStatusAction}
          onFileStatusAction={onFileStatusAction}
        />
      ) : isLoadingCommitDetail && !selectedCommitDetail ? (
        <div className="p-6">
          <p className="animate-pulse text-sm font-label text-on-surface-variant">Cargando...</p>
        </div>
      ) : commitDetailError ? (
        <div className="p-6">
          <FeedbackNotice title="Error" message={commitDetailError} tone="error" />
        </div>
      ) : selectedCommitDetail ? (
        <CommitDetailPanel detail={selectedCommitDetail} />
      ) : (
        <div className="p-6">
          <p className="text-sm font-label text-on-surface-variant">Selecciona un commit.</p>
        </div>
      )}
    </aside>
  );
}

type WorkingTreeInspectorProps = {
  repository: RepositoryState;
  activeTab: WorkspaceTab | undefined;
  hasStagedChanges: boolean;
  commitMessage: string;
  isCommitting: boolean;
  activeStatusAction: string | null;
  onCommitMessageChange: (value: string) => void;
  onCreateCommit: () => void;
  onBulkStatusAction: (command: string, actionKey: string, fallbackMessage: string) => void;
  onFileStatusAction: (
    command: string,
    actionPrefix: string,
    filePath: string,
    fallbackMessage: string,
  ) => void;
};

function WorkingTreeInspector({
  repository,
  activeTab,
  hasStagedChanges,
  commitMessage,
  isCommitting,
  activeStatusAction,
  onCommitMessageChange,
  onCreateCommit,
  onBulkStatusAction,
  onFileStatusAction,
}: WorkingTreeInspectorProps) {
  return (
    <div className="flex flex-col gap-0">
      <div className="border-b border-outline-variant/10 p-4">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[10px] font-bold font-label uppercase tracking-[0.1em] text-on-surface-variant">
            New Commit
          </span>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold font-label tracking-wide ${
              hasStagedChanges
                ? "bg-primary/20 text-primary"
                : "bg-surface-container-low text-on-surface-variant"
            }`}
          >
            {hasStagedChanges ? "READY" : "NO STAGED"}
          </span>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateCommit();
          }}
        >
          <div className="relative">
            <textarea
              className="h-24 w-full resize-none rounded-lg border border-outline-variant/20 bg-surface-container-lowest p-3 text-xs font-body text-on-surface outline-none placeholder:text-on-surface-variant/50 focus:border-primary/50"
              value={commitMessage}
              onChange={(event) => onCommitMessageChange(event.target.value)}
              placeholder="feat: describe los cambios staged"
            />
          </div>
          <button
            type="submit"
            disabled={!hasStagedChanges || isCommitting || !commitMessage.trim() || !activeTab}
            className="w-full rounded-lg bg-gradient-to-br from-primary to-primary-container py-2 text-xs font-bold font-label text-on-primary shadow-lg shadow-primary/10 transition-all hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:grayscale disabled:opacity-50"
          >
            {isCommitting ? "CREATING COMMIT..." : "COMMIT"}
          </button>
        </form>
      </div>

      <div className="flex flex-1 flex-col gap-6 p-4">
        <StatusColumn
          title="Staged Files"
          emptyMessage="No hay archivos staged."
          changes={repository.status.stagedChanges}
          bulkActionLabel="Unstage all"
          isBulkActionPending={activeStatusAction === "unstage-all"}
          onBulkAction={() =>
            onBulkStatusAction(
              "unstage_all_files",
              "unstage-all",
              "No fue posible sacar todos los archivos.",
            )
          }
          rowActionLabel="remove"
          activeActionKey={activeStatusAction}
          onRowAction={(filePath) =>
            onFileStatusAction(
              "unstage_file",
              "unstage",
              filePath,
              `No unstage ${filePath}`,
            )
          }
        />
        <StatusColumn
          title="Unstaged Changes"
          emptyMessage="No hay cambios unstaged."
          changes={repository.status.unstagedChanges}
          bulkActionLabel="Stage all"
          isBulkActionPending={activeStatusAction === "stage-all"}
          onBulkAction={() =>
            onBulkStatusAction("stage_all_files", "stage-all", "No fue posible hacer stage.")
          }
          rowActionLabel="add"
          activeActionKey={activeStatusAction}
          onRowAction={(filePath) =>
            onFileStatusAction("stage_file", "stage", filePath, `No stage ${filePath}`)
          }
        />
      </div>
    </div>
  );
}
