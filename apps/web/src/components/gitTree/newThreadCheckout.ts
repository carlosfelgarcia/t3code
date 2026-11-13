import type { VcsRef } from "@t3tools/contracts";
import { workspaceRelativeFilePath } from "@t3tools/shared/path";

export type NewThreadCheckout =
  | { readonly kind: "main" }
  | { readonly kind: "worktree"; readonly worktreePath: string }
  | { readonly kind: "create-worktree" };

/**
 * Where a new thread on `ref` runs: the checkout the branch is already in, or a new worktree when
 * it is checked out nowhere.
 */
export function resolveNewThreadCheckout(input: {
  ref: Pick<VcsRef, "worktreePath">;
  workspaceRoot: string;
}): NewThreadCheckout {
  const checkout = input.ref.worktreePath;
  if (checkout === null) return { kind: "create-worktree" };
  // The main checkout contains the project's workspace root; a worktree never does.
  return workspaceRelativeFilePath(input.workspaceRoot, checkout) === null
    ? { kind: "worktree", worktreePath: checkout }
    : { kind: "main" };
}
