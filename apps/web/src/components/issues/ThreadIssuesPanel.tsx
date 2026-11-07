import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import {
  type IssuesPanelSelection,
  type RightPanelSurface,
  useRightPanelStore,
} from "~/rightPanelStore";
import { useProject } from "~/state/entities";

import { type IssuesSearch, type IssuesSearchPatch, IssuesView, patchSearch } from "./IssuesPage";

type IssuesFilters = Omit<IssuesSearch, "repo" | "host" | "repository" | "number">;

/** The tab keeps the repository and open issue; the filters last only while it shows. */
export function ThreadIssuesPanel({
  threadRef,
  projectId,
  surface,
  composerDraftTarget,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId;
  surface: Extract<RightPanelSurface, { kind: "issues" }>;
  composerDraftTarget: ScopedThreadRef | DraftId;
}) {
  const project = useProject(scopeProjectRef(threadRef.environmentId, projectId));
  const [filters, setFilters] = useState<IssuesFilters>({ state: "open" });
  if (project === null) return null;

  const search: IssuesSearch = {
    ...filters,
    ...(surface.repo === undefined ? {} : { repo: surface.repo }),
    ...(surface.issue === undefined ? {} : surface.issue),
  };
  const onSearchChange = (patch: IssuesSearchPatch) => {
    const { repo, host, repository, number, ...rest } = patchSearch(search, patch);
    setFilters(rest);
    const view: IssuesPanelSelection = {
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
      useRightPanelStore.getState().setIssuesView(threadRef, view);
    }
  };

  return (
    <IssuesView
      key={`${project.environmentId}:${project.id}`}
      search={search}
      onSearchChange={onSearchChange}
      thread={{ project, composerDraftTarget }}
    />
  );
}
