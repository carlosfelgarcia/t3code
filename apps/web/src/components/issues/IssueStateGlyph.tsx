import { CircleCheckIcon, CircleDotIcon, CircleSlashIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";
import type { IssueStateShown } from "./issues.logic";

const ISSUE_STATE_PRESENTATION = {
  open: {
    label: "Open",
    Icon: CircleDotIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.open.toneClassName,
  },
  completed: {
    label: "Closed",
    Icon: CircleCheckIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.merged.toneClassName,
  },
  "not-planned": {
    label: "Closed as not planned",
    Icon: CircleSlashIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.draft.toneClassName,
  },
  duplicate: {
    label: "Closed as duplicate",
    Icon: CircleSlashIcon,
    toneClassName: PULL_REQUEST_STATE_PRESENTATION.draft.toneClassName,
  },
} as const;

export const issueStatePresentation = ({ state, closeReason }: IssueStateShown) =>
  ISSUE_STATE_PRESENTATION[state === "open" ? "open" : (closeReason ?? "completed")];

export function IssueStateGlyph({
  state,
  className,
}: {
  state: IssueStateShown;
  className?: string;
}) {
  const presentation = issueStatePresentation(state);
  return (
    <presentation.Icon
      role="img"
      aria-label={presentation.label}
      className={cn("size-4 shrink-0", presentation.toneClassName, className)}
    />
  );
}
