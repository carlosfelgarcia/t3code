import { useAtomMount } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  GIT_COMMIT_GRAPH_DEFAULT_LIMIT,
  GIT_COMMIT_GRAPH_MAX_LIMIT,
  type VcsCommitGraphCommit,
  type VcsRef,
} from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment, vcsStatusRevalidation } from "~/state/vcs";

import { type GraphLayout, layoutCommitGraph } from "./gitTreeLayout";

export interface GitTreePage {
  readonly commits: ReadonlyArray<VcsCommitGraphCommit>;
  readonly layout: GraphLayout;
}

export interface GitTreeData {
  readonly isRepo: boolean;
  readonly refs: ReadonlyArray<VcsRef>;
  readonly pages: ReadonlyArray<GitTreePage>;
  readonly nextCursor: number | null;
  /** Absent when the server predates reporting HEAD. */
  readonly headHash: string | null | undefined;
}

export function gitCommandErrorDetail(error: unknown): string {
  if (typeof error === "object" && error !== null && "detail" in error) {
    const detail = (error as { readonly detail: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) return detail;
  }
  return error instanceof Error ? error.message : "The Git command failed.";
}

const REFS_PAGE_LIMIT = 200;

/** Loads the branch list and graph for one checkout, reloading as its status changes. */
export function useGitTreeData(environmentId: EnvironmentId, cwd: string) {
  const readRefs = useAtomCommand(vcsEnvironment.readRefs, { reportFailure: false });
  const readCommitGraph = useAtomCommand(vcsEnvironment.readCommitGraph, { reportFailure: false });
  const [data, setData] = useState<GitTreeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedCount = useRef(GIT_COMMIT_GRAPH_DEFAULT_LIMIT);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const disposed = useRef(false);
  const generation = useRef(0);

  const loadOnce = async () => {
    const refs: VcsRef[] = [];
    let cursor: number | null = 0;
    let isRepo = true;
    while (cursor !== null) {
      // The server's ref snapshot is cached; agents change refs behind its back.
      const page = await readRefs({
        environmentId,
        input: { cwd, refKind: "local", refresh: true, limit: REFS_PAGE_LIMIT, cursor },
      });
      if (page._tag === "Failure") throw squashAtomCommandFailure(page);
      isRepo = page.value.isRepo;
      refs.push(...page.value.refs);
      cursor = page.value.nextCursor;
    }
    const graph = await readCommitGraph({
      environmentId,
      input: {
        cwd,
        limit: Math.min(
          Math.max(loadedCount.current, GIT_COMMIT_GRAPH_DEFAULT_LIMIT),
          GIT_COMMIT_GRAPH_MAX_LIMIT,
        ),
      },
    });
    if (graph._tag === "Failure") throw squashAtomCommandFailure(graph);
    if (disposed.current) return;
    const commits = graph.value.commits;
    generation.current += 1;
    loadedCount.current = commits.length;
    setData({
      isRepo: isRepo && graph.value.isRepo,
      refs,
      pages: [{ commits, layout: layoutCommitGraph(commits) }],
      nextCursor: graph.value.nextCursor,
      headHash: graph.value.headHash,
    });
    setError(null);
  };

  // At most one load runs; changes that land meanwhile collapse into one trailing load.
  const reload = async () => {
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    do {
      queued.current = false;
      await loadOnce().catch((cause: unknown) => {
        if (!disposed.current) setError(gitCommandErrorDetail(cause));
      });
    } while (queued.current && !disposed.current);
    inFlight.current = false;
  };

  const loadMore = async () => {
    if (data === null || data.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    const startedAt = generation.current;
    const result = await readCommitGraph({
      environmentId,
      input: { cwd, cursor: data.nextCursor, limit: GIT_COMMIT_GRAPH_DEFAULT_LIMIT },
    });
    setLoadingMore(false);
    // A reload replaced the pages this one would extend.
    if (disposed.current || generation.current !== startedAt) return;
    if (result._tag === "Failure") {
      setError(gitCommandErrorDetail(squashAtomCommandFailure(result)));
      return;
    }
    const previousLanes = data.pages.at(-1)?.layout.lanes ?? [];
    const commits = result.value.commits;
    loadedCount.current += commits.length;
    setData({
      ...data,
      pages: [...data.pages, { commits, layout: layoutCommitGraph(commits, previousLanes) }],
      nextCursor: result.value.nextCursor,
    });
  };

  // Passive: reads status pushes without retaining the remote polling loop.
  const status = useEnvironmentQuery(
    vcsEnvironment.status({ environmentId, input: { cwd, includeRemote: false } }),
  );
  useAtomMount(vcsStatusRevalidation({ environmentId, cwd }));
  const statusKey = JSON.stringify(status.data);
  const reloadForStatus = useEffectEvent((_statusKey: string) => void reload());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reloads the repository view when the server pushes a status change for this checkout.
  useEffect(() => {
    reloadForStatus(statusKey);
  }, [statusKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops results that land after the view closed.
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);

  return { data, error, loadingMore, reload, loadMore };
}
