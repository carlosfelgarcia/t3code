import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, DEFAULT_CLEAN_REPO_PROMPT } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { newMessageId, newThreadId } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { useEnvironmentProviders } from "~/state/environments";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { DEFAULT_RUNTIME_MODE } from "~/types";

export function failureOf(result: { readonly cause: Cause.Cause<unknown> }): unknown {
  return Option.getOrElse(Cause.findErrorOption(result.cause), () =>
    squashAtomCommandFailure(result),
  );
}

/** Starts an agent thread in the project's main checkout that cleans up its repository. */
export function useCleanRepo(project: EnvironmentProject) {
  const { environmentId } = project;
  const navigate = useNavigate();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const canCleanRepo = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const settings = useEnvironmentSettings(environmentId);
  const providers = useEnvironmentProviders().get(environmentId) ?? [];

  const cleanRepo = async (): Promise<void> => {
    const resolved = resolveProjectSettings(settings, project.id, project).settings;
    const modelSelection =
      resolved.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(providers, settings, project.id);
    if (modelSelection === null) {
      throw new Error("No model is available on this environment. Enable a provider first.");
    }
    const threadId = newThreadId();
    const runtimeMode = resolved.defaultRuntimeMode ?? DEFAULT_RUNTIME_MODE;
    const createdAt = new Date().toISOString();
    const result = await startTurn({
      environmentId,
      input: {
        threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: resolved.cleanRepoPrompt || DEFAULT_CLEAN_REPO_PROMPT,
          attachments: [],
        },
        modelSelection,
        runtimeMode,
        interactionMode: "default",
        bootstrap: {
          // No branch or worktree path launches in the project's main checkout.
          createThread: {
            projectId: project.id,
            title: "Clean repo",
            modelSelection,
            runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (result._tag === "Failure") throw failureOf(result);
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
    });
  };

  return { canCleanRepo, cleanRepo };
}
