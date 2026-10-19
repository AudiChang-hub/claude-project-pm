**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, or still waiting on CI.

This is the first tagged release. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.299).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

- **CI is checked on GitHub.** When a session's last words say CI is still running, the PM asks `gh` about that run (or commit) in the session's folder. A pass clears *Waiting on CI*; a failure shows as *CI failed*, notifies the PM and keeps the work item open.
- **Owners stay in sight.** A session that owns an open work item stays on the board whatever its status, even when it works from another project's folder.
- **Only the latest turn counts.** A recap belongs to the turn that wrote it, and a session record that missed later turns gives way to the transcript's last message.
- **Survives `/reload-plugins`.** The PM's `board` and `ledger` tools come back on its next turn instead of needing a new session.
- **Docs.** English README with screenshots (Traditional Chinese in `README.zh-TW.md`), and CI that runs `claude plugin validate .` and `claude plugin test .`.

## Fixed

- A session whose record was empty after a reload showed as ended even when its transcript said CI was still running.
- A recap saying nothing was left (沒有任何未提交的修改, "there are no uncommitted changes") was flagged as unfinished work.
- An owner working from another project's folder was reported as lost.

## Known limitations

- The board, the PM's instructions and its tool output are in Traditional Chinese for now; status detection reads English and Chinese.
- Desktop app only: the PM relies on the app's built-in session tools.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
