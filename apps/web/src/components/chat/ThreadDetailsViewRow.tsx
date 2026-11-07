import type { LucideIcon } from "lucide-react";

import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsViewRow({
  Icon,
  label,
  title,
  onOpen,
}: {
  Icon: LucideIcon;
  label: string;
  title: string;
  onOpen: () => void;
}) {
  return (
    <ThreadDetailsControl size="xs" variant="ghost" part="row" panel title={title} onClick={onOpen}>
      <Icon className={THREAD_DETAILS_PANEL_ICON_CLASS} aria-hidden />
      <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>{label}</span>
    </ThreadDetailsControl>
  );
}
