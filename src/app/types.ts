export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "typechange"
  | "conflicted";

export type ChangedFile = {
  path: string;
  kind: ChangeKind;
};

export type RepositoryStatus = {
  stagedChanges: ChangedFile[];
  unstagedChanges: ChangedFile[];
};

export type UpstreamStatus = {
  remoteName: string;
  branchName: string;
  ahead: number;
  behind: number;
};

export type CommitSummary = {
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

export type CommitFileChange = {
  path: string;
  previousPath: string | null;
  kind: ChangeKind;
};

export type CommitDetail = {
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

export type RepositoryState = {
  name: string;
  path: string;
  gitDir: string;
  currentBranch: string | null;
  localBranches: string[];
  upstreamStatus: UpstreamStatus | null;
  headShortSha: string | null;
  isBare: boolean;
  status: RepositoryStatus;
  recentCommits: CommitSummary[];
};

export type FeedbackTone = "error" | "warning" | "info" | "success";

export type FeedbackState = {
  title: string;
  message: string;
  tone: FeedbackTone;
};

export type WorkspaceTab = {
  id: number;
  title: string;
  customTitle: string | null;
  isPinned: boolean;
  repository: RepositoryState | null;
  feedback: FeedbackState | null;
  selectedHistoryEntryId: string | null;
  commitMessage: string;
  selectedCommitDetail: CommitDetail | null;
  commitDetailError: string | null;
  commitDetailCache: Record<string, CommitDetail>;
};

export type PersistedTab = {
  repositoryPath: string | null;
  isPinned: boolean;
  customTitle: string | null;
};

export type PersistedSession = {
  tabs: PersistedTab[];
  activeTabIndex: number;
};

export type TabContextMenuState = {
  tabId: number;
  x: number;
  y: number;
};
