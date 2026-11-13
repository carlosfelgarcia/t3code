import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { AuthOrchestrationOperateScope, type EnvironmentId, type VcsRef } from "@t3tools/contracts";

import { failureOf } from "~/hooks/useCleanRepo";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { resolveNewThreadCheckout } from "./newThreadCheckout";

/**
 * Opens a draft thread in `project` on a branch, reusing the checkout the branch is in, or creating
 * a worktree for it when it is checked out nowhere.
 */
export function useNewThreadOnBranch({
  environmentId,
  name,
  project,
}: {
  environmentId: EnvironmentId;
  name: string;
  project: EnvironmentProject | null;
}) {
  const handleNewThread = useNewThreadHandler();
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree, { reportFailure: false });
  const canStartThreads = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const canCreateWorktree = useAtomValue(
    vcsEnvironment.createWorktree.permissionAtom(environmentId),
  );

  /** Why a thread cannot start on `ref`, or `null` when it can. */
  const blockedReason = (ref: VcsRef): string | null => {
    if (project === null) return `Add ${name} as a project to start a thread`;
    if (!canStartThreads) return "Needs permission to start threads";
    const checkout = resolveNewThreadCheckout({ ref, workspaceRoot: project.workspaceRoot });
    if (checkout.kind === "create-worktree" && !canCreateWorktree) {
      return "Needs source control write access to create a worktree";
    }
    return null;
  };

  const openThread = async (ref: VcsRef): Promise<void> => {
    if (project === null) return;
    const checkout = resolveNewThreadCheckout({ ref, workspaceRoot: project.workspaceRoot });
    let worktreePath: string | null = null;
    if (checkout.kind === "worktree") {
      worktreePath = checkout.worktreePath;
    } else if (checkout.kind === "create-worktree") {
      // No new ref name checks the existing branch out instead of branching from it.
      const result = await createWorktree({
        environmentId,
        input: { cwd: project.workspaceRoot, refName: ref.name, path: null },
      });
      if (result._tag === "Failure") throw failureOf(result);
      worktreePath = result.value.worktree.path;
    }
    await handleNewThread(scopeProjectRef(environmentId, project.id), {
      branch: ref.name,
      worktreePath,
      envMode: worktreePath === null ? "local" : "worktree",
      startFromOrigin: false,
    });
  };

  return { blockedReason, openThread };
}
