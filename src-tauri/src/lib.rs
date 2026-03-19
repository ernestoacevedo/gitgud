use git2::{
    BranchType, Commit, Delta, DiffOptions, IndexAddOption, Repository, Signature, Status,
    StatusOptions,
};
use serde::Serialize;
use std::path::Path;
use std::process::Command;

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
    local_branches: Vec<String>,
    upstream_status: Option<UpstreamStatus>,
    head_short_sha: Option<String>,
    is_bare: bool,
    status: RepositoryStatus,
    recent_commits: Vec<CommitSummary>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct UpstreamStatus {
    remote_name: String,
    branch_name: String,
    ahead: usize,
    behind: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CommitSummary {
    full_sha: String,
    short_sha: String,
    summary: String,
    author_name: String,
    authored_at: i64,
    lane: usize,
    parent_lanes: Vec<usize>,
    visible_lane_count: usize,
    is_head: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CommitDetail {
    full_sha: String,
    short_sha: String,
    summary: String,
    message: String,
    author_name: String,
    author_email: Option<String>,
    authored_at: i64,
    committer_name: String,
    committer_email: Option<String>,
    committed_at: i64,
    parent_shas: Vec<String>,
    file_changes: Vec<CommitFileChange>,
    file_list_notice: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CommitFileChange {
    path: String,
    previous_path: Option<String>,
    kind: ChangeKind,
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

fn local_branch_names(repository: &Repository) -> Result<Vec<String>, String> {
    let mut branches = repository
        .branches(Some(BranchType::Local))
        .map_err(|error| format!("No fue posible listar las ramas locales: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|(branch, _)| branch.name().ok().flatten().map(str::to_owned))
        .collect::<Vec<_>>();

    branches.sort();
    Ok(branches)
}

fn upstream_status(repository: &Repository) -> Result<Option<UpstreamStatus>, String> {
    let Some(current_branch) = current_branch_name(repository) else {
        return Ok(None);
    };

    let branch = match repository.find_branch(&current_branch, BranchType::Local) {
        Ok(branch) => branch,
        Err(error) => {
            return Err(format!(
                "No fue posible cargar la rama local \"{current_branch}\": {error}"
            ))
        }
    };
    let upstream = match branch.upstream() {
        Ok(upstream) => upstream,
        Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
            "No fue posible cargar la rama remota configurada para \"{current_branch}\": {error}"
        ))
        }
    };

    let local_oid = branch
        .get()
        .target()
        .ok_or_else(|| format!("La rama local \"{current_branch}\" no apunta a ningun commit."))?;
    let upstream_oid = upstream.get().target().ok_or_else(|| {
        format!("La rama remota configurada para \"{current_branch}\" no apunta a ningun commit.")
    })?;
    let (ahead, behind) = repository
        .graph_ahead_behind(local_oid, upstream_oid)
        .map_err(|error| {
            format!("No fue posible comparar la rama local con su upstream: {error}")
        })?;
    let branch_name = upstream
        .name()
        .ok()
        .flatten()
        .and_then(|reference| reference.strip_prefix("refs/remotes/"))
        .map(str::to_owned)
        .or_else(|| upstream.name().ok().flatten().map(str::to_owned))
        .unwrap_or_else(|| "upstream desconocido".to_string());
    let remote_name = branch_name
        .split('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("remoto")
        .to_string();

    Ok(Some(UpstreamStatus {
        remote_name,
        branch_name,
        ahead,
        behind,
    }))
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

fn display_signature_name(signature: &git2::Signature<'_>, fallback: &str) -> String {
    signature
        .name()
        .map(str::to_owned)
        .unwrap_or_else(|| fallback.to_string())
}

fn short_oid(oid: git2::Oid) -> String {
    oid.to_string().chars().take(7).collect()
}

fn map_delta_change(status: Delta) -> Option<ChangeKind> {
    match status {
        Delta::Added => Some(ChangeKind::Added),
        Delta::Modified => Some(ChangeKind::Modified),
        Delta::Deleted => Some(ChangeKind::Deleted),
        Delta::Renamed => Some(ChangeKind::Renamed),
        Delta::Typechange => Some(ChangeKind::Typechange),
        Delta::Conflicted => Some(ChangeKind::Conflicted),
        _ => None,
    }
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

fn open_repository_for_command(path: &str) -> Result<Repository, String> {
    Repository::open(Path::new(path)).map_err(|error| {
        format!("La carpeta seleccionada no contiene un repositorio Git valido: {error}")
    })
}

fn stage_file_in_repository(repository: &Repository, file_path: &str) -> Result<(), String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("Debes indicar un archivo valido para hacer stage.".to_string());
    }

    let status = repository
        .status_file(Path::new(trimmed_path))
        .map_err(|error| format!("No fue posible leer el estado de \"{trimmed_path}\": {error}"))?;
    let mut index = repository
        .index()
        .map_err(|error| format!("No fue posible abrir el index del repositorio: {error}"))?;

    if status.is_wt_deleted() {
        index
            .remove_path(Path::new(trimmed_path))
            .map_err(|error| {
                format!("No fue posible hacer stage de \"{trimmed_path}\": {error}")
            })?;
    } else {
        index.add_path(Path::new(trimmed_path)).map_err(|error| {
            format!("No fue posible hacer stage de \"{trimmed_path}\": {error}")
        })?;
    }

    index
        .write()
        .map_err(|error| format!("No fue posible escribir el index del repositorio: {error}"))?;

    Ok(())
}

fn stage_all_files_in_repository(repository: &Repository) -> Result<(), String> {
    let mut index = repository
        .index()
        .map_err(|error| format!("No fue posible abrir el index del repositorio: {error}"))?;
    index
        .add_all(["*"], IndexAddOption::DEFAULT, None)
        .map_err(|error| {
            format!("No fue posible hacer stage de todos los cambios visibles: {error}")
        })?;
    index
        .write()
        .map_err(|error| format!("No fue posible escribir el index del repositorio: {error}"))?;

    Ok(())
}

fn unstage_paths_in_repository(repository: &Repository, paths: &[&Path]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let head_object = repository
        .head()
        .ok()
        .and_then(|head| head.peel(git2::ObjectType::Commit).ok());

    if let Some(head_object) = head_object.as_ref() {
        repository
            .reset_default(Some(head_object), paths.iter().copied())
            .map_err(|error| format!("No fue posible sacar archivos del area de stage: {error}"))?;
        return Ok(());
    }

    let mut index = repository
        .index()
        .map_err(|error| format!("No fue posible abrir el index del repositorio: {error}"))?;
    for path in paths {
        index.remove_path(path).map_err(|error| {
            format!(
                "No fue posible sacar \"{}\" del area de stage: {error}",
                path.display()
            )
        })?;
    }
    index
        .write()
        .map_err(|error| format!("No fue posible escribir el index del repositorio: {error}"))
}

fn unstage_file_in_repository(repository: &Repository, file_path: &str) -> Result<(), String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("Debes indicar un archivo valido para sacar del stage.".to_string());
    }

    let target = Path::new(trimmed_path);
    unstage_paths_in_repository(repository, &[target])
}

fn unstage_all_files_in_repository(repository: &Repository) -> Result<(), String> {
    let status = repository_status(repository)?;
    let staged_paths = status
        .staged_changes
        .iter()
        .map(|change| Path::new(change.path.as_str()))
        .collect::<Vec<_>>();

    unstage_paths_in_repository(repository, &staged_paths)
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

    revwalk
        .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(|error| format!("No fue posible ordenar el historial del repositorio: {error}"))?;

    let head_oid = repository.head().ok().and_then(|head| head.target());
    let mut commits = Vec::new();
    let mut active_lanes = Vec::new();

    for oid in revwalk.take(20) {
        let oid = oid.map_err(|error| {
            format!("No fue posible recorrer el historial del repositorio: {error}")
        })?;
        let commit = repository
            .find_commit(oid)
            .map_err(|error| format!("No fue posible cargar un commit del historial: {error}"))?;
        let lane = active_lanes
            .iter()
            .position(|active_oid| *active_oid == oid)
            .unwrap_or_else(|| {
                active_lanes.push(oid);
                active_lanes.len() - 1
            });
        let parent_ids = commit.parent_ids().collect::<Vec<_>>();
        let active_lane_count = active_lanes.len();
        let mut next_active_lanes = active_lanes.clone();

        if parent_ids.is_empty() {
            next_active_lanes.remove(lane);
        } else {
            next_active_lanes[lane] = parent_ids[0];

            for (offset, parent_id) in parent_ids.iter().skip(1).enumerate() {
                if let Some(existing_index) = next_active_lanes
                    .iter()
                    .position(|active_oid| active_oid == parent_id)
                {
                    if existing_index != lane {
                        next_active_lanes.remove(existing_index);
                    }
                }

                next_active_lanes.insert(lane + offset + 1, *parent_id);
            }
        }

        let mut deduped_lanes = Vec::with_capacity(next_active_lanes.len());
        for active_oid in next_active_lanes {
            if !deduped_lanes.contains(&active_oid) {
                deduped_lanes.push(active_oid);
            }
        }

        let parent_lanes = parent_ids
            .iter()
            .filter_map(|parent_id| {
                deduped_lanes
                    .iter()
                    .position(|active_oid| active_oid == parent_id)
            })
            .collect::<Vec<_>>();
        let visible_lane_count = active_lane_count
            .max(deduped_lanes.len())
            .max(
                parent_lanes
                    .iter()
                    .copied()
                    .max()
                    .map_or(0, |max_lane| max_lane + 1),
            )
            .max(lane + 1);

        commits.push(CommitSummary {
            full_sha: commit.id().to_string(),
            short_sha: short_oid(commit.id()),
            summary: display_commit_summary(&commit),
            author_name: display_author_name(&commit),
            authored_at: commit.time().seconds(),
            lane,
            parent_lanes,
            visible_lane_count,
            is_head: head_oid == Some(commit.id()),
        });

        active_lanes = deduped_lanes;
    }

    Ok(commits)
}

fn commit_detail(repository: &Repository, revision: &str) -> Result<CommitDetail, String> {
    let object = repository
        .revparse_single(revision)
        .map_err(|error| format!("No fue posible resolver el commit seleccionado: {error}"))?;
    let commit = object
        .peel_to_commit()
        .map_err(|error| format!("No fue posible cargar el commit seleccionado: {error}"))?;
    let tree = commit.tree().map_err(|error| {
        format!("No fue posible leer el arbol del commit seleccionado: {error}")
    })?;
    let parent_tree = match commit.parent_count() {
        0 => None,
        _ => Some(
            commit
                .parent(0)
                .and_then(|parent| parent.tree())
                .map_err(|error| {
                    format!("No fue posible leer el padre del commit seleccionado: {error}")
                })?,
        ),
    };
    let mut diff_options = DiffOptions::new();
    diff_options.include_typechange(true);
    let diff = repository
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_options))
        .map_err(|error| {
            format!("No fue posible leer los archivos cambiados del commit: {error}")
        })?;

    let mut file_changes = Vec::new();
    for delta in diff.deltas() {
        let Some(kind) = map_delta_change(delta.status()) else {
            continue;
        };

        let old_path = delta
            .old_file()
            .path()
            .map(|path| path.display().to_string());
        let new_path = delta
            .new_file()
            .path()
            .map(|path| path.display().to_string());
        let path = match (&new_path, &old_path) {
            (Some(path), _) if !path.is_empty() => path.clone(),
            (_, Some(path)) if !path.is_empty() => path.clone(),
            _ => continue,
        };
        let previous_path = match kind {
            ChangeKind::Renamed if old_path.as_deref() != Some(path.as_str()) => old_path,
            _ => None,
        };

        file_changes.push(CommitFileChange {
            path,
            previous_path,
            kind,
        });
    }

    file_changes.sort_by(|left, right| left.path.cmp(&right.path));

    let file_list_notice = if file_changes.is_empty() {
        Some(
            "Git no expuso archivos visibles para este commit. Puede tratarse de un commit vacio o de una limitacion del diff disponible."
                .to_string(),
        )
    } else {
        None
    };

    let author = commit.author();
    let committer = commit.committer();

    Ok(CommitDetail {
        full_sha: commit.id().to_string(),
        short_sha: short_oid(commit.id()),
        summary: display_commit_summary(&commit),
        message: commit.message().unwrap_or("Commit sin mensaje").to_string(),
        author_name: display_signature_name(&author, "Autor desconocido"),
        author_email: author.email().map(str::to_owned),
        authored_at: author.when().seconds(),
        committer_name: display_signature_name(&committer, "Committer desconocido"),
        committer_email: committer.email().map(str::to_owned),
        committed_at: committer.when().seconds(),
        parent_shas: commit.parent_ids().map(short_oid).collect(),
        file_changes,
        file_list_notice,
    })
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

    let parent_commit = repository
        .head()
        .ok()
        .and_then(|head| head.peel_to_commit().ok());
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

fn ensure_valid_branch_name(name: &str) -> Result<String, String> {
    let trimmed_name = name.trim();

    if trimmed_name.is_empty() {
        return Err("Debes ingresar un nombre para la nueva rama.".to_string());
    }

    let is_valid = git2::Branch::name_is_valid(trimmed_name)
        .map_err(|error| format!("No fue posible validar el nombre de la rama: {error}"))?;
    if !is_valid {
        return Err("Debes ingresar un nombre de rama valido para Git.".to_string());
    }

    Ok(trimmed_name.to_string())
}

fn ensure_has_remote(repository: &Repository) -> Result<(), String> {
    let remotes = repository
        .remotes()
        .map_err(|error| format!("No fue posible listar los remotos configurados: {error}"))?;

    if remotes.is_empty() {
        return Err(
            "El repositorio no tiene remotos configurados. Agrega un remoto, por ejemplo \"origin\", antes de sincronizar."
                .to_string(),
        );
    }

    Ok(())
}

fn tracked_branch_for_repository(repository: &Repository) -> Result<(String, String), String> {
    let current_branch = current_branch_name(repository).ok_or_else(|| {
        "Debes estar en una rama local para ejecutar esta sincronizacion.".to_string()
    })?;
    let branch = repository
        .find_branch(&current_branch, BranchType::Local)
        .map_err(|error| {
            format!("No fue posible cargar la rama local \"{current_branch}\": {error}")
        })?;
    let upstream = branch.upstream().map_err(|error| {
        if error.code() == git2::ErrorCode::NotFound {
            format!(
                "La rama \"{current_branch}\" no tiene upstream configurado. Configurala antes de usar pull o push desde la app."
            )
        } else {
            format!(
                "No fue posible cargar la rama remota configurada para \"{current_branch}\": {error}"
            )
        }
    })?;
    let upstream_name = upstream
        .name()
        .ok()
        .flatten()
        .map(str::to_owned)
        .unwrap_or_else(|| "upstream desconocido".to_string());

    Ok((current_branch, upstream_name))
}

#[derive(Clone, Copy)]
enum RemoteOperation {
    Fetch,
    Pull,
    Push,
}

impl RemoteOperation {
    fn as_git_subcommand(self) -> &'static str {
        match self {
            Self::Fetch => "fetch",
            Self::Pull => "pull",
            Self::Push => "push",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::Fetch => "fetch",
            Self::Pull => "pull",
            Self::Push => "push",
        }
    }
}

fn execute_remote_operation(
    repository: &Repository,
    operation: RemoteOperation,
) -> Result<(), String> {
    ensure_has_remote(repository)?;

    if matches!(operation, RemoteOperation::Pull | RemoteOperation::Push) {
        tracked_branch_for_repository(repository)?;
    }

    let command_path = repository
        .workdir()
        .unwrap_or_else(|| repository.path())
        .to_path_buf();
    let output = Command::new("git")
        .arg("-C")
        .arg(&command_path)
        .arg(operation.as_git_subcommand())
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| {
            format!(
                "No fue posible ejecutar {} con el cliente Git del sistema: {error}",
                operation.display_name()
            )
        })?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let details = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "Git devolvio un error sin detalles.".to_string()
    };

    Err(format!(
        "Git no pudo ejecutar {}. Revisa la autenticacion, el remoto configurado y el estado de tu rama. Detalle: {}",
        operation.display_name(),
        details
    ))
}

fn checkout_local_branch_for_repository(
    repository: &Repository,
    branch_name: &str,
) -> Result<(), String> {
    let branch = repository
        .find_branch(branch_name, BranchType::Local)
        .map_err(|error| {
            format!("No fue posible encontrar la rama local \"{branch_name}\": {error}")
        })?;
    let reference = branch.into_reference();
    let reference_name = reference
        .name()
        .ok_or_else(|| {
            format!("No fue posible resolver la referencia de la rama \"{branch_name}\".")
        })?
        .to_string();
    let object = reference
        .peel(git2::ObjectType::Commit)
        .map_err(|error| format!("No fue posible cargar la rama \"{branch_name}\": {error}"))?;

    repository
        .checkout_tree(&object, None)
        .map_err(|error| format!("Git rechazo el checkout de \"{branch_name}\": {error}"))?;
    repository
        .set_head(&reference_name)
        .map_err(|error| format!("No fue posible actualizar HEAD a \"{branch_name}\": {error}"))?;

    Ok(())
}

fn create_branch_for_repository(repository: &Repository, branch_name: &str) -> Result<(), String> {
    let valid_branch_name = ensure_valid_branch_name(branch_name)?;

    if repository
        .find_branch(&valid_branch_name, BranchType::Local)
        .is_ok()
    {
        return Err(format!("La rama \"{valid_branch_name}\" ya existe."));
    }

    let head_commit = repository
        .head()
        .and_then(|head| head.peel_to_commit())
        .map_err(|error| {
            format!("No fue posible crear la rama \"{valid_branch_name}\": {error}")
        })?;

    repository
        .branch(&valid_branch_name, &head_commit, false)
        .map_err(|error| {
            format!("Git rechazo la creacion de la rama \"{valid_branch_name}\": {error}")
        })?;

    checkout_local_branch_for_repository(repository, &valid_branch_name)
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
        local_branches: local_branch_names(&repository)?,
        upstream_status: upstream_status(&repository)?,
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
    let repository = open_repository_for_command(&path)?;
    create_commit_for_repository(&repository, &message)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn checkout_branch(path: String, branch_name: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    checkout_local_branch_for_repository(&repository, &branch_name)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn create_branch(path: String, branch_name: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    create_branch_for_repository(&repository, &branch_name)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn fetch_remote(path: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    execute_remote_operation(&repository, RemoteOperation::Fetch)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn pull_remote(path: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    execute_remote_operation(&repository, RemoteOperation::Pull)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn push_remote(path: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    execute_remote_operation(&repository, RemoteOperation::Push)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn read_commit_detail(path: String, commit_sha: String) -> Result<CommitDetail, String> {
    let repository = open_repository_for_command(&path)?;
    commit_detail(&repository, &commit_sha)
}

#[tauri::command]
fn stage_file(path: String, file_path: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    stage_file_in_repository(&repository, &file_path)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn unstage_file(path: String, file_path: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    unstage_file_in_repository(&repository, &file_path)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn stage_all_files(path: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    stage_all_files_in_repository(&repository)?;
    repository_state_from_path(Path::new(&path))
}

#[tauri::command]
fn unstage_all_files(path: String) -> Result<RepositoryState, String> {
    let repository = open_repository_for_command(&path)?;
    unstage_all_files_in_repository(&repository)?;
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
            stage_file,
            unstage_file,
            stage_all_files,
            unstage_all_files,
            create_commit,
            checkout_branch,
            create_branch,
            fetch_remote,
            pull_remote,
            push_remote,
            read_commit_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        checkout_local_branch_for_repository, commit_detail, create_branch_for_repository,
        create_commit_for_repository, ensure_valid_branch_name, execute_remote_operation,
        repository_state_from_path, stage_all_files_in_repository, stage_file_in_repository,
        unstage_all_files_in_repository, unstage_file_in_repository, ChangeKind, ChangedFile,
        RemoteOperation,
    };
    use git2::{BranchType, IndexAddOption, Repository, Signature};
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use tempfile::tempdir;

    fn commit_all(repository: &Repository, signature: &Signature<'_>, message: &str) -> git2::Oid {
        let mut index = repository.index().expect("index");
        index
            .add_all(["*"], IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("find tree");
        let parent_commit = repository
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok());
        let parent_refs = parent_commit.iter().collect::<Vec<_>>();

        repository
            .commit(
                Some("HEAD"),
                signature,
                signature,
                message,
                &tree,
                &parent_refs,
            )
            .expect("commit")
    }

    fn run_git(args: &[&str], workdir: &Path) {
        let output = Command::new("git")
            .arg("-C")
            .arg(workdir)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .expect("run git");

        if !output.status.success() {
            panic!(
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    fn clone_repository(remote_path: &Path, clone_path: &Path) -> Repository {
        let remote = remote_path.display().to_string();
        run_git(
            &["clone", &remote, &clone_path.display().to_string()],
            remote_path.parent().expect("parent"),
        );
        Repository::open(clone_path).expect("open clone")
    }

    fn configure_identity(repository_path: &Path) {
        run_git(&["config", "user.name", "GitGud Tester"], repository_path);
        run_git(
            &["config", "user.email", "tester@example.com"],
            repository_path,
        );
    }

    #[test]
    fn loads_repository_state_for_valid_repo() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("README.md"), "# GitGud\n").expect("write readme");
        commit_all(&repository, &signature, "Initial commit");
        repository
            .index()
            .expect("index")
            .write()
            .expect("write index");

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
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "content").expect("write file");
        let commit_id = commit_all(&repository, &signature, "init");
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
        assert!(state
            .local_branches
            .iter()
            .any(|name| name == "feature/us-001"));
    }

    #[test]
    fn validates_branch_names_before_creating_them() {
        assert_eq!(
            ensure_valid_branch_name(" feature/us-007 ").expect("valid branch"),
            "feature/us-007"
        );
        assert!(ensure_valid_branch_name("").is_err());
        assert!(ensure_valid_branch_name("with spaces").is_err());
    }

    #[test]
    fn creates_and_checks_out_a_new_local_branch() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        commit_all(&repository, &signature, "init");

        create_branch_for_repository(&repository, "feature/us-007").expect("create branch");

        let state = repository_state_from_path(directory.path()).expect("state");

        assert_eq!(state.current_branch.as_deref(), Some("feature/us-007"));
        assert!(state
            .local_branches
            .iter()
            .any(|name| name == "feature/us-007"));
    }

    #[test]
    fn checks_out_existing_local_branch() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        let commit_id = commit_all(&repository, &signature, "init");
        let commit = repository.find_commit(commit_id).expect("find commit");
        repository
            .branch("feature/existing", &commit, false)
            .expect("create branch");

        checkout_local_branch_for_repository(&repository, "feature/existing")
            .expect("checkout branch");

        let state = repository_state_from_path(directory.path()).expect("state");

        assert_eq!(state.current_branch.as_deref(), Some("feature/existing"));
    }

    #[test]
    fn reports_checkout_errors_without_hiding_repository_state() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        let commit_id = commit_all(&repository, &signature, "init");
        let commit = repository.find_commit(commit_id).expect("find commit");
        repository
            .branch("feature/conflict", &commit, false)
            .expect("create branch");
        checkout_local_branch_for_repository(&repository, "feature/conflict")
            .expect("checkout feature");
        fs::write(directory.path().join("tracked.txt"), "branch change\n").expect("branch change");
        commit_all(&repository, &signature, "branch commit");

        fs::write(directory.path().join("tracked.txt"), "dirty worktree\n")
            .expect("dirty worktree");

        let error = checkout_local_branch_for_repository(&repository, "master")
            .expect_err("expected checkout error");

        assert!(error.contains("checkout"));
        assert_eq!(
            repository_state_from_path(directory.path())
                .expect("state")
                .current_branch
                .as_deref(),
            Some("feature/conflict")
        );
    }

    #[test]
    fn reports_staged_and_unstaged_changes_separately() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        commit_all(&repository, &signature, "init");
        repository
            .index()
            .expect("index")
            .write()
            .expect("write index");

        fs::write(directory.path().join("tracked.txt"), "base\nworktree\n")
            .expect("modify tracked");
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
    fn stages_and_unstages_individual_files() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        commit_all(&repository, &signature, "init");

        fs::write(directory.path().join("tracked.txt"), "base\nworktree\n")
            .expect("modify tracked");

        stage_file_in_repository(&repository, "tracked.txt").expect("stage file");
        let staged_state = repository_state_from_path(directory.path()).expect("state after stage");
        assert!(staged_state.status.unstaged_changes.is_empty());
        assert!(staged_state.status.staged_changes.contains(&ChangedFile {
            path: "tracked.txt".to_string(),
            kind: ChangeKind::Modified,
        }));

        unstage_file_in_repository(&repository, "tracked.txt").expect("unstage file");
        let unstaged_state =
            repository_state_from_path(directory.path()).expect("state after unstage");
        assert!(unstaged_state.status.staged_changes.is_empty());
        assert!(unstaged_state
            .status
            .unstaged_changes
            .contains(&ChangedFile {
                path: "tracked.txt".to_string(),
                kind: ChangeKind::Modified,
            }));
    }

    #[test]
    fn stages_and_unstages_all_visible_changes() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        commit_all(&repository, &signature, "init");

        fs::write(directory.path().join("tracked.txt"), "base\nupdated\n").expect("update tracked");
        fs::write(directory.path().join("added.txt"), "new file\n").expect("write added");

        stage_all_files_in_repository(&repository).expect("stage all");
        let staged_state = repository_state_from_path(directory.path()).expect("staged state");
        assert_eq!(staged_state.status.unstaged_changes.len(), 0);
        assert_eq!(staged_state.status.staged_changes.len(), 2);

        unstage_all_files_in_repository(&repository).expect("unstage all");
        let unstaged_state = repository_state_from_path(directory.path()).expect("unstaged state");
        assert_eq!(unstaged_state.status.staged_changes.len(), 0);
        assert_eq!(unstaged_state.status.unstaged_changes.len(), 2);
    }

    #[test]
    fn validates_stage_and_unstage_targets() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");

        let stage_error = stage_file_in_repository(&repository, " ").expect_err("stage error");
        let unstage_error =
            unstage_file_in_repository(&repository, " ").expect_err("unstage error");

        assert!(stage_error.contains("archivo valido"));
        assert!(unstage_error.contains("archivo valido"));
    }

    #[test]
    fn reports_renamed_and_deleted_files() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("rename-me.txt"), "rename\n").expect("write rename");
        fs::write(directory.path().join("delete-me.txt"), "delete\n").expect("write delete");

        commit_all(&repository, &signature, "init");
        repository
            .index()
            .expect("index")
            .write()
            .expect("write index");

        fs::rename(
            directory.path().join("rename-me.txt"),
            directory.path().join("renamed.txt"),
        )
        .expect("rename file");
        let mut index = repository.index().expect("index");
        index
            .remove_path(Path::new("rename-me.txt"))
            .expect("remove old rename path");
        index
            .add_path(Path::new("renamed.txt"))
            .expect("add renamed file");
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
        commit_all(&repository, &signature, "init");

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
        assert_eq!(
            state.head_short_sha.as_deref(),
            Some(state.recent_commits[0].short_sha.as_str())
        );
        assert_eq!(
            state.recent_commits[0].full_sha,
            repository
                .head()
                .expect("head")
                .target()
                .expect("head target")
                .to_string()
        );
        assert!(state.recent_commits[0].is_head);
    }

    #[test]
    fn includes_graph_metadata_for_merge_commits() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("shared.txt"), "base\n").expect("write base");
        let base_commit_id = commit_all(&repository, &signature, "base");
        let base_commit = repository.find_commit(base_commit_id).expect("base commit");

        repository
            .branch("feature/graph", &base_commit, false)
            .expect("branch");

        fs::write(directory.path().join("main.txt"), "main\n").expect("write main");
        let main_commit_id = commit_all(&repository, &signature, "main change");
        let main_commit = repository.find_commit(main_commit_id).expect("main commit");

        repository
            .set_head("refs/heads/feature/graph")
            .expect("set feature head");
        repository
            .checkout_head(None)
            .expect("checkout feature head");
        fs::write(directory.path().join("feature.txt"), "feature\n").expect("write feature");
        let feature_commit_id = commit_all(&repository, &signature, "feature change");
        let feature_commit = repository
            .find_commit(feature_commit_id)
            .expect("feature commit");

        repository
            .set_head("refs/heads/master")
            .expect("set master head");
        repository
            .checkout_head(None)
            .expect("checkout master head");

        let mut index = repository.index().expect("index");
        index
            .add_all(["*"], IndexAddOption::DEFAULT, None)
            .expect("add all");
        index.write().expect("write index");
        let tree_id = index.write_tree().expect("write tree");
        let tree = repository.find_tree(tree_id).expect("tree");

        repository
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "merge feature",
                &tree,
                &[&main_commit, &feature_commit],
            )
            .expect("merge commit");

        let state = repository_state_from_path(directory.path()).expect("state");
        let merge_commit = &state.recent_commits[0];

        assert_eq!(merge_commit.summary, "merge feature");
        assert!(merge_commit.is_head);
        assert_eq!(merge_commit.parent_lanes.len(), 2);
        assert!(merge_commit.visible_lane_count >= 2);
        assert!(state
            .recent_commits
            .iter()
            .skip(1)
            .any(|commit| commit.short_sha == short_sha(feature_commit_id)));
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

        let error =
            create_commit_for_repository(&repository, "Empty commit").expect_err("expected error");

        assert!(error.contains("No hay cambios staged"));
    }

    #[test]
    fn reads_commit_detail_with_changed_files_and_metadata() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        fs::write(directory.path().join("tracked.txt"), "base\n").expect("write tracked");
        commit_all(&repository, &signature, "base commit");

        fs::write(directory.path().join("tracked.txt"), "base\nupdated\n").expect("update tracked");
        fs::write(directory.path().join("added.txt"), "new\n").expect("write added");
        let mut index = repository.index().expect("index");
        index
            .add_path(Path::new("tracked.txt"))
            .expect("stage tracked");
        index.add_path(Path::new("added.txt")).expect("stage added");
        index.write().expect("write index");

        let commit_id = commit_all(&repository, &signature, "detail commit");
        let detail = commit_detail(&repository, &short_sha(commit_id)).expect("detail");

        assert_eq!(detail.short_sha, short_sha(commit_id));
        assert_eq!(detail.summary, "detail commit");
        assert_eq!(detail.author_name, "GitGud");
        assert_eq!(detail.author_email.as_deref(), Some("gitgud@example.com"));
        assert_eq!(detail.parent_shas.len(), 1);
        assert!(detail.file_changes.contains(&super::CommitFileChange {
            path: "added.txt".to_string(),
            previous_path: None,
            kind: ChangeKind::Added,
        }));
        assert!(detail.file_changes.contains(&super::CommitFileChange {
            path: "tracked.txt".to_string(),
            previous_path: None,
            kind: ChangeKind::Modified,
        }));
        assert!(detail.file_list_notice.is_none());
    }

    #[test]
    fn reports_clear_notice_when_commit_has_no_visible_files() {
        let directory = tempdir().expect("tempdir");
        let repository = Repository::init(directory.path()).expect("repo init");
        let signature = Signature::now("GitGud", "gitgud@example.com").expect("signature");

        let tree_id = repository
            .index()
            .expect("index")
            .write_tree()
            .expect("write tree");
        let tree = repository.find_tree(tree_id).expect("tree");
        let commit_id = repository
            .commit(Some("HEAD"), &signature, &signature, "empty", &tree, &[])
            .expect("empty commit");

        let detail = commit_detail(&repository, &short_sha(commit_id)).expect("detail");

        assert!(detail.file_changes.is_empty());
        assert!(detail.file_list_notice.is_some());
    }

    #[test]
    fn fetch_updates_upstream_ahead_behind_counts() {
        let remote_dir = tempdir().expect("remote tempdir");
        let local_dir = tempdir().expect("local tempdir");
        let peer_dir = tempdir().expect("peer tempdir");

        let remote_repository = Repository::init_bare(remote_dir.path()).expect("init bare");
        drop(remote_repository);

        let local_path = local_dir.path().join("local");
        let peer_path = peer_dir.path().join("peer");
        let local_repository = clone_repository(remote_dir.path(), &local_path);
        configure_identity(&local_path);

        fs::write(local_path.join("tracked.txt"), "base\n").expect("write local");
        run_git(&["add", "tracked.txt"], &local_path);
        run_git(&["commit", "-m", "base"], &local_path);
        run_git(&["push", "-u", "origin", "master"], &local_path);

        let peer_repository = clone_repository(remote_dir.path(), &peer_path);
        configure_identity(&peer_path);
        fs::write(peer_path.join("remote.txt"), "remote change\n").expect("write peer");
        run_git(&["add", "remote.txt"], &peer_path);
        run_git(&["commit", "-m", "remote update"], &peer_path);
        run_git(&["push"], &peer_path);
        drop(peer_repository);

        execute_remote_operation(&local_repository, RemoteOperation::Fetch).expect("fetch");

        let state = repository_state_from_path(&local_path).expect("state");
        let upstream = state.upstream_status.expect("upstream status");

        assert_eq!(upstream.remote_name, "origin");
        assert_eq!(upstream.branch_name, "origin/master");
        assert_eq!(upstream.ahead, 0);
        assert_eq!(upstream.behind, 1);
    }

    #[test]
    fn pull_updates_local_history_after_remote_change() {
        let remote_dir = tempdir().expect("remote tempdir");
        let local_dir = tempdir().expect("local tempdir");
        let peer_dir = tempdir().expect("peer tempdir");

        let remote_repository = Repository::init_bare(remote_dir.path()).expect("init bare");
        drop(remote_repository);

        let local_path = local_dir.path().join("local");
        let peer_path = peer_dir.path().join("peer");
        let local_repository = clone_repository(remote_dir.path(), &local_path);
        configure_identity(&local_path);

        fs::write(local_path.join("tracked.txt"), "base\n").expect("write local");
        run_git(&["add", "tracked.txt"], &local_path);
        run_git(&["commit", "-m", "base"], &local_path);
        run_git(&["push", "-u", "origin", "master"], &local_path);

        let peer_repository = clone_repository(remote_dir.path(), &peer_path);
        configure_identity(&peer_path);
        fs::write(peer_path.join("tracked.txt"), "base\nremote update\n").expect("write peer");
        run_git(&["add", "tracked.txt"], &peer_path);
        run_git(&["commit", "-m", "remote update"], &peer_path);
        run_git(&["push"], &peer_path);
        drop(peer_repository);

        execute_remote_operation(&local_repository, RemoteOperation::Pull).expect("pull");

        let state = repository_state_from_path(&local_path).expect("state");
        let upstream = state.upstream_status.expect("upstream status");

        assert_eq!(state.recent_commits[0].summary, "remote update");
        assert_eq!(upstream.ahead, 0);
        assert_eq!(upstream.behind, 0);
        assert!(state.status.staged_changes.is_empty());
        assert!(state.status.unstaged_changes.is_empty());
    }

    #[test]
    fn push_updates_upstream_after_local_commit() {
        let remote_dir = tempdir().expect("remote tempdir");
        let local_dir = tempdir().expect("local tempdir");

        let remote_repository = Repository::init_bare(remote_dir.path()).expect("init bare");
        drop(remote_repository);

        let local_path = local_dir.path().join("local");
        let local_repository = clone_repository(remote_dir.path(), &local_path);
        configure_identity(&local_path);

        fs::write(local_path.join("tracked.txt"), "base\n").expect("write local");
        run_git(&["add", "tracked.txt"], &local_path);
        run_git(&["commit", "-m", "base"], &local_path);
        run_git(&["push", "-u", "origin", "master"], &local_path);

        fs::write(local_path.join("tracked.txt"), "base\nlocal update\n").expect("update local");
        run_git(&["add", "tracked.txt"], &local_path);
        run_git(&["commit", "-m", "local update"], &local_path);

        let state_before_push = repository_state_from_path(&local_path).expect("state before push");
        assert_eq!(
            state_before_push.upstream_status.expect("upstream").ahead,
            1
        );

        execute_remote_operation(&local_repository, RemoteOperation::Push).expect("push");

        let state = repository_state_from_path(&local_path).expect("state after push");
        let upstream = state.upstream_status.expect("upstream status");

        assert_eq!(state.recent_commits[0].summary, "local update");
        assert_eq!(upstream.ahead, 0);
        assert_eq!(upstream.behind, 0);
    }

    fn short_sha(oid: git2::Oid) -> String {
        oid.to_string().chars().take(7).collect()
    }
}
