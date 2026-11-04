import { createIssueEnvironmentAtoms } from "@t3tools/client-runtime/state/issues";
import type { EnvironmentId } from "@t3tools/contracts";
import { type AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const issueEnvironment = createIssueEnvironmentAtoms(connectionAtomRuntime);

/** Several reads of one query as one value; equal inputs share the atom. */
function queryList<Input, A, E>(
  label: string,
  query: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: Input;
  }) => Atom.Atom<AsyncResult.AsyncResult<A, E>>,
) {
  const family = Atom.family((key: string) => {
    const { environmentId, inputs } = JSON.parse(key) as {
      readonly environmentId: EnvironmentId | null;
      readonly inputs: ReadonlyArray<Input>;
    };
    return Atom.make((get) =>
      environmentId === null ? [] : inputs.map((input) => get(query({ environmentId, input }))),
    ).pipe(Atom.withLabel(`${label}:${key}`));
  });
  return (environmentId: EnvironmentId | null, inputs: ReadonlyArray<Input>) =>
    family(JSON.stringify({ environmentId, inputs: environmentId === null ? [] : inputs }));
}

export const issueListPages = queryList("issues:list-pages", issueEnvironment.list);
export const issueLabelCandidateLists = queryList(
  "issues:label-candidate-lists",
  issueEnvironment.labelCandidates,
);
