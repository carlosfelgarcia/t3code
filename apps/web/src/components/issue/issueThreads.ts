import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  IssueListEntry,
  ProjectId,
  ScopedThreadRef,
  ThreadId,
  ThreadIssueLink,
} from "@t3tools/contracts";
import { useState } from "react";

import type { DraftId } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";

import { writeHandoffToComposer } from "../pullRequest/usePullRequestActions";
import { toastManager } from "../ui/toast";
import { issueTrackerPresentation } from "./issuePresentation";

export type IssueThreadSubject = Pick<
  IssueListEntry,
  "tracker" | "host" | "scope" | "key" | "url" | "displayKey" | "title"
> & { readonly projectId: ProjectId };

export type PendingIssueLink = Omit<ThreadIssueLink, "linkedAt" | "source">;

function issueThreadPrompt(issue: IssueThreadSubject): string {
  const tracker = issueTrackerPresentation(issue.tracker).providerName;
  return `${tracker} issue ${issue.displayKey}: ${issue.title}\n${issue.url}`;
}

export function addIssueToComposer(target: ScopedThreadRef | DraftId, issue: IssueThreadSubject) {
  writeHandoffToComposer(target, { prompt: issueThreadPrompt(issue) });
  toastManager.add({ type: "success", title: "Added to the composer" });
}

// A draft has no server thread to link yet, so the link waits for its first send.
const pendingLinks = new Map<ThreadId, PendingIssueLink>();

export function takePendingIssueLink(threadId: ThreadId): PendingIssueLink | undefined {
  const link = pendingLinks.get(threadId);
  pendingLinks.delete(threadId);
  return link;
}

/** Opens a draft in the issue's project with a reference to it, linked once the user sends it. */
export function useStartIssueThread() {
  const newThread = useNewThreadHandler();
  const [opening, setOpening] = useState(false);
  const start = async (environmentId: EnvironmentId, issue: IssueThreadSubject) => {
    setOpening(true);
    const session = await newThread(scopeProjectRef(environmentId, issue.projectId)).then(
      (result) => result,
      () => null,
    );
    setOpening(false);
    if (session === null) {
      toastManager.add({
        type: "error",
        title: "Could not open a thread",
        description: "Try again from the project.",
      });
      return;
    }
    writeHandoffToComposer(session.draftId, { prompt: issueThreadPrompt(issue) });
    pendingLinks.set(session.threadId, {
      tracker: issue.tracker,
      host: issue.host,
      scope: issue.scope,
      key: issue.key,
      projectId: issue.projectId,
      url: issue.url,
      displayKey: issue.displayKey,
      title: issue.title,
    });
  };
  return { start, opening };
}
