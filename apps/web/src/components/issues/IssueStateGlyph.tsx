import type { IssueState } from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";

const ISSUE_STATE_PRESENTATION = {
  open: {
    label: "Open",
    Icon: CircleDotIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.open.toneClassName,
  },
  closed: {
    label: "Closed",
    Icon: CircleCheckIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.merged.toneClassName,
  },
} as const;

export function IssueStateGlyph({ state, className }: { state: IssueState; className?: string }) {
  const presentation = ISSUE_STATE_PRESENTATION[state];
  return (
    <presentation.Icon
      role="img"
      aria-label={presentation.label}
      className={cn("size-4 shrink-0", presentation.toneClassName, className)}
    />
  );
}
