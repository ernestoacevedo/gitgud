import { useEffect, useState } from "react";
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
  headShortSha: string | null;
  isBare: boolean;
  status: RepositoryStatus;
  recentCommits: CommitSummary[];
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

const CHANGE_LABELS: Record<ChangeKind, string> = {
  added: "Nuevo",
  modified: "Modificado",
  deleted: "Eliminado",
  renamed: "Renombrado",
  typechange: "Tipo cambiado",
  conflicted: "Conflicto",
};

function App() {
  const [repository, setRepository] = useState<RepositoryState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedBranchName, setSelectedBranchName] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [isCheckingOutBranch, setIsCheckingOutBranch] = useState(false);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(null);
  const [selectedCommitDetail, setSelectedCommitDetail] = useState<CommitDetail | null>(null);
  const [isLoadingCommitDetail, setIsLoadingCommitDetail] = useState(false);
  const [commitDetailError, setCommitDetailError] = useState<string | null>(null);

  async function loadRepository(path: string, command: "open_repository" | "refresh_repository") {
    const nextRepository = await invoke<RepositoryState>(command, { path });
    setRepository(nextRepository);
    setSelectedBranchName(nextRepository.currentBranch ?? nextRepository.localBranches[0] ?? "");
    setErrorMessage(null);
  }

  async function handleOpenRepository() {
    setIsOpening(true);
    setErrorMessage(null);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Selecciona un repositorio Git local",
      });

      if (!selectedPath || Array.isArray(selectedPath)) {
        return;
      }

      await loadRepository(selectedPath, "open_repository");
    } catch (error) {
      setRepository(null);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No fue posible abrir el repositorio seleccionado.",
      );
    } finally {
      setIsOpening(false);
    }
  }

  async function handleRefreshRepository() {
    if (!repository) {
      return;
    }

    setIsRefreshing(true);

    try {
      await loadRepository(repository.path, "refresh_repository");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No fue posible refrescar el estado del repositorio.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleCreateCommit() {
    if (!repository) {
      return;
    }

    setIsCommitting(true);

    try {
      const nextRepository = await invoke<RepositoryState>("create_commit", {
        path: repository.path,
        message: commitMessage,
      });

      setRepository(nextRepository);
      setCommitMessage("");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No fue posible crear el commit en el repositorio activo.",
      );
    } finally {
      setIsCommitting(false);
    }
  }

  async function handleCheckoutBranch() {
    if (!repository || !selectedBranchName) {
      return;
    }

    setIsCheckingOutBranch(true);

    try {
      const nextRepository = await invoke<RepositoryState>("checkout_branch", {
        path: repository.path,
        branchName: selectedBranchName,
      });

      setRepository(nextRepository);
      setSelectedBranchName(nextRepository.currentBranch ?? nextRepository.localBranches[0] ?? "");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No fue posible cambiar a la rama seleccionada.",
      );
    } finally {
      setIsCheckingOutBranch(false);
    }
  }

  async function handleCreateBranch() {
    if (!repository) {
      return;
    }

    const trimmedBranchName = newBranchName.trim();
    if (!trimmedBranchName) {
      setErrorMessage("Debes ingresar un nombre para la nueva rama.");
      return;
    }

    setIsCreatingBranch(true);

    try {
      const nextRepository = await invoke<RepositoryState>("create_branch", {
        path: repository.path,
        branchName: trimmedBranchName,
      });

      setRepository(nextRepository);
      setNewBranchName("");
      setSelectedBranchName(nextRepository.currentBranch ?? nextRepository.localBranches[0] ?? "");
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "No fue posible crear la nueva rama.",
      );
    } finally {
      setIsCreatingBranch(false);
    }
  }

  async function loadCommitDetail(path: string, commitSha: string) {
    setIsLoadingCommitDetail(true);

    try {
      const detail = await invoke<CommitDetail>("read_commit_detail", {
        path,
        commitSha,
      });
      setSelectedCommitDetail(detail);
      setCommitDetailError(null);
    } catch (error) {
      setSelectedCommitDetail(null);
      setCommitDetailError(
        error instanceof Error
          ? error.message
          : "No fue posible cargar el detalle del commit seleccionado.",
      );
    } finally {
      setIsLoadingCommitDetail(false);
    }
  }

  useEffect(() => {
    if (!repository || repository.recentCommits.length === 0) {
      setSelectedCommitSha(null);
      setSelectedCommitDetail(null);
      setCommitDetailError(null);
      return;
    }

    const nextSelectedCommit = repository.recentCommits.some(
      (commit) => commit.fullSha === selectedCommitSha,
    )
      ? selectedCommitSha
      : repository.recentCommits[0].fullSha;

    if (nextSelectedCommit !== selectedCommitSha) {
      setSelectedCommitSha(nextSelectedCommit);
    }
  }, [repository, selectedCommitSha]);

  useEffect(() => {
    if (!repository) {
      setSelectedBranchName("");
      return;
    }

    const preferredBranch = repository.currentBranch ?? repository.localBranches[0] ?? "";
    if (!selectedBranchName || !repository.localBranches.includes(selectedBranchName)) {
      setSelectedBranchName(preferredBranch);
    }
  }, [repository, selectedBranchName]);

  useEffect(() => {
    if (!repository || !selectedCommitSha) {
      return;
    }

    void loadCommitDetail(repository.path, selectedCommitSha);
  }, [repository, selectedCommitSha]);

  const hasLocalChanges = Boolean(
    repository &&
      (repository.status.stagedChanges.length > 0 ||
        repository.status.unstagedChanges.length > 0),
  );
  const hasStagedChanges = Boolean(repository && repository.status.stagedChanges.length > 0);
  const canCheckoutSelectedBranch = Boolean(
    repository &&
      selectedBranchName &&
      selectedBranchName !== repository.currentBranch,
  );

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">Cliente Git de escritorio</p>
        <h1>Abre un repositorio local y empieza a trabajar sin salir de la app.</h1>
        <p className="lede">
          GitGud valida la carpeta seleccionada, carga el estado actual del
          repositorio y deja visible qué proyecto está activo.
        </p>

        <div className="hero-actions">
          <button
            className="primary-button"
            type="button"
            onClick={handleOpenRepository}
            disabled={isOpening}
          >
            {isOpening ? "Abriendo..." : "Abrir repositorio"}
          </button>
          <span className="helper-text">
            Selecciona una carpeta local desde el diálogo del sistema.
          </span>
        </div>

        {errorMessage ? (
          <div className="feedback-card feedback-card--error" role="alert">
            <span className="feedback-label">Error</span>
            <p>{errorMessage}</p>
          </div>
        ) : null}
      </section>

      <section className="status-grid">
        <article className="info-card info-card--active">
          <div className="card-header">
            <span className="section-kicker">Repositorio activo</span>
            <div className="card-actions">
              {repository ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={handleRefreshRepository}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refrescando..." : "Refrescar"}
                </button>
              ) : null}
              <span className="status-pill">
                {repository ? "Cargado" : "Sin seleccionar"}
              </span>
            </div>
          </div>

          {repository ? (
            <div className="repo-summary">
              <h2>{repository.name}</h2>
              <p className="repo-path">{repository.path}</p>
            </div>
          ) : (
            <div className="empty-state">
              <h2>Ningún repositorio abierto</h2>
              <p>
                Cuando elijas una carpeta Git válida, aquí verás su nombre y
                ruta principal.
              </p>
            </div>
          )}
        </article>

        <article className="info-card">
          <div className="card-header">
            <span className="section-kicker">Estado actual</span>
          </div>

          {repository ? (
            <dl className="detail-list">
              <div>
                <dt>Rama actual</dt>
                <dd>{repository.currentBranch ?? "HEAD desacoplado"}</dd>
              </div>
              <div>
                <dt>Último commit</dt>
                <dd>{repository.headShortSha ?? "Sin commits aún"}</dd>
              </div>
              <div>
                <dt>Git dir</dt>
                <dd>{repository.gitDir}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{repository.isBare ? "Bare repository" : "Working tree"}</dd>
              </div>
            </dl>
          ) : (
            <p className="placeholder-copy">
              La vista principal mostrará aquí el estado cargado del repositorio
              seleccionado.
            </p>
          )}
        </article>
      </section>

      <section className="status-board">
        <article className="info-card">
          <div className="card-header">
            <span className="section-kicker">Cambios locales</span>
            {repository ? (
              <span className="status-pill">
                {hasLocalChanges ? "Con cambios" : "Limpio"}
              </span>
            ) : null}
          </div>

          {!repository ? (
            <p className="placeholder-copy">
              Abre un repositorio para ver archivos staged y unstaged.
            </p>
          ) : hasLocalChanges ? (
            <div className="change-columns">
              <StatusColumn
                title="Staged"
                helper="Listo para el próximo commit."
                emptyMessage="No hay cambios staged."
                changes={repository.status.stagedChanges}
              />
              <StatusColumn
                title="Unstaged"
                helper="Cambios detectados en el working tree."
                emptyMessage="No hay cambios unstaged."
                changes={repository.status.unstagedChanges}
              />
            </div>
          ) : (
            <div className="empty-state empty-state--compact">
              <h2>Working tree limpio</h2>
              <p>
                No hay cambios locales. El repositorio no tiene archivos staged
                ni unstaged en este momento.
              </p>
            </div>
          )}
        </article>
      </section>

      <section className="commit-grid">
        <article className="info-card">
          <div className="card-header">
            <span className="section-kicker">Ramas locales</span>
            {repository ? (
              <span className="status-pill">
                {repository.localBranches.length > 0
                  ? `${repository.localBranches.length} disponibles`
                  : "Sin ramas"}
              </span>
            ) : null}
          </div>

          {!repository ? (
            <p className="placeholder-copy">
              Abre un repositorio para listar ramas locales y hacer checkout desde la app.
            </p>
          ) : repository.localBranches.length > 0 ? (
            <form
              className="branch-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCheckoutBranch();
              }}
            >
              <label className="field-label" htmlFor="branch-selector">
                Cambiar de rama
              </label>
              <div className="branch-form__row">
                <select
                  id="branch-selector"
                  className="branch-select"
                  value={selectedBranchName}
                  onChange={(event) => setSelectedBranchName(event.target.value)}
                >
                  {repository.localBranches.map((branchName) => (
                    <option key={branchName} value={branchName}>
                      {branchName}
                    </option>
                  ))}
                </select>
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={!canCheckoutSelectedBranch || isCheckingOutBranch}
                >
                  {isCheckingOutBranch ? "Cambiando..." : "Hacer checkout"}
                </button>
              </div>
              <p className="helper-text">
                Rama actual: {repository.currentBranch ?? "HEAD desacoplado"}.
              </p>
            </form>
          ) : (
            <div className="empty-state empty-state--compact">
              <h2>Sin ramas locales</h2>
              <p>Este repositorio no expone ramas locales listas para checkout.</p>
            </div>
          )}
        </article>

        <article className="info-card">
          <div className="card-header">
            <span className="section-kicker">Nueva rama</span>
            {repository ? <span className="status-pill">Crear y cambiar</span> : null}
          </div>

          {repository ? (
            <form
              className="branch-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateBranch();
              }}
            >
              <label className="field-label" htmlFor="new-branch-name">
                Nombre de rama
              </label>
              <input
                id="new-branch-name"
                className="branch-input"
                type="text"
                value={newBranchName}
                onChange={(event) => setNewBranchName(event.target.value)}
                placeholder="feature/cambiar-rama"
                autoComplete="off"
              />
              <div className="commit-form__footer">
                <p className="helper-text">
                  Usa un nombre válido de Git. La nueva rama se creará desde `HEAD` y quedará activa.
                </p>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isCreatingBranch}
                >
                  {isCreatingBranch ? "Creando rama..." : "Crear rama"}
                </button>
              </div>
            </form>
          ) : (
            <p className="placeholder-copy">
              Abre un repositorio para crear una rama nueva sin usar la terminal.
            </p>
          )}
        </article>
      </section>

      <section className="commit-grid">
        <article className="info-card">
          <div className="card-header">
            <span className="section-kicker">Nuevo commit</span>
            {repository ? (
              <span className="status-pill">
                {hasStagedChanges ? "Listo para commit" : "Sin staged"}
              </span>
            ) : null}
          </div>

          {repository ? (
            <form
              className="commit-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateCommit();
              }}
            >
              <label className="field-label" htmlFor="commit-message">
                Mensaje de commit
              </label>
              <textarea
                id="commit-message"
                className="commit-input"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder="Describe los cambios que ya dejaste staged"
                rows={4}
              />
              <div className="commit-form__footer">
                <p className="helper-text">
                  Solo se incluirán los archivos que aparecen en la columna staged.
                </p>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!hasStagedChanges || isCommitting}
                >
                  {isCommitting ? "Creando commit..." : "Crear commit"}
                </button>
              </div>
            </form>
          ) : (
            <p className="placeholder-copy">
              Abre un repositorio para ingresar un mensaje y crear commits desde la app.
            </p>
          )}
        </article>

        <article className="info-card">
          <div className="card-header">
            <span className="section-kicker">Historial visible</span>
            {repository ? (
              <span className="status-pill">
                {repository.recentCommits.length > 0 ? "Actualizado" : "Sin commits"}
              </span>
            ) : null}
          </div>

          {!repository ? (
            <p className="placeholder-copy">
              El historial reciente aparecerá aquí cuando cargues un repositorio.
            </p>
          ) : repository.recentCommits.length > 0 ? (
            <ul className="history-list">
              {repository.recentCommits.map((commit) => (
                <HistoryRow
                  key={commit.shortSha}
                  commit={commit}
                  isSelected={commit.fullSha === selectedCommitSha}
                  onSelect={() => setSelectedCommitSha(commit.fullSha)}
                />
              ))}
            </ul>
          ) : (
            <div className="empty-state empty-state--compact">
              <h2>Sin historial todavía</h2>
              <p>El repositorio aún no tiene commits visibles para mostrar.</p>
            </div>
          )}
        </article>
      </section>

      <section className="status-board">
        <article className="info-card">
          <div className="card-header">
            <span className="section-kicker">Detalle del commit</span>
            {repository && selectedCommitSha ? (
              <span className="status-pill">
                {isLoadingCommitDetail ? "Cargando" : selectedCommitSha}
              </span>
            ) : null}
          </div>

          {!repository ? (
            <p className="placeholder-copy">
              Abre un repositorio para inspeccionar el detalle de un commit.
            </p>
          ) : repository.recentCommits.length === 0 ? (
            <div className="empty-state empty-state--compact">
              <h2>Sin commit seleccionado</h2>
              <p>Necesitas historial visible para consultar archivos y metadata.</p>
            </div>
          ) : isLoadingCommitDetail && !selectedCommitDetail ? (
            <p className="placeholder-copy">
              Cargando metadata y archivos del commit seleccionado...
            </p>
          ) : commitDetailError ? (
            <div className="feedback-card feedback-card--error" role="alert">
              <span className="feedback-label">Detalle no disponible</span>
              <p>{commitDetailError}</p>
            </div>
          ) : selectedCommitDetail ? (
            <CommitDetailPanel detail={selectedCommitDetail} />
          ) : (
            <p className="placeholder-copy">
              Selecciona un commit del historial para ver su metadata y archivos.
            </p>
          )}
        </article>
      </section>
    </main>
  );
}

type StatusColumnProps = {
  title: string;
  helper: string;
  emptyMessage: string;
  changes: ChangedFile[];
};

function StatusColumn({
  title,
  helper,
  emptyMessage,
  changes,
}: StatusColumnProps) {
  return (
    <section className="change-column">
      <div className="change-column__header">
        <h2>{title}</h2>
        <p>{helper}</p>
      </div>

      {changes.length > 0 ? (
        <ul className="change-list">
          {changes.map((change) => (
            <li key={`${title}-${change.path}`} className="change-row">
              <div>
                <span className={`change-kind change-kind--${change.kind}`}>
                  {CHANGE_LABELS[change.kind]}
                </span>
                <p className="change-path">{change.path}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="placeholder-copy">{emptyMessage}</p>
      )}
    </section>
  );
}

type HistoryRowProps = {
  commit: CommitSummary;
  isSelected: boolean;
  onSelect: () => void;
};

function HistoryRow({ commit, isSelected, onSelect }: HistoryRowProps) {
  const formattedDate = new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(commit.authoredAt * 1000));

  return (
    <li>
      <button
        className={`history-row${commit.isHead ? " history-row--head" : ""}${isSelected ? " history-row--selected" : ""}`}
        type="button"
        onClick={onSelect}
      >
        <CommitGraph commit={commit} />
        <div className="history-row__content">
          <div className="history-row__meta">
            <span className="commit-sha">{commit.shortSha}</span>
            {commit.isHead ? <span className="head-badge">HEAD</span> : null}
            <span className="history-author">{commit.authorName}</span>
            <span className="history-date">{formattedDate}</span>
          </div>
          <p className="history-summary">{commit.summary}</p>
        </div>
      </button>
    </li>
  );
}

type CommitDetailPanelProps = {
  detail: CommitDetail;
};

function CommitDetailPanel({ detail }: CommitDetailPanelProps) {
  const authoredAt = new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(detail.authoredAt * 1000));
  const committedAt = new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(detail.committedAt * 1000));

  return (
    <div className="commit-detail">
      <div className="commit-detail__header">
        <h2>{detail.summary}</h2>
        <p>{detail.message}</p>
      </div>

      <dl className="detail-list commit-detail__meta">
        <div>
          <dt>SHA completo</dt>
          <dd>{detail.fullSha}</dd>
        </div>
        <div>
          <dt>Autor</dt>
          <dd>
            {detail.authorName}
            {detail.authorEmail ? ` <${detail.authorEmail}>` : ""}
          </dd>
        </div>
        <div>
          <dt>Fecha autor</dt>
          <dd>{authoredAt}</dd>
        </div>
        <div>
          <dt>Committer</dt>
          <dd>
            {detail.committerName}
            {detail.committerEmail ? ` <${detail.committerEmail}>` : ""}
          </dd>
        </div>
        <div>
          <dt>Fecha commit</dt>
          <dd>{committedAt}</dd>
        </div>
        <div>
          <dt>Padres</dt>
          <dd>{detail.parentShas.length > 0 ? detail.parentShas.join(", ") : "Sin padres"}</dd>
        </div>
      </dl>

      <section className="commit-files">
        <div className="change-column__header">
          <h2>Archivos modificados</h2>
          <p>Lista de archivos detectados en el diff del commit seleccionado.</p>
        </div>

        {detail.fileChanges.length > 0 ? (
          <ul className="change-list">
            {detail.fileChanges.map((change) => (
              <li key={`${detail.fullSha}-${change.path}`} className="change-row">
                <span className={`change-kind change-kind--${change.kind}`}>
                  {CHANGE_LABELS[change.kind]}
                </span>
                <p className="change-path">
                  {change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path}
                </p>
              </li>
            ))}
          </ul>
        ) : detail.fileListNotice ? (
          <div className="feedback-card feedback-card--warning" role="status">
            <span className="feedback-label">Archivos no visibles</span>
            <p>{detail.fileListNotice}</p>
          </div>
        ) : (
          <p className="placeholder-copy">
            No se reportaron archivos para este commit.
          </p>
        )}
      </section>
    </div>
  );
}

type CommitGraphProps = {
  commit: CommitSummary;
};

function CommitGraph({ commit }: CommitGraphProps) {
  const laneWidth = 24;
  const graphHeight = 72;
  const topY = 10;
  const nodeY = 24;
  const bottomY = 62;
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
              : `M ${nodeX} ${nodeY} C ${nodeX} ${nodeY + 18}, ${parentX} ${bottomY - 18}, ${parentX} ${bottomY}`;

          return (
            <path
              key={`edge-${commit.shortSha}-${lane}-${index}`}
              d={path}
              className="commit-graph__edge"
            />
          );
        })}

        {commit.isHead ? (
          <circle
            cx={nodeX}
            cy={nodeY}
            r={9}
            className="commit-graph__head-halo"
          />
        ) : null}
        <circle cx={nodeX} cy={nodeY} r={5.5} className="commit-graph__node" />
      </svg>
    </div>
  );
}

export default App;
