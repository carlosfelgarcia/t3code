import {
  type IssueSummary,
  type RepositoryIdentity,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  effectiveIssueAuthor,
  issueActiveAccountMissing,
  issueBlockedMarker,
  ISSUE_AUTHOR_ALL,
  issueAuthorIgnored,
  issueAuthorOptions,
  issueBulkLabelChange,
  issueBulkLabels,
  issueRepositories,
  issueRowLabels,
  issueRowState,
  projectsForRepository,
} from "./issues.logic";

const github = (
  owner: string,
  name: string,
  origin?: RepositoryIdentity["origin"],
): RepositoryIdentity => ({
  canonicalKey: `github.com/${owner.toLowerCase()}/${name.toLowerCase()}`,
  locator: {
    source: "git-remote",
    remoteName: origin === undefined ? "origin" : "upstream",
    remoteUrl: `https://github.com/${owner}/${name}.git`,
  },
  provider: SourceControlProviderKind.make("github"),
  owner,
  name,
  displayName: `${owner}/${name}`,
  ...(origin === undefined ? {} : { origin }),
});

const fork = {
  canonicalKey: "github.com/me/web",
  remoteUrl: "https://github.com/me/web.git",
  displayName: "me/web",
};

describe("issueRepositories", () => {
  it("lists each GitHub repository once, with a fork's own repository beside its upstream", () => {
    expect(
      issueRepositories([
        { repositoryIdentity: github("acme", "web", fork) },
        { repositoryIdentity: github("Acme", "Web") },
        { repositoryIdentity: github("acme", "api"), isScratch: true },
        {
          repositoryIdentity: {
            ...github("acme", "lab"),
            provider: SourceControlProviderKind.make("gitlab"),
          },
        },
        { repositoryIdentity: null },
      ]),
    ).toEqual([
      { host: "github.com", repository: "acme/web" },
      { host: "github.com", repository: "me/web" },
    ]);
  });

  it("finds the projects behind a fork's repository", () => {
    const upstreamOnly = { repositoryIdentity: github("acme", "web") };
    const withFork = { repositoryIdentity: github("acme", "web", fork) };
    expect(
      projectsForRepository([upstreamOnly, withFork], { host: "github.com", repository: "Me/Web" }),
    ).toEqual([withFork]);
  });
});

describe("issueRowLabels", () => {
  const issue = {
    updatedAt: "2026-10-03T10:00:00Z",
    labels: [{ name: "bug", color: "d73a4a" }],
  } as Pick<IssueSummary, "updatedAt" | "labels"> as IssueSummary;
  const edit = {
    staleUpdatedAt: "2026-10-03T10:00:00Z",
    labels: [{ name: "ready-for-agent", color: null }],
  };

  it("shows a just-made label edit while the list still holds the read from before it", () => {
    expect(issueRowLabels(issue, edit)).toEqual(edit.labels);
  });

  it("trusts the list again once it carries a newer read of the issue", () => {
    expect(issueRowLabels({ ...issue, updatedAt: "2026-10-03T10:00:05Z" }, edit)).toEqual(
      issue.labels,
    );
  });
});

describe("issueRowState", () => {
  const issue = { updatedAt: "2026-10-03T10:00:00Z", state: "open" } as const;
  const edit = { staleUpdatedAt: "2026-10-03T10:00:00Z", state: "closed" } as const;

  it("shows a just-made state change while the list still holds the read from before it", () => {
    expect(issueRowState(issue, edit)).toBe("closed");
  });

  it("trusts the list again once it carries a newer read of the issue", () => {
    expect(issueRowState({ ...issue, updatedAt: "2026-10-03T10:00:05Z" }, edit)).toBe("open");
  });

  it("keeps the listed state when the issue has not been changed here", () => {
    expect(issueRowState(issue, undefined)).toBe("open");
  });
});

describe("issueBulkLabels", () => {
  const bug = { name: "bug", color: "d73a4a", description: null, isApplied: false };
  const docs = { name: "docs", color: "0075ca", description: "Documentation", isApplied: false };
  const feature = { name: "feature", color: null, description: null, isApplied: false };
  const web = (number: number, labels: ReadonlyArray<string>) => ({
    host: "github.com",
    repository: "acme/web",
    number,
    labels: labels.map((name) => ({ name, color: null })),
  });
  const first = web(1, ["bug", "docs"]);
  const second = web(2, ["bug"]);

  it("marks each label as on all, some or none of the selected issues", () => {
    expect(
      issueBulkLabels([first, second], new Map([["github.com/acme/web", [bug, docs, feature]]])),
    ).toEqual({
      labels: [
        { name: "bug", color: "d73a4a", description: null, state: "all" },
        { name: "docs", color: "0075ca", description: "Documentation", state: "some" },
        { name: "feature", color: null, description: null, state: "none" },
      ],
      hidden: false,
    });
  });

  it("offers only the labels every selected repository has, and says the rest are hidden", () => {
    const api = { host: "github.com", repository: "Acme/API", number: 7, labels: [] };
    const backend = { name: "backend", color: null, description: null, isApplied: false };
    expect(
      issueBulkLabels(
        [first, api],
        new Map([
          ["github.com/acme/web", [bug, docs]],
          ["github.com/acme/api", [backend, bug]],
        ]),
      ),
    ).toEqual({
      labels: [{ name: "bug", color: "d73a4a", description: null, state: "some" }],
      hidden: true,
    });
  });
});

describe("issueBulkLabelChange", () => {
  const web = (number: number, labels: ReadonlyArray<string>) => ({
    host: "github.com",
    repository: "acme/web",
    number,
    labels: labels.map((name) => ({ name, color: null })),
  });
  const first = web(1, ["bug", "docs"]);
  const second = web(2, ["bug"]);

  it("adds a label that some issues lack to the rest, keeping their other labels", () => {
    expect(
      issueBulkLabelChange([first, second], { name: "docs", color: "0075ca", state: "some" }),
    ).toEqual({
      applied: true,
      changes: [
        {
          issue: second,
          labels: [
            { name: "bug", color: null },
            { name: "docs", color: "0075ca" },
          ],
        },
      ],
    });
  });

  it("removes a label that every selected issue has from all of them", () => {
    expect(
      issueBulkLabelChange([first, second], { name: "bug", color: "d73a4a", state: "all" }),
    ).toEqual({
      applied: false,
      changes: [
        { issue: first, labels: [{ name: "docs", color: null }] },
        { issue: second, labels: [] },
      ],
    });
  });
});

describe("issueBlockedMarker", () => {
  const issue = { host: "github.com", repository: "acme/web" } as IssueSummary;
  const blocker = (number: number, repository = "acme/web") => ({
    host: "github.com",
    repository,
    number,
    title: `Blocker ${number}`,
    state: "open" as const,
  });

  it("names up to three open blockers, other repositories in full, and counts the rest", () => {
    expect(
      issueBlockedMarker({
        ...issue,
        openBlockerCount: 5,
        openBlockers: [blocker(12), blocker(9, "acme/api"), blocker(34), blocker(40)],
      }),
    ).toEqual({
      text: "Blocked by #12, acme/api#9, #34 +2",
      tooltip: [
        "#12 Blocker 12",
        "acme/api#9 Blocker 9",
        "#34 Blocker 34",
        "#40 Blocker 40",
        "and 1 more",
      ],
    });
  });

  it("falls back to the count when the blockers could not be read", () => {
    expect(issueBlockedMarker({ ...issue, openBlockerCount: 2 })).toEqual({
      text: "Blocked by 2 issues",
      tooltip: ["Blocked by 2 open issues"],
    });
  });

  it("marks nothing when no blocker is open or the host reports none", () => {
    expect(issueBlockedMarker({ ...issue, openBlockerCount: 0 })).toBeNull();
    expect(issueBlockedMarker(issue)).toBeNull();
  });
});

describe("issueAuthorOptions", () => {
  const account = (login: string, active = false, authenticated = true) => ({
    host: "github.com",
    account: login,
    active,
    authenticated,
  });
  const github = (accounts: ReadonlyArray<ReturnType<typeof account>>) => ({
    kind: SourceControlProviderKind.make("github"),
    auth: { accounts },
  });
  const all = { value: "", label: "All" };

  it.each([
    {
      name: "lists logins once, ignoring case, A–Z after All",
      providers: [
        github([account("odcgarcia"), account("carlosfelgarcia", true), account("OdCgarcia")]),
      ],
      author: undefined,
      expected: [
        all,
        { value: "carlosfelgarcia", label: "carlosfelgarcia" },
        { value: "odcgarcia", label: "odcgarcia" },
      ],
    },
    { name: "hides the menu without accounts", providers: [], author: undefined, expected: [] },
    {
      name: "offers All and a single account",
      providers: [github([account("carlosfelgarcia", true)])],
      author: undefined,
      expected: [all, { value: "carlosfelgarcia", label: "carlosfelgarcia" }],
    },
    {
      name: "includes inactive and unauthenticated accounts, and ignores other providers",
      providers: [
        github([account("work", false, false), account("me", true)]),
        {
          kind: SourceControlProviderKind.make("gitlab"),
          auth: { accounts: [account("gitlab-me", true)] },
        },
      ],
      author: undefined,
      expected: [all, { value: "me", label: "me" }, { value: "work", label: "work" }],
    },
    {
      name: "keeps an author from the URL that is not an account, in the URL's casing",
      providers: [github([account("OdCgarcia", true)])],
      author: "someone",
      expected: [
        all,
        { value: "OdCgarcia", label: "OdCgarcia" },
        { value: "someone", label: "someone" },
      ],
    },
    {
      name: "selects an account whose case differs from the URL",
      providers: [github([account("OdCgarcia", true)])],
      author: "odcgarcia",
      expected: [all, { value: "odcgarcia", label: "odcgarcia" }],
    },
    {
      name: "shows the URL author even without accounts",
      providers: [],
      author: "someone",
      expected: [all, { value: "someone", label: "someone" }],
    },
  ])("$name", ({ providers, author, expected }) => {
    expect(issueAuthorOptions(providers, author)).toEqual(expected);
  });
});

describe("effectiveIssueAuthor", () => {
  const providers = [
    {
      kind: SourceControlProviderKind.make("github"),
      auth: {
        accounts: [
          { host: "github.com", account: "OdCgarcia", active: false, authenticated: true },
          { host: "github.com", account: "carlosfelgarcia", active: true, authenticated: true },
        ],
      },
    },
  ];

  it.each([
    {
      name: "defaults to the active gh account",
      urlAuthor: undefined,
      setting: "active-account" as const,
      providers,
      expected: "carlosfelgarcia",
    },
    {
      name: "lists everyone when the active account is signed out",
      urlAuthor: undefined,
      setting: "active-account" as const,
      providers: [
        {
          kind: SourceControlProviderKind.make("github"),
          auth: {
            accounts: [
              {
                host: "github.com",
                account: "carlosfelgarcia",
                active: true,
                authenticated: false,
              },
            ],
          },
        },
      ],
      expected: undefined,
      missingActiveAccount: true,
    },
    {
      name: "defaults to a fixed login",
      urlAuthor: undefined,
      setting: { login: "OdCgarcia" },
      providers,
      expected: "OdCgarcia",
    },
    {
      name: "has no default when the setting is All",
      urlAuthor: undefined,
      setting: "all" as const,
      providers,
      expected: undefined,
    },
    {
      name: "lets an author picked on the page win over the default",
      urlAuthor: "OdCgarcia",
      setting: "active-account" as const,
      providers,
      expected: "OdCgarcia",
    },
    {
      name: "keeps All picked on the page instead of falling back to the default",
      urlAuthor: ISSUE_AUTHOR_ALL,
      setting: { login: "OdCgarcia" },
      providers,
      expected: undefined,
    },
  ])("$name", ({ urlAuthor, setting, providers, expected, missingActiveAccount = false }) => {
    expect(effectiveIssueAuthor(urlAuthor, setting, providers)).toBe(expected);
    expect(issueActiveAccountMissing(urlAuthor, setting, providers)).toBe(missingActiveAccount);
  });

  it("notices a server too old to filter by author", () => {
    expect(issueAuthorIgnored("OdCgarcia", {})).toBe(true);
    expect(issueAuthorIgnored("OdCgarcia", { author: "OdCgarcia" })).toBe(false);
    expect(issueAuthorIgnored(undefined, {})).toBe(false);
  });
});
