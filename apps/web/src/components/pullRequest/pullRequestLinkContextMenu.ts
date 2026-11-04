import type { ContextMenuItem } from "@t3tools/contracts";
import {
  type SourceControlDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@t3tools/client-runtime/source-control-clients";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external";

export const openOnHostLabel = (host: SourceControlDefinition): string =>
  host === UNKNOWN_SOURCE_CONTROL_CLIENT ? "Open on host" : `Open on ${host.label}`;

function pullRequestLinkContextMenuItems(
  openLabel: string,
  separatorBefore: boolean,
): readonly ContextMenuItem<PullRequestLinkContextMenuAction>[] {
  return [
    {
      id: "copy-link",
      label: "Copy link",
      icon: "copy",
      ...(separatorBefore ? { separatorBefore } : {}),
    },
    { id: "open-external", label: openLabel },
  ];
}

/** `items` go above the link actions; picking one calls `onAction`. */
export async function showPullRequestLinkContextMenu<Action extends string = never>({
  url,
  openLabel,
  position,
  items = [],
  onAction,
}: {
  readonly url: string;
  readonly openLabel: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly items?: readonly ContextMenuItem<Action>[];
  readonly onAction?: (action: Action) => void;
}): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  let action: PullRequestLinkContextMenuAction | Action | null = null;
  try {
    action = await api.contextMenu.show<PullRequestLinkContextMenuAction | Action>(
      [...items, ...pullRequestLinkContextMenuItems(openLabel, items.length > 0)],
      position,
    );
  } catch {
    return;
  }
  if (action === null) return;
  if (action !== "copy-link" && action !== "open-external") {
    onAction?.(action);
    return;
  }
  try {
    if (action === "copy-link") await writeTextToClipboard(url, "link");
    else await api.shell.openExternal(url);
  } catch {
    toastManager.add({
      type: "error",
      title: action === "copy-link" ? "Could not copy the link" : "Could not open the link",
    });
  }
}
