import { describe, expect, it } from "vite-plus/test";

import { layoutCommitGraph } from "./gitTreeLayout";

const commit = (hash: string, ...parents: string[]) => ({ hash, parents });
const through = (lane: number) => ({ kind: "through", from: lane, to: lane });
const into = (from: number, to: number) => ({ kind: "in", from, to });
const out = (from: number, to: number) => ({ kind: "out", from, to });

// Commits are newest first, as the commit graph read returns them.
const MERGE = [commit("M", "B", "F"), commit("F", "A"), commit("B", "A"), commit("A")];

describe("layoutCommitGraph", () => {
  it.each([
    {
      name: "a straight line",
      commits: [commit("C", "B"), commit("B", "A"), commit("A")],
      rows: [
        { hash: "C", lane: 0, edges: [out(0, 0)] },
        { hash: "B", lane: 0, edges: [into(0, 0), out(0, 0)] },
        { hash: "A", lane: 0, edges: [into(0, 0)] },
      ],
      width: 1,
    },
    {
      name: "a fork",
      commits: [commit("X", "B"), commit("Y", "B"), commit("B", "A"), commit("A")],
      rows: [
        { hash: "X", lane: 0, edges: [out(0, 0)] },
        { hash: "Y", lane: 1, edges: [through(0), out(1, 1)] },
        { hash: "B", lane: 0, edges: [into(0, 0), into(1, 0), out(0, 0)] },
        { hash: "A", lane: 0, edges: [into(0, 0)] },
      ],
      width: 2,
    },
    {
      name: "a merge",
      commits: MERGE,
      rows: [
        { hash: "M", lane: 0, edges: [out(0, 0), out(0, 1)] },
        { hash: "F", lane: 1, edges: [through(0), into(1, 1), out(1, 1)] },
        { hash: "B", lane: 0, edges: [into(0, 0), through(1), out(0, 0)] },
        { hash: "A", lane: 0, edges: [into(0, 0), into(1, 0)] },
      ],
      width: 2,
    },
    {
      name: "several branch tips side by side",
      commits: [commit("T1", "A"), commit("T2", "A"), commit("T3", "A"), commit("A")],
      rows: [
        { hash: "T1", lane: 0, edges: [out(0, 0)] },
        { hash: "T2", lane: 1, edges: [through(0), out(1, 1)] },
        { hash: "T3", lane: 2, edges: [through(0), through(1), out(2, 2)] },
        { hash: "A", lane: 0, edges: [into(0, 0), into(1, 0), into(2, 0)] },
      ],
      width: 3,
    },
    {
      name: "a freed lane reused by a later tip",
      commits: [
        commit("X", "B"),
        commit("Y", "B"),
        commit("B", "A"),
        commit("Z", "A"),
        commit("A"),
      ],
      rows: [
        { hash: "X", lane: 0, edges: [out(0, 0)] },
        { hash: "Y", lane: 1, edges: [through(0), out(1, 1)] },
        { hash: "B", lane: 0, edges: [into(0, 0), into(1, 0), out(0, 0)] },
        { hash: "Z", lane: 1, edges: [through(0), out(1, 1)] },
        { hash: "A", lane: 0, edges: [into(0, 0), into(1, 0)] },
      ],
      width: 2,
    },
  ])("lays out $name", ({ commits, rows, width }) => {
    expect(layoutCommitGraph(commits)).toEqual({ rows, lanes: [], width });
  });

  it("continues the open lanes when the next page is appended", () => {
    const whole = layoutCommitGraph(MERGE);
    const firstPage = layoutCommitGraph(MERGE.slice(0, 2));
    expect(firstPage.lanes).toEqual(["B", "A"]);
    const secondPage = layoutCommitGraph(MERGE.slice(2), firstPage.lanes);
    expect([...firstPage.rows, ...secondPage.rows]).toEqual(whole.rows);
    expect(secondPage.lanes).toEqual([]);
  });
});
