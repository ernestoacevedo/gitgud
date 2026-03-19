# GitGud

GitGud is a desktop Git client built with Tauri, React, and Rust for everyday local repository workflows.

## Current Scope

GitGud currently supports:

- Opening an existing local Git repository from the native folder picker.
- Working with multiple repository tabs in the same session.
- Restoring previously opened repositories when the app is reopened.
- Refreshing repository state automatically on focus and on a timed interval.
- Viewing repository status split into `staged` and `unstaged` changes.
- Staging and unstaging files individually or in bulk.
- Creating commits from the UI.
- Viewing recent history as a lightweight commit graph.
- Inspecting commit metadata and changed files.
- Running `fetch`, `pull`, and `push`.
- Viewing the current branch and upstream ahead/behind status.

## Known Limitations

- GitGud only works with existing local repositories. It does not initialize or clone repositories.
- Remote synchronization uses the system `git` binary with `GIT_TERMINAL_PROMPT=0`, so interactive authentication flows are not handled inside the app.
- `pull` and `push` require a local branch with an upstream already configured.
- The visible history is intentionally limited to recent commits to keep the UI responsive.
- Commit detail depends on what Git can expose through the available diff. Empty commits or edge cases may show a notice instead of a file list.
- Conflict resolution, stash management, and repository creation are not included in the current version.
- Branch creation and checkout are implemented in the backend and covered by tests, but the current frontend does not yet expose a dedicated branch management flow.

## Expected UI Errors

Most workflow errors are surfaced through inline feedback in the main view or the affected panel, including:

- Opening a folder that is not a valid Git repository.
- Failing to refresh repository state.
- Stage or unstage failures.
- Commit rejection due to missing Git identity, an empty message, or no staged changes.
- Remote operations failing because of missing remotes, missing upstream configuration, authentication issues, or sync errors.

## Suggested Manual Validation

Use a test repository with at least one reachable remote.

1. Open repository: select a valid Git folder and confirm the name, path, branch, status, and recent history load correctly. Then try a non-Git folder and verify the error message.
2. Multi-tab workflow: open more than one repository, switch tabs, close and reopen the app, and confirm the repositories are restored.
3. Individual stage: modify a tracked file, use the UI action to stage it, and confirm it moves from `Unstaged` to `Staged`.
4. Individual unstage: unstage the same file and confirm it returns to `Unstaged`.
5. Bulk stage: leave multiple visible changes and use `Stage all`; all files should move to `Staged`.
6. Bulk unstage: with several staged changes, use `Unstage all`; all files should move back to `Unstaged`.
7. Commit: create a commit from staged changes and confirm it appears at the top of history and the working tree becomes clean.
8. Working tree detail: select the working tree entry and confirm staged and unstaged sections reflect the current repository state.
9. Commit detail: select a commit and validate its metadata, parents, and changed files.
10. Fetch: create a remote commit from another clone, run `Fetch`, and confirm the ahead/behind status updates.
11. Pull: with remote changes available, run `Pull` and confirm local history updates.
12. Push: create a local commit, run `Push`, and confirm the ahead count returns to `0`.

## Development

Requirements:

- Node.js
- Rust
- Tauri system dependencies for your operating system
- Git available in `PATH`

Main commands:

```bash
npm install
npm run tauri dev
```

Verified in this repository:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```
