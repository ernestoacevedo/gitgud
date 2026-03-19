import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type RepositoryState = {
  name: string;
  path: string;
  gitDir: string;
  currentBranch: string | null;
  headShortSha: string | null;
  isBare: boolean;
};

function App() {
  const [repository, setRepository] = useState<RepositoryState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

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

      const nextRepository = await invoke<RepositoryState>("open_repository", {
        path: selectedPath,
      });

      setRepository(nextRepository);
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
            <span className="status-pill">
              {repository ? "Cargado" : "Sin seleccionar"}
            </span>
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
    </main>
  );
}

export default App;
