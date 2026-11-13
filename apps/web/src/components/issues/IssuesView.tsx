import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type IssueListInput,
  type IssueListResult,
  type IssueListState,
  type IssueRef,
  type IssueRepository,
  type IssueState,
  type IssueSummary,
  type PullRequestLabel,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import {
  BanIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  FolderGit2Icon,
  LayersIcon,
  ListChecksIcon,
  TagIcon,
  UserIcon,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import { useStableCallback } from "~/hooks/useStableCallback";
import { registerCommands } from "~/shortcuts/dispatcher";
import { cn } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { issueEnvironment, issueLabelCandidateLists, issueListPages } from "~/state/issues";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestCandidatePicker } from "../pullRequest/PullRequestCandidatePicker";
import { PullRequestCompactFilterMenu } from "../pullRequest/PullRequestCompactFilterMenu";
import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { LabelCandidateRow, labelCandidateMatches } from "../pullRequest/PullRequestLabelPicker";
import { showPullRequestLinkContextMenu } from "../pullRequest/pullRequestLinkContextMenu";
import {
  type PullRequestFilterOption,
  PullRequestSearchInput,
} from "../pullRequest/PullRequestListFilters";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowLines,
} from "../pullRequest/PullRequestListRow";
import { PullRequestRowLabels } from "../pullRequest/PullRequestRow";
import { IssueDetailPanel, useStartIssueThread } from "./IssueDetailPanel";
import { IssueStateGlyph } from "./IssueStateGlyph";
import {
  effectiveIssueAuthor,
  issueActiveAccountMissing,
  ISSUE_AUTHOR_ALL,
  issueBlockedMarker,
  issueAuthorIgnored,
  issueAuthorOptions,
  type IssueBulkLabel,
  issueBulkLabelChange,
  issueBulkLabels,
  type IssueLabelEdit,
  issueKey,
  issueRepositoryKey,
  issueRowLabels,
  issueRowState,
  type IssueStateShown,
  type IssueStateEdit,
  projectsForRepository,
} from "./issues.logic";

export interface IssuesSearch {
  readonly state: IssueListState;
  readonly q?: string | undefined;
  readonly labels?: ReadonlyArray<string>;
  /** Repository filter, as `host/owner/name`. */
  readonly repo?: string;
  /** GitHub login of whoever opened the issue, or `ISSUE_AUTHOR_ALL`. Absent: the default. */
  readonly author?: string;
  readonly host?: string;
  readonly repository?: string;
  readonly number?: number;
}

const SEARCH_DEBOUNCE_MS = 300;
const LABEL_WRITE_CONCURRENCY = 4;
const NO_ISSUE_KEYS: ReadonlySet<string> = new Set();

type MenuPosition = { readonly x: number; readonly y: number };
type IssueLabelChanges = ReadonlyArray<{
  readonly issue: IssueSummary;
  readonly labels: ReadonlyArray<PullRequestLabel>;
}>;

/** `undefined` clears a key. */
export type IssuesSearchPatch = {
  readonly [Key in keyof IssuesSearch]?: IssuesSearch[Key] | undefined;
};

const queryPatch = (value: string): IssuesSearchPatch => {
  const q = value.trim().slice(0, 200);
  return { q: q.length === 0 ? undefined : q };
};

export function patchSearch(previous: IssuesSearch, patch: IssuesSearchPatch): IssuesSearch {
  const next: Record<string, unknown> = { ...previous, ...patch };
  for (const key of Object.keys(patch))
    if (next[key] === undefined && key !== "q") delete next[key];
  return next as unknown as IssuesSearch;
}

const STATE_OPTIONS = [
  { value: "open", label: "Open", Icon: CircleDotIcon },
  { value: "closed", label: "Closed", Icon: CircleCheckIcon },
  { value: "all", label: "All", Icon: LayersIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListState>>;

/**
 * Lists one repository's issues at a time, read with `environmentId`. `repositories` are the
 * choices (a fork and its upstream); `projects` are where Start thread can open a thread.
 */
export function IssuesView({
  search,
  onSearchChange: onSearchChangeProp,
  environmentId: requestedEnvironmentId,
  repositories,
  projects,
  composerDraftTarget,
  picker,
}: {
  search: IssuesSearch;
  onSearchChange: (patch: IssuesSearchPatch, options?: { readonly push: true }) => void;
  environmentId: EnvironmentId;
  repositories: ReadonlyArray<IssueRepository>;
  projects: ReadonlyArray<EnvironmentProject>;
  composerDraftTarget: ScopedThreadRef | DraftId;
  picker: React.ReactNode;
}) {
  const onSearchChange = useStableCallback(onSearchChangeProp);
  const registry = useContext(RegistryContext);
  const { environments } = useEnvironments();
  const invalidate = useAtomCommand(issueEnvironment.invalidate, { reportFailure: false });

  const environmentId = environments.some(
    (environment) =>
      environment.environmentId === requestedEnvironmentId && environment.serverConfig !== null,
  )
    ? requestedEnvironmentId
    : null;
  const threadRepository =
    repositories.find((repository) => issueRepositoryKey(repository) === search.repo) ??
    repositories[0];
  const scopedRepositories = threadRepository === undefined ? [] : [threadRepository];
  const otherRepository =
    threadRepository === undefined
      ? null
      : (repositories.find(
          (repository) => issueRepositoryKey(repository) !== issueRepositoryKey(threadRepository),
        ) ?? null);

  const discovery = useEnvironmentQuery(
    environmentId === null
      ? null
      : sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const providers = discovery.data?.sourceControlProviders ?? [];
  const defaultAuthor =
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.settings.issueDefaultAuthor ?? DEFAULT_SERVER_SETTINGS.issueDefaultAuthor;
  const author = effectiveIssueAuthor(search.author, defaultAuthor, providers);
  // Without this wait, the first read would list everyone and then refetch for the account.
  const authorPending =
    search.author === undefined &&
    defaultAuthor === "active-account" &&
    discovery.data === null &&
    discovery.error === null;

  const baseInput: IssueListInput | null =
    scopedRepositories.length === 0 || authorPending
      ? null
      : {
          repositories: scopedRepositories,
          state: search.state,
          ...(search.labels === undefined || search.labels.length === 0
            ? {}
            : { labels: search.labels }),
          ...(search.q === undefined ? {} : { query: search.q }),
          ...(author === undefined ? {} : { author }),
        };
  const listKey = JSON.stringify([environmentId, baseInput]);
  const [loaded, setLoaded] = useState({ key: listKey, pages: 1 });
  const pageCount = loaded.key === listKey ? loaded.pages : 1;
  const pageInputs = Array.from({ length: pageCount }, (_, index) =>
    baseInput === null ? null : { ...baseInput, page: index + 1 },
  );
  const firstPage = useEnvironmentQuery(
    environmentId === null || pageInputs[0] == null
      ? null
      : issueEnvironment.list({ environmentId, input: pageInputs[0] }),
  );
  const [refreshing, setRefreshing] = useState(false);
  const [labelEdits, setLabelEdits] = useState<ReadonlyMap<string, IssueLabelEdit>>(new Map());
  const [stateEdits, setStateEdits] = useState<ReadonlyMap<string, IssueStateEdit>>(new Map());
  const [changingState, setChangingState] = useState<ReadonlySet<string>>(NO_ISSUE_KEYS);
  const setIssueState = useAtomCommand(issueEnvironment.setState, { reportFailure: false });
  const canChangeState = useAtomValue(issueEnvironment.setState.permissionAtom(environmentId));
  const { start: startThread } = useStartIssueThread();

  const loadedPages = useAtomValue(
    issueListPages(
      environmentId,
      pageInputs.filter((input) => input !== null),
    ),
  );
  const loadedIssues = [
    ...new Map(
      loadedPages
        .flatMap((page) => AsyncResult.getOrElse(page, () => null)?.issues ?? [])
        .map((issue) => [issueKey(issue), issue] as const),
    ).values(),
  ];
  // Keyed by the filters, so changing one clears it while Load more and Refresh keep it.
  const [selection, setSelection] = useState<{
    readonly listKey: string;
    readonly keys: ReadonlySet<string>;
    readonly anchor: string | null;
  }>({ listKey, keys: NO_ISSUE_KEYS, anchor: null });
  const selectionCurrent = selection.listKey === listKey;
  const selectedKeys = selectionCurrent ? selection.keys : NO_ISSUE_KEYS;
  const anchor = selectionCurrent ? selection.anchor : null;
  // Issues a refresh no longer lists drop out here.
  const selectedIssues = loadedIssues.filter((issue) => selectedKeys.has(issueKey(issue)));
  const selecting = selectedIssues.length > 0;
  const allSelected = selecting && selectedIssues.length === loadedIssues.length;
  const visibleSelection = new Set(selectedIssues.map(issueKey));
  const setSelected = (issues: ReadonlyArray<IssueRef>, nextAnchor: string | null) =>
    setSelection({ listKey, keys: new Set(issues.map(issueKey)), anchor: nextAnchor });
  const clearSelection = () => setSelected([], null);
  const selectAll = () => setSelected(loadedIssues, null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Esc clears the selection wherever focus is, ahead of the app's own Escape shortcuts.
  useEffect(() => {
    if (!selecting) return;
    return registerCommands(
      {},
      {
        onKeyDown: (event) => {
          if (event.key !== "Escape") return false;
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("input, textarea, [contenteditable], [role=dialog], [role=menu]")) {
            return false;
          }
          event.preventDefault();
          setSelection({ listKey, keys: NO_ISSUE_KEYS, anchor: null });
        },
      },
    );
  }, [selecting, listKey]);
  const toggleSelected = (issue: IssueSummary) => {
    const key = issueKey(issue);
    setSelected(
      visibleSelection.has(key)
        ? selectedIssues.filter((entry) => issueKey(entry) !== key)
        : [...selectedIssues, issue],
      key,
    );
  };
  const selectRange = (issue: IssueSummary) => {
    const to = loadedIssues.findIndex((entry) => issueKey(entry) === issueKey(issue));
    const from = loadedIssues.findIndex((entry) => issueKey(entry) === anchor);
    if (from === -1 || to === -1) return toggleSelected(issue);
    setSelected(
      [...selectedIssues, ...loadedIssues.slice(Math.min(from, to), Math.max(from, to) + 1)],
      anchor,
    );
  };
  const clickIssue = (issue: IssueSummary, event: React.MouseEvent) => {
    if (event.metaKey || event.ctrlKey) toggleSelected(issue);
    else if (event.shiftKey) selectRange(issue);
    else select(issue);
  };
  const checkIssue = (issue: IssueSummary, event: Event) => {
    if (event instanceof MouseEvent && event.shiftKey) selectRange(issue);
    else toggleSelected(issue);
  };
  const openIssueMenu = (issue: IssueSummary, position: MenuPosition) => {
    const issueProjects = projectsForRepository(projects, issue);
    const environmentLabel = (environmentId: EnvironmentId) =>
      environments.find((environment) => environment.environmentId === environmentId)?.label ??
      environmentId;
    const nextState =
      issueRowState(issue, stateEdits.get(issueKey(issue))).state === "open" ? "closed" : "open";
    void showPullRequestLinkContextMenu({
      url: issue.url,
      openLabel: "Open on GitHub",
      position,
      items: [
        issueProjects.length > 1
          ? {
              id: "start-thread",
              label: "Start thread",
              children: issueProjects.map((project, index) => ({
                id: `start-thread:${index}`,
                label: `${project.title} · ${environmentLabel(project.environmentId)}`,
              })),
            }
          : {
              id: "start-thread:0",
              label: "Start thread",
              ...(issueProjects.length === 0 ? { disabled: true } : {}),
            },
        ...(canChangeState
          ? [
              {
                id: "change-state",
                label: nextState === "closed" ? "Close issue" : "Reopen issue",
                ...(changingState.has(issueKey(issue)) ? { disabled: true } : {}),
              },
            ]
          : []),
      ],
      onAction: (action) => {
        if (action === "change-state") {
          void changeIssueState(issue, nextState);
          return;
        }
        const project = issueProjects[Number(action.slice("start-thread:".length))];
        if (project !== undefined) void startThread(issue, project);
      },
    });
  };

  const updateSearch = (patch: IssuesSearchPatch) => onSearchChange(patch);

  const refreshList = () => {
    if (environmentId === null) return;
    for (const input of pageInputs) {
      if (input !== null) registry.refresh(issueEnvironment.list({ environmentId, input }));
    }
  };
  const changeIssueState = async (issue: IssueSummary, state: IssueState) => {
    const key = issueKey(issue);
    if (environmentId === null || changingState.has(key)) return;
    setChangingState((current) => new Set(current).add(key));
    const { host, repository, number } = issue;
    const result = await setIssueState({
      environmentId,
      input: { host, repository, number, state },
    });
    setChangingState((current) => new Set([...current].filter((entry) => entry !== key)));
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: `Could not ${state === "closed" ? "close" : "reopen"} #${number}`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          `You don't have permission to close or reopen issues in ${repository}.`,
        ),
      });
      return;
    }
    setStateEdits((current) =>
      new Map(current).set(key, { staleUpdatedAt: issue.updatedAt, state }),
    );
    refreshList();
    // Changed from the list, the issue's own detail may never have been read to name its parent.
    if (selected !== null) {
      const open = issueEnvironment.detail({ environmentId, input: selected });
      const openSubIssues = AsyncResult.getOrElse(registry.get(open), () => null)?.subIssues;
      if (openSubIssues?.some((subIssue) => issueKey(subIssue) === key)) registry.refresh(open);
    }
  };
  const refreshFromGitHub = async () => {
    if (environmentId === null) return;
    setRefreshing(true);
    await invalidate({ environmentId, input: {} });
    refreshList();
    if (selected !== null) {
      registry.refresh(issueEnvironment.detail({ environmentId, input: selected }));
    }
    setRefreshing(false);
  };

  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const commitQuery = (value: string) => {
    setPendingQuery(null);
    onSearchChange(queryPatch(value));
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces typing into the URL; the timer must stop if the page unmounts.
  useEffect(() => {
    if (pendingQuery === null) return;
    const timer = setTimeout(() => {
      setPendingQuery(null);
      onSearchChange(queryPatch(pendingQuery));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onSearchChange, pendingQuery]);

  const selected: IssueRef | null =
    search.host !== undefined && search.repository !== undefined && search.number !== undefined
      ? { host: search.host, repository: search.repository, number: search.number }
      : null;
  const select = (issue: IssueRef | null) =>
    onSearchChange(
      { host: issue?.host, repository: issue?.repository, number: issue?.number },
      { push: true },
    );

  const labelOptions = [
    ...new Set([
      ...(search.labels ?? []),
      ...(firstPage.data?.issues ?? []).flatMap((issue) => issue.labels.map(({ name }) => name)),
    ]),
  ].toSorted((left, right) => left.localeCompare(right));
  const authorOptions = issueAuthorOptions(providers, author).map((option) => ({
    ...option,
    Icon: UserIcon,
  }));
  const repositoryOptions = repositories.map((repository) => ({
    value: issueRepositoryKey(repository),
    label: repository.repository,
    Icon: FolderGit2Icon,
  }));

  const listBody = (() => {
    if (environmentId === null) {
      return <ListMessage>Connect to an environment to see issues.</ListMessage>;
    }
    if (repositories.length === 0) {
      return (
        <ListMessage>
          Issues currently support GitHub only, and this repository is not on GitHub.
        </ListMessage>
      );
    }
    if (authorPending) {
      return (
        <ListMessage>
          <Spinner aria-hidden /> Loading issues…
        </ListMessage>
      );
    }
    return (
      <div className="flex flex-col">
        {issueActiveAccountMissing(search.author, defaultAuthor, providers) ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No active gh account is signed in on this environment, so Issues lists all authors.
          </p>
        ) : null}
        {pageInputs.map((input, index) =>
          input === null ? null : (
            <IssueListPage
              key={input.page}
              environmentId={environmentId}
              input={input}
              last={index === pageInputs.length - 1}
              current={selected}
              selection={visibleSelection}
              selecting={selecting}
              labelEdits={labelEdits}
              stateEdits={stateEdits}
              onClickIssue={clickIssue}
              onCheckIssue={checkIssue}
              onIssueMenu={openIssueMenu}
              onLoadMore={() => setLoaded({ key: listKey, pages: pageCount + 1 })}
              onRetry={() => void refreshFromGitHub()}
              otherRepository={otherRepository}
              onShowRepository={(repository) =>
                updateSearch({ repo: issueRepositoryKey(repository) })
              }
            />
          ),
        )}
      </div>
    );
  })();

  const refreshButton = (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Refresh issues"
      disabled={refreshing || environmentId === null}
      onClick={() => void refreshFromGitHub()}
    >
      <RefreshIcon size="md" refreshing={refreshing} />
    </Button>
  );
  const searchInput = (
    <PullRequestSearchInput
      value={search.q ?? ""}
      placeholder="Search issue titles"
      label="Search issues"
      onChange={setPendingQuery}
      onSubmit={commitQuery}
    />
  );

  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        className={cn(
          "@container/pr-list min-h-0 min-w-0 flex-col overflow-x-hidden bg-background",
          selected === null ? "flex flex-1" : "hidden",
        )}
      >
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-3">
          <div className="flex items-center gap-1">
            {picker}
            <div className="min-w-0 flex-1">{searchInput}</div>
            {refreshButton}
          </div>
          {/* The selection bar covers the filters rather than replacing them, so rows never shift. */}
          <div className="relative">
            <div
              className={cn("flex flex-wrap items-center gap-2", selecting && "invisible")}
              inert={selecting}
            >
              <Checkbox
                aria-label="Select all loaded issues"
                checked={false}
                disabled={loadedIssues.length === 0}
                onCheckedChange={selectAll}
              />
              <PullRequestCompactFilterMenu
                label="Filter by state"
                outlined
                value={search.state}
                options={STATE_OPTIONS}
                onChange={(state) => updateSearch({ state })}
              />
              {repositories.length > 1 ? (
                <PullRequestCompactFilterMenu
                  label="Filter by repository"
                  outlined
                  value={
                    threadRepository === undefined
                      ? (search.repo ?? "")
                      : issueRepositoryKey(threadRepository)
                  }
                  options={repositoryOptions}
                  onChange={(repo) => updateSearch({ repo: repo === "" ? undefined : repo })}
                />
              ) : null}
              {authorOptions.length > 0 ? (
                <PullRequestCompactFilterMenu
                  label="Filter by author"
                  triggerIcon={<UserIcon aria-hidden className="size-4" />}
                  triggerLabel={author === undefined ? "Author" : `Author · ${author}`}
                  outlined
                  value={author ?? ""}
                  options={authorOptions}
                  onChange={(next) =>
                    updateSearch({ author: next === "" ? ISSUE_AUTHOR_ALL : next })
                  }
                />
              ) : null}
              <IssueLabelFilter
                options={labelOptions}
                selected={search.labels ?? []}
                onChange={(labels) =>
                  updateSearch({ labels: labels.length === 0 ? undefined : labels })
                }
              />
            </div>
            {selecting && environmentId !== null ? (
              <div className="absolute inset-x-0 top-0 flex items-center gap-2">
                <Checkbox
                  aria-label={allSelected ? "Clear the selection" : "Select all loaded issues"}
                  checked={allSelected}
                  indeterminate={!allSelected}
                  onCheckedChange={() => (allSelected ? clearSelection() : selectAll())}
                />
                <span className="text-sm">{selectedIssues.length} selected</span>
                <IssueBulkLabelPicker
                  environmentId={environmentId}
                  selected={selectedIssues.map((issue) => ({
                    ...issue,
                    labels: issueRowLabels(issue, labelEdits.get(issueKey(issue))),
                  }))}
                  onApplied={(changes) => {
                    if (changes.length === 0) return;
                    setLabelEdits((current) => {
                      const next = new Map(current);
                      for (const { issue, labels } of changes) {
                        next.set(issueKey(issue), { staleUpdatedAt: issue.updatedAt, labels });
                      }
                      return next;
                    });
                    refreshList();
                  }}
                />
                <Button variant="ghost" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 outline-none"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "a" && (event.metaKey || event.ctrlKey) && !event.altKey) {
              event.preventDefault();
              selectAll();
            }
          }}
        >
          {listBody}
        </div>
      </div>
      {selected !== null && environmentId !== null ? (
        <IssueDetailPanel
          key={issueKey(selected)}
          environmentId={environmentId}
          reference={selected}
          projects={projects}
          onBack={() => select(null)}
          onOpenIssue={select}
          onLabelsChanged={(issue, edit) => {
            setLabelEdits((current) => new Map(current).set(issueKey(issue), edit));
            refreshList();
          }}
          stateEdit={stateEdits.get(issueKey(selected))}
          changingState={changingState.has(issueKey(selected))}
          onChangeState={(issue, state) => void changeIssueState(issue, state)}
          composerDraftTarget={composerDraftTarget}
        />
      ) : null}
    </div>
  );
}

function ListMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function IssueListPage({
  environmentId,
  input,
  last,
  current,
  selection,
  selecting,
  labelEdits,
  stateEdits,
  onClickIssue,
  onCheckIssue,
  onIssueMenu,
  onLoadMore,
  onRetry,
  otherRepository,
  onShowRepository,
}: {
  environmentId: EnvironmentId;
  input: IssueListInput;
  last: boolean;
  current: IssueRef | null;
  selection: ReadonlySet<string>;
  selecting: boolean;
  labelEdits: ReadonlyMap<string, IssueLabelEdit>;
  stateEdits: ReadonlyMap<string, IssueStateEdit>;
  onClickIssue: (issue: IssueSummary, event: React.MouseEvent) => void;
  onCheckIssue: (issue: IssueSummary, event: Event) => void;
  onIssueMenu: (issue: IssueSummary, position: MenuPosition) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  /** The thread project's other repository, offered when this one has Issues turned off. */
  otherRepository: IssueRepository | null;
  onShowRepository: (repository: IssueRepository) => void;
}) {
  const query = useEnvironmentQuery(issueEnvironment.list({ environmentId, input }));
  const result: IssueListResult | null = query.data;
  if (result === null) {
    return query.error === null ? (
      <ListMessage>
        <Spinner aria-hidden /> Loading issues…
      </ListMessage>
    ) : (
      <ListMessage>
        <span className="min-w-0 flex-1">{query.error}</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      </ListMessage>
    );
  }
  if (issueAuthorIgnored(input.author, result)) {
    return (
      <ListMessage>
        {"This environment's T3 is too old to filter by author. Update it, or pick All."}
      </ListMessage>
    );
  }
  return (
    <>
      {input.page === 1
        ? result.errors.map((error) => (
            <p key={error.host} className="px-3 py-2 text-xs text-warning-foreground">
              {error.host}: {error.message}
            </p>
          ))
        : null}
      {input.page === 1
        ? (result.disabledRepositories ?? []).map((repository) => (
            <ListMessage key={issueRepositoryKey(repository)}>
              <span className="min-w-0 flex-1">
                Issues are turned off for {repository.repository}.
              </span>
              {otherRepository === null ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onShowRepository(otherRepository)}
                >
                  Show {otherRepository.repository} issues
                </Button>
              )}
            </ListMessage>
          ))
        : null}
      {input.page === 1 &&
      result.issues.length === 0 &&
      (result.disabledRepositories ?? []).length === 0 ? (
        <ListMessage>No issues match these filters.</ListMessage>
      ) : null}
      {result.issues.map((issue) => (
        <IssueRow
          key={issueKey(issue)}
          issue={issue}
          labels={issueRowLabels(issue, labelEdits.get(issueKey(issue)))}
          state={issueRowState(issue, stateEdits.get(issueKey(issue)))}
          current={current !== null && issueKey(current) === issueKey(issue)}
          checked={selection.has(issueKey(issue))}
          selecting={selecting}
          onClick={onClickIssue}
          onCheck={onCheckIssue}
          onMenu={onIssueMenu}
        />
      ))}
      {last && result.hasMore ? (
        <div className="flex justify-center py-3">
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Load more issues
          </Button>
        </div>
      ) : null}
    </>
  );
}

function IssueRow({
  issue,
  labels,
  state,
  current,
  checked,
  selecting,
  onClick,
  onCheck,
  onMenu,
}: {
  issue: IssueSummary;
  labels: IssueSummary["labels"];
  state: IssueStateShown;
  current: boolean;
  checked: boolean;
  selecting: boolean;
  onClick: (issue: IssueSummary, event: React.MouseEvent) => void;
  onCheck: (issue: IssueSummary, event: Event) => void;
  onMenu: (issue: IssueSummary, position: MenuPosition) => void;
}) {
  return (
    <div
      className={cn(
        "group/issue-row flex items-center rounded-md pl-2",
        current ? "bg-accent" : checked ? "bg-accent/60" : "hover:bg-accent/60",
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(issue, { x: event.clientX, y: event.clientY });
      }}
    >
      <span
        className={cn(
          "flex shrink-0",
          !selecting && "opacity-0 group-hover/issue-row:opacity-100 focus-within:opacity-100",
        )}
      >
        <Checkbox
          aria-label={`Select issue #${issue.number}`}
          checked={checked}
          onCheckedChange={(_, details) => onCheck(issue, details.event)}
        />
      </span>
      <button
        type="button"
        aria-current={current ? "true" : undefined}
        className={cn(PULL_REQUEST_ROW_CLASS, "min-w-0 flex-1 px-2 py-2.5")}
        // Shift-click selects a range of rows, not the text between them.
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault();
        }}
        onClick={(event) => onClick(issue, event)}
      >
        <span className="flex w-4 shrink-0 flex-col items-center">
          <IssueStateGlyph state={state} />
        </span>
        <PullRequestRowLines
          number={<span className={PULL_REQUEST_ROW_NUMBER_CLASS}>#{issue.number}</span>}
          title={issue.title}
          meta={
            <span className="@container/pr-row-meta flex min-w-0 flex-1 items-center gap-1.5">
              <PullRequestRowLabels labels={labels} />
              <IssueBlockedMarker issue={issue} />
              <IssueSubIssueProgress issue={issue} />
              <PullRequestRowAuthor actor={issue.author} />
              <span className="truncate">{issue.repository}</span>
            </span>
          }
          updatedAt={issue.updatedAt}
        />
      </button>
    </div>
  );
}

/** Labels for every selected issue; each issue is its own request, so some can fail alone. */
function IssueBulkLabelPicker({
  environmentId,
  selected,
  onApplied,
}: {
  environmentId: EnvironmentId;
  /** With any label edits not yet in the list already applied. */
  selected: ReadonlyArray<IssueSummary>;
  onApplied: (changes: IssueLabelChanges) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const setLabels = useAtomCommand(issueEnvironment.setLabels, { reportFailure: false });

  // Labels are per repository, so one issue from each is enough to read them.
  const repositories = [
    ...new Map(
      selected.map((issue) => [
        issueRepositoryKey(issue),
        { host: issue.host, repository: issue.repository, number: issue.number },
      ]),
    ),
  ];
  const reads = useAtomValue(
    issueLabelCandidateLists(environmentId, open ? repositories.map(([, ref]) => ref) : []),
  );
  const lists = reads.map((read) => AsyncResult.getOrElse(read, () => null));
  const failure = reads.find((read) => read._tag === "Failure");
  const { labels, hidden } = issueBulkLabels(
    selected,
    new Map(repositories.map(([key], index) => [key, lists[index]?.candidates ?? []])),
  );

  const apply = async (label: IssueBulkLabel) => {
    const { applied, changes } = issueBulkLabelChange(selected, label);
    if (pending || changes.length === 0) return;
    setPending(true);
    const results: Array<Awaited<ReturnType<typeof setLabels>>> = [];
    const queue = changes.map(({ issue }, index) => ({ issue, index }));
    const write = async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const { issue, index } = next;
        results[index] = await setLabels({
          environmentId,
          input: {
            host: issue.host,
            repository: issue.repository,
            number: issue.number,
            labels: [label.name],
            applied,
          },
        });
      }
    };
    await Promise.all(Array.from({ length: LABEL_WRITE_CONCURRENCY }, write));
    setPending(false);

    const failed = changes.flatMap(({ issue }, index) => {
      const result = results[index];
      return result?._tag === "Failure"
        ? [
            {
              issue,
              reason: readableFailure(
                squashAtomCommandFailure(result),
                `You don't have permission to change labels in ${issue.repository}.`,
              ),
            },
          ]
        : [];
    });
    onApplied(changes.filter((_, index) => results[index]?._tag !== "Failure"));
    if (failed.length === 0) return;
    toastManager.add({
      type: "error",
      title: `Updated ${changes.length - failed.length} of ${changes.length}`,
      description: (
        <ul>
          {failed.map(({ issue, reason }) => (
            <li key={issueKey(issue)}>
              {issue.repository}#{issue.number}: {reason}
            </li>
          ))}
        </ul>
      ),
    });
  };

  return (
    <PullRequestCandidatePicker
      icon={<TagIcon className="size-3.5" />}
      label="Change labels of the selected issues"
      trigger={
        <Button variant="outline" aria-label="Change labels of the selected issues">
          <TagIcon aria-hidden className="size-4" />
          Labels
          <ChevronDownIcon aria-hidden className="text-muted-foreground" />
        </Button>
      }
      allowed
      disabledReason=""
      open={open}
      onOpenChange={setOpen}
      query={search}
      onQueryChange={setSearch}
      searchLabel="Search labels"
      isPending={failure === undefined && lists.some((list) => list === null)}
      error={failure === undefined ? null : formatEnvironmentQueryError(failure.cause)}
      candidates={labels.filter((label) => labelCandidateMatches(label, search))}
      emptyLabel={
        hidden
          ? "The selected repositories have no labels in common."
          : "This repository has no labels."
      }
      noMatchLabel="No label matches that."
      errorLabel="The labels could not be read."
      truncated={hidden || lists.some((list) => list?.truncated === true)}
      truncatedLabel={
        hidden
          ? "Labels missing from some of the selected repositories are hidden."
          : "This repository has more labels than are listed here. Apply the rest on GitHub."
      }
      candidateKey={(label) => label.name}
      disabled={pending}
      onSelect={(label) => void apply(label)}
    >
      {(label) => (
        <LabelCandidateRow
          candidate={{ ...label, isApplied: label.state === "all" }}
          partial={label.state === "some"}
        />
      )}
    </PullRequestCandidatePicker>
  );
}

function IssueBlockedMarker({ issue }: { issue: IssueSummary }) {
  const marker = issueBlockedMarker(issue);
  if (marker === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex min-w-0 shrink items-center gap-1" />}>
        <BanIcon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{marker.text}</span>
      </TooltipTrigger>
      <TooltipPopup>
        {marker.tooltip.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}

function IssueSubIssueProgress({ issue }: { issue: IssueSummary }) {
  const progress = issue.subIssueProgress;
  if (progress === undefined) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0 items-center gap-1" />}>
        <ListChecksIcon aria-hidden className="size-3 shrink-0" />
        <span className="tabular-nums">
          {progress.completed}/{progress.total}
        </span>
      </TooltipTrigger>
      <TooltipPopup>
        {progress.completed} of {progress.total} {progress.total === 1 ? "sub-issue" : "sub-issues"}{" "}
        completed
      </TooltipPopup>
    </Tooltip>
  );
}

function IssueLabelFilter({
  options,
  selected,
  onChange,
}: {
  options: ReadonlyArray<string>;
  selected: ReadonlyArray<string>;
  onChange: (labels: ReadonlyArray<string>) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Filter by label"
        render={<Button variant="outline" />}
        disabled={options.length === 0}
      >
        <TagIcon aria-hidden className="size-4" />
        {selected.length === 0 ? "Labels" : `Labels · ${selected.length}`}
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        {options.map((label) => (
          <MenuCheckboxItem
            key={label}
            checked={selected.includes(label)}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...selected, label].slice(0, 10)
                  : selected.filter((name) => name !== label),
              )
            }
          >
            {label}
          </MenuCheckboxItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
