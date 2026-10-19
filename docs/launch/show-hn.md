# Show HN draft

> **On hold: not posting for now** (decided 2026-10-19). Kept for later. If it is revived, update it
> to the current features first (the *not released* status, background work, the English and
> Traditional Chinese interface) and give
> the first comment the same plain, built-with-Claude-Code framing as the r/ClaudeAI draft.

Rules checked against https://news.ycombinator.com/showhn.html: it must be something people can
try (it is: a free, MIT plugin), the title starts with "Show HN:", the maker should be around to
answer comments, and no asking anyone for upvotes. Post after the release is out and CI is green.

## Title (74 characters; HN allows 80)

```
Show HN: Project PM – one board for all your parallel Claude Code sessions
```

## URL

```
https://github.com/AudiChang-hub/claude-project-pm
```

## First comment (post right after submitting)

```
With five or ten Claude Code sessions open on one project (one on a migration, one on a bug, one
waiting for CI, one forgotten), the sidebar tells you which are running, but not which one asked
you a question an hour ago, which one stopped with three steps of its plan left, or which one said
"CI is running, I'll deploy once it passes" and never came back.

Project PM is a Claude Code plugin (a function-hook mod) that makes one session per project the PM.
Every session writes a small record of its task list, final recap and open question; the PM reads
them all and keeps a board with what needs you at the top, plus a ledger of every task you hand it
(T-01, T-02, ...) with the session that owns it.

A few rules it enforces, because they are where work slips most often:

- Progress is counted from the ledger, not from each session's own checklist (sessions tick
  everything off when their turn ends, done or not).
- If a session's last words say CI is still running, it stays "waiting on CI" no matter how long
  ago it stopped. The PM runs `gh` in that session's folder against the run id or commit it
  mentioned; a pass clears it, a failure flags it.
- The ledger refuses to close an item while its owner is still running, waiting on you, stopped
  mid-plan or waiting on CI, unless you explicitly confirm.
- The PM hands implementation to other sessions instead of editing code itself.

Everything stays in ~/.claude/project-pm/ as JSON; the only network traffic is `gh` asking GitHub
about CI with your own login.

The board, the PM and its tools speak English or Traditional Chinese (following the system
language, or /pm lang), and read sessions' reports in either.

Limitations, honestly: it needs the Claude Code desktop app (it uses the app's session tools), and
"CI is still running" is detected from what the session wrote, so phrasing it does not recognise
slips through to the plain ended/idle status.

Install: /plugin install project-pm --marketplace AudiChang-hub/claude-project-pm, then /pm in a
new session. I'd love to hear how other people keep track of many agent sessions at once.
```

Before posting, confirm each claim still matches the code, and add a line in your own words about
why you built it: Show HN readers respond to the maker's story.
