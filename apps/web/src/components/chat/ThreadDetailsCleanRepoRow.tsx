import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { BrushCleaningIcon } from "lucide-react";
import { useState } from "react";

import { useCleanRepo } from "~/hooks/useCleanRepo";
import { useProject } from "~/state/entities";

import { gitCommandErrorDetail } from "../gitTree/useGitTreeData";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsCleanRepoRow({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const project = useProject(scopeProjectRef(environmentId, projectId));
  return project === null ? null : <CleanRepoRow project={project} />;
}

function CleanRepoRow({ project }: { project: EnvironmentProject }) {
  const { canCleanRepo, cleanRepo } = useCleanRepo(project);
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStarting(true);
    await cleanRepo().catch((cause: unknown) =>
      toastManager.add({
        type: "error",
        title: "Clean Repo failed",
        description: gitCommandErrorDetail(cause),
      }),
    );
    setStarting(false);
  };
  return (
    <ThreadDetailsControl
      size="xs"
      variant="ghost"
      part="row"
      panel
      disabled={!canCleanRepo || starting}
      title={
        canCleanRepo
          ? "Start an agent thread in the main checkout that cleans up this repository"
          : "Needs permission to start threads"
      }
      onClick={() => void start()}
    >
      {starting ? (
        <Spinner aria-hidden className="shrink-0" />
      ) : (
        <BrushCleaningIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
      )}
      <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>Clean Repo</span>
    </ThreadDetailsControl>
  );
}
