import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentIssueEntry } from "@t3tools/client-runtime/issue-list";
import { issueEntryKey } from "@t3tools/client-runtime/state/issues";
import type { EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { TagIcon } from "lucide-react";
import { useState } from "react";

import { refreshIssueLists, issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { bulkLabelChange, bulkLabelCoverage } from "./issueBulkLabels.logic";

/**
 * Labels for every selected issue at once. Labels belong to one repository, so a selection
 * spanning several is not offered any.
 */
export function IssueBulkLabelMenu({
  environmentId,
  rows,
}: {
  environmentId: EnvironmentId;
  rows: ReadonlyArray<EnvironmentIssueEntry>;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const canWrite = useAtomValue(issueEnvironment.update.permissionAtom(environmentId));
  const update = useAtomCommand(issueEnvironment.update, { reportFailure: false });
  const [first] = rows;
  const oneScope =
    first !== undefined &&
    rows.every(
      (row) =>
        row.projectId === first.projectId &&
        row.host === first.host &&
        row.scope.toLowerCase() === first.scope.toLowerCase(),
    );
  const candidatesQuery = useEnvironmentQuery(
    open && oneScope
      ? issueEnvironment.candidates({
          environmentId,
          input: {
            projectId: first.projectId,
            tracker: first.tracker,
            host: first.host,
            scope: first.scope,
          },
        })
      : null,
  );
  const labelRows = rows.map((row) => ({
    key: issueEntryKey(row),
    labels: row.labels.map((label) => label.name),
  }));

  const apply = async (label: string) => {
    const { mode, writes } = bulkLabelChange(labelRows, label);
    const byKey = new Map(rows.map((row) => [issueEntryKey(row), row] as const));
    setPending(true);
    const results = await Promise.all(
      writes.map((write) => {
        const row = byKey.get(write.key)!;
        return update({
          environmentId,
          input: {
            projectId: row.projectId,
            tracker: row.tracker,
            host: row.host,
            scope: row.scope,
            key: row.key,
            labels: [...write.labels],
          },
        });
      }),
    );
    setPending(false);
    refreshIssueLists(environmentId);
    const failed = results.filter((result) => result._tag === "Failure").length;
    if (failed > 0) {
      toastManager.add({
        type: "error",
        title:
          mode === "add"
            ? gt('Could not add "{label}" on {failed} of {total} issues', {
                label,
                failed,
                total: writes.length,
              })
            : gt('Could not remove "{label}" on {failed} of {total} issues', {
                label,
                failed,
                total: writes.length,
              }),
      });
    }
  };

  const disabledReason = !canWrite
    ? gt("This connection cannot change issues.")
    : !oneScope
      ? gt("Select issues from one repository to label them together.")
      : null;
  const labels = candidatesQuery.data?.labels ?? [];

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            disabled={disabledReason !== null || pending}
            title={disabledReason ?? undefined}
          />
        }
      >
        <TagIcon aria-hidden />
        <T>Labels</T>
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-80">
        {candidatesQuery.isPending && candidatesQuery.data === null ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            <T>Loading labels…</T>
          </p>
        ) : labels.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {candidatesQuery.error === null
              ? gt("This tracker has no labels.")
              : candidatesQuery.error}
          </p>
        ) : (
          labels.map((label) => {
            const coverage = bulkLabelCoverage(labelRows, label.name);
            return (
              <MenuCheckboxItem
                key={label.name}
                checked={coverage === "all"}
                onClick={() => void apply(label.name)}
              >
                <span className="min-w-0 flex-1 truncate">{label.name}</span>
                {coverage === "some" ? (
                  <span className="text-xs text-muted-foreground">
                    {gt("some", { $context: "some of the selected issues have this label" })}
                  </span>
                ) : null}
              </MenuCheckboxItem>
            );
          })
        )}
      </MenuPopup>
    </Menu>
  );
}
