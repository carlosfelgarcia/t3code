import {
  type IssueErrorReason,
  IssueOperationError,
  type IssueRef,
  type IssueSummary,
  type LinkedIssue,
  type PullRequestActor,
} from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import type { SourceControlIssues } from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { GraphQLClient } from "effect/graphql";

import * as GitHubGraphQlClient from "./gitHubGraphQlClient.ts";
import type * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";
import { IssueDependenciesGraphQLGroup } from "./issueDependencies.graphql.ts";

// GitHub's search API never pages past its first thousand results.
const SEARCH_RESULT_CAP = 1000;
const COMMENTS_PER_PAGE = 100;
const MAX_COMMENT_PAGES = 10;

const RawUser = Schema.Struct({
  login: Schema.String,
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.String),
});

const RawLabel = Schema.Struct({
  name: Schema.String,
  color: Schema.optional(Schema.NullOr(Schema.String)),
});

const RawIssue = Schema.Struct({
  node_id: Schema.optional(Schema.String),
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  html_url: Schema.String,
  repository_url: Schema.String,
  user: Schema.NullOr(RawUser),
  labels: Schema.Array(RawLabel),
  comments: Schema.Number,
  created_at: Schema.String,
  updated_at: Schema.String,
  /** Present only on pull requests, which GitHub serves through its issue endpoints too. */
  pull_request: Schema.optional(Schema.Unknown),
  /** Missing on GitHub Enterprise Server versions without issue dependencies. */
  issue_dependencies_summary: Schema.optional(Schema.Struct({ blocked_by: Schema.Number })),
});
type RawIssue = typeof RawIssue.Type;

const RawComment = Schema.Struct({
  id: Schema.Number,
  user: Schema.NullOr(RawUser),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  html_url: Schema.String,
});

const RawRepositoryLabel = Schema.Struct({
  ...RawLabel.fields,
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

const decodeIssue = decodeJsonResult(
  Schema.Struct({
    ...RawIssue.fields,
    body: Schema.optional(Schema.NullOr(Schema.String)),
    assignees: Schema.optional(Schema.NullOr(Schema.Array(RawUser))),
  }),
);
const decodeComments = decodeJsonResult(Schema.Array(RawComment));
const decodeLinkedIssues = decodeJsonResult(Schema.Array(RawIssue));
const decodeLabels = decodeJsonResult(Schema.Array(RawRepositoryLabel));

const decodeSearch = decodeJsonResult(
  Schema.Struct({ total_count: Schema.Number, items: Schema.Array(RawIssue) }),
);

const toActor = (user: typeof RawUser.Type | null): PullRequestActor | null =>
  user === null || user.login.trim().length === 0
    ? null
    : {
        login: user.login,
        name: null,
        avatarUrl: user.avatar_url ?? null,
        ...(user.type === "Bot" ? { isBot: true } : {}),
      };

const repositoryOf = (raw: RawIssue) => raw.repository_url.split("/").slice(-2).join("/");

const toSummary = (host: string, raw: RawIssue): IssueSummary => ({
  host,
  repository: repositoryOf(raw),
  number: raw.number,
  title: raw.title,
  state: raw.state === "closed" ? "closed" : "open",
  url: raw.html_url,
  author: toActor(raw.user),
  labels: raw.labels
    .filter((label) => label.name.trim().length > 0)
    .map((label) => ({ name: label.name, color: label.color ?? null })),
  commentCount: raw.comments,
  createdAt: raw.created_at,
  updatedAt: raw.updated_at,
  ...(raw.issue_dependencies_summary === undefined
    ? {}
    : { openBlockerCount: raw.issue_dependencies_summary.blocked_by }),
});

const IssueGraphQLGroup = IssueDependenciesGraphQLGroup.middleware(
  GitHubGraphQlClient.GitHubGraphQlAuth,
);

const quoted = (value: string) => `"${value.replaceAll('"', "")}"`;

const searchQuery = (input: Parameters<SourceControlIssues["list"]>[0]) =>
  [
    ...(input.query === undefined ? [] : [`${input.query} in:title`]),
    "is:issue",
    ...(input.state === "all" ? [] : [`state:${input.state}`]),
    ...input.repositories.map((repository) => `repo:${repository}`),
    ...input.labels.map((label) => `label:${quoted(label)}`),
    ...(input.author === undefined ? [] : [`author:${input.author}`]),
  ].join(" ");

const repositoryPath = (repository: string) =>
  `repos/${repository.split("/").map(encodeURIComponent).join("/")}`;

const issuePath = (ref: IssueRef) => `${repositoryPath(ref.repository)}/issues/${ref.number}`;

const reasonOf = (error: GitHubRequestPolicy.GitHubApiError): IssueErrorReason => {
  switch (error._tag) {
    case "GitHubCliMissingError":
    case "GitHubNotSignedInError":
    case "GitHubHostDisabledError":
    case "GitHubAppSessionError":
    case "GitHubApiAuthenticationError":
      return "unauthenticated";
    case "GitHubApiRateLimitError":
    case "SourceControlRateLimitPausedError":
      return "rate-limited";
    case "GitHubApiNotFoundError":
      return "not-found";
    case "GitHubApiResponseError":
      return error.status === 403 ? "forbidden" : "failed";
    default:
      return "failed";
  }
};

const describe = (
  reason: IssueErrorReason,
  operation: string,
  host: string,
  repository: string | undefined,
): string => {
  const where = repository ?? host;
  switch (reason) {
    case "unauthenticated":
      return `This environment has no working GitHub credential for ${host}. Sign in under Settings → Source control.`;
    case "rate-limited":
      return `GitHub's rate limit for ${host} is spent. Try again in a few minutes.`;
    case "not-found":
      return `GitHub could not find it in ${where}, or this environment's credential cannot see it.`;
    case "forbidden":
      switch (operation) {
        case "setIssueLabels":
          return `You don't have permission to change labels in ${where}.`;
        case "setIssueState":
          return `You don't have permission to close or reopen issues in ${where}.`;
        default:
          return `GitHub refused access to ${where}.`;
      }
    case "unsupported":
      return "Issues currently support GitHub only.";
    case "failed":
      return `GitHub could not complete ${operation} for ${where}.`;
  }
};

const issueError = (
  input: { operation: string; host: string; repository?: string | undefined },
  reason: IssueErrorReason,
  cause?: unknown,
) =>
  new IssueOperationError({
    operation: input.operation,
    host: input.host,
    ...(input.repository === undefined ? {} : { repository: input.repository }),
    reason,
    detail: describe(reason, input.operation, input.host, input.repository),
    ...(cause === undefined ? {} : { cause }),
  });

const toIssueError =
  (operation: string, host: string, repository?: string) =>
  (error: GitHubRequestPolicy.GitHubApiError): IssueOperationError =>
    issueError({ operation, host, repository }, reasonOf(error), error);

const decodeOrFail = <A, E>(
  decoded: Result.Result<A, E>,
  operation: string,
  host: string,
  repository?: string,
): Effect.Effect<A, IssueOperationError> =>
  Result.isSuccess(decoded)
    ? Effect.succeed(decoded.success)
    : Effect.fail(issueError({ operation, host, repository }, "failed", decoded.failure));

export const make = Effect.gen(function* () {
  const api = yield* GitHubRest.GitHubRest;
  const client = yield* GraphQLClient.make(IssueGraphQLGroup).pipe(
    Effect.provide(GitHubGraphQlClient.layer),
  );

  // Rows without them still show their count, so a failed read never fails the list.
  const openBlockers = Effect.fn("GitHubIssues.openBlockers")(
    function* (host: string, ids: ReadonlyArray<string>) {
      const blockers = new Map<string, ReadonlyArray<LinkedIssue>>();
      if (ids.length === 0) return blockers;
      const answer = yield* client
        .IssueBlockers({ ids })
        .pipe(GitHubGraphQlClient.call({ host, operation: "listIssueBlockers" }));
      for (const node of answer.nodes) {
        if (node?.__typename !== "Issue") continue;
        const open = (node.blockedBy.nodes ?? []).filter((blocker) => blocker?.state === "OPEN");
        blockers.set(
          node.id,
          open.flatMap((blocker) =>
            blocker === null
              ? []
              : [
                  {
                    host,
                    repository: blocker.repository.nameWithOwner,
                    number: blocker.number,
                    title: blocker.title,
                    state: "open" as const,
                  },
                ],
          ),
        );
      }
      return blockers;
    },
    Effect.orElseSucceed(() => new Map<string, ReadonlyArray<LinkedIssue>>()),
  );

  const list: SourceControlIssues["list"] = Effect.fn("GitHubIssues.list")(function* (input) {
    const params = new URLSearchParams({
      q: searchQuery(input),
      sort: "created",
      order: "desc",
      per_page: String(input.perPage),
      page: String(input.page),
    });
    const response = yield* api
      .rest({ host: input.host, operation: "listIssues", path: `search/issues?${params}` })
      .pipe(Effect.mapError(toIssueError("listIssues", input.host)));
    const answer = yield* decodeOrFail(decodeSearch(response.body), "listIssues", input.host);
    const items = answer.items.filter((raw) => raw.pull_request === undefined);
    const blockers = yield* openBlockers(
      input.host,
      items.flatMap((raw) =>
        raw.node_id !== undefined && (raw.issue_dependencies_summary?.blocked_by ?? 0) > 0
          ? [raw.node_id]
          : [],
      ),
    );
    return {
      issues: items.map((raw) => {
        const summary = toSummary(input.host, raw);
        const named = raw.node_id === undefined ? undefined : blockers.get(raw.node_id);
        return named === undefined ? summary : { ...summary, openBlockers: named };
      }),
      hasMore: input.page * input.perPage < Math.min(answer.total_count, SEARCH_RESULT_CAP),
    };
  });

  const setLabels: SourceControlIssues["setLabels"] = Effect.fn("GitHubIssues.setLabels")(
    function* (input) {
      const path = `${issuePath(input)}/labels`;
      const refusal = toIssueError("setIssueLabels", input.host, input.repository);
      if (input.applied) {
        yield* api
          .rest({
            host: input.host,
            operation: "setIssueLabels",
            method: "POST",
            path,
            body: { labels: input.labels },
          })
          .pipe(Effect.mapError(refusal));
        return;
      }
      yield* Effect.forEach(
        input.labels,
        (label) =>
          api
            .rest({
              host: input.host,
              operation: "setIssueLabels",
              method: "DELETE",
              path: `${path}/${encodeURIComponent(label)}`,
            })
            .pipe(
              // The label is already off the issue, which is what was asked for.
              Effect.catchTags({ GitHubApiNotFoundError: () => Effect.void }),
              Effect.mapError(refusal),
            ),
        { concurrency: 1, discard: true },
      );
    },
  );

  const setState: SourceControlIssues["setState"] = Effect.fn("GitHubIssues.setState")(
    function* (input) {
      yield* api
        .rest({
          host: input.host,
          operation: "setIssueState",
          method: "PATCH",
          path: issuePath(input),
          body: { state: input.state },
        })
        .pipe(Effect.mapError(toIssueError("setIssueState", input.host, input.repository)));
    },
  );

  const read = <A>(
    ref: Pick<IssueRef, "host" | "repository">,
    operation: string,
    path: string,
    decode: (body: string) => Result.Result<A, unknown>,
  ) =>
    api.rest({ host: ref.host, operation, path }).pipe(
      Effect.mapError(toIssueError(operation, ref.host, ref.repository)),
      Effect.flatMap((response) =>
        decodeOrFail(decode(response.body), operation, ref.host, ref.repository).pipe(
          Effect.map((value) => ({ value, headers: response.headers })),
        ),
      ),
    );

  const comments = Effect.fn("GitHubIssues.comments")(function* (ref: IssueRef) {
    const all: Array<typeof RawComment.Type> = [];
    for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
      const { value } = yield* read(
        ref,
        "listIssueComments",
        `${issuePath(ref)}/comments?per_page=${COMMENTS_PER_PAGE}&page=${page}`,
        decodeComments,
      );
      all.push(...value);
      if (value.length < COMMENTS_PER_PAGE) break;
    }
    return all;
  });

  // Hosts without issue dependencies still show the issue, just without these lists.
  const dependencies = (ref: IssueRef, direction: "blocked_by" | "blocking") =>
    read(
      ref,
      "listIssueDependencies",
      `${issuePath(ref)}/dependencies/${direction}?per_page=100`,
      decodeLinkedIssues,
    ).pipe(
      Effect.map(({ value }) =>
        value
          .map((raw): LinkedIssue => ({
            host: ref.host,
            repository: repositoryOf(raw),
            number: raw.number,
            title: raw.title,
            state: raw.state === "closed" ? "closed" : "open",
          }))
          .toSorted(
            (left, right) => Number(left.state === "closed") - Number(right.state === "closed"),
          ),
      ),
      Effect.option,
    );

  const detail: SourceControlIssues["detail"] = Effect.fn("GitHubIssues.detail")(function* (ref) {
    const [{ value: raw }, blockedBy, blocking] = yield* Effect.all(
      [
        read(ref, "readIssue", issuePath(ref), decodeIssue),
        dependencies(ref, "blocked_by"),
        dependencies(ref, "blocking"),
      ],
      { concurrency: "unbounded" },
    );
    if (raw.pull_request !== undefined) {
      return yield* new IssueOperationError({
        operation: "readIssue",
        host: ref.host,
        repository: ref.repository,
        reason: "not-found",
        detail: `#${ref.number} in ${ref.repository} is a pull request, not an issue.`,
      });
    }
    return {
      ...toSummary(ref.host, raw),
      body: raw.body ?? "",
      assignees: (raw.assignees ?? []).flatMap((user) => toActor(user) ?? []),
      comments: (yield* comments(ref)).map((comment) => ({
        id: String(comment.id),
        author: toActor(comment.user),
        body: comment.body ?? "",
        createdAt: comment.created_at,
        url: comment.html_url,
      })),
      ...(Option.isSome(blockedBy) ? { blockedBy: blockedBy.value } : {}),
      ...(Option.isSome(blocking) ? { blocking: blocking.value } : {}),
    };
  });

  const labelCandidates: SourceControlIssues["labelCandidates"] = Effect.fn(
    "GitHubIssues.labelCandidates",
  )(function* (ref) {
    const [repository, applied] = yield* Effect.all(
      [
        read(
          ref,
          "listRepositoryLabels",
          `${repositoryPath(ref.repository)}/labels?per_page=100`,
          decodeLabels,
        ),
        read(ref, "listIssueLabels", `${issuePath(ref)}/labels?per_page=100`, decodeLabels),
      ],
      { concurrency: 2 },
    );
    const appliedNames = new Set(applied.value.map((label) => label.name));
    const offered = new Set(repository.value.map((label) => label.name));
    return {
      candidates: [
        ...repository.value,
        // Labels on the issue beyond the first page of the repository's still need a way off.
        ...applied.value.filter((label) => !offered.has(label.name)),
      ].map((label) => ({
        name: label.name,
        color: label.color ?? null,
        description: label.description ?? null,
        isApplied: appliedNames.has(label.name),
      })),
      truncated: /rel="next"/.test(repository.headers["link"] ?? ""),
    };
  });

  return {
    list,
    detail,
    labelCandidates,
    setLabels,
    setState,
  } satisfies SourceControlIssues;
});
