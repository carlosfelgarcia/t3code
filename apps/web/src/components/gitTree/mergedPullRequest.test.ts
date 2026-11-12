import { describe, expect, it } from "vite-plus/test";

import { mergedPullRequestOf } from "./mergedPullRequest";

describe("mergedPullRequestOf", () => {
  it.each([
    {
      name: "GitHub squash",
      subject: "fix(web): minimap no longer flakes (#33964)",
      expected: { label: "#33964", subject: "fix(web): minimap no longer flakes" },
    },
    {
      name: "GitHub merge",
      subject: "Merge pull request #42 from octo/feature",
      expected: { label: "#42", subject: "Merge pull request #42 from octo/feature" },
    },
    {
      name: "Forgejo merge",
      subject: "Merge pull request 'Add search' (#7) from feature into main",
      expected: {
        label: "#7",
        subject: "Merge pull request 'Add search' (#7) from feature into main",
      },
    },
    {
      name: "the last of several squash suffixes",
      subject: 'Revert "Add search (#7)" (#9)',
      expected: { label: "#9", subject: 'Revert "Add search (#7)"' },
    },
    {
      name: "Bitbucket",
      subject: "Merged in feature/search (pull request #15)",
      expected: { label: "#15", subject: "Merged in feature/search (pull request #15)" },
    },
    {
      name: "Azure DevOps",
      subject: "Merged PR 128: Add search",
      expected: { label: "!128", subject: "Merged PR 128: Add search" },
    },
    {
      name: "GitLab",
      subject: "Merge branch 'search' into 'main'",
      message:
        "Merge branch 'search' into 'main'\n\nAdd search\n\nSee merge request group/app!31\n",
      expected: { label: "!31", subject: "Merge branch 'search' into 'main'" },
    },
    { name: "an ordinary commit", subject: "Fix issue #12 in parser", expected: null },
  ])("reads $name", ({ subject, message, expected }) => {
    expect(mergedPullRequestOf({ subject, message: message ?? subject })).toEqual(expected);
  });
});
