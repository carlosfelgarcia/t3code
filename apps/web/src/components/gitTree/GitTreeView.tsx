import { useAtomValue } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, VcsRef } from "@t3tools/contracts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BrushCleaningIcon,
  FolderTreeIcon,
  GitBranchIcon,
  MessageSquarePlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { failureOf, useCleanRepo } from "~/hooks/useCleanRepo";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { GitTreeGraph, type GitTreeGraphItem } from "./GitTreeGraph";
import { gitCommandErrorDetail, useGitTreeData } from "./useGitTreeData";
import { useNewThreadOnBranch } from "./useNewThreadOnBranch";

function PageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

type Operation = "pull" | "push" | "fetch" | "clean" | "refresh";

/**
 * `cwd` is the checkout the graph marks as current and Pull and Push act on. Clean Repo and New
 * thread start their threads in `project`, the project rooted at that checkout, so they are off
 * without one.
 */
export function GitTreeView({
  environmentId,
  name,
  cwd,
  project,
  picker,
}: {
  environmentId: EnvironmentId;
  name: string;
  cwd: string;
  project: EnvironmentProject | null;
  picker: React.ReactNode;
}) {
  const { data, error, loadingMore, reload, loadMore } = useGitTreeData(environmentId, cwd);
  const [running, setRunning] = useState<Operation | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const listRef = useRef<LegendListRef>(null);

  const pull = useAtomCommand(vcsEnvironment.pull, { reportFailure: false });
  const push = useAtomCommand(vcsEnvironment.push, { reportFailure: false });
  const fetchPrune = useAtomCommand(vcsEnvironment.fetchPrune, { reportFailure: false });
  const deleteBranch = useAtomCommand(vcsEnvironment.deleteBranch, { reportFailure: false });
  const canWrite = useAtomValue(vcsEnvironment.push.permissionAtom(environmentId));
  const newThread = useNewThreadOnBranch({ environmentId, name, project });

  const run = async (operation: Operation, title: string, action: () => Promise<string | null>) => {
    if (running !== null) return;
    setRunning(operation);
    const outcome = await action().then(
      (success) => ({ success, failure: null }),
      (cause: unknown) => ({ success: null, failure: gitCommandErrorDetail(cause) }),
    );
    setRunning(null);
    if (outcome.failure !== null) {
      toastManager.add({ type: "error", title, description: outcome.failure });
    } else if (outcome.success !== null) {
      toastManager.add({ type: "success", title: outcome.success });
    }
    await reload();
  };

  const runPull = () =>
    run("pull", "Pull failed", async () => {
      const result = await pull({ environmentId, input: { cwd } });
      if (result._tag === "Failure") throw failureOf(result);
      return result.value.status === "pulled"
        ? `Pulled ${result.value.refName}`
        : `${result.value.refName} is up to date`;
    });
  const runPush = () =>
    run("push", "Push failed", async () => {
      const result = await push({ environmentId, input: { cwd } });
      if (result._tag === "Failure") throw failureOf(result);
      return result.value.status === "pushed"
        ? `Pushed ${result.value.refName}${result.value.upstreamRef ? ` to ${result.value.upstreamRef}` : ""}`
        : `${result.value.refName} is up to date`;
    });
  const runFetchPrune = () =>
    run("fetch", "Fetch failed", async () => {
      const result = await fetchPrune({ environmentId, input: { cwd } });
      if (result._tag === "Failure") throw failureOf(result);
      return "Fetched and pruned remotes";
    });
  const runRefresh = () => run("refresh", "Refresh failed", async () => null);

  const runCleanRepo = (cleanRepo: () => Promise<void>) =>
    run("clean", "Clean Repo failed", async () => {
      await cleanRepo();
      return null;
    });

  const removeBranch = async (ref: VcsRef, force = false): Promise<void> => {
    setDeleting(ref.name);
    const result = await deleteBranch({
      environmentId,
      input: { cwd, refName: ref.name, ...(force ? { force: true } : {}) },
    });
    setDeleting(null);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: `Deleted ${ref.name}` });
      await reload();
      return;
    }
    const failure = failureOf(result);
    const reason =
      typeof failure === "object" && failure !== null && "reason" in failure
        ? failure.reason
        : undefined;
    if (!force && reason === "branch_not_merged") {
      const confirmed = await requestConfirmDialog(
        `Force delete ${ref.name}?\n${ref.name} has commits that are not merged into its upstream or HEAD. Force deleting discards them.`,
        { variant: "destructive" },
      );
      if (confirmed === true) await removeBranch(ref, true);
      return;
    }
    toastManager.add({
      type: "error",
      title: `Could not delete ${ref.name}`,
      description: gitCommandErrorDetail(failure),
    });
    await reload();
  };

  const openThread = async (ref: VcsRef): Promise<void> => {
    if (opening !== null) return;
    setOpening(ref.name);
    const failure = await newThread.openThread(ref).then(
      () => null,
      (cause: unknown) => gitCommandErrorDetail(cause),
    );
    setOpening(null);
    if (failure === null) return;
    toastManager.add({
      type: "error",
      title: `Could not start a thread on ${ref.name}`,
      description: failure,
    });
    await reload();
  };

  const items: GitTreeGraphItem[] = (data?.pages ?? []).flatMap((page) =>
    page.commits.map((commit, index) => ({ commit, row: page.layout.rows[index]! })),
  );
  const graphWidth = Math.max(1, ...(data?.pages ?? []).map((page) => page.layout.width));
  const currentRef = data?.refs.find((ref) => ref.current) ?? null;
  const headHash =
    data?.headHash !== undefined
      ? data.headHash
      : currentRef === null
        ? null
        : (items.find((item) => item.commit.refs.includes(currentRef.name))?.commit.hash ?? null);
  const scrollToBranch = (ref: VcsRef) => {
    const index = items.findIndex((item) => item.commit.refs.includes(ref.name));
    if (index !== -1) void listRef.current?.scrollToIndex({ index, animated: false });
  };
  const busy = running !== null;
  const writeTitle = canWrite ? undefined : "Needs source control write access";
  const branchBusy = deleting !== null || opening !== null;
  const currentBlockedReason = currentRef === null ? null : newThread.blockedReason(currentRef);

  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-1 px-3 py-2">
      {picker}
      <Button
        size="sm"
        variant="outline"
        disabled={!canWrite || busy || currentRef === null}
        title={writeTitle ?? "Fast-forward the current branch from its upstream"}
        onClick={() => void runPull()}
      >
        {running === "pull" ? <Spinner aria-hidden /> : <ArrowDownIcon aria-hidden />}
        Pull
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canWrite || busy || currentRef === null}
        title={writeTitle ?? "Push the current branch, setting its upstream if needed"}
        onClick={() => void runPush()}
      >
        {running === "push" ? <Spinner aria-hidden /> : <ArrowUpIcon aria-hidden />}
        Push
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!canWrite || busy || data?.isRepo !== true}
        title={writeTitle ?? "Fetch every remote and remove stale remote-tracking branches"}
        onClick={() => void runFetchPrune()}
      >
        {running === "fetch" ? <Spinner aria-hidden /> : <RefreshCwIcon aria-hidden />}
        Fetch & prune
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || branchBusy || currentRef === null || currentBlockedReason !== null}
        title={
          currentRef === null
            ? "Check out a branch to start a thread on it"
            : (currentBlockedReason ?? `Start a new thread on ${currentRef.name}`)
        }
        onClick={() => {
          if (currentRef !== null) void openThread(currentRef);
        }}
      >
        {currentRef !== null && opening === currentRef.name ? (
          <Spinner aria-hidden />
        ) : (
          <MessageSquarePlusIcon aria-hidden />
        )}
        New thread
      </Button>
      {project === null ? (
        <Button size="sm" variant="outline" disabled title={`Add ${name} as a project to clean it`}>
          <BrushCleaningIcon aria-hidden />
          Clean Repo
        </Button>
      ) : (
        <CleanRepoButton
          project={project}
          disabled={busy || data?.isRepo !== true}
          running={running === "clean"}
          onClean={(cleanRepo) => void runCleanRepo(cleanRepo)}
        />
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Refresh Git tree"
        disabled={busy}
        onClick={() => void runRefresh()}
      >
        <RefreshIcon size="md" refreshing={running === "refresh"} />
      </Button>
    </div>
  );

  const body = (() => {
    if (data === null) {
      return error === null ? (
        <PageMessage>
          <Spinner aria-hidden /> Loading repository…
        </PageMessage>
      ) : (
        <PageMessage>{error}</PageMessage>
      );
    }
    if (!data.isRepo) {
      return <PageMessage>{name} is not a Git repository.</PageMessage>;
    }
    return (
      <div className="@container/git-tree flex min-h-0 flex-1 border-t border-border/60">
        <aside
          aria-label="Branches"
          className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border/60 py-2 @2xl/git-tree:w-72"
        >
          {data.refs.map((ref) => (
            <BranchRow
              key={ref.name}
              branch={ref}
              deleting={deleting === ref.name}
              canDelete={canWrite && !branchBusy}
              opening={opening === ref.name}
              newThreadBlockedReason={newThread.blockedReason(ref)}
              canOpenThread={!branchBusy}
              onSelect={() => scrollToBranch(ref)}
              onDelete={() => void removeBranch(ref)}
              onOpenThread={() => void openThread(ref)}
            />
          ))}
          {data.refs.length === 0 ? (
            <p className="px-3 text-xs text-muted-foreground">No local branches yet.</p>
          ) : null}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {error === null ? null : (
            <p className="border-b border-border/60 px-3 py-1.5 text-xs text-destructive-foreground">
              {error}
            </p>
          )}
          {items.length === 0 ? (
            <PageMessage>No commits yet.</PageMessage>
          ) : (
            <GitTreeGraph
              items={items}
              width={graphWidth}
              headHash={headHash}
              headBranch={currentRef?.name ?? null}
              listRef={listRef}
              footer={
                data.nextCursor === null ? null : (
                  <div className="flex justify-center py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {loadingMore ? <Spinner aria-hidden /> : null}
                      Load more
                    </Button>
                  </div>
                )
              }
            />
          )}
        </div>
      </div>
    );
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      {body}
    </div>
  );
}

function BranchRow({
  branch,
  deleting,
  canDelete,
  opening,
  newThreadBlockedReason,
  canOpenThread,
  onSelect,
  onDelete,
  onOpenThread,
}: {
  branch: VcsRef;
  deleting: boolean;
  canDelete: boolean;
  opening: boolean;
  newThreadBlockedReason: string | null;
  canOpenThread: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onOpenThread: () => void;
}) {
  // The main checkout's own branch is `current`; any other path is a thread's worktree.
  const inWorktree = branch.worktreePath !== null && !branch.current;
  const upstream = branch.upstreamRef?.replace(/^refs\/(?:remotes|heads)\//, "");
  const deleteTitle = branch.current
    ? "The current branch cannot be deleted"
    : inWorktree
      ? `Checked out in ${branch.worktreePath}`
      : `Delete ${branch.name}`;
  return (
    <div className="group flex items-center gap-1 px-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1 text-left hover:bg-accent"
        onClick={onSelect}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5 text-sm">
          <GitBranchIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0",
              branch.current ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span className={cn("truncate", branch.current && "font-medium")}>{branch.name}</span>
          {branch.current ? <Badge variant="info">current</Badge> : null}
          {inWorktree ? (
            <FolderTreeIcon
              aria-label={`Checked out in ${branch.worktreePath}`}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
        </span>
        {upstream === undefined ? null : (
          <span className="flex w-full min-w-0 items-center gap-1.5 pl-5 text-xs text-muted-foreground">
            <span className="truncate">{upstream}</span>
            {branch.upstreamGone ? (
              <Badge variant="warning">gone</Badge>
            ) : (
              <>
                {branch.ahead ? (
                  <span aria-label={`${branch.ahead} to push`}>↑{branch.ahead}</span>
                ) : null}
                {branch.behind ? (
                  <span aria-label={`${branch.behind} to pull`}>↓{branch.behind}</span>
                ) : null}
              </>
            )}
          </span>
        )}
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`New thread on ${branch.name}`}
        title={newThreadBlockedReason ?? `New thread on ${branch.name}`}
        disabled={!canOpenThread || newThreadBlockedReason !== null}
        onClick={onOpenThread}
      >
        {opening ? <Spinner aria-hidden /> : <MessageSquarePlusIcon aria-hidden />}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Delete ${branch.name}`}
        title={deleteTitle}
        disabled={!canDelete || branch.current || inWorktree}
        onClick={onDelete}
      >
        {deleting ? <Spinner aria-hidden /> : <Trash2Icon aria-hidden />}
      </Button>
    </div>
  );
}

function CleanRepoButton({
  project,
  disabled,
  running,
  onClean,
}: {
  project: EnvironmentProject;
  disabled: boolean;
  running: boolean;
  onClean: (cleanRepo: () => Promise<void>) => void;
}) {
  const { canCleanRepo, cleanRepo } = useCleanRepo(project);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={!canCleanRepo || disabled}
      title={
        canCleanRepo
          ? "Start an agent thread in the main checkout that cleans up this repository"
          : "Needs permission to start threads"
      }
      onClick={() => onClean(cleanRepo)}
    >
      {running ? <Spinner aria-hidden /> : <BrushCleaningIcon aria-hidden />}
      Clean Repo
    </Button>
  );
}
