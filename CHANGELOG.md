# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions match `version` in `.claude-plugin/plugin.json`.

## [0.5.1] - 2026-10-20

### Fixed
- A report that described how the board judges (看板就會誤判成「已結束」，但發布其實還在等 PM; 會被列為待發布，而且 commit 還沒 push 的情況也一樣; the board flags it as not released) could read as the session's own work still to deliver, and another session described by what it waits on (正在等 PM 通知才發布的 Session) as its own. A sentence that describes a judgment, either the board (看板, board, detector) with a judging word (判成, 誤判, 列為, 標成, 顯示成, flags as) or a judging verb with a status after it (列為待發布), is now set aside as a whole, before and after that clause, except a clause with its own subject (我, 這次, 本次, I, we): 「看板會判成待發布，因為我還沒 push」 still reads as not pushed. 看板 or a status name alone, 列為 alone (列為待確認事項) and a misjudgment fixed (誤判已修好, 修了一個誤判) do not make a sentence a description; a phrase that ends in a session (還沒 push 的 Session) is someone else's.
- A report that said how its commit was made ("amended, no separate commit: the new commit is 3fa1c2e … not pushed") read as not committed as well as not pushed, so the git check that clears a push once its commit is on a remote branch never applied. A negation whose words name the manner of the work (另開, 另外, 新增, 再開, 額外, 拆成, force, separate, extra) is no work left, and a commit named by its hash (commit 是 3fa1c2e, amend 成 3fa1c2e, 併進 3fa1c2e, committed as 3fa1c2e) is a commit made. Leaving a tag or a CHANGELOG entry out on purpose was already no delivery left.
- *Follow up* (需追蹤) listed a recap's "not pushed" after the commit it named was pushed. It now reads a recap the way *Not released* does: delivery left as undeliveredOf reads it, cleared by the same git check; and work left otherwise (not done, verified or tested) with quoted words, rules and someone else's work set aside.
- A release waiting on the PM's word with more than a few words before the verb (等 PM 通知 2.4.1／2.4.2 上線後再 cherry-pick 發布) was not read as waiting.
- A finished release whose report also told of the person's own plan (你原本打算上線後自己調整) showed as *Not released*: the person's plan read as this session's next step. Future-tense words with the person as their subject (你, 您, you'll, you plan) no longer count, while 幫你, 給你 or 通知你 still leave the work with the session; "next" counts as a step only as "Next:" or "Next,", so "the next release can go ahead" is no step of its own. A report that said "no code changed、no push" in one clause, joined by 、, still read as not pushed: the no-code statement before a bare negation is no other subject now.
- A report that left its own delivery to come only in the future tense, with no negation (之後再 push, 接下來部署到正式站, 明天發布 2.4.2, PM 確認後我再推, I'll push after review, Next: deploy to production), could show as *Ended*. Those words now read as not released, with the kinds they name; when only a push is left and the commit is named, git still clears it once that commit is pushed. They do not count when they are an offer to the person (你可以之後再 push, you can deploy later), a question, a condition, a rule or process (流程是先 commit 再 push), someone else's work (它會推送, 子 Session, another session, 由 PM 負責, 其他工作), a future that will not come or a guess (不會再部署, 可能), a past told in order (之後它完成部署, 之後另外提交 3fa1c2e), or a verb used as a noun (多了兩個 commit, 合併後的提交, 之後部署會改成); a later word of the same kind still stands. As a result, a session whose CI has passed but whose words still say tagging and deploying come after it now shows as *Not released* rather than *Ended*. 完成部署 ("finished deploying") now reads as done, like 部署完成.
- A session whose work had no code to deliver (a data fix) and said so ("no code changed, and no push") showed as *Not released*, and the ledger would not close its item. A report that says it changed no code (沒有改程式, 純資料修正, no code changes) now lets a bare negation of commit, push or release go (也沒有 push, did not push), and "not needed" (不需要 push, 無需發布, no need to push, nothing to commit) settles the kinds it names. Work still to come still counts: a negation of what is yet to happen (還沒, 尚未, 未, not … yet), one with a subject of its own (設定檔沒有 commit), and any in a sentence that waits on something (沒有 push，等 PM 確認). Without such a statement a bare "no push" still reads as not released, and a no-code phrase that names a kind of work (只改資料的工作), a folder (只改資料夾) or what a report says (回報裡宣告沒有改程式) is no such statement.
- A report that said its own release was done and then told of another session's uncommitted changes ("blocked by another session's (version N+1) uncommitted changes… I did not touch them") showed as *Not released*. Words about another session's work (另一個／另個／其他／別的 Session, another session, someone else), about something owned by someone named before 的 (版本 2.4.2 的未提交修改), or disowned (我都沒有動, 沒碰, 不是我的, not mine, I didn't touch, together with the clause just before it when that clause has no I of its own) no longer count, for delivery, CI and background work alike. They are set aside before anything is read; of what is left, each kind's last word still stands, so "deployed 2.4.1, 2.4.2 not committed yet" still reads as not released.

## [0.5.0] - 2026-10-19

### Added
- English. The board, its cards and counters, the band above the prompt, the commands' replies, the toasts, the PM's instructions and the `board` and `ledger` tools (descriptions and output, the ledger's refusals included) speak English or Traditional Chinese. The language follows the system (`Intl`'s locale: the display language on Windows; any Chinese locale, Simplified included, reads Traditional Chinese, everything else English) unless the new `language` option says `en` or `zh-TW`. `/pm lang en|zh-TW|auto` switches at once and saves the option, the same `/config` row (`project-pm.language`) and settings.json `pluginConfigs` entry a person can set by hand. Reading sessions' reports in English and Chinese is unchanged, and so are the files the mod keeps.

### Changed
- The READMEs describe the language choice (a Language section, `/pm lang` in the command table). README.md shows the English board and README.zh-TW.md the Traditional Chinese one; the offline demo that draws them (`docs/demo/board.html?lang=en|zh-TW`) takes its words from `hooks/messages.ts`.

### Fixed
- A cancelled CI run counted as a failure, so a session that called off one commit's run and pushed a fix showed as *CI failed* after the fix passed. A cancelled run is now left out when its workflow ran again on the same commit; a workflow whose runs were all cancelled never finished, so the commit has not passed either and a newer commit, the folder's `HEAD` or the words decide (the words of CI still to run keep it *Waiting on CI*).
- When a report named several commits, an older one could answer for the newer one. A named commit that another named commit holds is now skipped, a failed or cancelled run named by id hands over its commit to the same rule, and each commit is asked together with the remote branch tips that hold it, the better answer standing (passed, then running, then failed): a fix that passed clears the commit it fixed, and a fix still running keeps it waiting.
- 「正在等 9f8e7d6 的 CI」 ("waiting for 9f8e7d6's CI") was not read as CI still running: a hash between the words no longer hides it. The status 等待 CI in a list or a chain of statuses (未完成、等待 CI、CI 失敗, CI 失敗／等待 CI → 背景執行) is a name, not CI running.
- A sentence describing re-runs (同一個 workflow 還有別的 run（重跑，或取消後又跑一次）, "another run of the same workflow, a re-run or one started again after a cancel") read as CI still running: any 跑 after a CI word counted. 重跑 and 又跑 now count only when under way (重跑中, 又跑著).

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
- On a session card, the 需追蹤 label ran straight into the recap after it ("需追蹤Merged locally as …"); a full-width space now separates them.
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

[0.5.1]: https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.5.1
[0.5.0]: https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.5.0
[0.4.0]: https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.4.0
[0.3.2]: https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.3.2
[0.3.1]: https://github.com/AudiChang-hub/claude-project-pm/commit/68af59e
[0.3.0]: https://github.com/AudiChang-hub/claude-project-pm/commit/5f324d9
[0.2.1]: https://github.com/AudiChang-hub/claude-project-pm/commit/4b0ead6
