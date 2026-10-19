# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions match `version` in `.claude-plugin/plugin.json`.

## [Unreleased]

### Fixed
- A cancelled CI run counted as a failure, so a session that called off one commit's run and pushed a fix showed as *CI failed* after the fix passed. A cancelled run is now left out when its workflow ran again on the same commit; a workflow whose runs were all cancelled never finished, so the commit has not passed either and a newer commit, the folder's `HEAD` or the words decide (the words of CI still to run keep it *Waiting on CI*).
- When a report named several commits, an older one could answer for the newer one. A named commit that another named commit holds is now skipped, a failed or cancelled run named by id hands over its commit to the same rule, and each commit is asked together with the remote branch tips that hold it, the better answer standing (passed, then running, then failed): a fix that passed clears the commit it fixed, and a fix still running keeps it waiting.
- 「正在等 9f8e7d6 的 CI」 ("waiting for 9f8e7d6's CI") was not read as CI still running: a hash between the words no longer hides it. The status 等待 CI in a list or a chain of statuses (未完成、等待 CI、CI 失敗, CI 失敗／等待 CI → 背景執行) is a name, not CI running.

## [0.4.0] - 2026-10-19

### Added
- *Not released* (待發布) status: a session whose latest recap or answer says its work is not delivered yet (not committed, pushed, released, deployed or live; 等 PM 放行) is never *Ended*, however ticked its task list, is listed under "needs attention", notifies the PM and blocks the ledger (`force` with a note still closes it). Sentences about a rule or an example, quoted words, someone else's work and double negatives do not count. When only a push is left and the words name the commit, the PM checks `git branch -r --contains` in the session's folder and the status clears once the commit is pushed. The third counter on the board is now *尚未完成* and counts it.
- A session records the commands it starts in the background (`run_in_background`, or moved there), from their `backgroundTaskId` until their task notification (or `TaskStop`). While one has not reported back, the session shows as *In the background*, however long the command takes (up to 6 hours, since a session whose process ended never hears back), and the board lists them under the session.

### Changed
- The README images show the *Not released* status and the board's new *尚未完成* counter.

### Fixed
- A session that ended its turn to wait on its own background work (tests running, CI to watch) showed as *Unfinished* and was listed under "needs attention" whenever its task list had steps left: open steps were checked before anything else. Running CI and background work now come first; words of background work count for 45 minutes in a session without the record.
- Any report that named the word 背景 ("background"), or quoted the status 「等待 CI」, read as work still going on, so a session that had finished everything showed as *In the background* for 45 minutes and the ledger would not close its item. Words now count only when they say the work is under way (正在…背景執行, 在背景跑, 背景執行中, 等 CI 通過後, "still running in the background", "Waiting for CI to finish") or what follows once it ends.
- A report that quoted the status 「等待 CI」, or described a rule or an example about CI (「CI 真的還在跑時…」), kept a session at *Waiting on CI* after its CI had passed, and the ledger refused to close its items; "檢查…還在" (checking something is still there) read as checks still running. CI words, and words of background work, now go through the same filter as the delivery words: quoted words and clauses about a rule, an example, a condition or someone else's work do not count, nor does the status named without quotes (標成等待 CI, 維持等待 CI). A delivery word used as a noun (還沒公開的 commit) no longer reads as work left undone.
- The commit checked on GitHub was the last hash in the words, which could be one quoted from another project or an example, or part of a session id; with GitHub then unable to answer, the words alone decided. The runs and commits the words name are now tried nearest their own CI words first, a commit only when it is in the session's repository, and the folder's `HEAD` (committed before the words) when none answers.
- A session that left only a push undone stayed *Not released* when its commit went out rebased or squashed with others, since the hash itself never reached a remote branch. The PM now also recognises the commit's content on a remote branch: the files it changed hold its exact content at the branch tip or at one of the branch's later commits, or the same holds for one of its descendants on a local branch (an earlier commit of a squash). Anything else still reads as not pushed.
- The PM lost its `board` and `ledger` tools for good when the engine dropped them after the module's start-up had already run, as when the mod's folder changed and `/board` reloaded it. The PM now checks its tools on every turn and every poll, and registers them again when they are missing.

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

[0.4.0]: https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.4.0
[0.3.2]: https://github.com/AudiChang-hub/claude-project-pm/commit/f072ce8
[0.3.1]: https://github.com/AudiChang-hub/claude-project-pm/commit/68af59e
[0.3.0]: https://github.com/AudiChang-hub/claude-project-pm/commit/5f324d9
[0.2.1]: https://github.com/AudiChang-hub/claude-project-pm/commit/4b0ead6
