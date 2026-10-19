# r/ClaudeAI draft

**Check the subreddit's current rules and flair before posting.** Reddit could not be read from
this session, so the rules were not verified. Things to confirm on
https://www.reddit.com/r/ClaudeAI/about/rules: which flair fits a project showcase (it has had a
"Built with Claude" style flair), whether self-promotion needs a disclosure, and whether links must
be free to try (this one is: MIT, no sign-up).

## Title

```
I built a "PM session" for Claude Code that tracks all my parallel sessions, so nothing slips
```

## Body

```
When I run many Claude Code sessions on one project, the hard part isn't the code, it's keeping
track: which session asked me something an hour ago, which one stopped with steps left, which one
said "waiting for CI" and never came back.

Project PM is a free, open-source (MIT) plugin for the Claude Code desktop app. Type /pm in a
session and it becomes that project's PM:

- A live board of every session in the project, most urgent first: waiting on you, CI failed,
  stopped with steps left, waiting on CI, running, in the background.
- A ledger of everything you ask the PM for (T-01, T-02, ...), each with an owner session.
  Progress is counted from the ledger, not from each session's own checklist.
- CI isn't "done" until GitHub says so: if a session says CI is still running, the PM checks the
  run with `gh`; a failure gets flagged and the work item can't be closed.
- The PM delegates to other sessions instead of writing code itself, relays their questions to you,
  and won't say "all done" while anything needs attention.

[screenshot: docs/images/board-hero.png]

Install:
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
then /pm in a new session.

Caveats: desktop app (Code tab) only; the board's labels are currently in Traditional Chinese
(status detection reads English and Chinese). Data stays in ~/.claude/project-pm/ as JSON.

Repo: https://github.com/AudiChang-hub/claude-project-pm

How do you keep track of many sessions at once? Happy to hear what's missing.
```

Attach `docs/images/board-hero.png` as the post image if the subreddit allows image + text posts;
otherwise link it from the repository.
