// Every word the mod shows people or hands the PM model, in each language it speaks.
// `{name}` takes a value; `{n|one|other}` picks by the number `n` (English plurals).

export type Lang = 'en' | 'zh-TW'

export const LANGS: readonly Lang[] = ['en', 'zh-TW']

const zhTW = {
  // Statuses: `label` on the pane, `tag` on the PM's board.
  'status.asking.label': '待回覆',
  'status.asking.tag': '待回覆',
  'status.failed.label': 'CI 失敗',
  'status.failed.tag': 'CI 失敗・需處理',
  'status.open.label': '未完成',
  'status.open.tag': '中斷・未完成',
  'status.unreleased.label': '待發布',
  'status.unreleased.tag': '待發布・未完成',
  'status.ci.label': '等待 CI',
  'status.ci.tag': '等待 CI・未完成',
  'status.running.label': '執行中',
  'status.running.tag': '執行中',
  'status.waiting.label': '背景執行',
  'status.waiting.tag': '背景執行',
  'status.done.label': '已結束',
  'status.done.tag': '已結束',
  'status.stale.label': '長期閒置',
  'status.stale.tag': '長期閒置',

  // Time and names.
  'time.unknown': '不明',
  'time.now': '剛剛',
  'time.minutes': '{n} 分鐘前',
  'time.hours': '{n} 小時前',
  'time.days': '{n} 天前',
  'project.scratch': '臨時資料夾',
  'project.unsorted': '未分類',
  'session.untitled': '（未命名）',
  'delivery.commit': 'commit',
  'delivery.push': 'push',
  'delivery.release': '發布／部署／上線',
  'list.joiner': '、',
  'list.steps': '；',

  // Errors and logs.
  'error.notArray': 'list_sessions 回傳的不是陣列',
  'error.listFailed': '讀取 Session 清單失敗',
  'error.noTranscript': '讀不到紀錄',
  'error.cannotStart': '開不了新 Session',
  'log.cannotWrite': 'project-pm: 寫不進 Session 紀錄：{reason}',
  'log.cannotRegister': 'project-pm: 無法重新註冊 PM 工具：{reason}',

  // Toasts.
  'toast.asking': '「{title}」待你回覆',
  'toast.failed': '「{title}」的 CI 失敗了',
  'toast.unreleased': '「{title}」已停下，但回報尚未交付',
  'toast.open': '「{title}」已停止，仍有 {n} 項步驟未完成',

  // The PM's instructions.
  'role.text': `# 你是「{project}」專案的 PM

這個 Session 是專案「{project}」（{path}）的 PM。使用者只跟你說話，靠你確保這個專案沒有任何工作遺漏。你的工作是掌握狀況、派工、追蹤、驗收，不是自己寫程式。

規則：
1. 使用者問進度、問有沒有漏掉、或你要回報之前，先呼叫 {board} 看最新看板，不要憑記憶回答。
2. 使用者交代新工作：先用 {ledger}（action: "add"）登記為工作項目，再決定交給現有 Session（SendMessage，to 填它的 local_… id）或開新 Session（start_session），派出後用 ledger update 填上 owner。
3. 不要自己動手改專案的程式碼；實作交給子 Session。使用者明確要你自己做時才例外。
4. CI 還在跑、還沒部署完成的工作一律不算完成：負責 Session 狀態為「等待 CI」「CI 失敗」「待發布」「執行中」「背景執行」「待回覆」或「未完成」時，ledger 會拒絕結案。
5. 一個工作項目只有在你確認對應 Session 真的做完（看板上沒有未完成步驟、收尾摘要沒提到還沒做的事，必要時用 list_events 看它的紀錄）之後，才用 ledger update 標成 done。
6. 說「都完成了」之前，看板的「需要處理」必須是空的、工作項目沒有 open；不是的話，逐條列出還差什麼。
7. 子 Session 在等使用者回覆時，把它的問題原文轉述給使用者，使用者回答後用 SendMessage 轉達回去。
8. 封存 Session 前先確認它沒有未完成步驟、沒有開著的 PR，並問過使用者。
9. 提到 Session 時用 [標題](#local_…) 連結它。`,
  'role.justClaimed': '使用者剛用 /pm 把這個 Session 設成 PM。先呼叫 {board}，用幾句話報告專案現況：哪些 Session 在等使用者回覆、哪些停下但還有步驟、工作項目有沒有沒完成的。',

  // The PM's tools.
  'tool.board.description':
    '專案狀態報告：列出此專案所有子 Session 的狀態（執行中、待回覆、CI 失敗、等待 CI、待發布、中斷・未完成、背景執行、已結束；CI 狀態會用 gh 向 GitHub 確認）、任務清單進度、最新指令與收尾摘要，以及工作項目和需要處理的事項。回報進度或判斷是否有遺漏前必須先呼叫。',
  'tool.board.scope': 'project（預設）只看這個專案；all 看所有專案。',
  'tool.board.includeDone': '一併列出已結束且無待辦的 Session 與已完成的工作項目。預設 false。',
  'tool.ledger.description':
    '專案 PM 的工作項目清單：使用者交代的每件工作都要登記在這裡，直到確認完成。顯示編號為 T-01 形式，操作時 id 填數字。add 新增（text 必填，owner 可填負責的 local_… Session id）；update 改 owner、status（open / done / dropped）或 note；list 列出全部。',
  'tool.ledger.id': 'update 時要修改的工作項目 id（T-03 填 3）',
  'tool.ledger.text': '工作項目內容（add 必填；update 時可改寫）',
  'tool.ledger.owner': '負責的 Session id（local_…）；空字串表示取消指派',
  'tool.ledger.note': '備註：進度、驗收結果、為什麼放棄',
  'tool.ledger.force': '負責 Session 仍在等 CI 或未完成時，強制結案。只有使用者明確確認時才能用，且 note 必填。',

  // Becoming the PM, stepping down, starting a PM session, archiving.
  'claim.noId': '無法取得此 Session 的 id（可能不在桌面版中），無法擔任 PM。',
  'claim.scratch': '此 Session 位於臨時資料夾，不屬於任何專案，無法擔任 PM。',
  'claim.tookOver': '此 Session 已接任「{project}」的 PM（原 PM：{before}）。',
  'claim.done': '此 Session 已擔任「{project}」的 PM。',
  'release.notPm': '此 Session 目前不是 PM。',
  'release.done': '此 Session 已卸任「{project}」的 PM；工作項目保留於專案中，由下一任 PM 接手。',
  'start.prompt': '{claim} 你是「{project}」專案的 PM。先呼叫 {board} 看所有 Session 的狀態，再用幾句話向使用者報告：哪些在等他回覆、哪些停下但任務清單還有步驟、工作項目有沒有沒完成的。',
  'start.background':
    '使用者希望每個專案都有一個 PM Session：使用者只跟 PM 說話，PM 追蹤專案「{project}」（{path}）裡所有子 Session 的工作狀態與工作項目，確保沒有工作遺漏。project-pm Mod 會在這個 Session 讀到開頭的標記時把它設成 PM，並提供看板與工作項目工具。',
  'notice.pmCreated': '已建立 PM Session「{project} · PM」，可在側欄開啟。',
  'notice.pmFailed': '無法自動建立 PM Session（{reason}）。請手動開啟新 Session 並執行 /pm。',
  'archive.reason': '專案 PM：封存「{title}」',
  'archive.refused': '封存要求遭拒',
  'notice.notArchived': '「{title}」未封存：{why}',
  'notice.archived': '已封存「{title}」，可於側欄的封存區復原。',

  // Commands.
  'command.pm': '指定此 Session 為專案 PM（/pm off 卸任，/pm lang en|zh-TW|auto 切換語言）',
  'command.board': '開啟或收合專案看板',
  'command.boardClosed': '已收合專案看板，再次執行 /board 可重新開啟。',
  'command.boardOpened': '已開啟專案看板。',
  'command.denyBoard': 'project-pm：專案看板讀取失敗，請稍後再試，或改用 list_sessions / list_events。',
  'command.denyLedger': 'project-pm：工作項目寫入失敗，請再試一次。',
  'pane.titlePm': '{project} · PM',
  'pane.titleBoard': '{project} · 專案看板',
  'pane.titleBoardNone': '專案看板',
  'lang.set': '看板語言已設為 {lang}。',
  'lang.setAuto': '看板語言改為跟隨系統（目前：{lang}）。',
  'lang.notSaved': '看板語言已在這個 Session 改為 {lang}，但無法存進設定（{reason}）；下次啟動會恢復原設定。',
  'lang.usage': '用法：/pm lang en、/pm lang zh-TW 或 /pm lang auto（跟隨系統）。目前：{lang}。',

  // The board as the PM model reads it.
  'board.cannotRead': '讀不到 Session 清單：{error}',
  'board.title': '# 專案狀態報告：{project}',
  'board.path': '路徑：{path}',
  'board.counts':
    'Sessions {total}（不含 PM）｜待回覆 {asking}｜CI 失敗 {failed}｜等待 CI {ci}｜待發布 {unreleased}｜中斷・未完成 {open}｜執行中 {running}｜背景執行 {waiting}｜已結束 {done}｜長期閒置 {stale}',
  'board.progress': '工作項目完成 {done}/{total}（專案進度以工作項目為準；Session 收尾時會把自己的任務清單全部勾選，不代表工作已完成）',
  'board.name': '「{title}」({id})',
  'board.attention.asking': '- [待回覆] {name} 等待使用者決策：{said}',
  'board.attention.open': '- [中斷・未完成] {name} 已停止，任務清單仍有 {n} 項未完成：{steps}',
  'board.attention.ci': '- [等待 CI・未完成] {name} 最後回報 CI 尚未跑完，不能視為完成：{said}',
  'board.attention.unreleased': '- [待發布・未完成] {name} 最後回報尚未交付（{kinds}），不能視為完成：{said}',
  'board.attention.failed': '- [CI 失敗・需處理] {name} GitHub 上的 CI（{target}）失敗，要修正後重跑：{said}',
  'board.attention.failedTarget': '最近一次',
  'board.attention.caveat': '- [需追蹤] {name} 收尾摘要載明尚有未完成事項：{said}',
  'board.attention.pr': '- [PR 開啟中] {name}',
  'board.attention.unassigned': '- [未指派] 工作項目 {code}「{text}」尚未指派負責 Session',
  'board.attention.lost': '- [負責人失聯] 工作項目 {code}「{text}」的負責 Session {owner} 已不在清單中（可能已封存），需確認是否完成',
  'board.owner.unassigned': '未指派',
  'board.owner.gone': '{id}（已不在清單中）',
  'board.owner.status': '{title}（{tag}{elsewhere}）',
  'board.owner.elsewhere': '・其他專案的 Session',
  'board.section.attention': '## 需要處理',
  'board.section.items': '## 工作項目',
  'board.none': '（無）',
  'board.allDone': '（全部完成）',
  'board.item': '- {code} (id {id}) [{status}] {text}｜負責：{owner}{note}',
  'board.itemNote': '｜備註：{note}',
  'board.flag.pr': 'PR 開啟中',
  'board.flag.pinned': '已釘選',
  'board.lastActive': '最後活動 {ago}{flags}',
  'board.flags': '｜{flags}',
  'board.tasks': '任務 {done}/{total}：{steps}',
  'board.prompt': '最新指令：{text}',
  'board.recap': '收尾摘要：{text}',
  'board.answer': '最後回報：{text}',
  'board.ask': '待決策問題：{text}',
  'board.background': '背景工作 {n} 項執行中：{tasks}',
  'board.backgroundTask': '{label}（{ago}開始）',
  'board.untracked': '（無追蹤紀錄：此 Session 在 Mod 安裝前開啟）最後訊息：{said}',
  'board.readFailed': '讀取失敗：{error}',
  'board.reading': '讀取中',
  'board.hidden': '另有 {n} 個已結束且無待辦的 Session 未列出；以 include_done: true 檢視全部。',

  // Why the ledger will not close an item yet.
  'blocker.ciFailedOn': 'GitHub 上的 CI（{target}）失敗',
  'blocker.ciRunning': '最後回報 CI 尚未跑完',
  'blocker.undelivered': '最後回報尚未交付（{kinds}）',
  'blocker.quoted': '負責的 Session「{title}」{why}（{said}）。',
  'blocker.lastReport': '負責的 Session「{title}」{why}（最後回報：{said}）。',
  'blocker.plain': '負責的 Session「{title}」{why}。',
  'blocker.why.ci': 'CI 尚未跑完',
  'blocker.why.failed': 'GitHub 上的 CI 失敗',
  'blocker.why.unreleased': '最後回報尚未交付（未 commit、push 或發布）',
  'blocker.why.running': '仍在執行中',
  'blocker.why.waiting': '仍有背景作業在跑',
  'blocker.why.asking': '正在等使用者回覆',
  'blocker.why.open': '任務清單仍有未完成步驟',

  // The ledger's answers.
  'ledger.empty': '目前沒有工作項目。',
  'ledger.row': '{code} (id {id}) [{status}] {text}｜負責：{owner}{note}',
  'ledger.unassigned': '未指派',
  'ledger.noProject': '此 Session 不屬於任何專案，沒有工作項目。',
  'ledger.needText': 'add 需要 text。',
  'ledger.added': '已新增工作項目 {code}（id {id}）。',
  'ledger.notFound': '找不到工作項目 id {id}。',
  'ledger.refused': '無法將 {code} 標記為完成：{blocker}\n確認 CI 通過、部署完成後再結案；若使用者已明確確認可結案，帶 force: true 並在 note 寫明確認內容。',
  'ledger.updated': '已更新工作項目 {code}。',
  'ledger.badAction': 'action 要是 add、update 或 list。',

  // The band above the prompt.
  'band.title': '專案 PM',
  'band.noPm': '　「{project}」尚未指派 PM',
  'band.starting': '建立中…',
  'band.start': '建立 PM Session',
  'band.claim': '由此 Session 擔任',
  'band.skip': '略過',

  // The pane.
  'pane.syncing': '正在同步 Session…',
  'pane.cannotRead': '無法讀取 Session 清單：{error}',
  'pane.projects': '{n} 個專案',
  'pane.pmSelf': 'PM：本 Session',
  'pane.pmOther': 'PM：已指派',
  'pane.pmNone': 'PM：未指派',
  'pane.ratio': '完成率 {percent}%',
  'pane.noData': '尚無資料',
  'pane.itemsDone': '工作項目完成 {done}/{total}',
  'pane.stepsDone': 'Session 步驟完成 {done}/{total}（尚無工作項目）',
  'pane.noItems': '尚無工作項目',
  'pane.itemsOpen': '{n} 項進行中',
  'pane.itemsUnassigned': '　·　{n} 項未指派',
  'pane.kpiRunning': '執行中',
  'pane.kpiAsking': '待回覆',
  'pane.kpiOpen': '尚未完成',
  'pane.portfolio': 'PORTFOLIO',
  'pane.project': 'PROJECT',
  'pane.allProjects': '全部專案',
  'pane.sessionsCount': '{n} Sessions　·　{role}',
  'pane.scopeProject': '本專案',
  'pane.scopeAll': '全部',
  'pane.confirmArchiveWarn': '確定封存？{warn}',
  'pane.confirmArchive': '確定封存此 Session？',
  'pane.archive': '封存',
  'pane.archiving': '封存中…',
  'pane.cancel': '取消',
  'pane.question': '問題：{text}',
  'pane.instruction': '指令：{text}',
  'pane.noReport': '尚無回報',
  'pane.cannotReadTranscript': '無法讀取紀錄：{error}',
  'pane.reading': '讀取中…',
  'pane.steps': '步驟 {done}/{total}',
  'pane.prOpen': 'PR 開啟中',
  'pane.untracked': '無追蹤紀錄',
  'pane.warnSteps': '尚有 {n} 項步驟未完成',
  'pane.warnPr': 'PR 仍開啟',
  'pane.warnPinned': '已釘選',
  'pane.moreSteps': '　（另 {n} 項）',
  'pane.caveat': '需追蹤',
  'pane.elsewhere': '・其他專案',
  'pane.ownerNone': '尚未指派',
  'pane.owner': '負責　{title}・{status}{elsewhere}',
  'pane.ownerGone': '負責 Session 已不在清單中',
  'pane.projectCounts': '{live} 進行中　·　{ended} 已結束{pm}',
  'pane.projectPm': '　·　PM',
  'pane.noLive': '沒有進行中的 Session。',
  'pane.noSessions': '此專案目前沒有其他 Session。',
  'pane.noPm': '此專案尚未指派 PM',
  'pane.items': '工作項目',
  'pane.sessions': 'SESSIONS',
  'pane.sessionsMeta': '{live} 進行中　·　{ended} 已結束',
  'pane.hideEnded': '收合已結束的 Session',
  'pane.showEnded': '顯示已結束的 Session（{n}）',
  'pane.synced': '同步於 {ago}　·　每 30 秒自動更新',
  'pane.refresh': '重新同步',
} as const

export type MessageKey = keyof typeof zhTW

const en: Record<MessageKey, string> = {
  'status.asking.label': 'Waiting on you',
  'status.asking.tag': 'Waiting on you',
  'status.failed.label': 'CI failed',
  'status.failed.tag': 'CI failed · needs fixing',
  'status.open.label': 'Unfinished',
  'status.open.tag': 'Stopped · unfinished',
  'status.unreleased.label': 'Not released',
  'status.unreleased.tag': 'Not released · unfinished',
  'status.ci.label': 'Waiting on CI',
  'status.ci.tag': 'Waiting on CI · unfinished',
  'status.running.label': 'Running',
  'status.running.tag': 'Running',
  'status.waiting.label': 'In the background',
  'status.waiting.tag': 'In the background',
  'status.done.label': 'Ended',
  'status.done.tag': 'Ended',
  'status.stale.label': 'Idle',
  'status.stale.tag': 'Idle',

  'time.unknown': 'unknown',
  'time.now': 'just now',
  'time.minutes': '{n} min ago',
  'time.hours': '{n} {n|hour|hours} ago',
  'time.days': '{n} {n|day|days} ago',
  'project.scratch': 'Scratch folder',
  'project.unsorted': 'Unsorted',
  'session.untitled': '(untitled)',
  'delivery.commit': 'commit',
  'delivery.push': 'push',
  'delivery.release': 'release, deploy or go live',
  'list.joiner': ', ',
  'list.steps': '; ',

  'error.notArray': 'list_sessions did not return a list',
  'error.listFailed': 'Could not read the session list',
  'error.noTranscript': 'Could not read the transcript',
  'error.cannotStart': 'Could not start a new session',
  'log.cannotWrite': 'project-pm: could not write the session record: {reason}',
  'log.cannotRegister': 'project-pm: could not register the PM tools again: {reason}',

  'toast.asking': '"{title}" is waiting on you',
  'toast.failed': 'CI failed for "{title}"',
  'toast.unreleased': '"{title}" stopped, but its work is not delivered yet',
  'toast.open': '"{title}" stopped with {n} {n|step|steps} left',

  'role.text': `# You are the PM of the "{project}" project

This session is the PM of the project "{project}" ({path}). The user talks only to you and counts on you to make sure no work in this project slips through. Your job is to keep track, hand out work, follow up and check it, not to write the code yourself.

Rules:
1. When the user asks about progress or whether anything was missed, and before you report, call {board} for the latest board. Do not answer from memory.
2. When the user asks for new work: record it first as a work item with {ledger} (action: "add"), then hand it to an existing session (SendMessage, with to set to its local_… id) or start a new one (start_session), and set its owner with a ledger update once it is handed out.
3. Do not change the project's code yourself; sub-sessions do the work. The only exception is when the user explicitly asks you to.
4. Work whose CI is still running, or that is not deployed yet, is never done: while the owning session is "Waiting on CI", "CI failed", "Not released", "Running", "In the background", "Waiting on you" or "Unfinished", the ledger refuses to close the item.
5. Mark a work item done with a ledger update only after you have confirmed that its session really finished (no steps left on the board, nothing left undone in its recap; read its transcript with list_events when in doubt).
6. Before you say "it's all done", the board's "Needs attention" must be empty and no work item may be open; otherwise list, one by one, what is still missing.
7. When a sub-session is waiting on the user, pass its question on word for word, then relay the user's answer back with SendMessage.
8. Before archiving a session, make sure it has no steps left and no open PR, and ask the user.
9. When you mention a session, link it as [title](#local_…).`,
  'role.justClaimed': 'The user just made this session the PM with /pm. Call {board} first, then report the state of the project in a few sentences: which sessions are waiting on the user, which stopped with steps left, and whether any work item is still open.',

  'tool.board.description':
    "Project status report: every sub-session of this project with its status (Running, Waiting on you, CI failed, Waiting on CI, Not released, Stopped · unfinished, In the background, Ended; CI is checked on GitHub with gh), its task list progress, latest instruction and recap, plus the work items and what needs attention. Call it before reporting progress or judging whether anything was missed.",
  'tool.board.scope': 'project (default) shows this project only; all shows every project.',
  'tool.board.includeDone': 'Also list ended sessions with nothing left and work items that are done. Default false.',
  'tool.ledger.description':
    "The project PM's work items: record every piece of work the user asks for here until it is confirmed done. Items read as T-01; pass the number as id. add creates one (text required, owner optional: the owning local_… session id); update changes owner, status (open / done / dropped) or note; list shows them all.",
  'tool.ledger.id': 'The id of the work item to update (3 for T-03)',
  'tool.ledger.text': 'What the work item is (required for add; may be rewritten on update)',
  'tool.ledger.owner': 'The owning session id (local_…); an empty string unassigns it',
  'tool.ledger.note': 'A note: progress, how it was checked, why it was dropped',
  'tool.ledger.force': 'Close the item although its owner is still waiting on CI or unfinished. Only when the user has explicitly confirmed it; note is then required.',

  'claim.noId': "This session's id is not available (perhaps it is not in the desktop app), so it cannot be the PM.",
  'claim.scratch': 'This session is in a scratch folder and belongs to no project, so it cannot be the PM.',
  'claim.tookOver': 'This session is now the PM of "{project}" (previous PM: {before}).',
  'claim.done': 'This session is now the PM of "{project}".',
  'release.notPm': 'This session is not the PM.',
  'release.done': 'This session is no longer the PM of "{project}"; the work items stay with the project for the next PM.',
  'start.prompt': '{claim} You are the PM of the "{project}" project. Call {board} first to see every session, then report to the user in a few sentences: which sessions are waiting on them, which stopped with steps left on their task list, and whether any work item is still open.',
  'start.background':
    'The user wants one PM session per project: they talk only to the PM, and the PM keeps track of the status and work items of every sub-session in the project "{project}" ({path}), so that no work slips through. The project-pm mod makes this session the PM when it reads the marker at the start, and gives it the board and work item tools.',
  'notice.pmCreated': 'Started the PM session "{project} · PM"; open it from the sidebar.',
  'notice.pmFailed': 'Could not start a PM session ({reason}). Open a new session yourself and run /pm.',
  'archive.reason': 'Project PM: archiving "{title}"',
  'archive.refused': 'the archive request was refused',
  'notice.notArchived': '"{title}" was not archived: {why}',
  'notice.archived': 'Archived "{title}"; restore it from the archive in the sidebar.',

  'command.pm': 'Make this session the project PM (/pm off to step down, /pm lang en|zh-TW|auto for the language)',
  'command.board': 'Open or close the project board',
  'command.boardClosed': 'Closed the project board; run /board again to open it.',
  'command.boardOpened': 'Opened the project board.',
  'command.denyBoard': 'project-pm: the board could not be read. Try again shortly, or use list_sessions / list_events.',
  'command.denyLedger': 'project-pm: the work item could not be saved. Please try again.',
  'pane.titlePm': '{project} · PM',
  'pane.titleBoard': '{project} · Board',
  'pane.titleBoardNone': 'Project board',
  'lang.set': 'The board now speaks {lang}.',
  'lang.setAuto': 'The board now follows the system language (currently {lang}).',
  'lang.notSaved': 'The board speaks {lang} in this session, but the setting could not be saved ({reason}); the next start goes back to the saved one.',
  'lang.usage': 'Usage: /pm lang en, /pm lang zh-TW or /pm lang auto (follow the system). Now: {lang}.',

  'board.cannotRead': 'Could not read the session list: {error}',
  'board.title': '# Project status: {project}',
  'board.path': 'Path: {path}',
  'board.counts':
    'Sessions {total} (PM not counted) | Waiting on you {asking} | CI failed {failed} | Waiting on CI {ci} | Not released {unreleased} | Stopped · unfinished {open} | Running {running} | In the background {waiting} | Ended {done} | Idle {stale}',
  'board.progress': 'Work items done {done}/{total} (progress counts work items; a session ticks off its own task list when it wraps up, which does not mean the work is done)',
  'board.name': '"{title}" ({id})',
  'board.attention.asking': '- [Waiting on you] {name} needs the user to decide: {said}',
  'board.attention.open': '- [Stopped · unfinished] {name} stopped with {n} {n|step|steps} left on its task list: {steps}',
  'board.attention.ci': "- [Waiting on CI · unfinished] {name} last said CI has not finished, so it is not done: {said}",
  'board.attention.unreleased': '- [Not released · unfinished] {name} last said its work is not delivered yet ({kinds}), so it is not done: {said}',
  'board.attention.failed': '- [CI failed · needs fixing] {name} CI on GitHub ({target}) failed and needs a fix and a new run: {said}',
  'board.attention.failedTarget': 'latest run',
  'board.attention.caveat': '- [Follow up] {name} says in its recap that something is left: {said}',
  'board.attention.pr': '- [PR open] {name}',
  'board.attention.unassigned': '- [Unassigned] Work item {code} "{text}" has no owning session yet',
  'board.attention.lost': '- [Owner gone] The owning session {owner} of work item {code} "{text}" is no longer listed (perhaps archived); check whether it was finished',
  'board.owner.unassigned': 'unassigned',
  'board.owner.gone': '{id} (no longer listed)',
  'board.owner.status': '{title} ({tag}{elsewhere})',
  'board.owner.elsewhere': ' · session of another project',
  'board.section.attention': '## Needs attention',
  'board.section.items': '## Work items',
  'board.none': '(none)',
  'board.allDone': '(all done)',
  'board.item': '- {code} (id {id}) [{status}] {text} | owner: {owner}{note}',
  'board.itemNote': ' | note: {note}',
  'board.flag.pr': 'PR open',
  'board.flag.pinned': 'pinned',
  'board.lastActive': 'Last active {ago}{flags}',
  'board.flags': ' | {flags}',
  'board.tasks': 'Tasks {done}/{total}: {steps}',
  'board.prompt': 'Latest instruction: {text}',
  'board.recap': 'Recap: {text}',
  'board.answer': 'Last report: {text}',
  'board.ask': 'Question to decide: {text}',
  'board.background': '{n} background {n|command|commands} running: {tasks}',
  'board.backgroundTask': '{label} (started {ago})',
  'board.untracked': '(No record: this session was open before the mod was installed) Last message: {said}',
  'board.readFailed': 'could not read it: {error}',
  'board.reading': 'reading',
  'board.hidden': '{n} more ended {n|session|sessions} with nothing left {n|is|are} not listed; pass include_done: true to see all.',

  'blocker.ciFailedOn': 'has CI failing on GitHub ({target})',
  'blocker.ciRunning': 'last said CI has not finished',
  'blocker.undelivered': 'last said its work is not delivered yet ({kinds})',
  'blocker.quoted': 'The owning session "{title}" {why} ({said}).',
  'blocker.lastReport': 'The owning session "{title}" {why} (last report: {said}).',
  'blocker.plain': 'The owning session "{title}" {why}.',
  'blocker.why.ci': 'is waiting on CI',
  'blocker.why.failed': 'has CI failing on GitHub',
  'blocker.why.unreleased': 'last said its work is not delivered yet (not committed, pushed or released)',
  'blocker.why.running': 'is still running',
  'blocker.why.waiting': 'still has work running in the background',
  'blocker.why.asking': 'is waiting on the user',
  'blocker.why.open': 'has steps left on its task list',

  'ledger.empty': 'No work items yet.',
  'ledger.row': '{code} (id {id}) [{status}] {text} | owner: {owner}{note}',
  'ledger.unassigned': 'unassigned',
  'ledger.noProject': 'This session belongs to no project, so it has no work items.',
  'ledger.needText': 'add needs text.',
  'ledger.added': 'Added work item {code} (id {id}).',
  'ledger.notFound': 'No work item with id {id}.',
  'ledger.refused': "Cannot mark {code} done: {blocker}\nClose it once CI has passed and it is deployed; if the user has explicitly confirmed it can be closed, pass force: true and write what they confirmed in note.",
  'ledger.updated': 'Updated work item {code}.',
  'ledger.badAction': 'action must be add, update or list.',

  'band.title': 'Project PM',
  'band.noPm': '　"{project}" has no PM yet',
  'band.starting': 'Starting…',
  'band.start': 'Start a PM session',
  'band.claim': 'Make this session the PM',
  'band.skip': 'Not now',

  'pane.syncing': 'Syncing sessions…',
  'pane.cannotRead': 'Could not read the session list: {error}',
  'pane.projects': '{n} {n|project|projects}',
  'pane.pmSelf': 'PM: this session',
  'pane.pmOther': 'PM: assigned',
  'pane.pmNone': 'PM: none',
  'pane.ratio': '{percent}% done',
  'pane.noData': 'No data yet',
  'pane.itemsDone': 'Work items done {done}/{total}',
  'pane.stepsDone': 'Session steps done {done}/{total} (no work items yet)',
  'pane.noItems': 'No work items yet',
  'pane.itemsOpen': '{n} open',
  'pane.itemsUnassigned': '　·　{n} unassigned',
  'pane.kpiRunning': 'Running',
  'pane.kpiAsking': 'Waiting on you',
  'pane.kpiOpen': 'Not finished',
  'pane.portfolio': 'PORTFOLIO',
  'pane.project': 'PROJECT',
  'pane.allProjects': 'All projects',
  'pane.sessionsCount': '{n} {n|session|sessions}　·　{role}',
  'pane.scopeProject': 'This project',
  'pane.scopeAll': 'All',
  'pane.confirmArchiveWarn': 'Archive it? {warn}',
  'pane.confirmArchive': 'Archive this session?',
  'pane.archive': 'Archive',
  'pane.archiving': 'Archiving…',
  'pane.cancel': 'Cancel',
  'pane.question': 'Question: {text}',
  'pane.instruction': 'Instruction: {text}',
  'pane.noReport': 'Nothing reported yet',
  'pane.cannotReadTranscript': 'Could not read the transcript: {error}',
  'pane.reading': 'Reading…',
  'pane.steps': 'Steps {done}/{total}',
  'pane.prOpen': 'PR open',
  'pane.untracked': 'No record',
  'pane.warnSteps': '{n} {n|step|steps} left',
  'pane.warnPr': 'PR still open',
  'pane.warnPinned': 'pinned',
  'pane.moreSteps': '　(+{n} more)',
  'pane.caveat': 'Follow up',
  'pane.elsewhere': ' · other project',
  'pane.ownerNone': 'Unassigned',
  'pane.owner': 'Owner　{title} · {status}{elsewhere}',
  'pane.ownerGone': 'Owning session is no longer listed',
  'pane.projectCounts': '{live} active　·　{ended} ended{pm}',
  'pane.projectPm': '　·　PM',
  'pane.noLive': 'No active sessions.',
  'pane.noSessions': 'No other sessions in this project.',
  'pane.noPm': 'This project has no PM yet',
  'pane.items': 'WORK ITEMS',
  'pane.sessions': 'SESSIONS',
  'pane.sessionsMeta': '{live} active　·　{ended} ended',
  'pane.hideEnded': 'Hide ended sessions',
  'pane.showEnded': 'Show ended sessions ({n})',
  'pane.synced': 'Synced {ago}　·　updates every 30 s',
  'pane.refresh': 'Sync now',
}

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = { en, 'zh-TW': zhTW }

/** The language the system runs in, as the JavaScript runtime reports it (Windows: the display language). */
export function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return ''
  }
}

/**
 * The language to speak: the `language` setting when it names one (`en`, `zh-TW`), else the system's.
 * Any Chinese locale reads Traditional Chinese, Simplified included (zh-CN, zh-Hans, zh-SG): the same
 * language in another script reads far more easily than English. Everything else reads English.
 */
export function resolveLang(setting: unknown, locale: string): Lang {
  if (setting === 'en' || setting === 'zh-TW') return setting

  return /^zh(?:[-_]|$)/i.test(locale) ? 'zh-TW' : 'en'
}

let current: Lang = resolveLang(undefined, systemLocale())

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang) {
  current = lang
}

/** The message `key` in the current language, `{name}` filled from `params`, `{n|one|other}` picked by `n`. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return MESSAGES[current][key].replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (whole, name: string, one?: string, other?: string) => {
    const value = params[name]
    if (one !== undefined) return Number(value) === 1 ? one : (other ?? '')

    return value === undefined ? whole : String(value)
  })
}

/** The names a message takes: `{name}` and `{name|one|other}` alike. */
export function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)(?:\|[^}]*)?\}/g)].map(m => m[1]!))].sort()
}
