import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { MessageSquarePlusIcon, TextCursorInputIcon } from "lucide-react";

import type { DraftId } from "~/composerDraftStore";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { addIssueToComposer, type IssueThreadSubject, useStartIssueThread } from "./issueThreads";

/** Start a thread on the issue, and, beside a thread, add the issue to its composer. */
export function IssueThreadActions({
  environmentId,
  issue,
  composerDraftTarget,
}: {
  environmentId: EnvironmentId;
  issue: IssueThreadSubject;
  composerDraftTarget?: ScopedThreadRef | DraftId | undefined;
}) {
  const gt = useGT();
  const { start, opening } = useStartIssueThread();
  return (
    <>
      {composerDraftTarget === undefined ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={gt("Add to composer")}
                onClick={() => addIssueToComposer(composerDraftTarget, issue)}
              />
            }
          >
            <TextCursorInputIcon aria-hidden className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup>
            <T>Add a reference to this issue to the composer</T>
          </TooltipPopup>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Start thread")}
              disabled={opening}
              onClick={() => void start(environmentId, issue)}
            />
          }
        >
          <MessageSquarePlusIcon aria-hidden className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup>
          <T>Start a thread on this issue, linked once you send</T>
        </TooltipPopup>
      </Tooltip>
    </>
  );
}
