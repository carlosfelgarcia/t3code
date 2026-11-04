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
  issueRepositories,
  issueRowLabels,
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
