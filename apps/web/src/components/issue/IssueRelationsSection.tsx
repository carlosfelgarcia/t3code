import type {
  EnvironmentId,
  IssueRelation,
  IssueRelations,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import type { MouseEvent } from "react";

import { useOpenIssueLink } from "~/lib/openIssueLink";
import { ISSUES_PANEL_REF } from "~/rightPanelStore";

import { PullRequestSection } from "../pullRequest/PullRequestSummaryTab";
import { IssueStateGlyph } from "./issuePresentation";

/** Parent issue, sub-issues and blockers, each opening beside the issue when a project reads it. */
export function IssueRelationsSection({
  relations,
  environmentId,
  threadRef,
  issueUrl,
}: {
  relations: IssueRelations;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  issueUrl: string;
}) {
  const gt = useGT();
  const openIssueLink = useOpenIssueLink(
    threadRef ?? undefined,
    threadRef === null ? ISSUES_PANEL_REF : undefined,
  );
  const groups = [
    { title: gt("Parent issue"), rows: relations.parent === null ? [] : [relations.parent] },
    {
      title:
        relations.subIssuesTotal > 0
          ? gt("Sub-issues ({completed}/{total})", {
              completed: relations.subIssuesCompleted,
              total: relations.subIssuesTotal,
            })
          : gt("Sub-issues"),
      rows: relations.subIssues,
    },
    {
      title: gt("Blocked by", { $context: "issues that block this issue" }),
      rows: relations.blockedBy,
    },
    { title: gt("Blocking", { $context: "issues this issue blocks" }), rows: relations.blocking },
  ].filter((group) => group.rows.length > 0);
  if (groups.length === 0) return null;

  return groups.map((group) => (
    <PullRequestSection key={`${group.title}:${issueUrl}`} title={group.title}>
      <div className="flex flex-col gap-1">
        {group.rows.map((relation) => (
          <RelationRow
            key={relation.url}
            relation={relation}
            onClick={(event) => openIssueLink(event, relation.url, environmentId)}
          />
        ))}
      </div>
    </PullRequestSection>
  ));
}

function RelationRow({
  relation,
  onClick,
}: {
  relation: IssueRelation;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      href={relation.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
      onClick={onClick}
    >
      <IssueStateGlyph state={relation.state} />
      <span className="min-w-0 flex-1 truncate text-sm">{relation.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {relation.displayKey}
      </span>
    </a>
  );
}
