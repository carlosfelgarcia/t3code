import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createIssueEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const detail = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:detail",
    tag: WS_METHODS.issuesDetail,
    staleTimeMs: 30_000,
  });
  const labelCandidates = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:issues:label-candidates",
    tag: WS_METHODS.issuesLabelCandidates,
    staleTimeMs: 60_000,
  });
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:issues:list",
      tag: WS_METHODS.issuesList,
      staleTimeMs: 30_000,
    }),
    detail,
    labelCandidates,
    setLabels: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:set-labels",
      tag: WS_METHODS.issuesSetLabels,
      onSuccess: ({ environmentId, input: { host, repository, number } }, registry) =>
        Effect.sync(() => {
          const ref = { environmentId, input: { host, repository, number } };
          registry.refresh(detail(ref));
          registry.refresh(labelCandidates(ref));
        }),
    }),
    /** Drops the server's shared reads, so only a person's refresh spends GitHub requests. */
    invalidate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:issues:invalidate",
      tag: WS_METHODS.issuesInvalidate,
    }),
  };
}
