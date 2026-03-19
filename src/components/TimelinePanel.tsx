import { WORKING_TREE_HISTORY_ENTRY_ID } from "../app/utils";
import type { CommitSummary, FeedbackState, RepositoryState } from "../app/types";
import { HistoryRow } from "./History";
import { EmptyWorkspace, FeedbackNotice } from "./Shared";

type WorkingTreeSummary = {
  added: number;
  modified: number;
  deleted: number;
  total: number;
};

type TimelinePanelProps = {
  repository: RepositoryState | null;
  appFeedback: FeedbackState | null;
  workingTreeSummary: WorkingTreeSummary | null;
  isWorkingTreeSelected: boolean;
  selectedCommitSha: string | null;
  isOpening: boolean;
  currentBranch: string | null;
  recentCommits: CommitSummary[];
  onSelectWorkingTree: () => void;
  onSelectCommit: (commitSha: string) => void;
  onOpenRepository: () => void;
};

export function TimelinePanel({
  repository,
  appFeedback,
  workingTreeSummary,
  isWorkingTreeSelected,
  selectedCommitSha,
  isOpening,
  currentBranch,
  recentCommits,
  onSelectWorkingTree,
  onSelectCommit,
  onOpenRepository,
}: TimelinePanelProps) {
  return (
    <div className="relative flex-1 overflow-y-auto bg-[#060e20]">
      <div className="absolute inset-y-0 left-10 w-px bg-outline-variant/10"></div>

      {appFeedback ? (
        <div className="border-b border-outline-variant/10 p-4">
          <FeedbackNotice
            title={appFeedback.title}
            message={appFeedback.message}
            tone={appFeedback.tone}
          />
        </div>
      ) : null}

      {repository ? (
        <div className="flex flex-col">
          {workingTreeSummary && workingTreeSummary.total > 0 ? (
            <WorkingTreeRow
              summary={workingTreeSummary}
              isSelected={isWorkingTreeSelected}
              onSelect={onSelectWorkingTree}
            />
          ) : null}

          {recentCommits.length > 0 ? (
            recentCommits.map((commit) => (
              <HistoryRow
                key={commit.fullSha}
                commit={commit}
                isSelected={commit.fullSha === selectedCommitSha}
                branchName={currentBranch}
                onSelect={onSelectCommit}
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
        <div className="flex h-full items-center justify-center p-8">
          <EmptyWorkspace
            title="Tab listo para un repositorio"
            copy="Selecciona un repositorio local usando el icono de carpeta superior."
            actionLabel={isOpening ? "Abriendo..." : "Abrir repositorio"}
            onAction={onOpenRepository}
            isActionDisabled={isOpening}
          />
        </div>
      )}
    </div>
  );
}

type WorkingTreeRowProps = {
  summary: WorkingTreeSummary;
  isSelected: boolean;
  onSelect: () => void;
};

function WorkingTreeRow({ summary, isSelected, onSelect }: WorkingTreeRowProps) {
  return (
    <div
      className={`group flex cursor-pointer border-l-4 ${
        isSelected
          ? "border-primary bg-surface-container-highest/60"
          : "border-transparent hover:bg-surface-container-highest/40"
      }`}
      onClick={onSelect}
      data-entry-id={WORKING_TREE_HISTORY_ENTRY_ID}
    >
      <div className="relative flex w-20 shrink-0 flex-col items-center px-2 py-3">
        <div className="z-10 h-3 w-3 rounded-full border-4 border-surface bg-primary shadow-[0_0_10px_rgba(105,218,255,0.5)]"></div>
      </div>
      <div className="flex-1 border-b border-outline-variant/5 py-3 pr-6">
        <div className="mb-0.5 flex items-center justify-between">
          <h4 className="text-sm font-medium font-headline text-on-surface">Working Tree</h4>
        </div>
        <div className="mt-1 flex items-center gap-4">
          {summary.modified > 0 ? (
            <span className="text-[10px] font-bold font-label text-secondary-dim">
              ✎ {summary.modified}
            </span>
          ) : null}
          {summary.added > 0 ? (
            <span className="text-[10px] font-bold font-label text-primary-dim">
              + {summary.added}
            </span>
          ) : null}
          {summary.deleted > 0 ? (
            <span className="text-[10px] font-bold font-label text-error-dim">
              - {summary.deleted}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
