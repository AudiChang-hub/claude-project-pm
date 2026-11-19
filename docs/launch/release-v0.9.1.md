**Run many Claude Code sessions and agents at once. You talk to one PM, and nothing slips.**

Project PM gives each project one PM session. It keeps a live board of every session and agent and a ledger of everything you asked for, and it won't call work done while anything is waiting on you, unfinished, waiting on CI, or not yet pushed or released. This patch makes sure a session cut off by a usage limit is not forgotten.

It follows v0.9.0. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.317).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Fixed

- **Sessions a usage limit stopped need attention.** A session whose turn was cut off by a usage limit ("You've hit your 5-hour limit · resets 3pm") showed as *Ended*, so nobody came back to it after the reset. It now shows as **Usage limit · resumes after 3pm** (額度用完・3pm 後可續), or just *Usage limit* when the message gives no time, under *Needs attention*, in the counts and on the pane.
- **Only the limit's message counts.** The turn has to have ended in error, and the last words before it have to open the way a usage limit's message does ("You've hit your 5-hour limit", "usage limit reached", 已達用量上限, 額度已用完). Other errors (a failing or overloaded API, the context or rate limit, 上下文長度上限, 速率上限) aren't taken for one, nor is the model mentioning a limit in a sentence of its own.
- **It goes away once it's handled.** It leaves the list when the session runs again, when a later turn ends normally, or when all its work items have been handed to another owner or closed. Work items now remember who they were handed over from.
- **The PM picks it up after the reset.** A new PM rule (15) has the PM come back to such a session once the limit resets, without being reminded. Following the quota rule, it wakes a small, recently active session, or starts a new one that takes over from the hand-over notes, then makes the new session the work item's owner.

## Known limitations

- Desktop app only for now; see the platform support table.
- The limit is recognized by how its message is worded. If an error leaves no message of its own and the model's last words happen to open exactly like a limit message ("Weekly limit reached"), they are still taken for one.
- Work items handed over before v0.9.1 don't remember their earlier owner, so a session a limit stopped whose item was reassigned before this version may still show until you archive it.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
