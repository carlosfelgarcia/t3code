import type { EnvironmentId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { IssuesPage, type IssuesSearch } from "../components/issues/IssuesPage";

function searchLabels(raw: unknown): Pick<IssuesSearch, "labels"> | Record<string, never> {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const labels = [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim().slice(0, 200))
        .filter((value) => value.length > 0),
    ),
  ].slice(0, 10);
  return labels.length === 0 ? {} : { labels };
}

const text = (raw: unknown) =>
  typeof raw === "string" && raw.trim().length > 0 ? raw.trim().slice(0, 200) : undefined;

export const Route = createFileRoute("/_chat/issues")({
  validateSearch: (raw: Record<string, unknown>): IssuesSearch => {
    const repo = text(raw.repo);
    const author = text(raw.author);
    const environmentId = text(raw.environmentId);
    const host = text(raw.host);
    const repository = text(raw.repository);
    return {
      state: raw.state === "closed" || raw.state === "all" ? raw.state : "open",
      // Always include q to override numeric values in the parent route's unvalidated search.
      q: text(raw.q),
      ...searchLabels(raw.labels),
      ...(repo === undefined ? {} : { repo }),
      ...(author === undefined ? {} : { author }),
      ...(environmentId === undefined ? {} : { environmentId: environmentId as EnvironmentId }),
      ...(host === undefined ? {} : { host }),
      ...(repository === undefined ? {} : { repository }),
      ...(typeof raw.number === "number" && Number.isInteger(raw.number) && raw.number > 0
        ? { number: raw.number }
        : {}),
    };
  },
  component: IssuesPage,
});
