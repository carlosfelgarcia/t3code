# Source control

T3 Code integrates with GitHub, GitLab, Forgejo, Gitea, Bitbucket, Azure DevOps, GitCafe, and Cursor
Origin to clone and publish repositories, create pull requests, and review changes.

## Review turn changes

A turn's changed files and diff show only the turn's own work. When a turn pulls, merges, or
rebases, the files Git brought in are left out. A file stays in the list when the turn edited it,
committed it, or fixed a conflict in it. Use the branch comparison to review everything that changed
against your base branch. Restore still returns the complete saved workspace.

On web and desktop, open the Diff pane source picker and choose **Commits** to review one local
commit at a time. The list shows the newest 100 commits in the branch comparison. A merge commit
shows its changes against its first parent.

A commit link from a supported code host opens in the Diff pane when the thread's repository has
that commit locally, on any branch. Otherwise a pull request commit link opens the pull request. Other
commit links follow your **Open links in** setting; on web, when that opens a new tab, T3 Code first
shows an **Open link** button. Command/Ctrl+Click always opens the link in your browser. Commit links follow the **Open pull requests in T3 Code**
setting in **Settings → Diffs**.

## Connect an account

Install Git and configure authentication on the machine running your T3 Code server. For a remote
environment, do this on the remote machine. After signing in, open **Settings → Source control**
and choose **Rescan**.

### GitHub

T3 Code talks to GitHub's API directly and only needs a token. Any of these works, in this
order of precedence:

1. A token saved in **Settings → Source control → GitHub**. It is kept in the server's secret
   store, and works without the GitHub CLI.
2. `GH_TOKEN` (`GH_ENTERPRISE_TOKEN` with `GH_HOST` for GitHub Enterprise Server) in the
   server's environment.
3. [GitHub CLI](https://cli.github.com/) 2.81.0 or newer, signed in with `gh auth login`.

If `gh` is signed in to several accounts or hosts, expand **GitHub** in the same place to pick
the account each host uses or turn a host off. A saved token or `GH_TOKEN` takes precedence
over that choice; a host turned off stays off either way.

For GitHub Enterprise, sign in with `gh auth login --hostname YOUR_HOST`. T3 Code treats a
custom server name as GitHub once it has a credential for that host.

### Forgejo and Gitea

Install [Forgejo CLI (`fj`)](https://codeberg.org/forgejo-contrib/forgejo-cli) or
[Gitea CLI (`tea`)](https://gitea.com/gitea/tea) 0.16 or later on your T3 Code server.
Sign in with `fj --host https://your-server auth add-token` or `tea login add`.
Repeat for each server you use, including Codeberg.

T3 Code prefers a matching `fj` login and falls back to `tea` when `fj` is unavailable
or has no login for that server. Once an account is selected, failed actions stay on that
account. Settings shows the detected CLI. Forgejo and Gitea share one integration entry.
Servers hosted under a URL subpath, such as `https://example.com/forgejo`, use `tea` because
fj 0.6 does not preserve the subpath when checking its account.

When cloning or publishing, use a full repository URL to select a specific server.
You can use `owner/repo` when only one fj server is configured, or with your default `tea`
login when fj is unavailable or unconfigured. With multiple fj servers, use the full URL.
If you have multiple `tea` accounts on one server, select one with
`tea login default <login-name>`. Git push and clone also need Git credentials or an SSH key
for that server.

### GitLab

Install [GitLab CLI](https://gitlab.com/gitlab-org/cli), then sign in:

```bash
glab auth login
```

### Bitbucket

Open **Settings → Source control**, expand **Bitbucket**, and enter one of:

- **Access token**: a token created for one repository, project, or workspace. It can only reach
  what it was created for.
- **Atlassian account email** and **API token**: an Atlassian API token for your account. It can
  reach every repository you can. Give it read/write access to repositories and pull requests, plus
  user read access (`read:user:bitbucket`).

A field saves when you leave it, and applies right away. The access token wins when both are saved.
Credentials are saved on the environment's server, so select a remote environment to configure
it. Saved tokens can't be viewed again; enter a new one to replace it, or choose **Remove** to clear
everything saved for Bitbucket.

If no credentials are saved, T3 Code falls back to these variables in the server's environment.
Restart the server after changing them:

```bash
export T3CODE_BITBUCKET_ACCESS_TOKEN="your-access-token"
# or
export T3CODE_BITBUCKET_EMAIL="you@example.com"
export T3CODE_BITBUCKET_API_TOKEN="your-token"
```

For a background service, put these `KEY=VALUE` entries in
[`service.env`](./background-service.md#configure-the-service-environment)
under T3 home, then run `t3 service restart`. Service installation and updates
preserve that file.

### Azure DevOps

Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/), add the DevOps extension, and sign in:

```bash
az extension add --name azure-devops
az login
```

### GitCafe

Install the GitCafe CLI and sign in:

```bash
bun install -g @gitcafe/cli
cafe auth login --host https://git.cafe/api
```

Alternatively, open **Settings → Source control**, expand **GitCafe**, and enter a token. It is
kept in the server's secret store, applies right away, and is used before `CAFE_TOKEN` and the
`cafe` login. Or set `CAFE_TOKEN` in the server's environment and restart it. Both tokens are only
sent to `git.cafe`; `CAFE_TOKEN` follows `CAFE_HOST` if you set it. Repositories on
`staging.git.cafe` need their own login with `--host https://staging.git.cafe/api`.

Line comments are not available for GitCafe pull requests yet.
Merging a stack lands it through GitCafe, and updating a branch restacks the layers above it.

### Cursor Origin

Install the [Origin CLI](https://cursor.com/docs/origin/cli) and sign in. Signing in also sets up Git
credentials for `origin.cursor.com`:

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
```

If cloning or pushing asks for a username, run `origin auth setup-git` to point Git at the CLI's
credentials again. Origin repositories use HTTPS and are published privately. Repositories mirrored
from GitHub keep their pull requests on GitHub; open those from the GitHub remote.

## Start, clone, or publish a project

To start from nothing, choose **New project** in the command palette (`Cmd/Ctrl+K`), or
**New project** under **Add Project** on any client, and type a name. T3 Code makes a Git
repository in `~/.t3/projects` (the `projects` folder of your T3 data directory) with a README,
an icon, and a first commit, then opens a new thread in it. Until the project has a thread, new
threads work in its folder, even when your default is a new worktree. The folder is named after the project,
like `pinball-stats` for "Pinball Stats". Turn on **Create private repository on GitHub** to also
publish it. If Git has no name or email on that machine, the project is created without the
first commit.

Use **Add Project** in the command palette (`Cmd/Ctrl+K`) to clone a repository. Choose a hosting
provider or paste a Git URL, then choose where to save it. Only GitHub is listed at first. To list
another provider here and in **Publish Repository**, turn on its switch under
**Settings → Source control**. A branch or file page copied from GitHub,
GitLab, GitCafe, Codeberg or Bitbucket also works: T3 Code clones that repository's default branch.
On other hosts, paste the repository's clone URL. The project opens right away while the
clone runs in the background: you can write your first prompt, and sending waits until the files
are in place. A toast tracks progress and lets you cancel; if the clone fails, retry it from the
toast or from the banner above the composer. When the host refuses the machine's SSH key, T3 Code
clones over HTTPS with Git's credentials for that host instead, and the project's remote uses the
HTTPS URL.

To lay clones out like [ghq](https://github.com/x-motemen/ghq), turn on **Clone into host folders**
under **Settings → Threads** (or **Source control** on mobile). Clones then default to
`<host>/<owner>/<repo>` under **Add project starts in**, so set that to `~/ghq` to share ghq's
folders. You can still change the destination before cloning.

For a local Git repository without a remote, **Publish Repository** creates a hosted repository,
adds it as `origin`, and pushes your commits. If there are no commits yet, it creates the remote;
make your first commit before pushing.

## Create a pull request

Use a thread's Git actions to commit, push, and create a pull request. T3 Code can generate commit
messages, review titles, and descriptions from your changes. Descriptions also draw on the work in
the thread, including the checks it ran.

An existing fork PR can appear beside the branch even if you pushed without setting an upstream.
If its badge is missing because several remotes hold that branch, set the branch's upstream to
the intended remote with `git branch --set-upstream-to=<remote>/<branch>`.

Choose how commit messages and pull request titles and descriptions are written in
**Settings → Source control → Commits & pull requests**. **Repository conventions** uses the
project's instructions and recent commit subjects. **Custom instructions** applies your own
instructions to commits and pull requests.

## Review and merge

Open **Pull requests** to review changes and comments, request reviewers, check out a branch,
or merge. You can edit review titles and descriptions and your own comments where the host allows it.
Where you can edit a description, you can also tick its checkboxes from the Summary tab
(the Overview tab on mobile).
GitLab calls these merge requests.

A link to part of a pull request opens that part: a comment or review is marked in the activity, a
changed-line link opens the file at those lines, a checks link opens the checks, and a commit link
opens that commit's changes. On web and desktop, hovering a comment or commit link previews it.

On mobile, **Pull requests** lists reviews across your connected environments. Open a review
to read its description, activity, commits, and changed files. Line comments stay as drafts
until you submit the review. **Work on PR** opens a chat with the review attached; sending
the first message prepares a worktree from the review's branch.

Previously loaded lists, review details, guides, and diff pages remain readable on mobile
without a connection, including after restarting the app. Saved content refreshes when the
environment reconnects; submitting changes requires a connection.

Enable **Remove agent credits when merging** in Settings → Source control to remove recognized
agent co-author and generated-by lines from GitHub merge and squash commit messages. Human
co-authors stay credited. The setting is off by default and projects can override it. It also
applies to auto-merge, but not merge queues or native stack merges. Original commits keep their
messages, so merge and rebase can still retain agent credits in those commits.

On web and desktop, hold **Shift** in the GitHub pull request list for quick actions.
To close several, press **Close**, drag across the rows in the same group, and release.
Press **Escape** before releasing to cancel. Failed closes stay in the list so you can retry them.

GitHub, GitLab, and Azure DevOps support auto-merge while checks are outstanding. GitHub also
supports approving waiting fork workflows and opening a revert pull request for a merged change.

Pull request sharing is off by default. In Settings → Environments → Pull request sharing (Pull
request routing under Environments on mobile), choose **Read PRs** or **Read and act** for each
environment you trust to share its source control access.
Enable both the original environment and the environment answering its requests on this client.
**Read and act** can use broader permissions than the original environment's credential;
only enable it for environments you control and trust. Changing a saved endpoint or removing an
environment clears its permission.

Review details, linked PR status, and permitted review actions can then use another connected
environment signed in to the same account on the same host. Each needs a project on that host.
A connected local environment is preferred for actions and can answer slow or failed reads.
Browsers and mobile clients need a paired environment to use its GitHub credentials.
Credentials stay on their machines. Previously verified credentials remain usable for routing
for ten minutes during a GitHub outage; new credentials must be verified first. An action with
an uncertain result is never automatically retried elsewhere. Listings, diffs, and checkout or
PR creation from Git actions continue to use the project's environment.

For Azure DevOps, use the host website to change comments. Bitbucket does not support reopening a
declined pull request.

### Review guides

Review guides are in beta. Turn on **Review guides** in Settings → Source control to add the
**Guide** tab to pull requests on that server. On mobile, move between stops with **Next**
and the back button; a stale guide offers a rewrite and hides excerpts that no longer match
the current change.

The **Guide** tab gives you a tour of a pull request without reading it line by line: stops
through the change in reading order. Each stop points at the lines worth reading, and a stop marked
**Look closely** has a call only a maintainer can make. Mechanical changes such as renames and
snapshots are grouped at the end, and every changed file appears somewhere on the tour.
Conversations already resolved in review are left out. For a pull request in a stack, the guide
covers that layer only, and may point out what a lower layer introduced or what a higher one uses.

Choose **Write guide** to have the review guide model from Settings → Source control read the
change in a temporary checkout; without one set, the source control writer model is used. Nothing
in the checkout is changed, and a large pull request takes a few minutes; you can go elsewhere in
the app. On web, you are told when the guide is ready; on mobile, return to the guide to check
its progress. Claude and Codex can write guides. The guide is
kept for everyone using this server. To write it again, for example after a push or after changing
the model or instructions, choose **Rewrite guide** from the pull request's **⋯** menu.

On web, while reading a stop, select lines in an excerpt to add a comment to your review or ask an agent
about them; comments wait with the ones from the **Code** tab until you send the review. Choose a
suggested question, or **Ask about this stop**, to open a thread that already knows which stop you
are on. **Finish review** on the last stop opens the review with everything you collected.

Agents can write guides too: ask one to prepare guides for a set of pull requests, and it starts
them for you. Each is read through the project whose checkout has that repository.

To shape guides to your taste, write **Review guide instructions** in Settings → Source control,
such as what to show first or what to skip; projects can override them. They change emphasis and
ordering, not the guide's layout or which files it covers.

### Mark files as viewed

Tick a file off in the **Code** tab once you have read it and it collapses; the toolbar keeps a
running count. A tick belongs to the pull request rather than to a commit, so scoping the tab to a
single commit keeps them. A file pushed to after you cleared it comes back marked **Changed**.

On GitHub these are GitHub's own viewed marks, so a review carries between T3 Code and github.com
in either direction. Forgejo, GitLab, Bitbucket, Azure DevOps, and Cursor Origin expose no record
T3 Code can read, so the server you are connected to keeps them instead: they follow you across the
apps connected to that server, but the host's own site will not show them, and the count reads **viewed in T3 Code**.

On mobile, open a changed file and mark it viewed from its header. Viewed files collapse,
and their marks follow the same rules as on web and desktop.

## Issues

The **Issues** button, next to **Pull requests** at the bottom of the sidebar, lists GitHub issues
from the repositories behind your projects, across your connected environments. A fork lists
both its upstream repository and your own. Issues currently
support GitHub only; projects on other hosts do not appear. Filter by repository, state, label,
and issue author (who opened the issue), or search titles. With more than one environment
connected, choose which one reads the list; it uses that environment's GitHub credentials. To
jump straight to one repository, right-click a thread and choose **Open issues**.

The author menu lists the GitHub accounts signed in to `gh` on the environment that reads the
list, active or not. To add a second account, run `gh auth login` for it, then
`gh auth switch` back to the account that machine normally uses.

Issues opens filtered to the active `gh` account on the environment that reads the list, or lists
all authors and says so when no active account is signed in there. Change
that in **Settings → Source control → Default issue author**: the active account, a fixed login, or
all authors. Each environment keeps its own default, and an author picked on the page lasts until
you leave Issues. An environment running an older T3 Code cannot filter by author; Issues says so
instead of listing everyone.

Open an issue to read its description and comments. You can add and remove labels; if GitHub
refuses the change, the label goes back and T3 Code says why. **Close issue** and **Reopen issue**
sit beside its state, and in the menu when you right-click it in the list. A closed issue can stay
in the Open list for a moment, marked closed, until GitHub's search catches up. **Start thread**
opens a draft in the issue's project with the issue's number, title, and link in the composer. Nothing is sent until
you send it, and the agent reads the rest of the issue itself. Issues are web and desktop only.

The list shows the newest issues first, in issue-number order within a repository. To label
several issues at once, select them with their checkboxes, Ctrl/Cmd-click, or Shift-click for a
range, then use **Labels**. Clicking a label that is on every
selected issue takes it off all of them; any other label goes on all of them. Select all (or
Ctrl/Cmd+A in the list) covers only the issues loaded so far, and changing a filter clears the
selection. A selection across repositories offers only the labels they all have. Right-click an
issue to start a thread from it, copy its link, or open it on GitHub.

To read issues beside a thread, choose **Issues** in the thread's details card or **Open Issues in
panel** in the command palette. It opens a tab in the thread's right panel listing the issues of
that thread's project. A fork opens on your own repository, with a filter to switch to its
upstream; if your fork has Issues turned off, the tab says so and offers the upstream instead. The
tab remembers the issue you opened when you switch tabs or reload. An issue opened there also has
**Add to composer**, which puts its number, title, and link in that thread's composer.

An issue with open blockers is marked in the list with the blocking issues' numbers; hover the
mark for their titles. An opened issue lists what it is blocked by and what it is blocking, including
closed ones, and selecting one opens it. Blockers are set on GitHub. GitHub Enterprise Server
versions without issue dependencies show neither.

An opened issue lists its sub-issues in their order on GitHub, and a sub-issue links to its
parent issue; the list shows how many of an issue's sub-issues are completed. Sub-issues are set on
GitHub. **Close issue** closes an issue as completed; to close one as not planned or as a
duplicate, use GitHub.

## Git Tree

**Git Tree**, at the bottom of the sidebar, in the command palette, or as **Open Git Tree** when you
right-click a thread, shows one project's local
branches and commit graph, and handles routine branch housekeeping. The page works on the
project's own folder. **Git Tree** in a thread's details card, or **Open Git Tree in panel** in the
command palette, opens it in the thread's right panel on that thread's checkout instead, its
worktree when it has one, so **Pull** and **Push** act on the thread's branch. Branches show how far they are ahead of and
behind their upstream, and mark an upstream that was deleted on the remote as **gone** once you
run **Fetch & prune**. The graph covers local branches, their upstreams and the default branch,
200 commits at a time.

**Pull** only fast-forwards the current branch. **Push** sets the upstream the first time and
never force-pushes; if the remote has commits you don't, pull first. Deleting a branch with
unmerged commits asks before force deleting it, and the current branch or one checked out in a
worktree can't be deleted.

**Clean Repo** starts a thread titled "Clean repo" in the project's folder with the project's
default model, and sends it at once. Its agent brings `main` or `master` up to date, removes local
branches and prunes remotes. It keeps branches that are unmerged or checked out in a worktree and
lists them, and if the folder has uncommitted changes it stops and tells you rather than stashing
or committing them.

Git Tree refreshes when T3 Code sees the checkout's status change. Use its refresh button after
changing the repository from a terminal or another app. Git Tree is web and desktop only.

## Troubleshooting

- **Not authenticated:** run the provider's login command on the server, then rescan. For Bitbucket,
  check the credentials saved in Settings → Source control, or confirm the running server received
  the environment variables.
- **GitHub sign-in cannot be verified:** update GitHub CLI to at least 2.81.0, or save a token in Settings → Source control.
- **Push fails despite a connected account:** check the Git remote's credentials. SSH and HTTPS
  remotes can require separate setup from the hosting provider's API access.
- **A review cannot load:** open it on the host website while resolving connectivity, permissions,
  or rate limits.

## Linked pull requests

A thread can hold several pull requests, including reviews from another repository on the same host.
Use **Link pull request** in the command palette or **Linked pull requests** panel, or right-click a
pull request link in the conversation. Creating a pull request from Git actions links it automatically,
and so does an agent creating one with `gh pr create` or `glab mr create`. Agents can link other
pull requests with the `link_pull_request` tool.

Use **Link pull request to thread** in the command palette to keep a pull request with the thread. From a review
on the Pull requests page, **Link to thread** lets you search for an active thread. The review header
also lists the threads that link to it, including archived threads, so you can return to their context.

Thread badges show a stack's layer count or the current review number with a count of additional
links. Clicking a badge with more than one review opens the **Linked pull requests** panel. On mobile, the Git overview lists linked reviews and their stacks; tap a review to open it.
Linking and unlinking are available in the web and desktop clients.

The **Linked pull requests** panel lists every review and groups stacks. Unlink a review from its
row menu. An unlinked stack layer stays out of later syncs. Open linked reviews refresh on the server;
closed reviews refresh periodically so reopening one on the host is detected. Merged reviews refresh
when requested. Settling a thread refreshes its open and closed reviews once; after that they stop refreshing until you unsettle it. With **Auto-settle merged threads** enabled, a thread can settle after every linked
review is terminal. An open or unsynced link keeps it active.

Ask the agent to watch, monitor, or babysit a pull request and it calls `watch_pull_request`. While
the thread is active, the server checks the pull request every two minutes and wakes the agent when a
check fails or waits for a maintainer's approval, the required checks pass, someone else comments or reviews, or the branch starts to
conflict. Threads in a project that watch the same pull request share one check. On GitHub, a check
first asks whether anything changed and reads the pull request only when it did, which keeps
watching inside GitHub's rate limit. Comments from your own account do not wake it. Watching ends
when the pull request merges or closes, after 10 wakes in a row that bring only comments, after 8
failed reads in a row, or when you press Stop on the thread. A rate limit only pauses watching.
Settling or archiving a thread also ends all its watches. Unsettle the thread before starting a new
watch. Watching a pull request again does not repeat check or conflict news its last
watch already reported; unlinking the pull request clears that. Subagents cannot watch pull requests; the thread that delegated to them does. To start or stop
it yourself, use the row menu in the **Linked pull requests** panel. In the thread details card, a
watched pull request shows an eye; click it to stop watching.

A watched thread counts as working between wakes, so it stays in the **Working** section and does
not auto-settle. Agents stop watching when they hand the work back to you, and the thread then
returns to your inbox.

Cross-repository links use a project on the same host. Azure DevOps reviews require a project checked
out from the matching organization and repository.

## GitHub stacks

The Pull requests page shows each PR's position in its GitHub stack. Open the stack badge in a
review to navigate its layers. **Merge stack** submits the selected pull request and every unmerged
layer below it to GitHub together, respecting branch rules and merge queues. The confirmation shows
the scope and merge strategy. GitHub rebases the remaining stack after merging.

**Rebase stack** updates remote branches from bottom to top without changing your local checkout.
It can rewrite history and restart checks. If a layer fails, earlier updates remain; resolve that
layer before retrying. GitHub may require manual conflict resolution after a lower layer is amended,
even when its changes look independent. Stack actions require an environment that supports them.
