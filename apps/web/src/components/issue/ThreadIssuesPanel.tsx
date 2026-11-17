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
import type {
  EnvironmentId,
  IssueInvolvement,
  IssueListInput,
  IssueListState,
  IssueListSort,
  ProjectId,
  ScopedThreadRef,
  SiblingRepository,
} from "@t3tools/contracts";
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
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { newProjectId } from "~/lib/utils";
import {
  type IssuesPanelSurface,
  selectActiveRightPanelSurface,
  useRightPanelStore,
} from "~/rightPanelStore";
import { useProject, useProjects } from "~/state/entities";
import { useEnvironment } from "~/state/environments";
import { issueEnvironment, useIssueList } from "~/state/issues";
import { projectEnvironment } from "~/state/projects";
import { useDebouncedValue } from "~/state/queries";
import { useAtomCommand } from "~/state/use-atom-command";

import { SiblingRepositoryPicker, useSiblingSelection } from "../SiblingRepositoryPicker";
import { IssueFiltersMenu } from "./IssueListFilterPickers";

const STATE_OPTIONS = [
  { value: "open", label: "Open", Icon: IssueGlyph.issue },
  { value: "closed", label: "Closed", Icon: CircleCheckIcon },
  { value: "all", label: "All", Icon: LayersIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListState>>;

const INVOLVEMENT_OPTIONS = [
  { value: "all", label: "Everyone", Icon: UsersIcon },
  { value: "assigned", label: "Assigned to me", Icon: UserCheckIcon },
  { value: "authored", label: "Opened by me", Icon: PenLineIcon },
  { value: "mentioned", label: "Mentioning me", Icon: AtSignIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueInvolvement>>;

const SORT_OPTIONS = [
  { value: "created", label: "Newest", Icon: CalendarArrowDownIcon },
  { value: "updated", label: "Recently updated", Icon: ClockIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<IssueListSort>>;

const PAGE_SIZE = 50;

/** The panel opens on open issues, newest first, unlike the page's recently-updated default. */
const DEFAULT_FILTERS: IssueListPreferences = { who: "all", status: "open", order: "created" };

interface ThreadIssuesPanelProps {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  surface: IssuesPanelSurface;
}

export function ThreadIssuesPanel({ projectId, ...props }: ThreadIssuesPanelProps) {
  const project = useProject(scopeProjectRef(props.threadRef.environmentId, projectId));
  return project === null ? null : <ProjectIssuesPanel {...props} project={project} />;
}

function ProjectIssuesPanel({
  threadRef,
  project,
  surface,
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
      setError(failure instanceof Error ? failure.message : "T3 Code could not add the project.");
    }
  };
  return (
    <Empty>
      <EmptyMedia variant="icon">
        <IssueGlyph.issue />
      </EmptyMedia>
      <EmptyHeader>
        <EmptyTitle>{sibling.name} is not a project yet</EmptyTitle>
        <EmptyDescription>
          {error ?? "Add it as a project to list its issues. It will show in the sidebar."}
        </EmptyDescription>
      </EmptyHeader>
      <Button size="sm" disabled={pending} onClick={() => void add()}>
        {pending ? "Adding…" : "Add as project"}
      </Button>
    </Empty>
  );
}

function IssueList({
  threadRef,
  project,
  filters,
  onFilters,
  picker,
}: {
  threadRef: ScopedThreadRef;
  project: EnvironmentProject;
  filters: IssueListPreferences;
  onFilters: (filters: IssueListPreferences) => void;
  picker: React.ReactNode;
}) {
  const environmentId = project.environmentId;
  const environment = useEnvironment(environmentId);
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
            ? { failure: failure instanceof Error ? failure.message : "The next page failed." }
            : result.value,
          cursors,
        ),
      ),
    );
  };

  const groups = groupIssues(held, debouncedQuery, projects, sort);
  const filterScopes = issueFilterScopes(held, projects);

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

  const update = (patch: Partial<IssueListPreferences>) => {
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
      title="Issues unavailable"
      error="Update this environment's T3 Code server to browse issues."
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
        <EmptyTitle>No issue tracker</EmptyTitle>
        <EmptyDescription>
          {project.title} has no remote on a supported tracker, and no tracker is bound to it.
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
                {group.tracker.detail ?? "This tracker cannot be read right now."}
              </p>
            ) : null}
            {group.errors.map((error) => (
              <p key={error.projectTitle} className="px-3 text-xs text-destructive">
                {error.message}
              </p>
            ))}
            {group.tracker.configured && group.rows.length === 0 && group.errors.length === 0 ? (
              <p className="px-3 text-sm text-muted-foreground">
                {debouncedQuery ? "Nothing matches that." : "No issues under these filters."}
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
                <IssueRow
                  key={key}
                  entry={row}
                  selected={selected}
                  showScope={showScope}
                  showTracker={false}
                  onSelect={openEntry}
                />
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
                    {loadingMore === group.tracker.host
                      ? "Loading…"
                      : moreFailure === null
                        ? "Load more"
                        : "Retry"}
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
            label="Search issues"
            placeholder="Search issues"
            busy={query !== debouncedQuery || (debouncedQuery.length > 0 && list.isPending)}
            onChange={setQuery}
            onSubmit={(q) => update({ q: q || undefined })}
          />
        </div>
        <PullRequestCompactFilterMenu
          label="Sort issues"
          triggerIcon={<ArrowDownUpIcon aria-hidden className="size-4" />}
          triggerLabel="Sort"
          outlined
          value={sort}
          options={SORT_OPTIONS}
          onChange={(order) => update({ order: order === "created" ? "created" : undefined })}
        />
        <IssueFiltersMenu
          state={filters.status}
          stateOptions={STATE_OPTIONS}
          onState={(status) => update({ status })}
          involvement={filters.who}
          involvementOptions={INVOLVEMENT_OPTIONS}
          onInvolvement={(who) => update({ who })}
          scopes={filterScopes}
          labels={filters.label ?? []}
          onLabels={(label) => update({ label })}
          assignee={filters.assignee}
          onAssignee={(assignee) => update({ assignee })}
        />
        <Button
          size="icon"
          variant="outline"
          aria-label="Refresh issues"
          onClick={list.refresh}
          disabled={list.isPending}
        >
          <RefreshIcon size="md" refreshing={list.isPending} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-2">{body}</div>
    </>
  );
}
