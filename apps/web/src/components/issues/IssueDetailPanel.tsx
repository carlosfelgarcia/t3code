import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  IssueDetail,
  IssueRef,
  IssueState,
  IssueSummary,
  LinkedIssue,
  PullRequestLabelCandidate,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  MessageSquarePlusIcon,
  TagIcon,
} from "lucide-react";
import { useState } from "react";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useEnvironments } from "~/state/environments";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";

import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "../pullRequest/PullRequestCandidatePicker";
import { PullRequestCommentBody } from "../pullRequest/PullRequestCommentBody";
import { readableFailure } from "../pullRequest/pullRequestDetail.logic";
import { writeHandoffToComposer } from "../pullRequest/usePullRequestActions";
import { LabelCandidateRow, labelCandidateMatches } from "../pullRequest/PullRequestLabelPicker";
import { PullRequestMarkdown } from "../pullRequest/PullRequestMarkdown";
import { PullRequestRowAuthor } from "../pullRequest/PullRequestListRow";
import { PullRequestLabelChip } from "../pullRequest/pullRequestPresentation";
import { IssueStateGlyph } from "./IssueStateGlyph";
import {
  type IssueLabelEdit,
  issueReference,
  issueRowState,
  type IssueStateEdit,
  issueThreadPrompt,
  projectsForRepository,
} from "./issues.logic";

const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

export function IssueDetailPanel({
  environmentId,
  reference,
  projects,
  onBack,
  onOpenIssue,
  onLabelsChanged,
  stateEdit,
  changingState,
  onChangeState,
}: {
  environmentId: EnvironmentId;
  reference: IssueRef;
  projects: ReadonlyArray<EnvironmentProject>;
  onBack: () => void;
  onOpenIssue: (issue: IssueRef) => void;
  onLabelsChanged: (issue: IssueRef, edit: IssueLabelEdit) => void;
  stateEdit: IssueStateEdit | undefined;
  changingState: boolean;
  onChangeState: (issue: IssueSummary, state: IssueState) => void;
}) {
  const query = useEnvironmentQuery(issueEnvironment.detail({ environmentId, input: reference }));
  const detail = query.data;
  const issueProjects = projectsForRepository(projects, reference);
  const cwd = issueProjects[0]?.workspaceRoot ?? "";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to issues" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {reference.repository} #{reference.number}
        </span>
        {detail ? (
          <>
            <IssueStartThread detail={detail} projects={issueProjects} />
            <Button
              variant="outline"
              size="sm"
              render={<a href={detail.url} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLinkIcon />
              Open on GitHub
            </Button>
          </>
        ) : null}
      </div>
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        {detail === null ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            {query.error === null ? (
              <>
                <Spinner aria-hidden /> Loading issue…
              </>
            ) : (
              query.error
            )}
          </div>
        ) : (
          <article className="mx-auto flex max-w-3xl flex-col gap-5 px-5 py-6">
            <header className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">
                {detail.title}{" "}
                <span className="font-normal text-muted-foreground">#{detail.number}</span>
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <IssueStateControl
                  environmentId={environmentId}
                  state={issueRowState(detail, stateEdit)}
                  changing={changingState}
                  onChange={(state) => onChangeState(detail, state)}
                />
                <PullRequestRowAuthor actor={detail.author} />
                <span>
                  opened <RelativeTime timestamp={detail.createdAt} />
                </span>
                <span>
                  updated <RelativeTime timestamp={detail.updatedAt} />
                </span>
              </div>
            </header>
            <dl className="grid grid-cols-[6rem_1fr] items-start gap-x-3 gap-y-2 text-xs">
              <dt className="pt-1 text-muted-foreground">Labels</dt>
              <dd>
                <IssueLabels
                  environmentId={environmentId}
                  detail={detail}
                  onChanged={(edit) => onLabelsChanged(reference, edit)}
                />
              </dd>
              <dt className="text-muted-foreground">Assignees</dt>
              <dd className="flex flex-wrap gap-2">
                {detail.assignees.length === 0 ? (
                  <span className="text-muted-foreground">No one</span>
                ) : (
                  detail.assignees.map((actor) => (
                    <PullRequestRowAuthor key={actor.login} actor={actor} />
                  ))
                )}
              </dd>
              <LinkedIssues
                title="Blocked by"
                from={detail}
                issues={detail.blockedBy}
                onOpen={onOpenIssue}
              />
              <LinkedIssues
                title="Blocking"
                from={detail}
                issues={detail.blocking}
                onOpen={onOpenIssue}
              />
            </dl>
            {detail.body.trim().length > 0 ? (
              <PullRequestMarkdown
                text={detail.body}
                cwd={cwd}
                environmentId={environmentId}
                lineBreaks
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">No description.</p>
            )}
            {detail.comments.length > 0 ? (
              <section className="flex flex-col gap-4 border-t border-border/60 pt-5">
                <h3 className="text-sm font-medium">
                  {detail.comments.length === 1
                    ? "1 comment"
                    : `${detail.comments.length} comments`}
                </h3>
                {detail.comments.map((comment) => (
                  <div key={comment.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PullRequestRowAuthor actor={comment.author} />
                      <a
                        href={comment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-foreground hover:underline"
                      >
                        <RelativeTime timestamp={comment.createdAt} />
                      </a>
                    </div>
                    <PullRequestCommentBody
                      text={comment.body}
                      cwd={cwd}
                      environmentId={environmentId}
                      lineBreaks
                    />
                  </div>
                ))}
              </section>
            ) : null}
          </article>
        )}
      </div>
    </div>
  );
}

function IssueStateControl({
  environmentId,
  state,
  changing,
  onChange,
}: {
  environmentId: EnvironmentId;
  state: IssueState;
  changing: boolean;
  onChange: (state: IssueState) => void;
}) {
  const canChange = useAtomValue(issueEnvironment.setState.permissionAtom(environmentId));
  const open = state === "open";
  return (
    <>
      <span className="inline-flex items-center gap-1.5">
        <IssueStateGlyph state={state} />
        {open ? "Open" : "Closed"}
      </span>
      {canChange ? (
        <Button
          variant="outline"
          size="xs"
          disabled={changing}
          onClick={() => onChange(open ? "closed" : "open")}
        >
          {open ? <CircleCheckIcon /> : <CircleDotIcon />}
          {open ? "Close issue" : "Reopen issue"}
        </Button>
      ) : null}
    </>
  );
}

function LinkedIssues({
  title,
  from,
  issues,
  onOpen,
}: {
  title: string;
  from: IssueRef;
  issues: ReadonlyArray<LinkedIssue> | undefined;
  onOpen: (issue: IssueRef) => void;
}) {
  if (issues === undefined || issues.length === 0) return null;
  return (
    <>
      <dt className="pt-0.5 text-muted-foreground">{title}</dt>
      <dd className="flex min-w-0 flex-col gap-1">
        {issues.map((issue) => (
          <button
            key={`${issue.repository}#${issue.number}`}
            type="button"
            className="flex min-w-0 items-center gap-1.5 text-left hover:underline"
            onClick={() =>
              onOpen({ host: issue.host, repository: issue.repository, number: issue.number })
            }
          >
            <IssueStateGlyph state={issue.state} className="size-3.5" />
            <span className="shrink-0 text-muted-foreground">{issueReference(from, issue)}</span>
            <span className={cn("truncate", issue.state === "closed" && "text-muted-foreground")}>
              {issue.title}
            </span>
          </button>
        ))}
      </dd>
    </>
  );
}

/** Label edits show at once and are undone on screen when GitHub refuses them. */
function IssueLabels({
  environmentId,
  detail,
  onChanged,
}: {
  environmentId: EnvironmentId;
  detail: IssueDetail;
  onChanged: (edit: IssueLabelEdit) => void;
}) {
  const reference = { host: detail.host, repository: detail.repository, number: detail.number };
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  // Edits made against this read of the issue; a fresh read already carries them.
  const [edits, setEdits] = useState<{
    readonly base: IssueDetail | null;
    readonly applied: ReadonlyMap<string, boolean>;
  }>({ base: null, applied: NO_OVERRIDES });
  const applied = edits.base === detail ? edits.applied : NO_OVERRIDES;

  const candidatesQuery = useEnvironmentQuery(
    open ? issueEnvironment.labelCandidates({ environmentId, input: reference }) : null,
  );
  const setLabels = useAtomCommand(issueEnvironment.setLabels, { reportFailure: false });

  const candidates = (candidatesQuery.data?.candidates ?? []).map((candidate) => ({
    ...candidate,
    isApplied: applied.get(candidate.name) ?? candidate.isApplied,
  }));
  const shown = [
    ...detail.labels.filter((label) => applied.get(label.name) !== false),
    ...[...applied]
      .filter(([name, on]) => on && !detail.labels.some((label) => label.name === name))
      .map(([name]) => ({
        name,
        color: candidates.find((candidate) => candidate.name === name)?.color ?? null,
      })),
  ];

  const setEdit = (name: string, on: boolean | undefined) =>
    setEdits((current) => {
      const next = new Map(current.base === detail ? current.applied : NO_OVERRIDES);
      if (on === undefined) next.delete(name);
      else next.set(name, on);
      return { base: detail, applied: next };
    });

  const toggle = async (candidate: PullRequestLabelCandidate) => {
    if (pending) return;
    const on = !candidate.isApplied;
    setPending(true);
    setEdit(candidate.name, on);
    const result = await setLabels({
      environmentId,
      input: { ...reference, labels: [candidate.name], applied: on },
    });
    setPending(false);
    if (result._tag === "Failure") {
      setEdit(candidate.name, undefined);
      toastManager.add({
        type: "error",
        title: on ? `Could not put ${candidate.name} on` : `Could not take ${candidate.name} off`,
        description: readableFailure(
          squashAtomCommandFailure(result),
          `You don't have permission to change labels in ${detail.repository}.`,
        ),
      });
      return;
    }
    onChanged({
      staleUpdatedAt: detail.updatedAt,
      labels: on
        ? [...shown, { name: candidate.name, color: candidate.color }]
        : shown.filter((label) => label.name !== candidate.name),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((label) => (
        <PullRequestLabelChip key={label.name} label={label} size="default" />
      ))}
      <PullRequestCandidatePicker
        icon={<TagIcon className="size-3.5" />}
        label="Change labels"
        allowed
        disabledReason=""
        open={open}
        onOpenChange={setOpen}
        query={search}
        onQueryChange={setSearch}
        searchLabel="Search labels"
        isPending={candidatesQuery.isPending && candidatesQuery.data === null}
        error={candidatesQuery.data === null ? candidatesQuery.error : null}
        candidates={candidates.filter((candidate) => labelCandidateMatches(candidate, search))}
        emptyLabel="This repository has no labels."
        noMatchLabel="No label matches that."
        errorLabel="The labels could not be read."
        truncated={candidatesQuery.data?.truncated === true}
        truncatedLabel="This repository has more labels than are listed here. Apply the rest on GitHub."
        candidateKey={(candidate) => candidate.name}
        disabled={pending}
        onSelect={(candidate) => void toggle(candidate)}
      >
        {(candidate) => <LabelCandidateRow candidate={candidate} />}
      </PullRequestCandidatePicker>
    </div>
  );
}

/** Opens a draft in the issue's project with a reference to it; the user sends it. */
export function useStartIssueThread() {
  const newThread = useNewThreadHandler();
  const [opening, setOpening] = useState(false);

  const start = async (
    issue: Pick<IssueSummary, "number" | "title" | "url">,
    project: EnvironmentProject,
  ) => {
    setOpening(true);
    const session = await newThread(scopeProjectRef(project.environmentId, project.id)).then(
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
  };
  return { start, opening };
}

function IssueStartThread({
  detail,
  projects,
}: {
  detail: IssueDetail;
  projects: ReadonlyArray<EnvironmentProject>;
}) {
  const { environments } = useEnvironments();
  const { start: startThread, opening } = useStartIssueThread();
  const start = (project: EnvironmentProject) => startThread(detail, project);

  const [only] = projects;
  if (projects.length <= 1) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={only === undefined || opening}
        onClick={() => {
          if (only !== undefined) void start(only);
        }}
      >
        <MessageSquarePlusIcon />
        Start thread
      </Button>
    );
  }
  const environmentLabel = (project: EnvironmentProject) =>
    environments.find((environment) => environment.environmentId === project.environmentId)
      ?.label ?? project.environmentId;
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" disabled={opening} />}>
        <MessageSquarePlusIcon />
        Start thread
        <ChevronDownIcon className="text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end">
        {projects.map((project) => (
          <MenuItem
            key={`${project.environmentId}:${project.id}`}
            onClick={() => void start(project)}
          >
            <span className="truncate">{project.title}</span>
            <span className="ml-auto truncate pl-3 text-muted-foreground">
              {environmentLabel(project)}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
