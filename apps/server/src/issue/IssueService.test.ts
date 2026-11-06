import {
  IssueOperationError,
  type IssueSummary,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import type {
  SourceControlIssueListInput,
  SourceControlIssues,
} from "@t3tools/source-control-core/server/driver";
import { fakeSourceControlDriverInstance } from "@t3tools/source-control-testing/fakeSourceControlDriver";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as BuiltInDrivers from "../sourceControl/builtInDrivers.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";
import * as IssueService from "./IssueService.ts";

const issue = (host: string, repository: string, number: number, createdAt: string) =>
  ({
    host,
    repository,
    number,
    title: `Issue ${number}`,
    state: "open",
    url: `https://${host}/${repository}/issues/${number}`,
    author: null,
    labels: [],
    commentCount: 0,
    createdAt,
    updatedAt: "2026-10-04T00:00:00Z",
  }) satisfies IssueSummary;

const makeService = (issues: Partial<SourceControlIssues>) => {
  const kind = SourceControlProviderKind.make("github");
  const drivers = Layer.succeed(BuiltInDrivers.SourceControlDrivers, [
    {
      driver: { kind, definition: sourceControlDefinitions.get(kind) },
      instance: {
        ...fakeSourceControlDriverInstance(kind),
        issues: {
          list: () => Effect.succeed({ issues: [], hasMore: false }),
          detail: () => Effect.die("unused"),
          labelCandidates: () => Effect.die("unused"),
          setLabels: () => Effect.void,
          setState: () => Effect.void,
          ...issues,
        },
      },
    },
  ]);
  return IssueService.make.pipe(Effect.provide(drivers));
};

it.effect("lists each repository once and merges hosts, newest created first", () =>
  Effect.gen(function* () {
    const listed: Array<SourceControlIssueListInput> = [];
    const service = yield* makeService({
      list: (input) =>
        Effect.sync(() => {
          listed.push(input);
          return input.host === "github.com"
            ? {
                issues: [
                  issue("github.com", "acme/web", 1, "2026-10-03T00:00:00Z"),
                  issue("github.com", "acme/web", 2, "2026-10-01T00:00:00Z"),
                ],
                hasMore: false,
              }
            : {
                issues: [issue("ghe.acme.dev", "acme/api", 1, "2026-10-02T00:00:00Z")],
                hasMore: true,
              };
        }),
    });

    const result = yield* service.list({
      repositories: [
        { host: "github.com", repository: "acme/web" },
        { host: "GitHub.com", repository: "Acme/Web" },
        { host: "ghe.acme.dev", repository: "acme/api" },
      ],
      state: "open",
      labels: ["bug"],
      query: "crash",
      author: "OdCgarcia",
    });

    expect(listed).toEqual([
      {
        host: "github.com",
        repositories: ["acme/web"],
        state: "open",
        labels: ["bug"],
        query: "crash",
        author: "OdCgarcia",
        page: 1,
        perPage: 50,
      },
      {
        host: "ghe.acme.dev",
        repositories: ["acme/api"],
        state: "open",
        labels: ["bug"],
        query: "crash",
        author: "OdCgarcia",
        page: 1,
        perPage: 50,
      },
    ]);
    expect(result.issues.map(({ host, number }) => `${host}#${number}`)).toEqual([
      "github.com#1",
      "ghe.acme.dev#1",
      "github.com#2",
    ]);
    expect(result.hasMore).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.author).toBe("OdCgarcia");
  }),
);

it.effect("keeps the hosts it could read when another refuses", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      list: (input) =>
        input.host === "github.com"
          ? Effect.succeed({
              issues: [issue("github.com", "acme/web", 1, "2026-10-03T00:00:00Z")],
              hasMore: false,
            })
          : Effect.fail(
              new IssueOperationError({
                operation: "listIssues",
                host: input.host,
                reason: "unauthenticated",
                detail: "Sign in to ghe.acme.dev.",
              }),
            ),
    });

    const result = yield* service.list({
      repositories: [
        { host: "github.com", repository: "acme/web" },
        { host: "ghe.acme.dev", repository: "acme/api" },
      ],
      state: "all",
    });

    expect(result.issues).toHaveLength(1);
    expect(result.errors).toEqual([{ host: "ghe.acme.dev", message: "Sign in to ghe.acme.dev." }]);
  }),
);

it.effect("reads GitHub again after a label change instead of serving the cached list", () =>
  Effect.gen(function* () {
    let reads = 0;
    const service = yield* makeService({
      list: () => Effect.sync(() => (reads++, { issues: [], hasMore: false })),
    });
    const input = {
      repositories: [{ host: "github.com", repository: "acme/web" }],
      state: "open",
    } as const;

    yield* service.list(input);
    yield* service.list(input);
    expect(reads).toBe(1);

    yield* service.setLabels({
      host: "github.com",
      repository: "acme/web",
      number: 1,
      labels: ["bug"],
      applied: true,
    });
    yield* service.list(input);
    expect(reads).toBe(2);
  }),
);

it.effect("reads GitHub again after a state change instead of serving the cached list", () =>
  Effect.gen(function* () {
    let reads = 0;
    const service = yield* makeService({
      list: () => Effect.sync(() => (reads++, { issues: [], hasMore: false })),
    });
    const input = {
      repositories: [{ host: "github.com", repository: "acme/web" }],
      state: "open",
    } as const;

    yield* service.list(input);
    yield* service.setState({
      host: "github.com",
      repository: "acme/web",
      number: 1,
      state: "closed",
    });
    yield* service.list(input);
    expect(reads).toBe(2);
  }),
);

it.effect("reads GitHub for each author instead of sharing one cached list", () =>
  Effect.gen(function* () {
    let reads = 0;
    const service = yield* makeService({
      list: () => Effect.sync(() => (reads++, { issues: [], hasMore: false })),
    });
    const input = {
      repositories: [{ host: "github.com", repository: "acme/web" }],
      state: "open",
    } as const;

    yield* service.list({ ...input, author: "carlosfelgarcia" });
    yield* service.list({ ...input, author: "OdCgarcia" });
    yield* service.list(input);
    expect(reads).toBe(3);
  }),
);
