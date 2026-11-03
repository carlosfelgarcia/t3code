import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitHubIssues from "./GitHubIssues.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

type Answer = Effect.Effect<GitHubRest.GitHubRestResponse, GitHubRequestPolicy.GitHubApiError>;

const harness = (answer: (input: GitHubRest.GitHubRestInput) => Answer) => {
  const calls: Array<GitHubRest.GitHubRestInput> = [];
  const layer = Layer.succeed(
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
  return { calls, issues: GitHubIssues.make.pipe(Effect.provide(layer)) };
};

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

it.effect("lists issues across repositories, newest update first, without pull requests", () =>
  Effect.gen(function* () {
    const { calls, issues } = harness(() =>
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
    expect(url.searchParams.get("sort")).toBe("updated");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("per_page")).toBe("50");
    expect(url.searchParams.get("page")).toBe("2");
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

it.effect("reads an issue with its assignees and comments in order", () =>
  Effect.gen(function* () {
    const comment = (id: number, at: string) => ({
      id,
      user: octocat,
      body: `comment ${id}`,
      created_at: at,
      html_url: `https://github.com/acme/web/issues/12#issuecomment-${id}`,
    });
    const { calls, issues } = harness(({ path }) =>
      path.includes("/comments")
        ? ok([comment(1, "2026-10-02T10:00:00Z"), comment(2, "2026-10-03T09:00:00Z")])
        : ok(rawIssue),
    );
    const detail = yield* (yield* issues).detail(ref);

    expect(detail).toEqual({
      ...summary,
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
    expect(calls.map(({ path }) => path)).toEqual([
      "repos/acme/web/issues/12",
      "repos/acme/web/issues/12/comments?per_page=100&page=1",
    ]);
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
