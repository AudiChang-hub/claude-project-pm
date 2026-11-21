# Project PM for Claude Code

**English** | [繁體中文](README.zh-TW.md)

[![CI](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml/badge.svg)](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Run many Claude Code sessions and agents at once. You talk to one PM, and nothing slips.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.png">
  <img src="docs/images/hero-light.png" alt="Claude Code's desktop app with demo data: asked whether anything is slipping, the PM reads the board and lists what waits on you, a failed CI, unfinished work and an item awaiting QA; on the right, the desktop app's board pane." width="100%">
</picture>

<p align="center">
  <img src="docs/images/overview.png" alt="Project PM v1.1.0 at a glance: you talk to the PM from the Claude Code desktop app or the CLI, both on one shared core; the PM hands work to sessions or agents; a QA gate before anything closes or is pushed; new in v1.1, one ledger for both, a clearer board and the web board opened from the pane; and the measured cost of each hand-off." width="100%">
</p>

## Why

With several sessions open on one project, work slips: a question waits an hour for you, a session stops with steps left, "CI is running, I'll deploy after" never gets checked, and every session ticks its own checklist done whether the work is or not.

Project PM makes one session the project's PM. It keeps a live board of every session and agent and a ledger of everything you asked for, and it won't call work done while anything is waiting on you, unfinished, waiting on CI, or not yet pushed or released.

## New in v1.1

- **One list for both apps.** With the core installed, the desktop app and the CLI use the same ledger and the same QA gate. Your v1.0 data carries over by itself.
- **Numbers that add up.** The board counts each open item once, under what it needs most.
- **Names, not codes.** Sessions show by their title or what you asked them, never by a long id.
- **The web board, one click away.** Press **Open in browser** at the bottom of the desktop pane. The web board now looks like the pane and lists your desktop projects too.
- **The PM's notes go in `CLAUDE.md`.** `init` writes its project section there, no longer in `AGENTS.md`.

v1.0 (the CLI, QA before the push, the CI template, one program) and earlier: [CHANGELOG](CHANGELOG.md)

## Install

**Claude Code desktop app** (Code tab):

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Or **+** next to the prompt box → **Plugins** → **Add marketplace** → `AudiChang-hub/claude-project-pm` → **Add plugin**. Then open a new session in your project and type `/pm`. To keep it updated: `claude` → `/plugin` → **Marketplaces** → `claude-project-pm` → **Enable auto-update**.

**Claude Code CLI:** download the file for your computer from [Releases](https://github.com/AudiChang-hub/claude-project-pm/releases) and run it with `init` in your project's folder. It changes nothing until you add `--yes`. An npm version (`npx`) comes in a later release.

Step by step, and what to do when Windows or macOS warns you (those steps are not yet checked on a real download): [core/README.md](core/README.md).

## Platform support

✅ available · ◐ partial

| Feature | Claude Code desktop | Claude Code CLI¹ |
| --- | :-: | :-: |
| Board | ✅ | ✅ |
| Web board² | ✅ | ✅ |
| Ledger, shared by both³ | ✅ | ✅ |
| QA gate, shared by both³ | ✅ | ✅ |
| Delivery check (git, CI) | ✅ | ◐ |
| Live session tracking | ✅ | ◐ |
| Agent hand-off | ✅ | ◐ |
| Development guidelines | ✅ | ✅ |
| CI template⁴ | ✅ | ✅ |

¹ Tested with Claude Code 2.1.326. The board is the web board and `git pm board`. Partial: CI status (git is checked), sessions seen only through hooks, and no automatic agent set-up.
² Needs the core (the CLI step above). In the desktop app: **Open in browser** on the pane.
³ Once the core is installed; without it, the desktop app keeps its own.
⁴ GitHub Actions, run in your repository on every push and pull request.

As of v1.1. Updated with every release.

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

## Commands (desktop app)

| Command | What it does |
| --- | --- |
| `/pm` | Makes this session the project's PM and opens the board. |
| `/pm off` | Steps down. The ledger stays for the next PM. |
| `/board` | Opens or closes the board in any session. |
| `/pm lang en` · `zh-TW` · `auto` | Board and PM language; `auto` follows your system. |
| `/pm guidelines <file>` · `off` | Gives the PM and its sessions your development rules. |

**Two boards.** Claude Code desktop: the board is the pane on the right (the image at the top). The web board shows the same work in your browser, for the CLI or a second screen:

- **Install the core first:** the Claude Code CLI step above (download, run it with `init` in your project's folder).
- **Open it:** in the desktop app, press **Open in browser** at the bottom of the pane. In a terminal, run `git pm open` in your project's folder. Or ask the PM for "the board link".
- **Typing `127.0.0.1:47130` alone shows an error page.** The board opens only from the link Project PM gives you, which carries a private key, so other programs on your computer cannot read it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/web-board-dark.png">
  <img src="docs/images/web-board-light.png" alt="The CLI's web board in a browser, demo data: 6 of 12 work items done; Needs attention lists waiting on you, CI failed, unfinished, not released and awaiting QA; each session's status beside it." width="100%">
</picture>

<details>
<summary><b>See it in the CLI</b> (demo data)</summary>
<br>
In a terminal, the PM reads the board and tells you what needs you:
<img src="docs/images/cli-chat.png" alt="Claude Code in a terminal, demo data: asked whether anything is slipping, the PM calls the project-pm board tool and answers: two things wait on you, three are being handled, 6 of 12 work items done." width="100%">
<code>git pm board</code> prints the same board, sessions by name:
<img src="docs/images/cli-board.png" alt="git pm board in a terminal, demo data: the project's status line, Needs attention (waiting on you, CI failed, stopped, not released, awaiting QA) and the open work items with their owners." width="100%">
</details>

## Requirements

- The Claude Code desktop app (mod, tested with 2.1.317), or Claude Code's CLI (core, tested with 2.1.326).
- Optional: the [GitHub CLI](https://cli.github.com/), signed in, so the PM can check CI.
- Agents that change files need a git repository. In the desktop app they run inside the PM's process, so restarting Claude Code interrupts them; the board marks them *interrupted*.

## License

[MIT](LICENSE). Tests: `claude plugin test .` and, in `core/`, `npm test`.
