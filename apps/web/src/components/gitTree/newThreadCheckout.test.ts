import { describe, expect, it } from "vite-plus/test";

import { resolveNewThreadCheckout } from "./newThreadCheckout";

describe("resolveNewThreadCheckout", () => {
  it.each([
    {
      name: "the main checkout's branch runs locally",
      ref: { worktreePath: "/repo" },
      expected: { kind: "main" },
    },
    {
      name: "a subdirectory project's main checkout runs locally",
      ref: { worktreePath: "/mono" },
      workspaceRoot: "/mono/apps/web",
      expected: { kind: "main" },
    },
    {
      name: "a branch in another worktree reuses it",
      ref: { worktreePath: "/wt/feature" },
      expected: { kind: "worktree", worktreePath: "/wt/feature" },
    },
    {
      name: "a worktree nested in the main checkout is still a worktree",
      ref: { worktreePath: "/repo/.worktrees/feature" },
      expected: { kind: "worktree", worktreePath: "/repo/.worktrees/feature" },
    },
    {
      name: "a branch checked out nowhere needs a new worktree",
      ref: { worktreePath: null },
      expected: { kind: "create-worktree" },
    },
  ])("$name", ({ ref, workspaceRoot = "/repo", expected }) => {
    expect(resolveNewThreadCheckout({ ref, workspaceRoot })).toEqual(expected);
  });
});
