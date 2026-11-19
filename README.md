# Project PM for Claude Code

**English** | [繁體中文](README.zh-TW.md)

[![CI](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml/badge.svg)](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Run many Claude Code sessions and agents at once. You talk to one PM, and nothing slips.**

<p align="center">
  <img src="docs/images/overview.png" alt="Project PM v0.9.0 at a glance: you talk to the PM, which keeps a board and a ledger and hands work to sessions or agents. Both pass a QA gate: acceptance criteria, an independent QA agent before each push, no close without a pass, and CI that blocks real data kept in a secret. Measured cost per hand-off: 18k to 840k input-equivalent tokens. Agents work in their own worktree and never push." width="100%">
</p>

## Why

With several sessions open on one project, work slips: a question waits an hour for you, a session stops with steps left, "CI is running, I'll deploy after" never gets checked, and every session ticks its own checklist done whether the work is or not.

Project PM makes one session the project's PM. It keeps a live board of every session and agent and a ledger of everything you asked for, and it won't call work done while anything is waiting on you, unfinished, waiting on CI, or not yet pushed or released.

## Quick start

Needs the Claude Code desktop app (Code tab).

1. Install:

   ```
   /plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
   ```

   In the desktop app: **+** next to the prompt box → **Plugins** → **Add marketplace** → `AudiChang-hub/claude-project-pm` → **Add plugin**.

2. Open a new session in your project and type `/pm`. It becomes the PM, opens the board and tells you what is waiting on you.
3. Talk to the PM: *"Is anything slipping?"*, *"Find the pages with no meta description."*, *"Which sessions are waiting on me?"*
4. Keep it updated. Claude Code doesn't update third-party plugins on its own: in a terminal, run `claude` → `/plugin` → **Marketplaces** → `claude-project-pm` → **Enable auto-update**, or update by hand with `claude plugin update project-pm@claude-project-pm`.

## Platform support

✅ available · ◐ partial · 🗓 planned · — not supported

| Feature | Claude Code desktop | Claude Code CLI¹ | Codex² | Copilot² | Antigravity² | Cursor² | Devin² |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Board pane | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| Text board | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| Ledger | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| QA gate | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| Delivery check (git, CI) | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| Live session tracking | ✅ | 🗓 v1.0 | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.2⁴ | 🗓 v1.2⁴ |
| Agent hand-off | ✅ | 🗓 v1.0 | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.2⁴ | 🗓 v1.2⁴ |
| Development guidelines | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| CI real-data scan³ | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 |

¹ Tested on v0.9.0 (Claude Code 2.1.326): `/pm` cannot start in the CLI (it gets no session id), so the board, ledger, QA gate and agent hand-off don't work there yet. From v1.0 the shared core supports it; live tracking and agent hand-off are partial in v1.0.
² App (or editor) and CLI; a note will mark where they differ.
³ v1.0 ships a GitHub Actions template, whatever AI tool you use. This repository's own CI already runs it.
⁴ Partial outside the Claude Code desktop app: sessions report through hooks, so a session without the hook is not seen, and no new session can be started.

This table is updated with every release.

## New in v0.9.0

- **QA gate.** Each work item carries acceptance criteria. Before a code change is pushed, the PM sends an independent QA agent that sees only the diff and the criteria, and the ledger won't close an item without a QA pass (or a skip with its reason). Whoever checks it is never its owner. The board lists what awaits QA and what failed it.
- **Quota-first hand-offs.** The PM reuses an open session only if it was active in the last hour and hasn't run many turns (about 18k input-equivalent tokens). Waking a large idle one costs about 840k, so a small thing goes to a new session (70k) or an agent (60k read-only) instead.
- **CI blocks real data.** This repository's CI scans every tracked file for real data; the list lives in a secret, never in the repo. A CI template for your own projects comes in v1.0.

v0.8.0 brought agents: background work in its own worktree, merged after the PM reviews it ([release notes](https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.8.0)).

[CHANGELOG](CHANGELOG.md) · [How QA works](docs/design/qa.md) · [How agents work](docs/design/agents.md)

## What the PM guards

- **Waiting on you comes first**, with the question quoted.
- **CI isn't done until GitHub says so**: the PM checks the run with `gh`.
- **Not shipped isn't done**: git decides what is committed and pushed, and a session's report says what is released.
- **The ledger won't close unfinished or unchecked work** unless you say so.

<details>
<summary><b>See the board</b> (demo data)</summary>
<br>
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/board-dark.png">
    <img src="docs/images/board-light.png" alt="The Project PM board for a demo project: 55% of work items done, work items owned by sessions and agents, an Agents section with one running, one to verify and one done, and sessions waiting on you, with failed CI, unfinished, not released and running." width="420">
  </picture>
</p>
</details>

Every status, how delivery is judged, development guidelines and what the mod keeps on disk: [How it works](docs/how-it-works.md).

## Commands

| Command | What it does |
| --- | --- |
| `/pm` | Makes this session the project's PM and opens the board. |
| `/pm off` | Steps down. The ledger stays for the next PM. |
| `/board` | Opens or closes the board in any session. |
| `/pm lang en` · `zh-TW` · `auto` | Board and PM language; `auto` follows your system. |
| `/pm guidelines <file>` · `off` | Gives the PM and its sessions your development rules. |

## Requirements

- The **Claude Code desktop app** (Code tab): the PM uses its built-in session tools.
- A Claude Code version with function-hook mods; tested with 2.1.317.
- Optional: the [GitHub CLI](https://cli.github.com/), signed in, so the PM can check CI.
- Agents that change files need a git repository. They run inside the PM's process, so restarting Claude Code interrupts them; the board marks them *interrupted*.

## License

[MIT](LICENSE). Tests: `claude plugin validate .` and `claude plugin test .`, no login needed.
