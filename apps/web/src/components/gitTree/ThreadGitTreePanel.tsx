import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";

import { type RightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { useProject } from "~/state/entities";

import { SiblingRepositoryPicker, useSiblingSelection } from "../SiblingRepositoryPicker";
import { GitTreeView } from "./GitTreeView";

interface ThreadGitTreePanelProps {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  /** The thread's checkout: its worktree when it has one. */
  cwd: string;
  surface: Extract<RightPanelSurface, { kind: "git-tree" }>;
}

export function ThreadGitTreePanel({ projectId, ...props }: ThreadGitTreePanelProps) {
  const project = useProject(scopeProjectRef(props.threadRef.environmentId, projectId));
  return project === null ? null : <ProjectGitTreePanel {...props} project={project} />;
}

function ProjectGitTreePanel({
  threadRef,
  project,
  cwd,
  surface,
}: Omit<ThreadGitTreePanelProps, "projectId"> & { project: EnvironmentProject }) {
  const { siblings, sibling, siblingProject } = useSiblingSelection(project, surface.sibling);
  if (siblings === null && surface.sibling !== undefined) return null;

  return (
    <GitTreeView
      key={sibling?.path ?? cwd}
      environmentId={project.environmentId}
      name={sibling?.name ?? project.title}
      cwd={sibling?.path ?? cwd}
      project={sibling === null ? project : siblingProject}
      picker={
        siblings === null || siblings.length === 0 ? null : (
          <>
            <SiblingRepositoryPicker
              project={project}
              ownPath={cwd}
              siblings={siblings}
              selected={sibling}
              onSelect={(next) =>
                useRightPanelStore.getState().setGitTreeSibling(threadRef, next?.path)
              }
            />
            {sibling === null ? null : (
              <span className="basis-full truncate text-xs text-muted-foreground">
                {sibling.path}
              </span>
            )}
          </>
        )
      }
    />
  );
}
