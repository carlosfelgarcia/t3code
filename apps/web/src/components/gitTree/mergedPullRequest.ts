export interface MergedPullRequest {
  /** The reference as its host writes it: `#12`, or `!12` on GitLab and Azure DevOps. */
  readonly label: string;
  /** The subject without a trailing `(#12)`, which the badge already shows. */
  readonly subject: string;
}

const SQUASH_SUFFIX = /\s*\(#(\d+)\)\s*$/;
// Default merge and squash messages of the hosts T3 Code supports, most specific first.
const SUBJECT_PATTERNS: ReadonlyArray<readonly [RegExp, "#" | "!"]> = [
  [/^Merge pull request #(\d+)\b/, "#"], // GitHub merge
  [/\(pull request #(\d+)\)/, "#"], // Bitbucket
  [/^Merged PR (\d+):/, "!"], // Azure DevOps
  [/\(#(\d+)\)(?!.*\(#\d+\))/, "#"], // GitHub and Forgejo squash, Forgejo merge
];
const GITLAB_MERGE_REQUEST = /^See merge request \S*!(\d+)\s*$/m;

/** Reads the pull request a merge or squash commit landed, from its host's default message. */
export function mergedPullRequestOf(commit: {
  readonly subject: string;
  readonly message: string;
}): MergedPullRequest | null {
  const { subject } = commit;
  for (const [pattern, sigil] of SUBJECT_PATTERNS) {
    const number = pattern.exec(subject)?.[1];
    if (number !== undefined)
      return { label: `${sigil}${number}`, subject: subject.replace(SQUASH_SUFFIX, "") };
  }
  const gitLab = GITLAB_MERGE_REQUEST.exec(commit.message)?.[1];
  return gitLab === undefined ? null : { label: `!${gitLab}`, subject };
}
