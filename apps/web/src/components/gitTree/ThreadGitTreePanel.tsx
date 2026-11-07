import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { useProject } from "~/state/entities";

import { GitTreeView } from "./GitTreePage";

export function ThreadGitTreePanel({
  environmentId,
  projectId,
  cwd,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** The thread's checkout: its worktree when it has one. */
  cwd: string;
}) {
  const project = useProject(scopeProjectRef(environmentId, projectId));
  if (project === null) return null;
  return <GitTreeView key={cwd} project={project} cwd={cwd} layout="panel" />;
}
