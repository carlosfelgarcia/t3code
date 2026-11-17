export interface BulkLabelRow {
  readonly key: string;
  readonly labels: ReadonlyArray<string>;
}

export interface BulkLabelChange {
  readonly mode: "add" | "remove";
  /** Only the rows whose label set changes, each with its whole new set. */
  readonly writes: ReadonlyArray<{ readonly key: string; readonly labels: ReadonlyArray<string> }>;
}

const sameName = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** How many of the rows carry `label`: none, some, or every one of them. */
export function bulkLabelCoverage(
  rows: ReadonlyArray<BulkLabelRow>,
  label: string,
): "none" | "some" | "all" {
  const carrying = rows.filter((row) => row.labels.some((name) => sameName(name, label))).length;
  return carrying === 0 ? "none" : carrying === rows.length ? "all" : "some";
}

/** A label every row carries comes off all of them; any other label goes on all of them. */
export function bulkLabelChange(rows: ReadonlyArray<BulkLabelRow>, label: string): BulkLabelChange {
  const mode = bulkLabelCoverage(rows, label) === "all" ? "remove" : "add";
  const writes = rows.flatMap((row) => {
    const has = row.labels.some((name) => sameName(name, label));
    if (mode === "remove") {
      return [{ key: row.key, labels: row.labels.filter((name) => !sameName(name, label)) }];
    }
    return has ? [] : [{ key: row.key, labels: [...row.labels, label] }];
  });
  return { mode, writes };
}

/**
 * The selection after a row's checkbox or a modified click: Shift selects the range from the
 * anchor in list order, anything else toggles the one row.
 */
export function nextIssueSelection(
  selected: ReadonlySet<string>,
  orderedKeys: ReadonlyArray<string>,
  key: string,
  anchor: string | null,
  range: boolean,
): ReadonlySet<string> {
  const from = anchor === null ? -1 : orderedKeys.indexOf(anchor);
  const to = orderedKeys.indexOf(key);
  if (range && from !== -1 && to !== -1) {
    const next = new Set(selected);
    for (const rangeKey of orderedKeys.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      next.add(rangeKey);
    }
    return next;
  }
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
