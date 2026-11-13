import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { SiblingRepository } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { projectEnvironment } from "~/state/projects";

import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "./ui/combobox";
import { SelectButton } from "./ui/select";

const OWN_REPOSITORY = "__project__";

/**
 * The project's sibling repositories and the one a tab chose by `selectedPath`. `siblings` is
 * empty while the project's "List sibling repositories" setting is off and `null` while the first
 * read is in flight. `siblingProject` is the project rooted at the chosen sibling, if any.
 */
export function useSiblingSelection(project: EnvironmentProject, selectedPath: string | undefined) {
  const settings = useEnvironmentSettings(project.environmentId);
  const projects = useProjects();
  const enabled = resolveProjectSettings(settings, project.id, project).settings
    .listSiblingRepositories;
  const query = useEnvironmentQuery(
    enabled
      ? projectEnvironment.listSiblingRepositories({
          environmentId: project.environmentId,
          input: { cwd: project.workspaceRoot },
        })
      : null,
  );
  const siblings: ReadonlyArray<SiblingRepository> | null =
    !enabled || query.error !== null ? [] : (query.data?.repositories ?? null);
  const sibling = siblings?.find((entry) => entry.path === selectedPath) ?? null;
  const siblingProject =
    sibling === null
      ? null
      : (projects.find(
          (entry) =>
            entry.environmentId === project.environmentId && entry.workspaceRoot === sibling.path,
        ) ?? null);
  return { siblings, sibling, siblingProject };
}

/**
 * Picks between the project's own repository (`null`), checked out at `ownPath`, and one of its
 * sibling repositories.
 */
export function SiblingRepositoryPicker({
  project,
  ownPath,
  siblings,
  selected,
  onSelect,
}: {
  project: EnvironmentProject;
  ownPath: string;
  siblings: ReadonlyArray<SiblingRepository>;
  selected: SiblingRepository | null;
  onSelect: (sibling: SiblingRepository | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const options = [
    { value: OWN_REPOSITORY, name: project.title, path: ownPath },
    ...siblings.map((sibling) => ({ value: sibling.path, name: sibling.name, path: sibling.path })),
  ].filter((option) => needle === "" || option.name.toLowerCase().includes(needle));
  const values = options.map((option) => option.value);
  const selectedValue = selected?.path ?? OWN_REPOSITORY;

  return (
    <div className="w-44 shrink-0">
      <Combobox
        items={values}
        filteredItems={values}
        filter={null}
        autoHighlight
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setQuery("");
        }}
        value={selectedValue}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          setOpen(false);
          onSelect(siblings.find((sibling) => sibling.path === next) ?? null);
        }}
      >
        <ComboboxTrigger
          aria-label="Repository"
          title={selected?.path ?? ownPath}
          render={<SelectButton size="sm" />}
        >
          <span className="truncate">{selected?.name ?? project.title}</span>
        </ComboboxTrigger>
        <ComboboxPopup align="start" side="bottom" className="w-80">
          <ComboboxSearchInput
            aria-label="Search repositories"
            placeholder="Search repositories…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ComboboxEmpty>No repositories match.</ComboboxEmpty>
          <ComboboxList className="max-h-72">
            {options.map((option, index) => (
              <ComboboxItem
                key={option.value}
                hideIndicator
                selectedFill={false}
                index={index}
                value={option.value}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{option.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{option.path}</span>
                </div>
                {option.value === selectedValue ? (
                  <CheckIcon aria-hidden className="size-3.5 text-muted-foreground" />
                ) : null}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxPopup>
      </Combobox>
    </div>
  );
}
