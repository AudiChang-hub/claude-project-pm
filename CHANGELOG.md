# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions match `version` in `.claude-plugin/plugin.json`.

## [0.3.2] - 2026-10-19

### Added
- CI is checked on GitHub. When a session's latest words say CI is still running, the PM runs `gh` in that session's folder (the run id the words name, else the commit they name, else a `HEAD` committed no later than the words). A pass clears *Waiting on CI*; a failure shows as the new *CI failed* status, is listed under "needs attention", notifies the PM and still blocks the ledger. Answers are cached (a pass for good, a failure for 5 minutes, running or unknown for 1 minute); with no answer, the words decide.
- An open work item's owner stays in sight on the board and in the PM's report whatever its status, including an owner working from another project's folder, shown with its title, status and that it belongs to another project.
- English README with screenshots; the Traditional Chinese README moved to `README.zh-TW.md`.
- An offline demo of the board (`docs/demo/`) that draws the README images from made-up data.
- GitHub Actions workflow that runs `claude plugin validate .` and `claude plugin test .`.

### Changed
- A recap counts only for the turn whose `wrap_up` wrote it; a later turn that ends without its own `wrap_up` drops it.
- A session record that has missed later turns gives way to the transcript's last message.

### Fixed
- A session whose record was empty (written when its module reloaded) showed as ended even when its transcript said CI was still running; empty records are now ignored and the transcript decides.
- A recap saying nothing is left, such as 沒有任何未提交的修改 ("there are no uncommitted changes"), was flagged as unfinished work.
- After `/reload-plugins` the PM lost its `board` and `ledger` tools until the session restarted; start-up now runs on the first hook a fresh module copy sees, so the tools return on the PM's next turn.
- An owner working from another project's folder was reported as lost; only an archived or missing owner is now.

## [0.3.1] - 2026-10-19

### Fixed
- After a module reload, a session stopped writing its record: the host kept who the session was, but the module's own record was gone and was never loaded again.
- A session the desktop app had not registered yet at its start was never tracked; it now asks again, at most every 30 seconds, on its next tracked event.

## [0.3.0] - 2026-10-17

### Added
- *Waiting on CI* status: a session whose latest turn says CI has not finished never decays into *Ended*, however long it sits, and is listed under "needs attention".
- The ledger refuses to close a work item whose owner is waiting on CI, running, waiting on the person or stopped mid-task, unless the person explicitly confirms (`force` with a note).

## [0.2.1] - 2026-10-17

### Added
- First public version: one PM session per project (`/pm`, `/pm off`), tracking every session's task list, final recap, open question, latest prompt and last answer.
- Project board pane (`/board`): completion ring, running / waiting-on-you / unfinished counters, session cards with step bars, this project or all projects, archive with confirmation.
- The PM's `board` report and `ledger` of work items (T-01, T-02, …).
- A band above the prompt in projects without a PM, offering to start a PM session or make the current one the PM.
- Notifications to the PM when a session starts waiting on the person or stops with steps left.

[0.3.2]: https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.3.2
[0.3.1]: https://github.com/AudiChang-hub/claude-project-pm/commit/68af59e
[0.3.0]: https://github.com/AudiChang-hub/claude-project-pm/commit/5f324d9
[0.2.1]: https://github.com/AudiChang-hub/claude-project-pm/commit/4b0ead6
