import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PullRequestActor, PullRequestLabel } from "./pullRequest.ts";

export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

export const IssueListState = Schema.Literals(["open", "closed", "all"]);
export type IssueListState = typeof IssueListState.Type;

/** A repository on a GitHub host, as `owner/name`. */
export const IssueRepository = Schema.Struct({
  host: TrimmedNonEmptyString,
  repository: TrimmedNonEmptyString,
});
export type IssueRepository = typeof IssueRepository.Type;

export const IssueRef = Schema.Struct({
  ...IssueRepository.fields,
  number: PositiveInt,
});
export type IssueRef = typeof IssueRef.Type;

export const ISSUE_LIST_PAGE_SIZE = 50;

export const IssueListInput = Schema.Struct({
  repositories: Schema.Array(IssueRepository).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  state: IssueListState,
  labels: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(200))).check(
      Schema.isMaxLength(10),
    ),
  ),
  query: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  /** GitHub login of whoever opened the issue. */
  author: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
  /** One-based page of `ISSUE_LIST_PAGE_SIZE` issues. */
  page: Schema.optional(PositiveInt),
});
export type IssueListInput = typeof IssueListInput.Type;

/** Another issue an issue depends on, or that depends on it. */
export const LinkedIssue = Schema.Struct({
  ...IssueRef.fields,
  title: Schema.String,
  state: IssueState,
});
export type LinkedIssue = typeof LinkedIssue.Type;

export const IssueSummary = Schema.Struct({
  ...IssueRef.fields,
  title: Schema.String,
  state: IssueState,
  url: Schema.String,
  author: Schema.NullOr(PullRequestActor),
  labels: Schema.Array(PullRequestLabel),
  commentCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** Missing where the host does not report issue dependencies. */
  openBlockerCount: Schema.optional(NonNegativeInt),
  /** Missing when the blockers could not be read; the count still marks the issue blocked. */
  openBlockers: Schema.optional(Schema.Array(LinkedIssue)),
});
export type IssueSummary = typeof IssueSummary.Type;

export const IssueListHostError = Schema.Struct({
  host: TrimmedNonEmptyString,
  message: Schema.String,
});
export type IssueListHostError = typeof IssueListHostError.Type;

export const IssueListResult = Schema.Struct({
  issues: Schema.Array(IssueSummary),
  hasMore: Schema.Boolean,
  /** Hosts that could not be read; the issues from the others still list. */
  errors: Schema.Array(IssueListHostError),
  /** The author filter applied. Servers older than the filter drop it, so this is missing. */
  author: Schema.optional(TrimmedNonEmptyString),
});
export type IssueListResult = typeof IssueListResult.Type;

export const IssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: Schema.NullOr(PullRequestActor),
  body: Schema.String,
  createdAt: IsoDateTime,
  url: Schema.String,
});
export type IssueComment = typeof IssueComment.Type;

export const IssueDetail = Schema.Struct({
  ...IssueSummary.fields,
  body: Schema.String,
  assignees: Schema.Array(PullRequestActor),
  comments: Schema.Array(IssueComment),
  /** Missing when the host does not offer issue dependencies or they could not be read. */
  blockedBy: Schema.optional(Schema.Array(LinkedIssue)),
  blocking: Schema.optional(Schema.Array(LinkedIssue)),
});
export type IssueDetail = typeof IssueDetail.Type;

export const IssueLabelChangeInput = Schema.Struct({
  ...IssueRef.fields,
  labels: Schema.Array(TrimmedNonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(25)),
  applied: Schema.Boolean,
});
export type IssueLabelChangeInput = typeof IssueLabelChangeInput.Type;

export const IssueErrorReason = Schema.Literals([
  "unsupported",
  "unauthenticated",
  "forbidden",
  "not-found",
  "rate-limited",
  "failed",
]);
export type IssueErrorReason = typeof IssueErrorReason.Type;

export class IssueOperationError extends Schema.TaggedError<IssueOperationError>()(
  "IssueOperationError",
  {
    operation: Schema.String,
    reason: IssueErrorReason,
    host: Schema.String,
    repository: Schema.optional(Schema.String),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
