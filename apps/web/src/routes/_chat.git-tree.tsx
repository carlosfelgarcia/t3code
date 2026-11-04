import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { GitTreePage, type GitTreeSearch } from "../components/gitTree/GitTreePage";

const text = (raw: unknown) =>
  typeof raw === "string" && raw.trim().length > 0 ? raw.trim().slice(0, 200) : undefined;

export const Route = createFileRoute("/_chat/git-tree")({
  validateSearch: (raw: Record<string, unknown>): GitTreeSearch => {
    const environmentId = text(raw.environmentId);
    const projectId = text(raw.projectId);
    return {
      ...(environmentId === undefined ? {} : { environmentId: environmentId as EnvironmentId }),
      ...(projectId === undefined ? {} : { projectId: projectId as ProjectId }),
    };
  },
  component: GitTreePage,
});
