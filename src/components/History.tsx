import { memo, useState } from "react";
import { CHANGE_LABELS, formatCompactDateTime, formatDateTime } from "../app/utils";
import type { CommitDetail, CommitSummary } from "../app/types";
import { FeedbackNotice } from "./Shared";

type HistoryRowProps = {
  commit: CommitSummary;
  isSelected: boolean;
  branchName: string | null;
  onSelect: (commitSha: string) => void;
};

export const HistoryRow = memo(function HistoryRow({
  commit,
  isSelected,
  branchName,
  onSelect,
}: HistoryRowProps) {
  return (
    <div
      className={`group flex cursor-pointer border-l-4 ${
        isSelected
          ? "border-primary bg-surface-container-highest/60"
          : "border-transparent hover:bg-surface-container-highest/40"
      }`}
      onClick={() => onSelect(commit.fullSha)}
    >
      <div className="relative flex w-20 flex-col items-center px-0 py-0 shrink-0">
        <CommitGraph commit={commit} />
      </div>
      <div className="min-w-0 flex-1 border-b border-outline-variant/5 py-3 pr-6">
        <div className="mb-0.5 flex min-w-0 items-start justify-between gap-3">
          <h4 className="min-w-0 flex-1 truncate pr-2 text-sm font-medium font-headline text-on-surface/80 group-hover:text-on-surface">
            {commit.summary}
          </h4>
          <span className="max-w-[9rem] shrink-0 break-words text-right text-[10px] leading-tight font-label text-on-surface-variant">
            {formatCompactDateTime(commit.authoredAt)}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {commit.isHead ? (
            <div className="flex shrink-0 items-center gap-1 rounded border-l-2 border-primary bg-surface-container-high px-1.5 py-[1px]">
              <span className="material-symbols-outlined text-[10px] text-primary">
                call_split
              </span>
              <span className="text-[9px] font-bold font-label text-primary">
                {branchName ?? "HEAD"}
              </span>
            </div>
          ) : null}
          <div className="min-w-0 truncate text-[10px] font-label text-on-surface-variant">
            {commit.authorName}
          </div>
          <div className="ml-auto shrink-0 pl-2 text-[10px] font-medium font-mono text-outline-variant">
            {commit.shortSha}
          </div>
        </div>
      </div>
    </div>
  );
});

type CommitDetailPanelProps = {
  detail: CommitDetail;
};

export function CommitDetailPanel({ detail }: CommitDetailPanelProps) {
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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-outline-variant/10 p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-surface-container-highest text-lg font-bold font-headline text-primary">
              {detail.authorName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="break-words text-sm font-bold font-headline text-on-surface">
                {detail.authorName}
              </div>
              <div className="break-words text-[10px] font-label text-on-surface-variant">
                Commited {formatDateTime(detail.authoredAt)}
              </div>
            </div>
          </div>
          <button
            className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold font-label tracking-widest transition-colors ${
              copyState === "copied"
                ? "border-secondary/50 text-secondary"
                : "border-primary/20 text-primary hover:bg-primary/10"
            } bg-surface-container-highest`}
            type="button"
            onClick={() => void handleCopySha()}
            title={copyState === "copied" ? "SHA copiado" : "Copiar SHA completo"}
          >
            {detail.fullSha.slice(0, 8)}
          </button>
        </div>
        <h2 className="mb-2 whitespace-pre-wrap break-words text-base font-bold font-headline leading-tight text-on-surface">
          {detail.message}
        </h2>
      </div>

      <div className="relative flex-1 overflow-y-auto p-4 px-6">
        <div className="sticky top-0 z-10 mb-4 flex items-center justify-between bg-surface-container py-2 shadow-sm backdrop-blur">
          <h3 className="text-[10px] font-bold font-label uppercase tracking-[0.2em] text-on-surface-variant">
            FILES CHANGED ({detail.fileChanges.length})
          </h3>
        </div>

        {detail.fileChanges.length > 0 ? (
          <ul className="space-y-1">
            {detail.fileChanges.map((change) => (
              <li
                key={`${detail.fullSha}-${change.path}`}
                className="group flex items-start gap-3 rounded p-2 transition-colors hover:bg-surface-variant"
              >
                <div
                  className={`shrink-0 pt-0.5 text-[10px] font-bold uppercase ${
                    change.kind === "added"
                      ? "text-secondary"
                      : change.kind === "deleted"
                        ? "text-error"
                        : "text-tertiary-fixed"
                  }`}
                >
                  <span>{CHANGE_LABELS[change.kind]}</span>
                </div>
                <p className="min-w-0 break-all text-xs font-body text-on-surface">
                  {change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path}
                </p>
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
          <p className="text-xs text-on-surface-variant">
            No se reportaron archivos para este commit.
          </p>
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
    <div className="absolute inset-y-0 flex h-full w-full justify-center" aria-hidden="true">
      <svg
        width={width}
        height={graphHeight}
        viewBox={`0 0 ${width} ${graphHeight}`}
        className="h-full overflow-visible"
      >
        {lanes.map((lane) => {
          const x = lane * laneWidth + 20;
          return (
            <line
              key={`lane-${commit.shortSha}-${lane}`}
              x1={x}
              y1={topY}
              x2={x}
              y2={bottomY}
              stroke={colors[lane % colors.length]}
              strokeWidth="2"
              strokeOpacity="0.4"
              fill="none"
            />
          );
        })}

        {commit.parentLanes.map((lane, index) => {
          const parentX = lane * laneWidth + 20;
          const path =
            lane === commit.lane
              ? `M ${nodeX} ${nodeY} L ${parentX} ${bottomY}`
              : `M ${nodeX} ${nodeY} C ${nodeX} ${nodeY + 16}, ${parentX} ${bottomY - 16}, ${parentX} ${bottomY}`;
          return (
            <path
              key={`edge-${commit.shortSha}-${lane}-${index}`}
              d={path}
              stroke={colors[commit.lane % colors.length]}
              strokeWidth="2"
              strokeOpacity="0.8"
              fill="none"
            />
          );
        })}

        {commit.isHead ? (
          <circle
            cx={nodeX}
            cy={nodeY}
            r={6}
            fill="#0d1424"
            stroke={colors[commit.lane % colors.length]}
            strokeWidth="3"
            className="shadow-[0_0_10px_rgba(105,218,255,0.5)]"
          />
        ) : (
          <circle
            cx={nodeX}
            cy={nodeY}
            r={4}
            fill={colors[commit.lane % colors.length]}
            stroke="#060e20"
            strokeWidth="2"
          />
        )}
      </svg>
    </div>
  );
});
