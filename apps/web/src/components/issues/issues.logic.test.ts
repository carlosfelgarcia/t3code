import {
  type IssueSummary,
  type RepositoryIdentity,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { issueRepositories, issueRowLabels, projectsForRepository } from "./issues.logic";

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
