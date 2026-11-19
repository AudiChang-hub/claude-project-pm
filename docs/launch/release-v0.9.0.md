**Run many Claude Code sessions and agents at once. You talk to one PM, and nothing slips.**

Project PM gives each project one PM session. It keeps a live board of every session and agent and a ledger of everything you asked for, and it won't call work done while anything is waiting on you, unfinished, waiting on CI, or not yet pushed or released. Now, by default, an item also closes only after it has passed QA.

It follows v0.8.0. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.317).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

- **A QA gate.** Each work item can carry acceptance criteria. Before a code change is pushed, the PM sends an independent QA agent (Explore, its description starting with "T-xx QA") that gets only the diff's range and the criteria, never the developer's conclusions. The mod gives it a checklist: the diff holds only its target, a bug fix comes with a test that fails before the fix, tests and validate pass by their exit code, the version and CHANGELOG follow your guidelines, no secret or local setting rides along, an interface change is looked at on screen, and no test was weakened to pass (a deleted case or assertion, a changed expected value, a counter-example swapped for an easier one, an added skip, a loosened threshold), each listed by file and line. The ledger won't close an item without a QA pass (or a skip with its reason), and it refuses a verdict recorded under the owner's name; it cannot prove who really checked.
- **Quota first.** The PM picks where work goes by what it costs, measured in input-equivalent tokens per hand-off:

  | Hand-off | Cost |
  | --- | --- |
  | An open session, active in the last hour and not large | about 18,000 |
  | A read-only Explore agent | about 60,000 |
  | A new session | about 70,000 |
  | An agent that writes files | 120,000–150,000 |
  | Waking a large idle session (a 650,000-token context) | about 840,000 |

  So it reuses an open session only while it is warm and small; otherwise a small thing goes to a new session or an agent.

## Added

- **QA in the ledger.** New optional fields `criteria` and `qa` (pass, fail or skipped, who checked it, when, a note, and the project's HEAD commit at the time). The ledger tool takes `criteria`, `qa`, `qa_by` and `qa_note`. A new owner or a reopen voids the old verdict; a close refused for another reason keeps a verdict given with it and says so. Items written before keep reading and writing as they were. `force` with a note still closes an item when you say so.
- **QA on the board and the pane.** *Needs attention* lists items awaiting QA (their owner has delivered, or is archived or gone) and items that failed it; each item shows its verdict and commit.
- **CI blocks real data.** This repository's CI scans every tracked file for real data; the list lives in the repo secret `BLOCKED_TERMS`, never in the repo, and the output names only the file and line of each hit. It checks this repository only: a CI template for your own projects comes in v1.0.
- **Platform support table** in the README: which features work where. Today they run in the Claude Code desktop app. The Claude Code CLI was tested on v0.9.0: `/pm` cannot start there (it gets no session id), so it waits for v1.0 and its shared core. Codex, Copilot and Antigravity are planned for v1.1, Cursor and Devin for v1.2, and the CI template for v1.0. The table is updated with every release.

## Changed

- **The PM's rule for sessions and agents** now puts quota first, with the measured costs above.
- **The QA logic is a module of its own** (`hooks/qa.ts`) that uses nothing of the desktop app, so it can move to other tools later.

## Fixed

- **Read-only agents and their detail file.** An Explore, Plan or claude-code-guide agent was asked to write its full account to a file it cannot write. It now puts the account in its reply after the first line, and the mod saves it to a file.

## Known limitations

- Desktop app only for now; see the platform support table.
- `qa_by` guards against the owner checking its own work by mistake; it does not prove that a check happened.
- A pass is not tied to later commits: the HEAD it records is for tracing, and closing does not compare it.
- The QA agent's answer is not written to the ledger by itself; the PM records it.
- Agents end with the PM's process, and an agent that may change files needs a git repository (as in v0.8.0).

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
