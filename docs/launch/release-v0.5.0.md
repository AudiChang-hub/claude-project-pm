**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, still running in the background, waiting on CI, or not yet pushed or released.

It follows v0.4.0. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.299).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

- **English and Traditional Chinese.** The board, the band above the prompt, the commands' replies, the notifications, the PM's instructions and its `board` and `ledger` tools now speak English or Traditional Chinese.
- **Follows your system language.** Any Chinese locale shows Traditional Chinese (Simplified included), everything else English. As before, sessions' reports are read in either language, whichever one the board shows.
- **Choose it yourself.** Set the new `language` option to `auto`, `en` or `zh-TW` (the `project-pm.language` row in `/config`), or type `/pm lang en`, `/pm lang zh-TW` or `/pm lang auto` in any session: it switches at once and saves the option.
- **Docs.** The README shows the English board and README.zh-TW.md the Traditional Chinese one, with a Language section in each.

## Fixed

- A cancelled CI run counted as a failure, so a session that called off one run and pushed a fix showed as *CI failed* after the fix passed. A cancelled run is now left out when its workflow ran again on the same commit.
- When a report named several commits, an older one could answer for the newer one. A commit that a later named commit contains is skipped, and each commit is checked with the remote branch tips that hold it: a fix that passed clears the commit it fixed.
- A report that described re-runs (重跑, 又跑一次) read as CI still running; only a re-run under way counts now.
- 「正在等 9f8e7d6 的 CI」 ("waiting for 9f8e7d6's CI") was not read as CI still running, and the status 等待 CI named in a list of statuses was.

## Known limitations

- Desktop app only: the PM relies on the app's built-in session tools.
- Statuses such as *Waiting on CI* and *Not released* come from what a session wrote; phrasing they do not recognise falls through to *Ended*.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
