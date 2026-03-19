use git2::{Commit, Repository, Signature, Status, StatusOptions};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RepositoryStatus {
    staged_changes: Vec<ChangedFile>,
    unstaged_changes: Vec<ChangedFile>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ChangedFile {
    path: String,
    kind: ChangeKind,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Typechange,
    Conflicted,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RepositoryState {
    name: String,
    path: String,
    git_dir: String,
    current_branch: Option<String>,
    head_short_sha: Option<String>,
    is_bare: bool,
    status: RepositoryStatus,
    recent_commits: Vec<CommitSummary>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CommitSummary {
    short_sha: String,
    summary: String,
    author_name: String,
}

fn short_head_sha(repository: &Repository) -> Option<String> {
    repository
        .head()
        .ok()
        .and_then(|head| head.target())
        .map(|oid| oid.to_string().chars().take(7).collect())
}

fn current_branch_name(repository: &Repository) -> Option<String> {
    repository
        .head()
        .ok()
        .filter(|head| head.is_branch())
        .and_then(|head| head.shorthand().map(str::to_owned))
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| path.display().to_string())
}

fn display_commit_summary(commit: &Commit) -> String {
    commit
        .summary()
        .map(str::to_owned)
        .unwrap_or_else(|| "Commit sin mensaje".to_string())
}

fn display_author_name(commit: &Commit) -> String {
    commit
        .author()
        .name()
        .map(str::to_owned)
        .unwrap_or_else(|| "Autor desconocido".to_string())
}

fn short_oid(oid: git2::Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

fn map_index_change(status: Status) -> Option<ChangeKind> {
    if status.is_index_new() {
        Some(ChangeKind::Added)
    } else if status.is_index_modified() {
        Some(ChangeKind::Modified)
    } else if status.is_index_deleted() {
        Some(ChangeKind::Deleted)
    } else if status.is_index_renamed() {
        Some(ChangeKind::Renamed)
    } else if status.is_index_typechange() {
        Some(ChangeKind::Typechange)
    } else if status.is_conflicted() {
        Some(ChangeKind::Conflicted)
    } else {
        None
    }
}

fn map_worktree_change(status: Status) -> Option<ChangeKind> {
    if status.is_wt_new() {
        Some(ChangeKind::Added)
    } else if status.is_wt_modified() {
        Some(ChangeKind::Modified)
    } else if status.is_wt_deleted() {
        Some(ChangeKind::Deleted)
    } else if status.is_wt_renamed() {
        Some(ChangeKind::Renamed)
    } else if status.is_wt_typechange() {
        Some(ChangeKind::Typechange)
    } else if status.is_conflicted() {
        Some(ChangeKind::Conflicted)
    } else {
        None
    }
}

fn repository_status(repository: &Repository) -> Result<RepositoryStatus, String> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repository
        .statuses(Some(&mut options))
        .map_err(|error| format!("No fue posible leer el estado del repositorio: {error}"))?;

    let mut staged_changes = Vec::new();
    let mut unstaged_changes = Vec::new();

    for entry in statuses.iter() {
        let Some(path) = entry.path() else {
            continue;
        };

        let status = entry.status();

        if let Some(kind) = map_index_change(status) {
            staged_changes.push(ChangedFile {
                path: path.to_owned(),
                kind,
            });
        }

        if let Some(kind) = map_worktree_change(status) {
            unstaged_changes.push(ChangedFile {
                path: path.to_owned(),
                kind,
            });
        }
    }

    staged_changes.sort_by(|left, right| left.path.cmp(&right.path));
    unstaged_changes.sort_by(|left, right| left.path.cmp(&right.path));

    Ok(RepositoryStatus {
        staged_changes,
        unstaged_changes,
    })
}

fn recent_commits(repository: &Repository) -> Result<Vec<CommitSummary>, String> {
    let mut revwalk = match repository.revwalk() {
        Ok(revwalk) => revwalk,
        Err(error) => {
            return Err(format!(
                "No fue posible leer el historial del repositorio: {error}"
            ))
        }
    };

    if let Err(error) = revwalk.push_head() {
        if error.code() == git2::ErrorCode::UnbornBranch
            || error.code() == git2::ErrorCode::NotFound
            || error.class() == git2::ErrorClass::Reference
        {
            return Ok(Vec::new());
        }

        return Err(format!(
            "No fue posible leer el historial del repositorio: {error}"
        ));
    }

    let mut commits = Vec::new();

    for oid in revwalk.take(8) {
        let oid =
            oid.map_err(|error| format!("No fue posible recorrer el historial del repositorio: {error}"))?;
        let commit = repository
            .find_commit(oid)
            .map_err(|error| format!("No fue posible cargar un commit del historial: {error}"))?;

        commits.push(CommitSummary {
            short_sha: short_oid(commit.id()),
            summary: display_commit_summary(&commit),
            author_name: display_author_name(&commit),
        });
    }

    Ok(commits)
}

fn commit_signature(repository: &Repository) -> Result<Signature<'_>, String> {
    repository
        .signature()
        .map_err(|error| format!("Git rechazo el commit: {error}"))
}

fn create_commit_for_repository(repository: &Repository, message: &str) -> Result<(), String> {
    let trimmed_message = message.trim();
    if trimmed_message.is_empty() {
        return Err("Debes ingresar un mensaje de commit.".to_string());
    }

    let status = repository_status(repository)?;
    if status.staged_changes.is_empty() {
        return Err("No hay cambios staged para crear un commit.".to_string());
    }

    let signature = commit_signature(repository)?;
    let mut index = repository
        .index()
        .map_err(|error| format!("No fue posible abrir el index del repositorio: {error}"))?;
    index
        .write()
        .map_err(|error| format!("No fue posible escribir el index del repositorio: {error}"))?;

    let tree_id = index
        .write_tree()
        .map_err(|error| format!("No fue posible generar el arbol del commit: {error}"))?;
    let tree = repository
        .find_tree(tree_id)
        .map_err(|error| format!("No fue posible cargar el arbol del commit: {error}"))?;

    let parent_commit = repository.head().ok().and_then(|head| head.peel_to_commit().ok());
    let parent_refs = parent_commit.iter().collect::<Vec<_>>();

    repository
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            trimmed_message,
            &tree,
            &parent_refs,
        )
        .map_err(|error| format!("Git rechazo el commit: {error}"))?;

    Ok(())
}

fn repository_state_from_path(path: &Path) -> Result<RepositoryState, String> {
    let repository = Repository::open(path).map_err(|error| {
        format!("La carpeta seleccionada no contiene un repositorio Git valido: {error}")
    })?;

    let workdir = repository
        .workdir()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| path.to_path_buf());

    Ok(RepositoryState {
        name: display_name(&workdir),
        path: workdir.display().to_string(),
        git_dir: repository.path().display().to_string(),
        current_branch: current_branch_name(&repository),
        head_short_sha: short_head_sha(&repository),
        is_bare: repository.is_bare(),
        status: repository_status(&repository)?,
        recent_commits: recent_commits(&repository)?,
    })
}

#[tauri::command]
fn open_repository(path: String) -> Result<RepositoryState, String> {
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn refresh_repository(path: String) -> Result<RepositoryState, String> {
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn create_commit(path: String, message: String) -> Result<RepositoryState, String> {
    let repository = Repository::open(Path::new(&path))
        .map_err(|error| format!("La carpeta seleccionada no contiene un repositorio Git valido: {error}"))?;
    create_commit_for_repository(&repository, &message)?;
    repository_state_from_path(Path::new(&path))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_repository,
            refresh_repository,
            create_commit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{create_commit_for_repository, repository_state_from_path, ChangeKind, ChangedFile};
    use git2::{BranchType, IndexAddOption, Repository, Signature};
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn loads_repository_state_for_valid_repo() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");

        fs::write(directory.path().join("README.md"), "# GitGud\n").expect("write readme");

        let mut index = repository.index().expect("index");
        index
            .add_path(std::path::Path::new("README.md"))
            .expect("add path");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "Initial commit",
                &tree,
                &[],
            )
            .expect("commit");
        repository.index().expect("index").write().expect("write index");

        let state = repository_state_from_path(directory.path()).expect("state");
        let resolved_state_path = fs::canonicalize(Path::new(&state.path)).expect("state path");
        let resolved_directory_path = fs::canonicalize(directory.path()).expect("directory path");

        assert_eq!(
            state.name,
            directory.path().file_name().unwrap().to_string_lossy()
        );
        assert_eq!(resolved_state_path, resolved_directory_path);
        assert_eq!(state.current_branch.as_deref(), Some("master"));
        assert_eq!(state.head_short_sha.as_ref().map(String::len), Some(7));
        assert!(!state.is_bare);
        assert!(state.status.staged_changes.is_empty());
        assert!(state.status.unstaged_changes.is_empty());
    }

    #[test]
    fn returns_clear_error_for_invalid_repo() {
        let directory = tempdir().expect("tempdir");

        let error = repository_state_from_path(directory.path()).expect_err("expected error");

        assert!(error.contains("no contiene un repositorio Git valido"));
    }

    #[test]
    fn opens_git_directory_inside_worktree() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");

        let nested_git_dir = directory.path().join(".git");
        let state = repository_state_from_path(&nested_git_dir).expect("state");

        assert_eq!(
            state.path,
            repository.workdir().unwrap().display().to_string()
        );
    }

    #[test]
    fn resolves_branch_names_through_local_branch_lookup() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");

        fs::write(directory.path().join("tracked.txt"), "content").expect("write file");
        let mut index = repository.index().expect("index");
        index
            .add_path(std::path::Path::new("tracked.txt"))
            .expect("add path");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");
        let commit_id = repository
            .commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
            .expect("commit");
        let commit = repository.find_commit(commit_id).expect("find commit");

        repository
            .branch("feature/us-001", &commit, false)
            .expect("create branch");
        repository
            .set_head("refs/heads/feature/us-001")
            .expect("set head");

        let state = repository_state_from_path(directory.path()).expect("state");
        let branch_names = repository
            .branches(Some(BranchType::Local))
            .expect("branches")
            .filter_map(Result::ok)
            .filter_map(|(branch, _)| branch.name().ok().flatten().map(str::to_owned))
            .collect::<Vec<_>>();

        assert!(branch_names.iter().any(|name| name == "feature/us-001"));
        assert_eq!(state.current_branch.as_deref(), Some("feature/us-001"));
    }

    #[test]
    fn reports_staged_and_unstaged_changes_separately() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        let mut index = repository.index().expect("index");
        index
            .add_all(["*"], IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        repository
            .commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
            .expect("commit");
        repository.index().expect("index").write().expect("write index");

        fs::write(directory.path().join("tracked.txt"), "base\nworktree\n").expect("modify tracked");
        fs::write(directory.path().join("staged.txt"), "ready\n").expect("write staged");
        let mut index = repository.index().expect("index");
        index
            .add_path(Path::new("staged.txt"))
            .expect("stage new file");
        index.write().expect("write index");

        let state = repository_state_from_path(directory.path()).expect("state");

        assert_eq!(
            state.status.staged_changes,
            vec![ChangedFile {
                path: "staged.txt".to_string(),
                kind: ChangeKind::Added,
            }]
        );
        assert_eq!(
            state.status.unstaged_changes,
            vec![ChangedFile {
                path: "tracked.txt".to_string(),
                kind: ChangeKind::Modified,
            }]
        );
    }

    #[test]
    fn reports_renamed_and_deleted_files() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("rename-me.txt"), "rename\n").expect("write rename");
        fs::write(directory.path().join("delete-me.txt"), "delete\n").expect("write delete");

        let mut index = repository.index().expect("index");
        index
            .add_all(["*"], IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        repository
            .commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
            .expect("commit");
        repository.index().expect("index").write().expect("write index");

        fs::rename(
            directory.path().join("rename-me.txt"),
            directory.path().join("renamed.txt"),
        )
        .expect("rename file");
        let mut index = repository.index().expect("index");
        index
            .remove_path(Path::new("rename-me.txt"))
            .expect("remove old rename path");
        index.add_path(Path::new("renamed.txt")).expect("add renamed file");
        index
            .remove_path(Path::new("delete-me.txt"))
            .expect("remove deleted path");
        index.write().expect("write index");

        let state = repository_state_from_path(directory.path()).expect("state");

        assert!(
            state
                .status
                .staged_changes
                .iter()
                .any(|change| change.kind == ChangeKind::Renamed),
            "expected renamed file in {:?}",
            state.status.staged_changes
        );
        assert!(
            state.status.staged_changes.contains(&ChangedFile {
                path: "delete-me.txt".to_string(),
                kind: ChangeKind::Deleted,
            }),
            "expected deleted file in {:?}",
            state.status.staged_changes
        );
    }

    #[test]
    fn creates_commit_from_staged_changes_and_updates_history() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        let mut index = repository.index().expect("index");
        index
            .add_all(["*"], IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        repository
            .commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
            .expect("commit");

        repository
            .config()
            .expect("config")
            .set_str("user.name", "GitGud Tester")
            .expect("set user.name");
        repository
            .config()
            .expect("config")
            .set_str("user.email", "tester@example.com")
            .expect("set user.email");

        fs::write(directory.path().join("tracked.txt"), "base\nstaged\n").expect("modify tracked");
        let mut index = repository.index().expect("index");
        index
            .add_path(Path::new("tracked.txt"))
            .expect("stage tracked");
        index.write().expect("write index");

        create_commit_for_repository(&repository, "Save staged work").expect("create commit");

        let state = repository_state_from_path(directory.path()).expect("state");

        assert!(state.status.staged_changes.is_empty());
        assert!(state.recent_commits.len() >= 2);
        assert_eq!(state.recent_commits[0].summary, "Save staged work");
        assert_eq!(state.head_short_sha.as_deref(), Some(state.recent_commits[0].short_sha.as_str()));
    }

    #[test]
    fn rejects_commit_when_nothing_is_staged() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");

        repository
            .config()
            .expect("config")
            .set_str("user.name", "GitGud Tester")
            .expect("set user.name");
        repository
            .config()
            .expect("config")
            .set_str("user.email", "tester@example.com")
            .expect("set user.email");

        let error = create_commit_for_repository(&repository, "Empty commit").expect_err("expected error");

        assert!(error.contains("No hay cambios staged"));
    }
}
