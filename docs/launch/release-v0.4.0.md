**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, still running in the background, waiting on CI, or not yet pushed or released.

This is the first tagged release. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.299). It was built with Claude Code, and its own development is run the way it works: one PM session hands each task to a sub-session and checks it before closing it.

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

- **Not shipped is not done.** A new *Not released* (待發布) status: a session whose latest report says its work is not yet committed, pushed, released, deployed or live stays open however ticked its task list, is listed under "needs attention", notifies the PM and keeps its work item open. When only a push is left and the report names the commit, it clears by itself once that commit is on a remote branch.
- **Background work is waiting, not stopped.** A session tracks the commands it starts in the background until they report back (up to 6 hours), and shows as *In the background* meanwhile instead of *Unfinished*.
- **CI is checked on GitHub.** When a session's report says CI is still running, the PM asks `gh` about the runs and commits it names (nearest the CI words first, only commits in that repository), then the folder's `HEAD`. A pass clears *Waiting on CI*; a failure shows as *CI failed*.
- **Reports are read for what they say about the work.** Quoted status names, sentences about a rule or an example, conditions and other sessions' work no longer count as CI running, work in the background or work left undelivered.
- **The PM keeps its tools.** If the engine drops the PM's `board` and `ledger` tools (after `/reload-plugins`, or when the mod's folder changes), they come back on its next turn or within 30 seconds.
- **Owners stay in sight.** A session that owns an open work item stays on the board whatever its status, even when it works from another project's folder.
- **Docs and CI.** English README with screenshots (Traditional Chinese in `README.zh-TW.md`), and GitHub Actions running `claude plugin validate .` and `claude plugin test .`.

## Fixed

- A session waiting on its own background tests or CI showed as *Unfinished* because its task list had steps left.
- A report that merely named "background" or quoted 「等待 CI」 kept a finished session *In the background* or *Waiting on CI*, and the ledger would not close its item.
- The commit checked on GitHub could be a hash quoted from another project or part of a session id.
- A session whose record was empty after a reload showed as ended even when its transcript said CI was still running.
- A recap saying nothing was left (沒有任何未提交的修改, "there are no uncommitted changes") was flagged as unfinished work.

## Known limitations

- The board, the PM's instructions and its tool output are in Traditional Chinese for now; status detection reads English and Chinese.
- Desktop app only: the PM relies on the app's built-in session tools.
- Statuses such as *Waiting on CI* and *Not released* come from what a session wrote; phrasing they do not recognise falls through to *Ended*.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
