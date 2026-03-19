import type { RepositoryState } from "../app/types";

type RemoteOperation = "fetch" | "pull" | "push";
type RemoteOperationStatus = "idle" | "loading" | "success" | "error";

type RepositoryToolbarProps = {
  repository: RepositoryState | null;
  activeRemoteOperation: RemoteOperation | null;
  remoteOperationStatuses: Record<RemoteOperation, RemoteOperationStatus>;
  onRemoteOperation: (operation: RemoteOperation) => void;
};

export function RepositoryToolbar({
  repository,
  activeRemoteOperation,
  remoteOperationStatuses,
  onRemoteOperation,
}: RepositoryToolbarProps) {
  return (
    <section className="flex h-10 shrink-0 items-center justify-between border-b border-outline-variant/10 bg-surface-container px-4">
      <div className="flex items-center gap-2">
        {repository ? (
          <div className="flex items-center rounded bg-surface-container-low p-0.5">
            <RemoteActionButton
              icon="download"
              label="FETCH"
              tone="text-secondary"
              isActive={activeRemoteOperation === "fetch"}
              status={remoteOperationStatuses.fetch}
              disabled={activeRemoteOperation !== null}
              onClick={() => onRemoteOperation("fetch")}
            />
            <Divider />
            <RemoteActionButton
              icon="vertical_align_bottom"
              label="PULL"
              tone="text-primary"
              isActive={activeRemoteOperation === "pull"}
              status={remoteOperationStatuses.pull}
              disabled={activeRemoteOperation !== null}
              onClick={() => onRemoteOperation("pull")}
            />
            <Divider />
            <RemoteActionButton
              icon="vertical_align_top"
              label="PUSH"
              tone="text-tertiary"
              isActive={activeRemoteOperation === "push"}
              status={remoteOperationStatuses.push}
              disabled={activeRemoteOperation !== null}
              onClick={() => onRemoteOperation("push")}
            />
          </div>
        ) : null}

        {repository ? (
          <>
            <div className="mx-2 h-6 w-px bg-outline-variant/20"></div>
            <button className="flex items-center gap-1.5 rounded-full border border-outline-variant/20 bg-surface-container-highest/50 px-3 py-1 text-xs font-medium font-label text-on-surface-variant hover:border-primary/40">
              <span className="material-symbols-outlined text-sm">mediation</span>
              {repository.currentBranch ?? "-"}
            </button>
          </>
        ) : null}
      </div>
      <div />
    </section>
  );
}

function Divider() {
  return <div className="mx-1 h-4 w-px bg-outline-variant/20"></div>;
}

type RemoteActionButtonProps = {
  icon: string;
  label: string;
  tone: string;
  isActive: boolean;
  status: RemoteOperationStatus;
  disabled: boolean;
  onClick: () => void;
};

function RemoteActionButton({
  icon,
  label,
  tone,
  isActive,
  status,
  disabled,
  onClick,
}: RemoteActionButtonProps) {
  const statusIcon =
    status === "loading"
      ? "sync"
      : status === "success"
        ? "check_circle"
        : status === "error"
          ? "error"
          : icon;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`remote-action-button remote-action-button--${status} ${
        isActive ? "remote-action-button--active" : ""
      } ${disabled ? "remote-action-button--disabled" : ""}`}
      aria-live="polite"
    >
      <span
        className={`material-symbols-outlined text-sm ${tone} ${
          status === "loading" ? "remote-action-button__icon--spin" : ""
        }`}
      >
        {statusIcon}
      </span>
      <span>{label}</span>
      <span className="remote-action-button__status" aria-hidden="true">
        {status === "loading" ? "..." : status === "success" ? "OK" : status === "error" ? "!" : ""}
      </span>
    </button>
  );
}
