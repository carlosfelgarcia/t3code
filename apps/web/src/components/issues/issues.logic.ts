import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import type {
  IssueDefaultAuthor,
  IssueListResult,
  IssueRef,
  IssueRepository,
  IssueSummary,
  PullRequestLabel,
  SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";

type IssueProject = Pick<EnvironmentProject, "isScratch" | "repositoryIdentity">;

/**
 * The GitHub repositories behind a project's git remotes: the one its identity names (the
 * `upstream` remote of a fork) and, for a fork, the `origin` the user pushes to.
 */
function issueRepositoriesOf(project: IssueProject): ReadonlyArray<IssueRepository> {
  const identity = project.repositoryIdentity;
  if (project.isScratch || identity == null || identity.provider !== "github") return [];
  const own = {
    repository: sourceControlClients.repositorySelector(identity),
    host: sourceControlClients.changeRequestHost(identity, undefined),
  };
  const origin = identity.origin;
  const originUrl = origin?.remoteUrl;
  const fork =
    origin === undefined ||
    originUrl === undefined ||
    sourceControlClients.recognizeRemote(originUrl)?.kind !== "github"
      ? null
      : {
          repository: origin.displayName ?? null,
          host: sourceControlClients.changeRequestHost(
            { canonicalKey: origin.canonicalKey, locator: { remoteUrl: originUrl } },
            undefined,
          ),
        };
  return [own, fork].flatMap((entry) =>
    entry === null || entry.repository === null || entry.host === undefined
      ? []
      : [{ host: entry.host, repository: entry.repository }],
  );
}

export const issueRepositoryKey = ({ host, repository }: IssueRepository) =>
  `${host.toLowerCase()}/${repository.toLowerCase()}`;

/** Each repository once, however many projects or environments point at it, in a stable order. */
export function issueRepositories(
  projects: ReadonlyArray<IssueProject>,
): ReadonlyArray<IssueRepository> {
  const byKey = new Map<string, IssueRepository>();
  for (const project of projects) {
    for (const repository of issueRepositoriesOf(project)) {
      if (!byKey.has(issueRepositoryKey(repository))) {
        byKey.set(issueRepositoryKey(repository), repository);
      }
    }
  }
  return [...byKey.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([, repository]) => repository);
}

export function projectsForRepository<Project extends IssueProject>(
  projects: ReadonlyArray<Project>,
  repository: IssueRepository,
): ReadonlyArray<Project> {
  const key = issueRepositoryKey(repository);
  return projects.filter((project) =>
    issueRepositoriesOf(project).some((own) => issueRepositoryKey(own) === key),
  );
}

/** Only the reference: the agent reads the body and comments itself, with its own GitHub access. */
export function issueThreadPrompt(
  issue: Pick<IssueRef, "number"> & { title: string; url: string },
) {
  return `GitHub issue #${issue.number}: ${issue.title}\n${issue.url}`;
}

export const issueKey = (issue: IssueRef) => `${issueRepositoryKey(issue)}#${issue.number}`;

const ROW_BLOCKERS_SHOWN = 3;

/** `#12` within the same repository, `owner/repo#12` across repositories. */
export const issueReference = (from: IssueRef, to: IssueRef) =>
  issueRepositoryKey(from) === issueRepositoryKey(to)
    ? `#${to.number}`
    : `${to.repository}#${to.number}`;

/** Null when the issue has no open blocker, so the row stays unmarked. */
export function issueBlockedMarker(
  issue: IssueSummary,
): { readonly text: string; readonly tooltip: ReadonlyArray<string> } | null {
  const named = issue.openBlockers ?? [];
  const count = Math.max(issue.openBlockerCount ?? 0, named.length);
  if (count === 0) return null;
  if (named.length === 0) {
    const issues = count === 1 ? "issue" : "issues";
    return {
      text: `Blocked by ${count} ${issues}`,
      tooltip: [`Blocked by ${count} open ${issues}`],
    };
  }
  const shown = named.slice(0, ROW_BLOCKERS_SHOWN).map((blocker) => issueReference(issue, blocker));
  const hidden = count - shown.length;
  return {
    text: `Blocked by ${shown.join(", ")}${hidden > 0 ? ` +${hidden}` : ""}`,
    tooltip: [
      ...named.map((blocker) => `${issueReference(issue, blocker)} ${blocker.title}`),
      ...(count > named.length ? [`and ${count - named.length} more`] : []),
    ],
  };
}

export interface IssueLabelEdit {
  /** When the edit was made against; GitHub's search index lags, so older rows are stale. */
  readonly staleUpdatedAt: string;
  readonly labels: ReadonlyArray<PullRequestLabel>;
}

/** A row's labels, preferring a just-made edit until the list catches up with it. */
export function issueRowLabels(
  issue: IssueSummary,
  edit: IssueLabelEdit | undefined,
): ReadonlyArray<PullRequestLabel> {
  return edit !== undefined && issue.updatedAt <= edit.staleUpdatedAt ? edit.labels : issue.labels;
}

type IssueAuthorProviders = ReadonlyArray<{
  readonly kind: SourceControlProviderDiscoveryItem["kind"];
  readonly auth: Pick<SourceControlProviderDiscoveryItem["auth"], "accounts">;
}>;

export const githubAccounts = (providers: IssueAuthorProviders) =>
  providers.flatMap((provider) =>
    provider.kind === "github" ? (provider.auth.accounts ?? []) : [],
  );

export const activeGithubLogin = (providers: IssueAuthorProviders) =>
  githubAccounts(providers).find((account) => account.active && account.authenticated)?.account;

export interface IssueAuthorOption {
  readonly value: string;
  readonly label: string;
}

/**
 * All, then every GitHub login signed in on the environment, A–Z. An author from the URL stays
 * listed (in its own casing, so it matches the selection) even when it is not an account.
 * Empty when there is nothing to offer.
 */
export function issueAuthorOptions(
  providers: IssueAuthorProviders,
  author: string | undefined,
): ReadonlyArray<IssueAuthorOption> {
  const byKey = new Map<string, string>();
  const logins = [
    ...(author === undefined ? [] : [author]),
    ...githubAccounts(providers).map(({ account }) => account),
  ];
  for (const login of logins) {
    if (!byKey.has(login.toLowerCase())) byKey.set(login.toLowerCase(), login);
  }
  if (byKey.size === 0) return [];
  return [
    { value: "", label: "All" },
    ...[...byKey.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([, login]) => ({ value: login, label: login })),
  ];
}

/** The URL's `author` when All was picked on the page, so the default does not come back. */
export const ISSUE_AUTHOR_ALL = "*";

export function effectiveIssueAuthor(
  urlAuthor: string | undefined,
  setting: IssueDefaultAuthor,
  providers: IssueAuthorProviders,
): string | undefined {
  if (urlAuthor === ISSUE_AUTHOR_ALL) return undefined;
  if (urlAuthor !== undefined) return urlAuthor;
  if (setting === "all") return undefined;
  return setting === "active-account" ? activeGithubLogin(providers) : setting.login;
}

/** True when the default is the active gh account but the environment has none signed in. */
export function issueActiveAccountMissing(
  urlAuthor: string | undefined,
  setting: IssueDefaultAuthor,
  providers: IssueAuthorProviders,
): boolean {
  return (
    urlAuthor === undefined &&
    setting === "active-account" &&
    activeGithubLogin(providers) === undefined
  );
}

/** True when the server listed issues without the author filter it was asked for. */
export function issueAuthorIgnored(
  author: string | undefined,
  result: Pick<IssueListResult, "author">,
): boolean {
  return author !== undefined && result.author === undefined;
}
