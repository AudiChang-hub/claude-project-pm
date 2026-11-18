# Project PM for Claude Code

**English** | [繁體中文](README.zh-TW.md)

[![CI](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml/badge.svg)](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Run many Claude Code sessions and agents at once. You talk to one PM, and nothing slips.**

<p align="center">
  <img src="docs/images/overview.png" alt="Project PM v0.8.0 at a glance: you talk to the PM, which keeps a board and a ledger and hands work to sessions (for follow-ups, push and CI) or to agents (one-off, read-heavy, in the background). Ledger updates are 97% smaller, the board is up to 49% shorter. Agents work in their own worktree, count as done only once the PM merges them, can only read the ledger, and never push." width="100%">
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

## New in v0.8.0

- **The PM hands work to agents.** A small, self-contained job runs as a background agent while you keep talking to the PM. Work you'll follow up on, or that pushes, waits on CI or releases, still goes to a session. Agents sit on the board next to sessions (◆ where sessions have ●) with their state, time and token cost.
- **Far fewer tokens.** A ledger change answers with just that item (10,354 → 278 characters on a real ledger), the board is 37–49% shorter, and full write-ups go to a detail file you open with **Detail** on a card.
- **Safe by default.**
  - An agent that may change files works in its own git worktree, never in your checkout. Outside a git repository, the PM can't start one.
  - Its commit counts as done only once the PM has merged it into your branch.
  - Agents can read the ledger but not change it, and never push or release.

[Release notes](https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.8.0) · [CHANGELOG](CHANGELOG.md) · [How agents work](docs/design/agents.md)

## What the PM guards

- **Waiting on you comes first**, with the question quoted.
- **CI isn't done until GitHub says so**: the PM checks the run with `gh`.
- **Not shipped isn't done**: git decides what is committed and pushed, and a session's report says what is released.
- **The ledger won't close unfinished work** unless you say so.

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
