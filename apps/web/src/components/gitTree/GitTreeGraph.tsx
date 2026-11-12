import { LegendList, type LegendListRef } from "@legendapp/list/react";
import type { VcsCommitGraphCommit } from "@t3tools/contracts";
import { TagIcon } from "lucide-react";
import { memo, type Ref } from "react";

import { cn } from "~/lib/utils";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { GraphEdge, GraphRow } from "./gitTreeLayout";
import { mergedPullRequestOf } from "./mergedPullRequest";

// Matches the rows' h-7.
const GIT_TREE_ROW_HEIGHT = 28;
const LANE_WIDTH = 14;
const NODE_RADIUS = 4;
const LANE_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ec4899",
  "#a855f7",
  "#06b6d4",
  "#ef4444",
  "#84cc16",
];

export interface GitTreeGraphItem {
  readonly commit: VcsCommitGraphCommit;
  readonly row: GraphRow;
}

const laneX = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

function edgePath(edge: GraphEdge): string {
  const height = GIT_TREE_ROW_HEIGHT;
  const from = laneX(edge.from);
  const to = laneX(edge.to);
  if (edge.kind === "through") return `M ${from} 0 L ${from} ${height}`;
  const [top, bottom] = edge.kind === "in" ? [0, height / 2] : [height / 2, height];
  const bend = (top + bottom) / 2;
  return from === to
    ? `M ${from} ${top} L ${to} ${bottom}`
    : `M ${from} ${top} C ${from} ${bend}, ${to} ${bend}, ${to} ${bottom}`;
}

function formatDate(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const GitTreeGraphRow = memo(function GitTreeGraphRow({
  item,
  width,
  head,
  headBranch,
}: {
  item: GitTreeGraphItem;
  width: number;
  head: boolean;
  /** The checked-out branch, or null for a detached HEAD. */
  headBranch: string | null;
}) {
  const { commit, row } = item;
  const svgWidth = Math.max(width, 1) * LANE_WIDTH;
  const branches = head ? commit.refs.filter((ref) => ref !== headBranch) : commit.refs;
  const pullRequest = mergedPullRequestOf(commit);
  return (
    <div
      className={cn(
        "relative flex h-7 items-center gap-2 pr-3 text-xs",
        head
          ? "bg-primary/8 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary"
          : "hover:bg-accent/50",
      )}
    >
      <svg
        aria-hidden
        className="shrink-0"
        width={svgWidth}
        height={GIT_TREE_ROW_HEIGHT}
        viewBox={`0 0 ${svgWidth} ${GIT_TREE_ROW_HEIGHT}`}
      >
        {row.edges.map((edge) => (
          <path
            key={`${edge.kind}:${edge.from}:${edge.to}`}
            d={edgePath(edge)}
            fill="none"
            stroke={laneColor(edge.kind === "out" ? edge.to : edge.from)}
            strokeWidth={1.5}
          />
        ))}
        <circle
          cx={laneX(row.lane)}
          cy={GIT_TREE_ROW_HEIGHT / 2}
          r={NODE_RADIUS}
          fill={head ? "var(--background)" : laneColor(row.lane)}
          stroke={laneColor(row.lane)}
          strokeWidth={head ? 2 : 0}
        />
      </svg>
      {head ? (
        <Badge className="shrink-0">
          {headBranch === null ? "HEAD (detached)" : `HEAD → ${headBranch}`}
        </Badge>
      ) : null}
      {branches.map((ref) => (
        <Badge key={ref} variant="outline" className="shrink-0">
          {ref}
        </Badge>
      ))}
      {commit.tags?.map((tag) => (
        <Badge key={tag} variant="warning" className="shrink-0">
          <TagIcon aria-hidden />
          {tag}
        </Badge>
      ))}
      {pullRequest === null ? null : (
        <Badge
          variant="info"
          className="shrink-0"
          title={`Merged pull request ${pullRequest.label}`}
        >
          <PullRequestGlyph.merged aria-hidden />
          {pullRequest.label}
        </Badge>
      )}
      <Tooltip>
        <TooltipTrigger
          render={<span className={cn("min-w-0 flex-1 truncate", head && "font-medium")} />}
        >
          {pullRequest?.subject ?? commit.subject}
        </TooltipTrigger>
        <TooltipPopup side="bottom" align="start">
          <div className="flex max-w-md flex-col gap-1">
            <p className="whitespace-pre-wrap break-words">{commit.message}</p>
            <p className="text-muted-foreground">
              {commit.authorName} · {formatDate(commit.authorDate)}
            </p>
            <p className="font-mono text-muted-foreground">{commit.hash}</p>
          </div>
        </TooltipPopup>
      </Tooltip>
      <span className="hidden shrink-0 text-muted-foreground sm:inline">{commit.authorName}</span>
      <span className="shrink-0 font-mono text-muted-foreground">{commit.hash.slice(0, 7)}</span>
    </div>
  );
});

export function GitTreeGraph({
  items,
  width,
  headHash,
  headBranch,
  listRef,
  footer,
}: {
  items: ReadonlyArray<GitTreeGraphItem>;
  width: number;
  headHash: string | null;
  headBranch: string | null;
  listRef: Ref<LegendListRef>;
  footer: React.ReactElement | null;
}) {
  return (
    <LegendList<GitTreeGraphItem>
      ref={listRef}
      className="min-h-0 flex-1"
      data={items as GitTreeGraphItem[]}
      keyExtractor={(item) => item.commit.hash}
      renderItem={({ item }) => (
        <GitTreeGraphRow
          item={item}
          width={width}
          head={item.commit.hash === headHash}
          headBranch={headBranch}
        />
      )}
      estimatedItemSize={GIT_TREE_ROW_HEIGHT}
      recycleItems={false}
      drawDistance={GIT_TREE_ROW_HEIGHT * 20}
      ListFooterComponent={footer}
    />
  );
}
