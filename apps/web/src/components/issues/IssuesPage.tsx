import { RegistryContext } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type IssueListInput,
  type IssueListResult,
  type IssueListState,
  type IssueRef,
  type IssueSummary,
} from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CircleCheckIcon,
  CircleDotIcon,
  FolderGit2Icon,
  LayersIcon,
  ServerIcon,
  TagIcon,
  UserIcon,
} from "lucide-react";
import { useContext, useEffect, useState } from "react";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useAllEnvironmentShellsBootstrapped, useProjects } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PullRequestCompactFilterMenu } from "../pullRequest/PullRequestCompactFilterMenu";
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
import { IssueDetailPanel } from "./IssueDetailPanel";
import { IssueStateGlyph } from "./IssueStateGlyph";
import {
  effectiveIssueAuthor,
  issueActiveAccountMissing,
  ISSUE_AUTHOR_ALL,
  issueAuthorIgnored,
  issueAuthorOptions,
  type IssueLabelEdit,
  issueKey,
  issueRepositories,
  issueRepositoryKey,
  issueRowLabels,
} from "./issues.logic";

export interface IssuesSearch {
  readonly state: IssueListState;
  readonly q?: string | undefined;
  readonly labels?: ReadonlyArray<string>;
  /** Repository filter, as `host/owner/name`. */
  readonly repo?: string;
  /** GitHub login of whoever opened the issue, or `ISSUE_AUTHOR_ALL`. Absent: the default. */
  readonly author?: string;
  /** The environment whose GitHub credentials read the list. */
  readonly environmentId?: EnvironmentId;
  readonly host?: string;
  readonly repository?: string;
  readonly number?: number;
}

const SEARCH_DEBOUNCE_MS = 300;

/** `undefined` clears a key. */
type IssuesSearchPatch = { readonly [Key in keyof IssuesSearch]?: IssuesSearch[Key] | undefined };

const withQuery = (value: string) => (previous: IssuesSearch) => {
  const q = value.trim().slice(0, 200);
  return patchSearch(previous, { q: q.length === 0 ? undefined : q });
};

function patchSearch(previous: IssuesSearch, patch: IssuesSearchPatch): IssuesSearch {
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

export function IssuesPage() {
  const search = useSearch({ from: "/_chat/issues" });
  const navigate = useNavigate({ from: "/issues" });
  const registry = useContext(RegistryContext);
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const allProjects = useProjects();
  const projectsKnown = useAllEnvironmentShellsBootstrapped();
  const invalidate = useAtomCommand(issueEnvironment.invalidate, { reportFailure: false });

  const capableEnvironments = environments.filter(
    (environment) => environment.serverConfig !== null,
  );
  const capableIds = new Set(capableEnvironments.map((environment) => environment.environmentId));
  const environmentId =
    [search.environmentId, primaryEnvironmentId, capableEnvironments[0]?.environmentId].find(
      (id): id is EnvironmentId => id != null && capableIds.has(id),
    ) ?? null;
  const projects = allProjects.filter((project) => capableIds.has(project.environmentId));
  const repositories = issueRepositories(projects);
  const scopedRepositories =
    search.repo === undefined
      ? repositories
      : repositories.filter((repository) => issueRepositoryKey(repository) === search.repo);

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

  const updateSearch = (patch: IssuesSearchPatch) =>
    void navigate({ search: (previous) => patchSearch(previous, patch), replace: true });

  const refreshList = () => {
    if (environmentId === null) return;
    for (const input of pageInputs) {
      if (input !== null) registry.refresh(issueEnvironment.list({ environmentId, input }));
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
    void navigate({ search: withQuery(value), replace: true });
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- debounces typing into the URL; the timer must stop if the page unmounts.
  useEffect(() => {
    if (pendingQuery === null) return;
    const timer = setTimeout(() => {
      setPendingQuery(null);
      void navigate({ search: withQuery(pendingQuery), replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [navigate, pendingQuery]);

  const selected: IssueRef | null =
    search.host !== undefined && search.repository !== undefined && search.number !== undefined
      ? { host: search.host, repository: search.repository, number: search.number }
      : null;
  const select = (issue: IssueRef | null) =>
    void navigate({
      search: (previous) =>
        patchSearch(previous, {
          host: issue?.host,
          repository: issue?.repository,
          number: issue?.number,
        }),
    });

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
  const environmentOptions = capableEnvironments.map((environment) => ({
    value: environment.environmentId as string,
    label: `Read with ${environment.label}`,
    Icon: ServerIcon,
  }));
  const repositoryOptions = [
    { value: "", label: "All repositories", Icon: FolderGit2Icon },
    ...repositories.map((repository) => ({
      value: issueRepositoryKey(repository),
      label: repository.repository,
      Icon: FolderGit2Icon,
    })),
  ];

  const listBody = (() => {
    if (environmentId === null) {
      return <ListMessage>Connect to an environment to see issues.</ListMessage>;
    }
    if (repositories.length === 0) {
      return projectsKnown ? (
        <ListMessage>
          Issues currently support GitHub only, and none of your projects is backed by a GitHub
          repository.
        </ListMessage>
      ) : (
        <ListMessage>
          <Spinner aria-hidden /> Loading projects…
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
              selected={selected}
              labelEdits={labelEdits}
              onSelect={select}
              onLoadMore={() => setLoaded({ key: listKey, pages: pageCount + 1 })}
              onRetry={() => void refreshFromGitHub()}
            />
          ),
        )}
      </div>
    );
  })();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1">
        <div
          className={cn(
            "@container/pr-list min-h-0 min-w-0 flex-col overflow-x-hidden bg-background",
            selected === null
              ? "flex flex-1"
              : "hidden border-r border-border/60 lg:flex lg:w-[28rem] lg:shrink-0",
          )}
        >
          <WorkspacePageHeader electron={isElectron} className="relative bg-background">
            <WorkspaceBreadcrumb ariaLabel="Issues breadcrumb">
              <WorkspaceBreadcrumbItem current>
                <h1 className="truncate">Issues</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <div className="min-w-0 flex-1" />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Refresh issues"
              disabled={refreshing || environmentId === null}
              onClick={() => void refreshFromGitHub()}
            >
              <RefreshIcon size="md" refreshing={refreshing} />
            </Button>
          </WorkspacePageHeader>
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
            <div className="min-w-0 basis-full">
              <PullRequestSearchInput
                value={search.q ?? ""}
                placeholder="Search issue titles"
                label="Search issues"
                onChange={setPendingQuery}
                onSubmit={commitQuery}
              />
            </div>
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
                value={search.repo ?? ""}
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
                onChange={(next) => updateSearch({ author: next === "" ? ISSUE_AUTHOR_ALL : next })}
              />
            ) : null}
            <IssueLabelFilter
              options={labelOptions}
              selected={search.labels ?? []}
              onChange={(labels) =>
                updateSearch({ labels: labels.length === 0 ? undefined : labels })
              }
            />
            {environmentOptions.length > 1 && environmentId !== null ? (
              <PullRequestCompactFilterMenu
                label="Read issues with"
                outlined
                value={environmentId as string}
                options={environmentOptions}
                onChange={(next) => updateSearch({ environmentId: next as EnvironmentId })}
              />
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">{listBody}</div>
        </div>
        {selected !== null && environmentId !== null ? (
          <IssueDetailPanel
            key={issueKey(selected)}
            environmentId={environmentId}
            reference={selected}
            projects={projects}
            onBack={() => select(null)}
            onLabelsChanged={(issue, edit) => {
              setLabelEdits((current) => new Map(current).set(issueKey(issue), edit));
              refreshList();
            }}
          />
        ) : null}
      </div>
    </SidebarInset>
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
  selected,
  labelEdits,
  onSelect,
  onLoadMore,
  onRetry,
}: {
  environmentId: EnvironmentId;
  input: IssueListInput;
  last: boolean;
  selected: IssueRef | null;
  labelEdits: ReadonlyMap<string, IssueLabelEdit>;
  onSelect: (issue: IssueRef) => void;
  onLoadMore: () => void;
  onRetry: () => void;
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
      {input.page === 1 && result.issues.length === 0 ? (
        <ListMessage>No issues match these filters.</ListMessage>
      ) : null}
      {result.issues.map((issue) => (
        <IssueRow
          key={issueKey(issue)}
          issue={issue}
          labels={issueRowLabels(issue, labelEdits.get(issueKey(issue)))}
          selected={selected !== null && issueKey(selected) === issueKey(issue)}
          onSelect={onSelect}
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
  selected,
  onSelect,
}: {
  issue: IssueSummary;
  labels: IssueSummary["labels"];
  selected: boolean;
  onSelect: (issue: IssueRef) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      className={cn(
        PULL_REQUEST_ROW_CLASS,
        "px-3 py-2.5 hover:bg-accent/60",
        selected && "bg-accent",
      )}
      onClick={() =>
        onSelect({ host: issue.host, repository: issue.repository, number: issue.number })
      }
    >
      <span className="flex w-4 shrink-0 flex-col items-center">
        <IssueStateGlyph state={issue.state} />
      </span>
      <PullRequestRowLines
        number={<span className={PULL_REQUEST_ROW_NUMBER_CLASS}>#{issue.number}</span>}
        title={issue.title}
        meta={
          <span className="@container/pr-row-meta flex min-w-0 flex-1 items-center gap-1.5">
            <PullRequestRowLabels labels={labels} />
            <PullRequestRowAuthor actor={issue.author} />
            <span className="truncate">{issue.repository}</span>
          </span>
        }
        updatedAt={issue.updatedAt}
      />
    </button>
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
