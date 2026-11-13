import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import {
  type IssuesPanelSelection,
  type RightPanelSurface,
  useRightPanelStore,
} from "~/rightPanelStore";
import { useProject } from "~/state/entities";

import { SiblingRepositoryPicker, useSiblingSelection } from "../SiblingRepositoryPicker";
import { projectIssueRepositories } from "./issues.logic";
import { type IssuesSearch, type IssuesSearchPatch, IssuesView, patchSearch } from "./IssuesView";

type IssuesFilters = Omit<IssuesSearch, "repo" | "host" | "repository" | "number">;

interface ThreadIssuesPanelProps {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  surface: Extract<RightPanelSurface, { kind: "issues" }>;
  composerDraftTarget: ScopedThreadRef | DraftId;
}

export function ThreadIssuesPanel({ projectId, ...props }: ThreadIssuesPanelProps) {
  const project = useProject(scopeProjectRef(props.threadRef.environmentId, projectId));
  return project === null ? null : <ProjectIssuesPanel {...props} project={project} />;
}

/** The tab keeps the repository and open issue; the filters last only while it shows. */
function ProjectIssuesPanel({
  threadRef,
  project,
  surface,
  composerDraftTarget,
}: Omit<ThreadIssuesPanelProps, "projectId"> & { project: EnvironmentProject }) {
  const { siblings, sibling, siblingProject } = useSiblingSelection(project, surface.sibling);
  const [filters, setFilters] = useState<IssuesFilters>({ state: "open" });
  if (siblings === null && surface.sibling !== undefined) return null;

  const search: IssuesSearch = {
    ...filters,
    ...(surface.repo === undefined ? {} : { repo: surface.repo }),
    ...(surface.issue === undefined ? {} : surface.issue),
  };
  const setView = (view: IssuesPanelSelection) =>
    useRightPanelStore.getState().setIssuesView(threadRef, view);
  const onSearchChange = (patch: IssuesSearchPatch) => {
    const { repo, host, repository, number, ...rest } = patchSearch(search, patch);
    setFilters(rest);
    const view: IssuesPanelSelection = {
      ...(surface.sibling === undefined ? {} : { sibling: surface.sibling }),
      ...(repo === undefined ? {} : { repo }),
      ...(host === undefined || repository === undefined || number === undefined
        ? {}
        : { issue: { host, repository, number } }),
    };
    if (
      view.repo !== surface.repo ||
      view.issue?.host !== surface.issue?.host ||
      view.issue?.repository !== surface.issue?.repository ||
      view.issue?.number !== surface.issue?.number
    ) {
      setView(view);
    }
  };

  return (
    <IssuesView
      key={sibling?.path ?? `${project.environmentId}:${project.id}`}
      search={search}
      onSearchChange={onSearchChange}
      environmentId={project.environmentId}
      repositories={projectIssueRepositories(
        sibling === null ? project : { repositoryIdentity: sibling.repositoryIdentity },
      )}
      projects={sibling === null ? [project] : siblingProject === null ? [] : [siblingProject]}
      composerDraftTarget={composerDraftTarget}
      picker={
        siblings === null || siblings.length === 0 ? null : (
          <SiblingRepositoryPicker
            project={project}
            ownPath={project.workspaceRoot}
            siblings={siblings}
            selected={sibling}
            onSelect={(next) => {
              setFilters({ state: filters.state });
              setView(next === null ? {} : { sibling: next.path });
            }}
          />
        )
      }
    />
  );
}
