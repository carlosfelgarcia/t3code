import {
  ISSUE_LIST_PAGE_SIZE,
  type IssueDetail,
  type IssueLabelChangeInput,
  type IssueListInput,
  IssueListState,
  type IssueListResult,
  IssueOperationError,
  type IssueRef,
  type IssueStateChangeInput,
  type IssueSummary,
  type PullRequestLabelCandidateList,
} from "@t3tools/contracts";
import type { SourceControlIssues } from "@t3tools/source-control-core/server/driver";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as SourceControlBuiltInDrivers from "../sourceControl/builtInDrivers.ts";

// GitHub's search API allows 30 requests a minute; share identical reads briefly.
const LIST_CACHE_TTL = Duration.seconds(30);
const LIST_CACHE_CAPACITY = 64;

/** GitHub issues for the repositories behind the user's projects. */
export class IssueService extends Context.Service<
  IssueService,
  {
    readonly list: (input: IssueListInput) => Effect.Effect<IssueListResult, IssueOperationError>;
    readonly detail: (ref: IssueRef) => Effect.Effect<IssueDetail, IssueOperationError>;
    readonly labelCandidates: (
      ref: IssueRef,
    ) => Effect.Effect<PullRequestLabelCandidateList, IssueOperationError>;
    readonly setLabels: (input: IssueLabelChangeInput) => Effect.Effect<void, IssueOperationError>;
    readonly setState: (input: IssueStateChangeInput) => Effect.Effect<void, IssueOperationError>;
    readonly invalidate: Effect.Effect<void>;
  }
>()("t3/issue/IssueService") {}

const ListKey = Schema.Struct({
  epoch: Schema.Number,
  hosts: Schema.Array(Schema.Tuple([Schema.String, Schema.Array(Schema.String)])),
  state: IssueListState,
  labels: Schema.Array(Schema.String),
  query: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  page: Schema.Number,
});
type ListKey = typeof ListKey.Type;
const ListKeyJson = Schema.fromJsonString(ListKey);
const encodeListKey = Schema.encodeSync(ListKeyJson);
const decodeListKey = Schema.decodeSync(ListKeyJson);

// Matches GitHub's `sort=created`, so one repository reads in issue-number order.
const byNewestCreated = (left: IssueSummary, right: IssueSummary) =>
  right.createdAt.localeCompare(left.createdAt);

/** Several projects, on several environments, can point at one repository; list it once. */
const repositoriesByHost = (repositories: IssueListInput["repositories"]) => {
  const hosts = new Map<string, Map<string, string>>();
  for (const { host, repository } of repositories) {
    const normalizedHost = host.toLowerCase();
    const forHost = hosts.get(normalizedHost) ?? new Map<string, string>();
    hosts.set(normalizedHost, forHost);
    if (!forHost.has(repository.toLowerCase())) forHost.set(repository.toLowerCase(), repository);
  }
  return [...hosts].map(([host, forHost]) => [host, [...forHost.values()]] as const);
};

export const make = Effect.gen(function* () {
  const drivers = yield* SourceControlBuiltInDrivers.SourceControlDrivers;
  const github = drivers.find(({ driver }) => driver.kind === "github")?.instance.issues;
  let epoch = 0;

  const issuesFor = (
    host: string,
    operation: string,
  ): Effect.Effect<SourceControlIssues, IssueOperationError> =>
    github === undefined
      ? Effect.fail(
          new IssueOperationError({
            operation,
            host,
            reason: "unsupported",
            detail: "Issues currently support GitHub only, and this server cannot read GitHub.",
          }),
        )
      : Effect.succeed(github);

  const listUncached = Effect.fn("IssueService.readList")(function* (key: ListKey) {
    const reads = yield* Effect.forEach(
      key.hosts,
      ([host, repositories]) =>
        issuesFor(host, "listIssues").pipe(
          Effect.flatMap((issues) =>
            issues.list({
              host,
              repositories,
              state: key.state,
              labels: key.labels,
              query: key.query ?? undefined,
              author: key.author ?? undefined,
              page: key.page,
              perPage: ISSUE_LIST_PAGE_SIZE,
            }),
          ),
          Effect.result,
          Effect.map((result) => ({ host, result })),
        ),
      { concurrency: 4 },
    );
    const failures = reads.flatMap(({ host, result }) =>
      result._tag === "Failure" ? [{ host, error: result.failure }] : [],
    );
    const firstFailure = failures[0];
    if (firstFailure !== undefined && failures.length === reads.length) {
      return yield* firstFailure.error;
    }
    const seen = new Set<string>();
    const issues = reads
      .flatMap(({ result }) => (result._tag === "Success" ? result.success.issues : []))
      .filter((issue) => {
        const id = `${issue.host}\0${issue.repository.toLowerCase()}\0${issue.number}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .toSorted(byNewestCreated);
    return {
      issues,
      hasMore: reads.some(({ result }) => result._tag === "Success" && result.success.hasMore),
      errors: failures.map(({ host, error }) => ({ host, message: error.message })),
      ...(key.author === null ? {} : { author: key.author }),
    } satisfies IssueListResult;
  });

  const listCache = yield* Cache.makeWith((key: string) => listUncached(decodeListKey(key)), {
    capacity: LIST_CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? LIST_CACHE_TTL : Duration.zero),
  });

  return IssueService.of({
    list: Effect.fn("IssueService.list")(function* (input) {
      return yield* Cache.get(
        listCache,
        encodeListKey({
          epoch,
          hosts: repositoriesByHost(input.repositories),
          state: input.state,
          labels: input.labels ?? [],
          query: input.query ?? null,
          author: input.author ?? null,
          page: input.page ?? 1,
        }),
      );
    }),
    detail: Effect.fn("IssueService.detail")(function* (ref) {
      return yield* (yield* issuesFor(ref.host, "readIssue")).detail(ref);
    }),
    labelCandidates: Effect.fn("IssueService.labelCandidates")(function* (ref) {
      return yield* (yield* issuesFor(ref.host, "listIssueLabelCandidates")).labelCandidates(ref);
    }),
    setLabels: Effect.fn("IssueService.setLabels")(function* (input) {
      yield* (yield* issuesFor(input.host, "setIssueLabels")).setLabels(input);
      epoch++;
    }),
    setState: Effect.fn("IssueService.setState")(function* (input) {
      yield* (yield* issuesFor(input.host, "setIssueState")).setState(input);
      epoch++;
    }),
    invalidate: Effect.sync(() => {
      epoch++;
    }),
  });
});

export const layer = Layer.effect(IssueService, make);
