**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, still running in the background, waiting on CI, or not yet pushed or released.

It follows v0.7.0. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.317).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

A fix release: a session whose work has gone out no longer shows as *Not released* because its commit reached main another way, and a work item you closed stays closed on the board.

## Fixed

- **Released means released.** A session that reported it was released no longer shows as *Not released* when its commit reached main as a cherry-pick, and its work item closes without forcing it.
- **Cherry-picked and rebased commits count as pushed.** The board recognises a commit that reached a remote branch under another hash: picked over cleanly, picked with a conflict resolved on the way, rebased, or squashed, even when main changed the same files before and after.
- **The reason matches the quote.** Beside a verdict, the board and the ledger now quote the session's report itself (its status, delivery, commit and summary), so a reason such as "not pushed" is never shown next to a report that says it was deployed.
- **A closed work item stays closed.** Once every work item a session owns is done, that session leaves *Needs attention* and the counters, whatever its last report said, until it reports again. Sessions that are running, waiting on you, waiting on CI or working in the background still show.
- **Faster checks in large repositories.** The push check looks at the remote's default branch and the few branches updated last instead of every remote branch, so a repository with dozens of old branches is checked in a fraction of the time.

## Also in this release

- **A plugin icon**, shown in Claude Code's plugin list.
- **Staying up to date.** The README now explains that Claude Code does not update a plugin from a third-party marketplace by itself: turn on auto-update for it in `/plugin`, or update it by hand. Open sessions reload the new version when they are idle.

## Known limitations

- Desktop app only: the PM relies on the app's built-in session tools.
- A cherry-pick whose title was changed and whose conflicts rewrote much of the change is still not recognised; the session shows as *Not released* until it reports `released` or you close its work item.
- A commit hash quoted in a session's answer, for example inside a code block about another session, can still be read as the session's own commit.
- Sessions that do not report through the `report` tool are still judged from their words where git cannot answer.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
