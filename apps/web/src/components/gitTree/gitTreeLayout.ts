export interface GraphCommit {
  readonly hash: string;
  readonly parents: ReadonlyArray<string>;
}

/**
 * One line segment inside a row. `through` passes lane `from` top to bottom, `in` joins lane
 * `from` at the top to the commit's node in lane `to`, and `out` leaves the node in lane `from`
 * for lane `to` at the bottom.
 */
export interface GraphEdge {
  readonly kind: "through" | "in" | "out";
  readonly from: number;
  readonly to: number;
}

export interface GraphRow {
  readonly hash: string;
  readonly lane: number;
  readonly edges: ReadonlyArray<GraphEdge>;
}

/** Each open lane holds the hash it waits for; null marks a free slot. */
export type GraphLanes = ReadonlyArray<string | null>;

export interface GraphLayout {
  readonly rows: ReadonlyArray<GraphRow>;
  /** Pass to the next page's layout so its lines continue this page's. */
  readonly lanes: GraphLanes;
  readonly width: number;
}

/** Commits must come children first, as `git log --date-order` lists them. */
export function layoutCommitGraph(
  commits: ReadonlyArray<GraphCommit>,
  previousLanes: GraphLanes = [],
): GraphLayout {
  const lanes = [...previousLanes];
  const rows: GraphRow[] = [];
  let width = 0;
  const freeLane = (taken: number) => {
    const index = lanes.findIndex((hash, lane) => hash === null && lane !== taken);
    return index === -1 ? Math.max(lanes.length, taken + 1) : index;
  };

  for (const { hash, parents } of commits) {
    const waiting = lanes.flatMap((expected, lane) => (expected === hash ? [lane] : []));
    const lane = waiting[0] ?? freeLane(-1);
    const edges: GraphEdge[] = [];
    lanes.forEach((expected, index) => {
      if (expected === hash) edges.push({ kind: "in", from: index, to: lane });
      else if (expected !== null) edges.push({ kind: "through", from: index, to: index });
    });
    for (const index of waiting) lanes[index] = null;

    const [firstParent, ...otherParents] = parents;
    if (firstParent !== undefined) {
      lanes[lane] = firstParent;
      edges.push({ kind: "out", from: lane, to: lane });
    }
    for (const parent of otherParents) {
      const existing = lanes.indexOf(parent);
      const target = existing === -1 ? freeLane(lane) : existing;
      lanes[target] = parent;
      edges.push({ kind: "out", from: lane, to: target });
    }
    while (lanes.length > 0 && lanes.at(-1) == null) lanes.pop();

    rows.push({ hash, lane, edges });
    width = Math.max(width, lane + 1, ...edges.map((edge) => Math.max(edge.from, edge.to) + 1));
  }
  return { rows, lanes, width };
}
