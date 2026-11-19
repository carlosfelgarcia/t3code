import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  continueIssuePage,
  groupIssues,
  holdIssuePages,
  issueCursorsForHost,
  issueFilterScopes,
  issueTrackerKey,
  type HeldIssuePage,
} from "@t3tools/client-runtime/issue-list";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { issueEntryKey } from "@t3tools/client-runtime/state/issues";
import {
  AuthOrchestrationOperateScope,
  threadIssueKeysEqual,
  type ContextMenuItem,
  type EnvironmentId,
  type IssueInvolvement,
  type IssueListInput,
  type IssueListState,
  type IssueListSort,
  type ProjectId,
  type ScopedThreadRef,
  type SiblingRepository,
} from "@t3tools/contracts";
import type { EnvironmentIssueEntry } from "@t3tools/client-runtime/issue-list";
import {
  ArrowDownUpIcon,
  AtSignIcon,
  CalendarArrowDownIcon,
  CircleCheckIcon,
  ClockIcon,
  LayersIcon,
  PenLineIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { Fragment, useState } from "react";

import { IssueRow, type IssueRowTarget } from "~/components/issue/IssueRow";
import type { IssueListPreferences } from "~/components/issue/issueListPreferences";
import { IssueGlyph, issueTrackerPresentation } from "~/components/issue/issuePresentation";
import { PullRequestCompactFilterMenu } from "~/components/pullRequest/PullRequestCompactFilterMenu";
import { PullRequestListGhost } from "~/components/pullRequest/PullRequestGhosts";
import {
  PullRequestSearchInput,
  type PullRequestFilterOption,
} from "~/components/pullRequest/PullRequestListFilters";
import { PullRequestsUnavailableState } from "~/components/pullRequest/PullRequestsUnavailableState";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { ThreadDetailsIssueRows } from "~/components/chat/ThreadDetailsIssueRows";
import type { DraftId } from "~/composerDraftStore";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { readLocalApi } from "~/localApi";
import { m } from "~/i18n/messages";
import { newProjectId } from "~/lib/utils";
import {
  type IssuesPanelSurface,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "~/rightPanelStore";
import { useProject, useProjects, useThreadShell } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { issueEnvironment, useIssueList } from "~/state/issues";
import { Checkbox } from "~/components/ui/checkbox";
import { IssueBulkLabelMenu } from "./IssueBulkLabelMenu";
import { nextIssueSelection } from "./issueBulkLabels.logic";
import { projectEnvironment } from "~/state/projects";
import { useDebouncedValue } from "~/state/queries";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { SiblingRepositoryPicker, useSiblingSelection } from "../SiblingRepositoryPicker";
import { resolveFilterOptions } from "../pullRequest/pullRequestListOptions";
import { toastManager } from "../ui/toast";
import { IssueFiltersMenu } from "./IssueListFilterPickers";
import { addIssueToComposer, useStartIssueThread } from "./issueThreads";

const STATE_OPTIONS = [
  { value: "open", label: msg("Open", { $context: "issue state" }), Icon: IssueGlyph.issue },
  { value: "closed", label: msg("Closed", { $context: "issue state" }), Icon: CircleCheckIcon },
  { value: "all", label: msg("All", { $context: "issue filter" }), Icon: LayersIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListState>>;

const INVOLVEMENT_OPTIONS = [
  { value: "all", label: msg("Everyone", { $context: "issue filter" }), Icon: UsersIcon },
  { value: "assigned", label: msg("Assigned to me"), Icon: UserCheckIcon },
  { value: "authored", label: msg("Opened by me"), Icon: PenLineIcon },
  { value: "mentioned", label: msg("Mentioning me"), Icon: AtSignIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueInvolvement>>;

const SORT_OPTIONS = [
  {
    value: "created",
    label: msg("Newest", { $context: "sort order" }),
    Icon: CalendarArrowDownIcon,
  },
  { value: "updated", label: msg("Recently updated"), Icon: ClockIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListSort>>;

const PAGE_SIZE = 50;

/** The panel opens on open issues, newest first, unlike the page's recently-updated default. */
const DEFAULT_FILTERS: IssueListPreferences = { who: "all", status: "open", order: "created" };

interface ThreadIssuesPanelProps {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  surface: IssuesPanelSurface;
  composerDraftTarget: ScopedThreadRef | DraftId;
}

export function ThreadIssuesPanel({ projectId, ...props }: ThreadIssuesPanelProps) {
  const project = useProject(scopeProjectRef(props.threadRef.environmentId, projectId));
  return project === null ? null : <ProjectIssuesPanel {...props} project={project} />;
}

function ProjectIssuesPanel({
  threadRef,
  project,
  surface,
  composerDraftTarget,
}: Omit<ThreadIssuesPanelProps, "projectId"> & { project: EnvironmentProject }) {
  const { siblings, sibling, siblingProject } = useSiblingSelection(project, surface.sibling);
  const filters = surface.filters ?? DEFAULT_FILTERS;
  const setPanel = (patch: { sibling?: string | undefined; filters?: IssueListPreferences }) =>
    useRightPanelStore.getState().setIssuesPanel(threadRef, {
      sibling: "sibling" in patch ? patch.sibling : surface.sibling,
      filters: patch.filters ?? surface.filters,
    });
  if (siblings === null && surface.sibling !== undefined) return null;

  const listProject = sibling === null ? project : siblingProject;
  const picker =
    siblings === null || siblings.length === 0 ? null : (
      <SiblingRepositoryPicker
        project={project}
        ownPath={project.workspaceRoot}
        siblings={siblings}
        selected={sibling}
        // Labels and assignees belong to one repository, so they do not carry across.
        onSelect={(next) =>
          setPanel({
            sibling: next?.path,
            filters: {
              who: filters.who,
              status: filters.status,
              ...(filters.order ? { order: filters.order } : {}),
            },
          })
        }
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {listProject === null && sibling !== null ? (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-2">{picker}</div>
          <AddSiblingAsProject environmentId={project.environmentId} sibling={sibling} />
        </>
      ) : listProject === null ? null : (
        <IssueList
          key={`${listProject.environmentId}:${listProject.id}`}
          threadRef={threadRef}
          composerDraftTarget={composerDraftTarget}
          project={listProject}
          filters={filters}
          onFilters={(next) => setPanel({ filters: next })}
          picker={picker}
        />
      )}
    </div>
  );
}

/** Issues are read through a project, so a sibling folder has to become one first. */
function AddSiblingAsProject({
  environmentId,
  sibling,
}: {
  environmentId: EnvironmentId;
  sibling: SiblingRepository;
}) {
  const gt = useGT();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setPending(true);
    setError(null);
    const result = await createProject({
      environmentId,
      input: {
        projectId: newProjectId(),
        title: inferProjectTitleFromPath(sibling.path),
        workspaceRoot: sibling.path,
        createWorkspaceRootIfMissing: false,
        defaultModelSelection: null,
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error ? failure.message : gt("T3 Code could not add the project."),
      );
    }
  };
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <IssueGlyph.issue />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{gt("{name} is not a project yet", { name: sibling.name })}</EmptyTitle>
        <EmptyDescription>
          {error ?? gt("Add it as a project to list its issues. It will show in the sidebar.")}
        </EmptyDescription>
      </EmptyHeader>
      <Button size="sm" disabled={pending} onClick={() => void add()}>
        {pending ? gt("Adding…") : gt("Add as project")}
      </Button>
    </Empty>
  );
}

function IssueList({
  threadRef,
  composerDraftTarget,
  project,
  filters,
  onFilters,
  picker,
}: {
  threadRef: ScopedThreadRef;
  composerDraftTarget: ScopedThreadRef | DraftId;
  project: EnvironmentProject;
  filters: IssueListPreferences;
  onFilters: (filters: IssueListPreferences) => void;
  picker: React.ReactNode;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const environmentId = project.environmentId;
  const environment = useEnvironment(environmentId);
  const linkedIssues = useThreadShell(threadRef)?.issues ?? [];
  const issuesSupported = environment?.serverConfig?.environment.capabilities.issues === true;
  const projects = useProjects();
  const [query, setQuery] = useState(filters.q ?? "");
  const debouncedQuery = useDebouncedValue(query, 300);
  const sort = filters.order ?? "updated";

  const listInput: IssueListInput = {
    state: filters.status,
    involvement: filters.who,
    projectId: project.id,
    limit: PAGE_SIZE,
    sort,
    ...(debouncedQuery ? { query: debouncedQuery } : {}),
    ...(filters.label?.length ? { labels: filters.label } : {}),
    ...(filters.assignee ? { assignee: filters.assignee } : {}),
  };
  const targets = issuesSupported ? [{ environmentId, input: listInput }] : [];
  const list = useIssueList(targets);
  useLiveRefresh(list.refresh, { key: JSON.stringify(targets) });

  const [pages, setPages] = useState<ReadonlyMap<EnvironmentId, HeldIssuePage>>(new Map());
  const held = holdIssuePages(list.answers, pages);
  const loadPage = useAtomCommand(issueEnvironment.listPage, { reportFailure: false });
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const loadMore = async (host: string) => {
    const page = held.get(environmentId);
    const cursors = page ? issueCursorsForHost(page.nextCursors, host) : {};
    if (!page || Object.keys(cursors).length === 0 || loadingMore !== null) return;
    setLoadingMore(host);
    const result = await loadPage({ environmentId, input: { ...listInput, cursors } });
    setLoadingMore(null);
    const failure = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
    setPages((current) =>
      new Map(current).set(
        environmentId,
        continueIssuePage(
          page,
          result._tag === "Failure"
            ? {
                failure:
                  failure instanceof Error ? failure.message : m(msg("The next page failed.")),
              }
            : result.value,
          cursors,
        ),
      ),
    );
  };

  const groups = groupIssues(held, debouncedQuery, projects, sort);
  const rows = groups.flatMap((group) => group.rows);
  const orderedKeys = rows.map(issueEntryKey);
  // Only loaded rows can be selected; a filter change starts over.
  const [selection, setSelection] = useState<{
    keys: ReadonlySet<string>;
    anchor: string | null;
  }>({ keys: new Set(), anchor: null });
  const selectedRows = rows.filter((row) => selection.keys.has(issueEntryKey(row)));
  const toggleSelected = (key: string, range: boolean) =>
    setSelection((current) => ({
      keys: nextIssueSelection(current.keys, orderedKeys, key, current.anchor, range),
      anchor: key,
    }));
  const clearSelection = () => setSelection({ keys: new Set(), anchor: null });
  // The panel lists one project, so label and assignee choices come from it alone.
  const filterScopes = issueFilterScopes(held, projects, {
    environmentId,
    projectId: project.id,
  });

  const activeSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, threadRef),
  );
  const openEntry = (entry: IssueRowTarget) =>
    useRightPanelStore.getState().openIssue(threadRef, {
      ...(entry.environmentId === threadRef.environmentId
        ? {}
        : { environmentId: entry.environmentId }),
      projectId: entry.projectId,
      tracker: entry.tracker,
      host: entry.host,
      scope: entry.scope,
      key: entry.key,
      url: entry.url,
    });

  const showRowMenu = useIssueRowMenu(threadRef, composerDraftTarget);

  const update = (patch: Partial<IssueListPreferences>) => {
    clearSelection();
    const next = { ...filters, ...patch };
    onFilters({
      who: next.who,
      status: next.status,
      ...(next.q ? { q: next.q } : {}),
      ...(next.label?.length ? { label: next.label } : {}),
      ...(next.assignee ? { assignee: next.assignee } : {}),
      ...(next.order ? { order: next.order } : {}),
    });
  };

  const noneAnswered = list.answers.length === 0;
  const body = !issuesSupported ? (
    <PullRequestsUnavailableState
      title={gt("Issues unavailable")}
      error={gt("Update this environment's T3 Code server to browse issues.")}
    />
  ) : noneAnswered && list.isPending ? (
    <PullRequestListGhost />
  ) : noneAnswered && list.error ? (
    <PullRequestsUnavailableState
      error={list.error}
      onRetry={list.refresh}
      refreshing={list.isPending}
    />
  ) : groups.length === 0 ? (
    <Empty>
      <EmptyMedia variant="icon">
        <IssueGlyph.issue />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>
          <T>No issue tracker</T>
        </EmptyTitle>
        <EmptyDescription>
          {gt("{project} has no remote on a supported tracker, and no tracker is bound to it.", {
            project: project.title,
          })}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  ) : (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const presentation = issueTrackerPresentation(group.tracker.tracker);
        const showScope = new Set(group.rows.map((row) => row.scope.toLowerCase())).size > 1;
        return (
          <section key={issueTrackerKey(group.tracker)} className="flex flex-col gap-1">
            {groups.length > 1 ? (
              <h2 className="flex items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground">
                <presentation.Icon aria-hidden className="size-3.5" />
                {presentation.providerName}
              </h2>
            ) : null}
            {!group.tracker.configured ? (
              <p className="px-3 text-sm text-muted-foreground">
                {group.tracker.detail ?? gt("This tracker cannot be read right now.")}
              </p>
            ) : null}
            {group.errors.map((error) => (
              <p key={error.projectTitle} className="px-3 text-xs text-destructive">
                {error.message}
              </p>
            ))}
            {group.tracker.configured && group.rows.length === 0 && group.errors.length === 0 ? (
              <p className="px-3 text-sm text-muted-foreground">
                {debouncedQuery ? (
                  <T>Nothing matches that.</T>
                ) : (
                  <T>No issues under these filters.</T>
                )}
              </p>
            ) : null}
            {group.rows.map((row) => {
              const key = issueEntryKey(row);
              const selected =
                activeSurface?.kind === "issue" &&
                issueEntryKey({
                  ...activeSurface,
                  host: activeSurface.host ?? "",
                  projectId: activeSurface.projectId as ProjectId,
                }) === key;
              return (
                <div
                  key={key}
                  className="flex items-center gap-1 ps-2"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void showRowMenu(row, { x: event.clientX, y: event.clientY });
                  }}
                  onClickCapture={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) return;
                    event.preventDefault();
                    event.stopPropagation();
                    toggleSelected(key, event.shiftKey);
                  }}
                >
                  <Checkbox
                    aria-label={gt("Select {key}", { key: row.displayKey })}
                    checked={selection.keys.has(key)}
                    onCheckedChange={() => toggleSelected(key, false)}
                  />
                  <IssueRow
                    entry={row}
                    selected={selected}
                    showScope={showScope}
                    showTracker={false}
                    onSelect={openEntry}
                  />
                </div>
              );
            })}
            {group.more.map((moreEnvironmentId) => {
              const moreFailure = held.get(moreEnvironmentId)?.moreFailure ?? null;
              return (
                <Fragment key={moreEnvironmentId}>
                  {moreFailure === null ? null : (
                    <p className="px-3 text-xs text-destructive">{moreFailure}</p>
                  )}
                  <Button
                    size="sm"
                    variant="ghost-muted"
                    className="self-start"
                    disabled={loadingMore !== null}
                    onClick={() => void loadMore(group.tracker.host)}
                  >
                    {loadingMore === group.tracker.host ? (
                      <T>Loading…</T>
                    ) : moreFailure === null ? (
                      <T>Load more</T>
                    ) : (
                      <T>Retry</T>
                    )}
                  </Button>
                </Fragment>
              );
            })}
          </section>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        {picker}
        <div className="min-w-32 flex-1">
          <PullRequestSearchInput
            value={query}
            label={gt("Search issues")}
            placeholder={gt("Search issues")}
            busy={query !== debouncedQuery || (debouncedQuery.length > 0 && list.isPending)}
            onChange={(next) => {
              clearSelection();
              setQuery(next);
            }}
            onSubmit={(q) => update({ q: q || undefined })}
          />
        </div>
        <PullRequestCompactFilterMenu
          label={gt("Sort issues")}
          triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
          triggerLabel={gt("Sort", { $context: "verb, button that sorts a list" })}
          outlined
          value={sort}
          options={resolveFilterOptions(SORT_OPTIONS, resolve)}
          onChange={(order) => update({ order: order === "created" ? "created" : undefined })}
        />
        <IssueFiltersMenu
          state={filters.status}
          stateOptions={resolveFilterOptions(STATE_OPTIONS, resolve)}
          onState={(status) => update({ status })}
          involvement={filters.who}
          involvementOptions={resolveFilterOptions(INVOLVEMENT_OPTIONS, resolve)}
          onInvolvement={(who) => update({ who })}
          scopes={filterScopes}
          labels={filters.label ?? []}
          onLabels={(label) => update({ label })}
          assignee={filters.assignee}
          onAssignee={(assignee) => update({ assignee })}
          // The sibling picker chooses the repository; the panel never lists several projects.
          projects={[]}
          project={undefined}
          onProject={() => undefined}
        />
        <Button
          size="icon"
          variant="outline"
          aria-label={gt("Refresh issues")}
          onClick={list.refresh}
          disabled={list.isPending}
        >
          <RefreshIcon size="md" refreshing={list.isPending} />
        </Button>
      </div>
      {selectedRows.length > 0 ? (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {gt("{count} selected", { count: selectedRows.length })}
          </span>
          <IssueBulkLabelMenu environmentId={environmentId} rows={selectedRows} />
          <span className="flex-1" />
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setSelection({ keys: new Set(orderedKeys), anchor: selection.anchor })}
          >
            <T>Select all</T>
          </Button>
          <Button size="xs" variant="ghost" onClick={clearSelection}>
            <T context="verb, clears a selection">Clear</T>
          </Button>
        </div>
      ) : null}
      <div
        className="min-h-0 flex-1 overflow-y-auto py-2"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "a" && orderedKeys.length > 0) {
            event.preventDefault();
            setSelection({ keys: new Set(orderedKeys), anchor: selection.anchor });
          }
        }}
      >
        {linkedIssues.length > 0 ? (
          <section
            aria-label={gt("Linked issues")}
            className="mb-3 flex flex-col border-b border-border/60 px-1 pb-2"
          >
            <h2 className="px-2 py-1 text-xs font-medium text-muted-foreground">
              <T>Linked to this thread</T>
            </h2>
            <ThreadDetailsIssueRows
              links={linkedIssues}
              threadRef={threadRef}
              compact={false}
              mountScope="linked-items"
            />
          </section>
        ) : null}
        {body}
      </div>
    </>
  );
}

type IssueRowMenuAction =
  | "start-thread"
  | "add-to-composer"
  | "link"
  | "copy-link"
  | "open-external";

function useIssueRowMenu(
  threadRef: ScopedThreadRef,
  composerDraftTarget: ScopedThreadRef | DraftId,
) {
  const gt = useGT();
  const { start } = useStartIssueThread();
  const thread = useThreadShell(threadRef);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const link = useAtomCommand(threadEnvironment.linkIssue, { reportFailure: false });
  const unlink = useAtomCommand(threadEnvironment.unlinkIssue, { reportFailure: false });

  return async (row: EnvironmentIssueEntry, position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const key = { tracker: row.tracker, host: row.host, scope: row.scope, key: row.key };
    const linked = (thread?.issues ?? []).some((existing) => threadIssueKeysEqual(existing, key));
    const sameEnvironment = row.environmentId === threadRef.environmentId;
    const items: ContextMenuItem<IssueRowMenuAction>[] = [
      { id: "start-thread", label: gt("Start thread"), icon: "message-square-plus" },
      { id: "add-to-composer", label: gt("Add to composer") },
      ...(thread !== null && canOperate && sameEnvironment
        ? [
            {
              id: "link" as const,
              label: linked ? gt("Unlink from this thread") : gt("Link to this thread"),
            },
          ]
        : []),
      { id: "copy-link", label: gt("Copy link"), icon: "copy", separatorBefore: true },
      {
        id: "open-external",
        label: gt("Open on {provider}", {
          provider: issueTrackerPresentation(row.tracker).providerName,
        }),
      },
    ];
    const action = await api.contextMenu.show(items, position).catch(() => null);
    switch (action) {
      case "start-thread":
        return start(row.environmentId, row);
      case "add-to-composer":
        return addIssueToComposer(composerDraftTarget, row);
      case "link": {
        const input = { threadId: threadRef.threadId, ...key };
        const result = await (linked
          ? unlink({ environmentId: threadRef.environmentId, input })
          : link({
              environmentId: threadRef.environmentId,
              input: {
                ...input,
                projectId: row.projectId,
                url: row.url,
                displayKey: row.displayKey,
                title: row.title,
                source: "manual",
              },
            }));
        if (result._tag === "Failure") {
          toastManager.add({
            type: "error",
            title: linked ? gt("Could not unlink the issue") : gt("Could not link the issue"),
          });
        }
        return;
      }
      case "copy-link":
        return writeTextToClipboard(row.url, {
          target: "issue link",
          unavailableMessage: msg("Clipboard API is unavailable while copying the issue link."),
          failureMessage: msg("Failed to copy the issue link to the clipboard."),
        }).catch(() => toastManager.add({ type: "error", title: gt("Could not copy the link") }));
      case "open-external":
        return api.shell
          .openExternal(row.url)
          .catch(() => toastManager.add({ type: "error", title: gt("Could not open the link") }));
    }
  };
}
