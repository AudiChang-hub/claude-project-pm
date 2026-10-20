**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, still running in the background, waiting on CI, or not yet pushed or released.

It follows v0.5.0. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.299).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

A fix release: the board reads sessions' reports more accurately, so fewer sessions show as *Not released* when their work is delivered, and fewer show as *Ended* when it is not.

## Fixed

- **Work promised for later is not done.** A session that only says it will push, deploy or release later ("I'll push after review", "Next: deploy to production", 之後再 push) now shows as *Not released* instead of *Ended*. When it names the commit, it clears by itself once that commit is pushed. Offers to you ("you can deploy later"), questions, conditions and descriptions of a process do not count.
- **Nothing to ship, nothing held back.** A session that changed no code (a data fix, say) and says there is nothing to push no longer shows as *Not released*, and its work item can be closed.
- **Other sessions' work stays theirs.** A session that finished its own release and mentions another session's uncommitted changes, or changes it says it did not touch, no longer shows as *Not released*.
- **Explaining the board is not a status.** A report that explains how the board judges ("the board would flag this as not released") is no longer read as the session's own unfinished work. A sentence that says "because I haven't pushed" still counts.
- **Your plans are not the session's.** A finished release that mentions what you planned to do afterwards no longer shows as *Not released*.
- **Amended commits count as committed.** A session that amended a commit and names the new hash is no longer read as "not committed", so it clears once that commit is pushed.
- **"Follow up" clears after the push.** The *Follow up* note on a card no longer lingers after the commit the recap named has been pushed.
- **Waiting for a go-ahead, in more words.** A release waiting on the PM's word is recognised even with a longer phrase before it ("wait for the PM to confirm 2.4.1 is live, then release").

## Known limitations

- Desktop app only: the PM relies on the app's built-in session tools.
- Statuses such as *Waiting on CI* and *Not released* still come from what a session wrote; phrasing they do not recognise falls through to *Ended*.
- In a sentence that explains how the board judges, a session's own unfinished work counts only when the clause has its own subject ("I", "we", "this time"). Without one, that work may be set aside and the session may show as *Ended*.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
