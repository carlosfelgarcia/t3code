import { describe, expect, it } from "vite-plus/test";

import { bulkLabelChange, nextIssueSelection } from "./issueBulkLabels.logic";

describe("bulkLabelChange", () => {
  it("adds a label some rows lack to only those rows, and removes one every row has", () => {
    const rows = [
      { key: "1", labels: ["bug", "ui"] },
      { key: "2", labels: ["Bug"] },
      { key: "3", labels: [] },
    ];
    expect(bulkLabelChange(rows, "ui")).toEqual({
      mode: "add",
      writes: [
        { key: "2", labels: ["Bug", "ui"] },
        { key: "3", labels: ["ui"] },
      ],
    });
    expect(bulkLabelChange(rows.slice(0, 2), "BUG")).toEqual({
      mode: "remove",
      writes: [
        { key: "1", labels: ["ui"] },
        { key: "2", labels: [] },
      ],
    });
  });
});

describe("nextIssueSelection", () => {
  const order = ["a", "b", "c", "d"];

  it("toggles one row, and with a range fills from the anchor in list order", () => {
    expect([...nextIssueSelection(new Set(["a"]), order, "a", null, false)]).toEqual([]);
    expect([...nextIssueSelection(new Set(["a"]), order, "c", "a", false)]).toEqual(["a", "c"]);
    expect([...nextIssueSelection(new Set(["d"]), order, "b", "d", true)].sort()).toEqual([
      "b",
      "c",
      "d",
    ]);
    // A range with no anchor on the page toggles like a plain click.
    expect([...nextIssueSelection(new Set(), order, "b", "gone", true)]).toEqual(["b"]);
  });
});
