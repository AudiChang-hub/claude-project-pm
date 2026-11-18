**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, still running in the background, waiting on CI, or not yet pushed or released.

It follows v0.7.1. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.317).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

- **The PM can hand work to agents, not only to sessions.** A small, self-contained piece of work no longer needs a session of its own: the PM can start a background agent for it, and you keep talking to the PM while it runs. An agent that may change files works in a git worktree of its own, so it never touches your checkout, and its commit counts as done only once the PM has merged it into your project's branch. The board shows agents next to sessions (a diamond where sessions have a dot), with what each one is doing, how long it took and what it cost.
- **The PM spends far fewer tokens.** It used to reread the whole ledger after every change and long quotes from every session on the board. Now a change answers with just the item it touched (on one real ledger, from about 10,000 characters to under 300), the board is 37–49% shorter, and a session's or agent's full write-up goes to a file the PM and you can open instead of into the conversation.

## Added

- **Agents on the board and in the ledger.** Each agent has a state: running, done, *to verify* (it committed and the PM has not merged it yet), *needs decision*, failed, *interrupted*, or *dropped*. A work item can be owned by an agent, and the ledger closes it only once the agent's work is done. Agents that failed, need a decision, wait to be verified or were interrupted show under *Needs attention*; finished ones fold away after an hour.
- **When to use which.** The PM's instructions say when a session fits better than an agent, and what an agent costs: every agent loads the whole system prompt again, about 37,000 to 58,000 tokens, so a small thing goes to a session that is already open.
- **Short notices.** When an agent finishes, the PM reads its first line and the path to its detail file, not its whole reply.

## Changed

- **Short reports.** Sessions in a project with a PM are asked to report in about 300 characters (status, commit, one line, and the path to a detail file). The `report` tool takes a `detail`, which the mod saves to a file; the pane's card has a *Detail* button that opens it.
- **A shorter ledger.** `list` shows open items by default, each on one line; `include_done: true` shows all, and an `id` shows one item in full.

## Fixed

- **"In the background" when nothing was running.** A session whose closing words only described waiting (for example, "a work item closes once its agent is done") showed as *In the background* for 45 minutes. A session that wrapped up its turn now waits only on what it actually started: background commands, and background agents until they report back.
- **An agent let go no longer waits forever.** An agent whose commit was deliberately not merged (its worktree and branch deleted, its work item dropped) stayed *To verify* under *Needs attention*. It now becomes *dropped* and folds away. The same happens when the person closes an agent's work items after it ended: done if any is done, dropped if all were dropped.

## Known limitations

- Desktop app only: the PM relies on the app's built-in session tools.
- Agents end with the PM's process. Reloading the plugin keeps them running, but restarting Claude Code stops them; they then show as *interrupted* and need to be started again.
- An agent that may change files needs a git repository. Outside one, the PM's request is refused and the work goes to a read-only agent or a session.
- Agents' worktrees live in `.claude/worktrees/` inside your project. A repository that does not ignore that folder shows it as untracked.
- An agent is asked to reply in one line and write the rest to a file. If it does not, the mod still shortens its notice and saves the full reply to a file.
- A cherry-pick whose title was changed and whose conflicts rewrote much of the change is still not recognised; the session shows as *Not released* until it reports `released` or you close its work item.
- A commit hash quoted in a session's answer, for example inside a code block about another session, can still be read as the session's own commit.
- Sessions that do not report through the `report` tool are still judged from their words where git cannot answer.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
