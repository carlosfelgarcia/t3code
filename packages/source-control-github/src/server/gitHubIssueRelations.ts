import type { IssueRelation, IssueRelations } from "@t3tools/contracts";

import type * as Relations from "./issueRelations.graphql.ts";
import { toIssueState } from "./gitHubIssueJson.ts";

/** `#12` within `scope`, `owner/name#12` for an issue in another repository. */
function toRelation(scope: string, node: Relations.IssueRelationNode): IssueRelation {
  const nodeScope = node.repository.nameWithOwner;
  const sameScope = nodeScope.toLowerCase() === scope.toLowerCase();
  return {
    scope: nodeScope,
    key: String(node.number),
    displayKey: sameScope ? `#${node.number}` : `${nodeScope}#${node.number}`,
    title: node.title,
    url: node.url,
    state: toIssueState(node.state, node.stateReason),
  };
}

const nodesOf = (
  scope: string,
  connection: { readonly nodes?: ReadonlyArray<Relations.IssueRelationNode | null> | null },
) => (connection.nodes ?? []).flatMap((node) => (node === null ? [] : [toRelation(scope, node)]));

export function toIssueRelations(
  scope: string,
  result: Relations.IssueRelations.Result,
): IssueRelations | undefined {
  const issue = result.repository?.issue;
  if (issue == null) return undefined;
  return {
    parent: issue.parent == null ? null : toRelation(scope, issue.parent),
    subIssues: nodesOf(scope, issue.subIssues),
    subIssuesTotal: issue.subIssuesSummary.total,
    subIssuesCompleted: issue.subIssuesSummary.completed,
    blockedBy: nodesOf(scope, issue.blockedBy),
    blocking: nodesOf(scope, issue.blocking),
  };
}
