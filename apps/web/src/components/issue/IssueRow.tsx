import type { EnvironmentIssueEntry } from "@t3tools/client-runtime/issue-list";
import type { IssueRelationSummary } from "@t3tools/contracts";
import { BanIcon, ListChecksIcon, MessageSquareIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowLines,
} from "../pullRequest/PullRequestListRow";
import {
  PullRequestLabelChip,
  PullRequestActorAvatar,
} from "../pullRequest/pullRequestPresentation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { IssueStateGlyph, issueTrackerPresentation } from "./issuePresentation";

export type IssueRowTarget = Pick<
  EnvironmentIssueEntry,
  "environmentId" | "projectId" | "tracker" | "host" | "scope" | "key" | "url"
>;

/** The page row in the pull-request list's shape: state glyph, then key and title over meta. */
function IssueRowImpl({
  entry,
  selected,
  showScope,
  showTracker,
  environmentLabel,
  onSelect,
}: {
  entry: EnvironmentIssueEntry;
  selected: boolean;
  /** Only when the list spans more than one scope, where the key alone is ambiguous. */
  showScope: boolean;
  /** Only when the list spans more than one tracker or host. */
  showTracker: boolean;
  /** Names the server this row was read from, where the list spans more than one. */
  environmentLabel?: string | undefined;
  onSelect: (entry: IssueRowTarget) => void;
}) {
  const tracker = issueTrackerPresentation(entry.tracker);
  return (
    <div
      className={cn(
        "flex items-center rounded-md [content-visibility:auto] [contain-intrinsic-block-size:56.5px]",
        selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(entry)}
        className={cn(PULL_REQUEST_ROW_CLASS, "@container/issue-row-meta px-3 py-2.5")}
      >
        <IssueStateGlyph state={entry.state} />
        <PullRequestRowLines
          number={<span className={PULL_REQUEST_ROW_NUMBER_CLASS}>{entry.displayKey}</span>}
          title={entry.title}
          status={
            <>
              {entry.assignees.length > 0 ? (
                <span className="flex items-center -space-x-1">
                  {entry.assignees.slice(0, 3).map((assignee) => (
                    <PullRequestActorAvatar
                      key={assignee.login}
                      actor={assignee}
                      className="ring-1 ring-background"
                    />
                  ))}
                </span>
              ) : null}
              {entry.commentCount > 0 ? (
                <span className="inline-flex items-center gap-0.5 tabular-nums">
                  <MessageSquareIcon aria-hidden className="size-3" />
                  {entry.commentCount}
                </span>
              ) : null}
            </>
          }
          meta={
            <>
              <PullRequestRowAuthor actor={entry.author} />
              {entry.relationSummary ? <IssueRowRelations summary={entry.relationSummary} /> : null}
              {showTracker ? (
                <span className="inline-flex shrink-0 items-center gap-1">
                  <tracker.Icon aria-hidden className="size-3" />
                  <span className="sr-only">{tracker.providerName}</span>
                </span>
              ) : null}
              {showScope ? <span className="truncate">{entry.scope}</span> : null}
              {environmentLabel ? <span className="truncate">{environmentLabel}</span> : null}
              {entry.labels.length > 0 ? (
                <span className="hidden min-w-0 items-center gap-1 @xl/issue-row-meta:flex">
                  {entry.labels.slice(0, 3).map((label, index) => (
                    <PullRequestLabelChip key={label.name} label={label}>
                      {index === 2 && entry.labels.length > 3 ? (
                        <span className="shrink-0">+{entry.labels.length - 3}</span>
                      ) : null}
                    </PullRequestLabelChip>
                  ))}
                </span>
              ) : null}
            </>
          }
          updatedAt={entry.updatedAt}
        />
      </button>
    </div>
  );
}

export const IssueRow = memo(IssueRowImpl);

const ROW_BLOCKERS_SHOWN = 3;

function IssueRowRelations({ summary }: { summary: IssueRelationSummary }) {
  const count = summary.openBlockerCount;
  const named = summary.openBlockers.slice(0, ROW_BLOCKERS_SHOWN);
  const hidden = count - named.length;
  return (
    <>
      {count > 0 ? (
        <Tooltip>
          <TooltipTrigger
            render={<span className="inline-flex min-w-0 shrink items-center gap-1" />}
          >
            <BanIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">
              {named.length === 0
                ? `Blocked by ${count} ${count === 1 ? "issue" : "issues"}`
                : `Blocked by ${named.map((blocker) => blocker.displayKey).join(", ")}${hidden > 0 ? ` +${hidden}` : ""}`}
            </span>
          </TooltipTrigger>
          <TooltipPopup>
            {summary.openBlockers.map((blocker) => (
              <div key={blocker.url}>
                {blocker.displayKey} {blocker.title}
              </div>
            ))}
            {count > summary.openBlockers.length ? (
              <div>
                {summary.openBlockers.length === 0
                  ? `${count} open ${count === 1 ? "issue" : "issues"}`
                  : `and ${count - summary.openBlockers.length} more`}
              </div>
            ) : null}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {summary.subIssuesTotal > 0 ? (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex shrink-0 items-center gap-1" />}>
            <ListChecksIcon aria-hidden className="size-3 shrink-0" />
            <span className="tabular-nums">
              {summary.subIssuesCompleted}/{summary.subIssuesTotal}
            </span>
          </TooltipTrigger>
          <TooltipPopup>
            {summary.subIssuesCompleted} of {summary.subIssuesTotal}{" "}
            {summary.subIssuesTotal === 1 ? "sub-issue" : "sub-issues"} completed
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </>
  );
}
