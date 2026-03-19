import { useState } from "react";
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
  headShortSha: string | null;
  isBare: boolean;
  status: RepositoryStatus;
  recentCommits: CommitSummary[];
};

type CommitSummary = {
  shortSha: string;
  summary: string;
  authorName: string;
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
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);

  async function loadRepository(path: string, command: "open_repository" | "refresh_repository") {
    const nextRepository = await invoke<RepositoryState>(command, { path });
    setRepository(nextRepository);
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

  const hasLocalChanges = Boolean(
    repository &&
      (repository.status.stagedChanges.length > 0 ||
        repository.status.unstagedChanges.length > 0),
  );
  const hasStagedChanges = Boolean(repository && repository.status.stagedChanges.length > 0);

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
                <li key={commit.shortSha} className="history-row">
                  <div className="history-row__meta">
                    <span className="commit-sha">{commit.shortSha}</span>
                    <span className="history-author">{commit.authorName}</span>
                  </div>
                  <p className="history-summary">{commit.summary}</p>
                </li>
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

export default App;
