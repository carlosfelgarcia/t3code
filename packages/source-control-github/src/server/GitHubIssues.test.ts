import { expect, it } from "@effect/vitest";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as GitHubAppSignIn from "./GitHubAppSignIn.ts";
import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubIssues from "./GitHubIssues.ts";
import * as GitHubQuota from "./GitHubQuota.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

type Answer = Effect.Effect<GitHubRest.GitHubRestResponse, GitHubRequestPolicy.GitHubApiError>;

interface GraphQlCall {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

const harness = (
  answer: (input: GitHubRest.GitHubRestInput) => Answer,
  graphql: (call: GraphQlCall) => Response = () => new Response(null, { status: 500 }),
) => {
  const calls: Array<GitHubRest.GitHubRestInput> = [];
  const graphqlCalls: Array<GraphQlCall> = [];
  const rest = Layer.succeed(
    GitHubRest.GitHubRest,
    GitHubRest.GitHubRest.of({
      rest: (input) => {
        calls.push(input);
        return answer(input);
      },
      credential: () => Effect.die("unused"),
      appCredential: () => Effect.succeedNone,
    }),
  );
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const body = request.body;
        const call = JSON.parse(
          body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "{}",
        ) as GraphQlCall;
        graphqlCalls.push(call);
        return HttpClientResponse.fromWeb(request, graphql(call));
      }),
    ),
  );
  const policy = GitHubRequestPolicy.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        http,
        Layer.succeed(GitHubCredentials.GitHubCredentials, {
          get: (host) =>
            Effect.succeed({
              host,
              token: Redacted.make("secret"),
              source: "gh" as const,
              fingerprint: `${host}:secret`,
            }),
          saved: () => Effect.succeedNone,
          fingerprint: (host, token) => Effect.succeed(`${host}:${token}`),
          invalidate: () => Effect.void,
        }),
        Layer.mock(GitHubAppSignIn.GitHubAppSignIn)({
          enabled: false,
          token: () => Effect.succeedNone,
          invalidate: () => Effect.void,
        }),
        GitHubQuota.layer,
        SourceControlRateLimit.layer,
      ),
    ),
  );
  return {
    calls,
    graphqlCalls,
    issues: GitHubIssues.make.pipe(Effect.provide(Layer.merge(rest, policy))),
  };
};

const graphqlAnswer = (data: unknown) =>
  new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  Effect.succeed({
    status: 200,
    headers,
    body: JSON.stringify(body),
    truncated: false,
    invalidUtf8: false,
  });

const refused = (status: number, message: string) =>
  Effect.fail(
    new GitHubRequestPolicy.GitHubApiResponseError({
      host: "github.com",
      operation: "test",
      status,
      githubErrors: [message],
    }),
  );

const octocat = { login: "octocat", avatar_url: "https://avatars/octocat", type: "User" };
const rawIssue = {
  number: 12,
  title: "Crash on start",
  state: "open",
  html_url: "https://github.com/acme/web/issues/12",
  repository_url: "https://api.github.com/repos/acme/web",
  user: octocat,
  labels: [{ name: "bug", color: "d73a4a" }],
  comments: 2,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-03T10:00:00Z",
  body: "It crashes.",
  assignees: [octocat],
};
const summary = {
  host: "github.com",
  repository: "acme/web",
  number: 12,
  title: "Crash on start",
  state: "open",
  url: "https://github.com/acme/web/issues/12",
  author: { login: "octocat", name: null, avatarUrl: "https://avatars/octocat" },
  labels: [{ name: "bug", color: "d73a4a" }],
  commentCount: 2,
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-03T10:00:00Z",
};
const ref = { host: "github.com", repository: "acme/web", number: 12 };

it.effect("lists issues across repositories, newest first, without pull requests", () =>
  Effect.gen(function* () {
    const { calls, graphqlCalls, issues } = harness(() =>
      ok({
        total_count: 120,
        items: [
          rawIssue,
          {
            ...rawIssue,
            number: 13,
            html_url: "https://github.com/acme/web/pull/13",
            pull_request: { url: "https://api.github.com/repos/acme/web/pulls/13" },
          },
        ],
      }),
    );
    const result = yield* (yield* issues).list({
      host: "github.com",
      repositories: ["acme/web", "acme/api"],
      state: "open",
      labels: ["needs triage"],
      query: "crash",
      author: "OdCgarcia",
      page: 2,
      perPage: 50,
    });

    expect(result).toEqual({ issues: [summary], hasMore: true });
    const url = new URL(`https://api.github.com/${calls[0]?.path}`);
    expect(url.pathname).toBe("/search/issues");
    expect(url.searchParams.get("q")).toBe(
      'crash in:title is:issue state:open repo:acme/web repo:acme/api label:"needs triage" author:OdCgarcia',
    );
    expect(url.searchParams.get("sort")).toBe("created");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("page")).toBe("2");
    expect(graphqlCalls).toEqual([]);
  }),
);

const blockedPage = {
  host: "github.com",
  repositories: ["acme/web"],
  state: "open",
  labels: [],
  query: undefined,
  author: undefined,
  page: 1,
  perPage: 50,
} as const;

it.effect("names the open blockers of each blocked issue on a page in one request", () =>
  Effect.gen(function* () {
    const blocked = {
      ...rawIssue,
      node_id: "I_12",
      issue_dependencies_summary: { blocked_by: 2, total_blocked_by: 3 },
    };
    const clear = {
      ...rawIssue,
      number: 14,
      node_id: "I_14",
      issue_dependencies_summary: { blocked_by: 0, total_blocked_by: 1 },
    };
    const blocker = (number: number, state: string, repository = "acme/web") => ({
      number,
      title: `Blocker ${number}`,
      state,
      repository: { nameWithOwner: repository },
    });
    const { graphqlCalls, issues } = harness(
      () => ok({ total_count: 2, items: [blocked, clear] }),
      () =>
        graphqlAnswer({
          nodes: [
            {
              __typename: "Issue",
              id: "I_12",
              blockedBy: {
                nodes: [blocker(3, "OPEN"), blocker(4, "CLOSED"), blocker(9, "OPEN", "acme/api")],
              },
            },
          ],
        }),
    );
    const result = yield* (yield* issues).list(blockedPage);

    expect(result.issues).toEqual([
      {
        ...summary,
        openBlockerCount: 2,
        openBlockers: [
          {
            host: "github.com",
            repository: "acme/web",
            number: 3,
            title: "Blocker 3",
            state: "open",
          },
          {
            host: "github.com",
            repository: "acme/api",
            number: 9,
            title: "Blocker 9",
            state: "open",
          },
        ],
      },
      { ...summary, number: 14, openBlockerCount: 0 },
    ]);
    expect(graphqlCalls.map(({ variables }) => variables)).toEqual([{ ids: ["I_12"] }]);
  }),
);

it.effect(
  "lists why each closed issue was closed, as completed where GitHub records no reason",
  () =>
    Effect.gen(function* () {
      const closed = (number: number, state_reason: string | null) => ({
        ...rawIssue,
        number,
        state: "closed",
        state_reason,
      });
      const { issues } = harness(() =>
        ok({
          total_count: 5,
          items: [
            { ...rawIssue, state_reason: "reopened" },
            closed(20, "completed"),
            closed(21, "not_planned"),
            closed(22, "duplicate"),
            closed(23, null),
          ],
        }),
      );
      const result = yield* (yield* issues).list(blockedPage);

      expect(
        result.issues.map(({ number, state, closeReason }) => [number, state, closeReason]),
      ).toEqual([
        [12, "open", undefined],
        [20, "closed", "completed"],
        [21, "closed", "not-planned"],
        [22, "closed", "duplicate"],
        [23, "closed", "completed"],
      ]);
    }),
);

it.effect("lists a parent issue's sub-issue progress, and none for issues without sub-issues", () =>
  Effect.gen(function* () {
    const { issues } = harness(() =>
      ok({
        total_count: 3,
        items: [
          { ...rawIssue, sub_issues_summary: { total: 7, completed: 3, percent_completed: 42 } },
          { ...rawIssue, number: 13, sub_issues_summary: { total: 0, completed: 0 } },
          { ...rawIssue, number: 14 },
        ],
      }),
    );
    const result = yield* (yield* issues).list(blockedPage);

    expect(result.issues).toEqual([
      { ...summary, subIssueProgress: { completed: 3, total: 7 } },
      { ...summary, number: 13 },
      { ...summary, number: 14 },
    ]);
  }),
);

it.effect("still lists blocked issues by count when their blockers cannot be read", () =>
  Effect.gen(function* () {
    const { issues } = harness(() =>
      ok({
        total_count: 1,
        items: [{ ...rawIssue, node_id: "I_12", issue_dependencies_summary: { blocked_by: 1 } }],
      }),
    );
    const result = yield* (yield* issues).list(blockedPage);

    expect(result.issues).toEqual([{ ...summary, openBlockerCount: 1 }]);
  }),
);

it.effect("adds labels in one request and removes them one at a time", () =>
  Effect.gen(function* () {
    const { calls, issues } = harness(() => ok([]));
    const service = yield* issues;
    yield* service.setLabels({ ...ref, labels: ["bug", "good first issue"], applied: true });
    yield* service.setLabels({ ...ref, labels: ["bug", "good first issue"], applied: false });

    expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      {
        method: "POST",
        path: "repos/acme/web/issues/12/labels",
        body: { labels: ["bug", "good first issue"] },
      },
      { method: "DELETE", path: "repos/acme/web/issues/12/labels/bug", body: undefined },
      {
        method: "DELETE",
        path: "repos/acme/web/issues/12/labels/good%20first%20issue",
        body: undefined,
      },
    ]);
  }),
);

it.effect("names the repository when GitHub refuses a label change", () =>
  Effect.gen(function* () {
    const { issues } = harness(() => refused(403, "Must have admin rights to Repository."));
    const error = yield* (yield* issues)
      .setLabels({ ...ref, labels: ["bug"], applied: true })
      .pipe(Effect.flip);

    expect(error).toMatchObject({
      _tag: "IssueOperationError",
      reason: "forbidden",
      repository: "acme/web",
      message: "You don't have permission to change labels in acme/web.",
    });
  }),
);

it.effect("treats removing a label the issue no longer has as done", () =>
  Effect.gen(function* () {
    const { issues } = harness(() =>
      Effect.fail(
        new GitHubRequestPolicy.GitHubApiNotFoundError({ host: "github.com", operation: "test" }),
      ),
    );
    yield* (yield* issues).setLabels({ ...ref, labels: ["bug"], applied: false });
  }),
);

it.effect("closes and reopens an issue by patching its state", () =>
  Effect.gen(function* () {
    const { calls, issues } = harness(() => ok(rawIssue));
    const service = yield* issues;
    yield* service.setState({ ...ref, state: "closed" });
    yield* service.setState({ ...ref, state: "open" });

    expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: "PATCH", path: "repos/acme/web/issues/12", body: { state: "closed" } },
      { method: "PATCH", path: "repos/acme/web/issues/12", body: { state: "open" } },
    ]);
  }),
);

it.effect("names the repository when GitHub refuses a state change", () =>
  Effect.gen(function* () {
    const { issues } = harness(() => refused(403, "Must have triage rights to Repository."));
    const error = yield* (yield* issues).setState({ ...ref, state: "closed" }).pipe(Effect.flip);

    expect(error).toMatchObject({
      _tag: "IssueOperationError",
      reason: "forbidden",
      repository: "acme/web",
      message: "You don't have permission to close or reopen issues in acme/web.",
    });
  }),
);

it.effect("reads an issue with its assignees and comments in order", () =>
  Effect.gen(function* () {
    const comment = (id: number, at: string) => ({
      id,
      user: octocat,
      body: `comment ${id}`,
      created_at: at,
      html_url: `https://github.com/acme/web/issues/12#issuecomment-${id}`,
    });
    const linked = (number: number, state: string, repository = "acme/web") => ({
      ...rawIssue,
      number,
      title: `Issue ${number}`,
      state,
      repository_url: `https://api.github.com/repos/${repository}`,
    });
    const { calls, issues } = harness(({ path }) =>
      path.includes("/comments")
        ? ok([comment(1, "2026-10-02T10:00:00Z"), comment(2, "2026-10-03T09:00:00Z")])
        : path.includes("/dependencies/blocked_by")
          ? ok([linked(3, "closed"), linked(9, "open", "acme/api")])
          : path.includes("/dependencies/blocking")
            ? ok([linked(20, "open")])
            : ok(rawIssue),
    );
    const detail = yield* (yield* issues).detail(ref);

    expect(detail).toEqual({
      ...summary,
      blockedBy: [
        { host: "github.com", repository: "acme/api", number: 9, title: "Issue 9", state: "open" },
        {
          host: "github.com",
          repository: "acme/web",
          number: 3,
          title: "Issue 3",
          state: "closed",
          closeReason: "completed",
        },
      ],
      blocking: [
        {
          host: "github.com",
          repository: "acme/web",
          number: 20,
          title: "Issue 20",
          state: "open",
        },
      ],
      body: "It crashes.",
      assignees: [summary.author],
      comments: [
        {
          id: "1",
          author: summary.author,
          body: "comment 1",
          createdAt: "2026-10-02T10:00:00Z",
          url: "https://github.com/acme/web/issues/12#issuecomment-1",
        },
        {
          id: "2",
          author: summary.author,
          body: "comment 2",
          createdAt: "2026-10-03T09:00:00Z",
          url: "https://github.com/acme/web/issues/12#issuecomment-2",
        },
      ],
    });
    expect(calls.map(({ path }) => path).toSorted()).toEqual([
      "repos/acme/web/issues/12",
      "repos/acme/web/issues/12/comments?per_page=100&page=1",
      "repos/acme/web/issues/12/dependencies/blocked_by?per_page=100",
      "repos/acme/web/issues/12/dependencies/blocking?per_page=100",
    ]);
  }),
);

it.effect("reads an issue's sub-issues in their parent's order, and its own parent issue", () =>
  Effect.gen(function* () {
    const linked = (number: number, state: string, state_reason: string | null = null) => ({
      ...rawIssue,
      number,
      title: `Issue ${number}`,
      state,
      state_reason,
    });
    const { calls, issues } = harness(({ path }) =>
      path.includes("/sub_issues")
        ? ok([linked(30, "closed", "not_planned"), linked(31, "open"), linked(29, "closed")])
        : path.endsWith("/parent")
          ? ok({ ...linked(1, "open"), repository_url: "https://api.github.com/repos/acme/api" })
          : path.includes("/comments")
            ? ok([])
            : path.includes("/dependencies/")
              ? ok([])
              : ok({
                  ...rawIssue,
                  sub_issues_summary: { total: 3, completed: 2 },
                  parent_issue_url: "https://api.github.com/repos/acme/api/issues/1",
                }),
    );
    const detail = yield* (yield* issues).detail(ref);

    const issue = (number: number) => ({
      host: "github.com",
      repository: "acme/web",
      number,
      title: `Issue ${number}`,
    });
    expect(detail.subIssueProgress).toEqual({ completed: 2, total: 3 });
    expect(detail.subIssues).toEqual([
      { ...issue(30), state: "closed", closeReason: "not-planned" },
      { ...issue(31), state: "open" },
      { ...issue(29), state: "closed", closeReason: "completed" },
    ]);
    expect(detail.parentIssue).toEqual({ ...issue(1), repository: "acme/api", state: "open" });
    expect(calls.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "repos/acme/web/issues/12/sub_issues?per_page=100",
        "repos/acme/web/issues/12/parent",
      ]),
    );
  }),
);

it.effect(
  "reads an issue without its dependencies, sub-issues or parent when GitHub cannot list them",
  () =>
    Effect.gen(function* () {
      const { issues } = harness(({ path }) =>
        path.includes("/dependencies/") || path.includes("/sub_issues") || path.endsWith("/parent")
          ? refused(404, "Not Found")
          : path.includes("/comments")
            ? ok([])
            : ok({
                ...rawIssue,
                sub_issues_summary: { total: 2, completed: 0 },
                parent_issue_url: "https://api.github.com/repos/acme/web/issues/1",
              }),
      );
      const detail = yield* (yield* issues).detail(ref);

      expect(detail).toEqual({
        ...summary,
        subIssueProgress: { completed: 0, total: 2 },
        body: "It crashes.",
        assignees: [summary.author],
        comments: [],
      });
    }),
);

it.effect("does not read a pull request as an issue", () =>
  Effect.gen(function* () {
    const { issues } = harness(() => ok({ ...rawIssue, pull_request: {} }));
    const error = yield* (yield* issues).detail(ref).pipe(Effect.flip);

    expect(error).toMatchObject({
      reason: "not-found",
      message: "#12 in acme/web is a pull request, not an issue.",
    });
  }),
);

it.effect("offers the repository's labels, marking the ones on the issue", () =>
  Effect.gen(function* () {
    const { issues } = harness(({ path }) =>
      path.startsWith("repos/acme/web/issues/12/labels")
        ? ok([
            { name: "bug", color: "d73a4a" },
            { name: "deleted", color: "ffffff" },
          ])
        : ok(
            [
              { name: "bug", color: "d73a4a", description: "Broken" },
              { name: "docs", color: "0075ca", description: null },
            ],
            { link: '<https://api.github.com/repositories/1/labels?page=2>; rel="next"' },
          ),
    );

    expect(yield* (yield* issues).labelCandidates(ref)).toEqual({
      candidates: [
        { name: "bug", color: "d73a4a", description: "Broken", isApplied: true },
        { name: "docs", color: "0075ca", description: null, isApplied: false },
        { name: "deleted", color: "ffffff", description: null, isApplied: true },
      ],
      truncated: true,
    });
  }),
);
