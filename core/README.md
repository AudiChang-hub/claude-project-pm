# project-pm

[中文說明](README.zh-TW.md)

A PM for Claude Code sessions: a list of the work you asked for, a QA check before work closes and before it is pushed, and a board of where every session stands. It runs as an MCP server (MCP is how Claude Code plugs in extra tools like this one).

Project PM is for **Claude Code only**; version 1.0 sets it up for Claude Code's command line. It needs no Node.js: you download one program and run it once.

## Install

### 1. Download

From the project's [Releases page](https://github.com/AudiChang-hub/claude-project-pm/releases), download the file for your computer:

| Computer | File |
| --- | --- |
| Windows | `project-pm-windows-x64.exe` |
| Mac with Apple chip (M1 and later) | `project-pm-macos-arm64` |
| Mac with Intel chip | `project-pm-macos-x64` |
| Linux | `project-pm-linux-x64` or `project-pm-linux-arm64` |

Download it only from that page. To make sure the file is the real one, compare its SHA-256 with the line for it in `SHA256SUMS` on the same page:

- Windows (PowerShell): `Get-FileHash .\project-pm-windows-x64.exe`
- Mac: `shasum -a 256 project-pm-macos-arm64`
- Linux: `sha256sum project-pm-linux-x64`

### 2. Let it run the first time

**Why your computer warns you:** the program has no code-signing certificate. Those cost money every year, and this project is free, so we do not buy one. The warning does not mean the program is harmful; it means the system does not know who made it. That is why step 1 matters.

- **Windows.** Your browser may say the file "isn't commonly downloaded": choose **Keep**. If you open it from File Explorer and see "Windows protected your PC", click **More info**, then **Run anyway**. Running it from a terminal may not show this at all. *These Windows steps have not been tried yet with a file downloaded from the web; the program itself has been run on Windows.*
  - If **Smart App Control** is on, Windows may block the program with no button to allow it. For now there is no other way to run it: the npm version, which would be one, is not published yet (see below). Do not turn Smart App Control off for this.
- **Mac.** You may see that Apple "cannot check it for malicious software". Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. Or, in Terminal, run `xattr -d com.apple.quarantine project-pm-macos-arm64`, which removes the "downloaded from the internet" mark from that one file. *These Mac steps have not been tried on a real Mac yet.*
- **Linux.** There is no warning, but the file is not executable yet: `chmod +x project-pm-linux-x64`.

### 3. Set up your project

In a terminal, go to your project's folder (a git repository) and run:

```
./project-pm-windows-x64.exe init
```

(use your file's name). It lists every file it would change and **changes nothing**. When the list looks right, run it again with `--yes`. Add `--ci` to also get the QA workflow for GitHub Actions.

`init` copies the program to `~/.project-pm/bin/` and points every setting at that copy, so you can delete the download afterwards. It does not change your PATH, install anything else, or need administrator rights.

## What it changes

- Claude Code's MCP setting (`claude mcp add --scope user project-pm`), and its hooks in `~/.claude/settings.json` (a hook is a command Claude Code runs on its own at set moments, such as when you send a message; these ones tell the board where each session stands).
- A section in your project's `AGENTS.md`, and `@AGENTS.md` at the top of `CLAUDE.md` if you have one.
- The skill `~/.claude/skills/project-pm/SKILL.md`.
- A git `pre-push` hook (a check git runs before every `git push`): a push waits until its commits are checked. `git pm skip "<reason>"` lets a push through on purpose; the reason shows on the board.
- Optional (`--ci`): `.github/workflows/project-pm-qa.yml`.

If you protect a branch on GitHub so that a pull request merges only when its checks pass, make **both** checks this workflow adds required: **Project PM QA** and **Words that must stay private** (the scan for words you keep in the `BLOCKED_TERMS` secret). They are separate checks, so requiring only the first still lets a pull request through when the word scan fails. (If the workflow was written in Chinese, the checks are called **Project PM 品質檢查** and **不能公開的詞**.)

Every change is recorded in `~/.project-pm/install-log.json`.

## Uninstall

Run it in your project's folder, the same one where you ran `init`:

```
~/.project-pm/bin/project-pm-1.0.0 uninstall --yes
```

(on Windows, `project-pm-1.0.0.exe`). Every file goes back to how it was. `uninstall --hooks` removes only the git hook.

## npm version (later)

An npm version for developers with Node.js 20 or later (`npx -y project-pm@<version> init`) is planned but **not published yet**: 1.0.0 is not on npm. Use the program above for now.

## Known limits of 1.0

- The programs are not code-signed (see above). With Windows Smart App Control on, the program may be blocked, and there is no other way to run it yet: the npm version comes in a later release.
- 1.0.0 is not on npm yet.
- The development guidelines file is locked against the AI's edit tools. A change that gets past the lock (a shell command, another session, you in your editor), or a change of which file the guidelines are (`git rm`, an edit of `.project-pm.json`, turning them off), is only noticed afterwards and listed on the board under *Needs attention*; Project PM never puts the file back. To undo one, the warning names a read-only copy in `~/.project-pm/guidelines/copies/` of what the file held when you last spoke: ask the AI to copy it back. Not caught: a change made on purpose to get past the check, and a change a background command makes after a turn ends and before you speak again.
- The Windows steps to allow a program downloaded from the web (SmartScreen) have not been checked yet. The program itself, built on Windows, has been run there.
- The Mac steps to allow the program have not been checked on a real Mac. The Mac programs themselves are built and tested on GitHub's Mac machines.
