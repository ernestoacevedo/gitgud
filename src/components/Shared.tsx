import { CHANGE_LABELS } from "../app/utils";
import type { ChangedFile, FeedbackState } from "../app/types";

type EmptyWorkspaceProps = {
  title: string;
  copy: string;
  actionLabel?: string;
  onAction?: () => void;
  isActionDisabled?: boolean;
};

export function EmptyWorkspace({
  title,
  copy,
  actionLabel,
  onAction,
  isActionDisabled = false,
}: EmptyWorkspaceProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container text-outline-variant">
        <span className="material-symbols-outlined text-3xl">inbox</span>
      </div>
      <h1 className="text-xl font-bold font-headline text-on-surface">{title}</h1>
      <p className="max-w-sm text-sm text-on-surface-variant">{copy}</p>
      {actionLabel && onAction ? (
        <button
          className="mt-2 rounded-lg border border-outline-variant/20 bg-surface-container-highest px-6 py-2 text-sm font-bold font-label text-on-surface transition-all hover:border-primary/40 disabled:opacity-50"
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

export function StatusColumn({
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
        <h3 className="text-[10px] font-bold font-label uppercase tracking-[0.2em] text-on-surface-variant">
          {title}
          <span className="ml-1 rounded-sm bg-surface-container-highest px-1.5 text-on-surface">
            {changes.length}
          </span>
        </h3>
        <button
          className="text-[10px] font-bold uppercase tracking-wider text-primary hover:text-primary-fixed disabled:opacity-50"
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
            <li
              key={`${title}-${change.path}`}
              className="group flex items-center justify-between rounded p-2 transition-colors hover:bg-surface-variant"
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <span
                  className={`truncate text-[10px] font-bold font-label uppercase ${
                    change.kind === "added"
                      ? "text-secondary"
                      : change.kind === "deleted"
                        ? "text-error"
                        : "text-tertiary-fixed"
                  }`}
                >
                  {CHANGE_LABELS[change.kind]}
                </span>
                <p className="truncate text-xs font-body text-on-surface">{change.path}</p>
              </div>
              <button
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-outline-variant/20 bg-surface-container text-on-surface-variant opacity-0 transition-all hover:bg-surface-container-highest hover:text-primary group-hover:opacity-100 disabled:opacity-50"
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
        <p className="p-2 text-xs text-on-surface-variant">{emptyMessage}</p>
      )}
    </div>
  );
}

type FeedbackNoticeProps = FeedbackState;

export function FeedbackNotice({ title, message, tone }: FeedbackNoticeProps) {
  const colors = {
    error: "border-error-container bg-error-container/20 text-error",
    warning: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    info: "border-primary/30 bg-primary/10 text-primary-fixed",
    success: "border-secondary/30 bg-secondary/10 text-secondary-fixed",
  };

  return (
    <div
      className={`rounded-lg border p-3 ${colors[tone] || colors.info}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="mb-1 block text-xs font-bold font-label uppercase tracking-widest">
        {title}
      </span>
      <p className="text-xs">{message}</p>
    </div>
  );
}
