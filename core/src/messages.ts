/**
 * The core's own words, in both languages. The words the core shares with the desktop mod (the board, the ledger,
 * the QA gate, the PM's instructions) stay in hooks/messages.ts and are read through its `t`; the language is set
 * once for both (`initLang`).
 */
import { getLang, resolveLang, setLang, systemLocale } from '../../hooks/messages'
import type { Lang } from '../../hooks/messages'

const zhTW = {
  'error.notGit': '這個資料夾（{path}）不在 git repo 裡，沒有交辦清單。請在專案的 git 資料夾裡使用，或先執行 git init。',
  'error.cannotWrite': 'Project PM 寫不進資料檔（{reason}），這次的內容沒有存下來。',
  'error.corrupt': 'Project PM 的資料檔 {file} 無法讀取（{reason}）。檔案沒有被改動；請備份後修正或刪除它。',
  'error.unknownTool': '沒有名為 {name} 的工具。',
  'report.noPmYet': '已記錄：{status}。這個專案還沒有 PM，PM 上任後會在看板看到這份回報。',
  'report.recorded': '已回報給 PM：{status}。',
  'report.recordedDetail': '已回報給 PM：{status}。詳細內容已存到 {path}，給 PM 的訊息附上這個路徑即可。',
  'report.itemMissing': '（找不到工作項目 id {id}，commit 沒有記到工作項目上。）',
  'pm.claimed': '此 Session（{actor}）已擔任「{project}」的 PM。',
  'pm.tookOver': '此 Session（{actor}）已接任「{project}」的 PM（原 PM：{before}）。',
  'pm.notPm': '此 Session（{actor}）目前不是「{project}」的 PM（PM：{pm}）。',
  'pm.released': '此 Session 已卸任「{project}」的 PM；工作項目保留，由下一任 PM 接手。',
  'pm.status': '專案「{project}」（{path}）\nPM：{pm}\n工作項目：{open} 項未結案，共 {total} 項\n看板：{url}',
  'pm.nobody': '（沒有）',
  'pm.noBoardUrl': '網頁看板沒有在執行（在專案資料夾執行 git pm open 打開）',
  'pm.badAction': 'action 要是 claim、release 或 status。',
  'board.noSessionsRead': '（讀不到 Session 紀錄：{error}；交辦清單照常列出）',
  'board.ciChecking': '（CI 狀態查詢中，稍後再看一次看板）',
  'board.noPush': '[push 時跳過了檢查] 遠端的 {branch} 有 {n} 個 commit 沒有驗收紀錄（最新的是 {sha}）。請派驗收，或用 git pm skip 補上理由。',
  'tool.pm.description': '擔任或卸任這個專案的 PM，或查看目前誰是 PM 和網頁看板的網址。claim 會附上 PM 的工作指示。',
  'tool.pm.action': 'claim：擔任 PM；release：卸任；status：目前的 PM、工作項目數和看板網址。',
  'tool.project': '專案資料夾的路徑（選填）。沒給時用這個工具連線的工作資料夾。',
  'tool.ledger.qaSha': '這次驗收的 commit（選填）。沒給時用專案目前的 HEAD。',
  'tool.ledger.commit': '把這個 commit 記到工作項目上（update 時，選填），push 前的檢查用它找對應的工作項目。',
  'tool.report.actor': '這個 Session 的 id（選填）。hook 給過 Session id 時帶上，看板才對得起來。',
  'tool.report.item': '這份回報對應的工作項目 id（選填）。有給又帶 commit 時，commit 會記到該項目。',
  'tool.report.title': '這個 Session 在看板上的名稱（選填）。',
  'hook.actorHint': '呼叫 report 時，actor 填 {actor}。',
  'cli.usage': `用法：project-pm <指令>

  mcp                         MCP server（stdio），各 AI 工具的 MCP 設定都寫這個
  serve                       網頁看板和 Streamable HTTP 的 MCP（只綁 127.0.0.1）
  open                        需要時啟動 serve，在瀏覽器打開看板
  board [--all] [--done] [--json] 在終端機印出文字看板（--json：同一份 JSON）
  init [--yes] [--ci]         設定 Claude Code（預設只列出要改的內容）
  uninstall [--yes] [--hooks] 還原 init 改過的每個檔
  hook claude-code <事件>     給 Claude Code 的 hook 呼叫
  check pre-push              給 git 的 pre-push hook 呼叫
  skip "<理由>"               明確略過這次 push 的驗收，理由會記在看板上
  --version                   版本`,
  'cli.unknown': '不認得的指令：{command}',
  'cli.skipNeedsReason': '請寫理由，例如：git pm skip "只改說明文字"',
  'push.blocked': `✋ 這次 push 先擋下來了（Project PM）

還沒驗收的改動：
{lines}

為什麼要擋：沒有檢查過就上傳，壞掉的程式可能直接影響使用的人。

接下來可以：
  1. 請 AI 驗收：{ask}，通過後再 push 一次。
  2. 這次確定不用驗收（例如只改說明文字）：
       git pm skip "只改說明文字"
     然後再 push。理由會記在看板上。`,
  'push.askItem': '對 PM 說「驗收 {code}」',
  'push.askNone': '對 PM 說「把剛才的改動登記成工作項目並驗收」',
  'push.lineItem': '  • {code}「{text}」：{n} 個 commit，最新的是 {sha}',
  'push.lineNone': '  • 沒有對應的工作項目：{n} 個 commit，最新的是 {sha}',
  'push.unregistered': '未登記的 push：{branch}（{sha}）',
  'push.checkFailed': 'Project PM 這次沒辦法檢查（{reason}），先讓 push 通過。看板之後會標出沒驗收的 commit。',
  'push.gitFailed': 'git 沒辦法列出 {ref} 要上傳的 commit',
  'push.notChecked': 'Project PM 這次沒辦法完整檢查（{reason}），先讓 push 通過。看板會把這件事列在「需要處理」，請確認這次上傳的改動有沒有驗收。',
  'board.pushNotChecked': '[push 時沒檢查到] {when} 的 push，Project PM 沒辦法檢查（{reason}），改動直接上傳了。請確認它們有沒有驗收。',
  'skip.recorded': '已記錄：{code} 在 {sha} 略過驗收，理由「{reason}」。現在可以 push 了，看板上會顯示這筆略過。',
  'skip.recordedNew': '已記錄：新增 {code}（未登記的 push），在 {sha} 略過驗收，理由「{reason}」。現在可以 push 了，看板上會顯示這筆略過。',
  'agents.section': `## Project PM

這個專案由 Project PM 管理交辦和驗收。在這個專案工作的每個 AI 工具都請照做：

- 完成、暫停、卡住或需要使用者決定時，用 project-pm 的 \`report\` 工具回報（Claude Code 裡叫 \`{tool}\`），附一句摘要。沒有這個工具時，在最後的摘要寫一行「交付狀態：完成／進行中／卡住」。
- 程式改完要先驗收才能 push。push 前會檢查每個 commit 有沒有驗收紀錄，沒有就擋下：請 PM 派驗收，通過後再 push。
- 確定不需要驗收時（例如只改說明文字），請使用者執行 \`git pm skip "<理由>"\`，理由會記在看板上。不要用 \`git push --no-verify\` 繞過檢查。
- 細節見 Skill \`project-pm\`。`,
  'agents.short': 'Project PM：完成或卡住時用 project-pm 的 `report` 工具回報；push 前要先驗收，略過用 `git pm skip "<理由>"`；細節見 Skill `project-pm`。',
  'skill.description': '在有 Project PM 的專案裡怎麼工作：回報狀態、push 前先驗收、必要時明確略過驗收。',
  'skill.body': `# Project PM

## 回報
- 完成、暫停、卡住、等使用者決定、等 CI、等發版時，呼叫 project-pm 的 \`report\` 工具（Claude Code 裡叫 \`{tool}\`）：status 填狀態，summary 寫一句白話摘要。
- 有 commit 時帶上 commit；知道對應的工作項目時帶上 item，push 前的檢查才找得到它。
- 沒有這個工具時，在最後的摘要寫一行「交付狀態：完成／進行中／卡住」。

## 驗收
- 結案前要有驗收：由不是負責人的 Session 或 Agent 檢查，結果用 \`ledger\` 的 update 記下（qa、qa_by、qa_note）。
- 驗收紀錄記的是當時的 commit。驗收之後又改了程式，要再驗收一次。

## push
- push 前，git 的 pre-push hook 會檢查每個要上傳的 commit 有沒有驗收紀錄，沒有就擋下並列出對應的工作項目。
- 確定不用驗收時，請使用者執行 \`git pm skip "<理由>"\`，再 push 一次。理由會記在看板上。
- 不要用 \`git push --no-verify\`。它會跳過檢查，看板之後仍會標出「push 時跳過了檢查」。`,
  'init.heading': 'Project PM 的設定：專案「{project}」（{path}）\n\n會做的改動：',
  'init.copy': '• 複製執行檔到 {file}（各設定都寫這個路徑，等於釘選版本）',
  'init.mcp': '• Claude Code 加入 MCP server：{command}',
  'init.text': '• {file} 加入這一段：\n{lines}',
  'init.whole': '• 建立 {file}',
  'init.hooks': '• {file}：在 {events} 事件呼叫 {command}',
  'init.prepush': '• git 的 pre-push hook：{file}（已有的 hook 改名為 pre-push.local，兩個都會跑）',
  'init.alias': '• 這個專案的 git alias pm：{value}（讓 git pm skip 在任何終端機都能用）',
  'init.noClaude': '找不到 claude 指令，沒有加入 Claude Code 的 MCP 設定。裝好 Claude Code 後再執行一次 init。',
  'init.modInstalled': '這台電腦裝了 Project PM 的桌面版 mod，它已經提供同名的工具和 hook；為了不重複，init 不加 MCP 設定和 Claude Code 的 hook。',
  'init.mcpTaken': 'Claude Code 已經有一個不是 init 加的 project-pm MCP 設定，init 不改它。要換成這一版，先執行 claude mcp remove --scope user project-pm 再跑一次 init。',
  'init.agentsLong': 'AGENTS.md 這一串檔案已經接近 28 KiB（有些工具只讀 32 KiB），段落改用一行的精簡版，細節放在 Skill。',
  'init.skillTaken': '{file} 已經有別的內容，init 不覆蓋。',
  'init.gitignoreHint': '這個專案裡有 .project-pm/ 資料夾，但 .gitignore 沒有排除它，下次 commit 可能把它一起上傳。Project PM 的資料不放在這裡；如果裡面有交辦內容或真實資料，請在 .gitignore 加一行 .project-pm/（init 不會幫你改）。',
  'init.aliasTaken': '這個專案已經有別的 git alias pm（{value}），init 不覆蓋。要略過驗收時請改打：{command}',
  'init.ciTaken': '{file} 已經有別的內容，init 不覆蓋。',
  'init.dryRun': '\n以上只是列出，沒有改任何檔。確認沒問題後執行：project-pm init --yes',
  'init.done': '\n完成，改了 {n} 項。每一項都記在 install-log.json，執行 project-pm uninstall --yes 可以全部還原。',
  'init.partly': '\n改了 {n} 項，但下面這些沒有成功：\n{failed}',
  'init.mcpFailed': 'claude mcp add 沒有成功',
  'init.mcpNotListed': 'claude mcp list 看不到 project-pm，已經撤回 MCP 設定。',
  'uninstall.nothing': '沒有 init 的紀錄，沒有東西要還原。',
  'uninstall.item': '• 還原：{what}',
  'uninstall.dryRun': '\n以上只是列出，沒有改任何檔。確認沒問題後執行：project-pm uninstall --yes',
  'uninstall.done': '\n完成，還原了 {n} 項。',
  'uninstall.failed': '沒能還原：{what}（{reason}）。這一項還留在紀錄裡，之後再執行一次 uninstall --yes 會再試。',
  'uninstall.failedFile': '沒能還原：{what}（{reason}）。這一項還留在紀錄裡：關掉正在使用 {file} 的程式後，再執行一次 uninstall --yes，或手動刪除它。',
  'uninstall.deleteLater': '{file} 就是現在執行中的程式，Windows 不讓它刪掉自己；這個指令結束後會自動刪除。如果一分鐘內還刪不掉，會打開一份說明告訴你。',
  'uninstall.deleteFailed': 'Project PM 解除安裝後，試了一分鐘還是沒能刪除這個檔案，因為它還在被使用：\r\n\r\n{file}\r\n\r\n請關掉正在使用它的程式（例如還開著的 AI 工具），再手動刪除這個檔案。\r\n',
  'ci.name': 'Project PM 品質檢查',
  'ci.summaryTitle': '## Project PM 品質檢查',
  'ci.summaryHead': '| 項目 | 結果 | 發生什麼事 | 為什麼重要 | 怎麼修 |',
  'ci.pass': '✅ 通過',
  'ci.fail': '❌ 沒通過',
  'ci.skip': '⏭️ 略過',
  'ci.tests.step': '自動測試',
  'ci.tests.passed': '自動測試都通過了。',
  'ci.tests.failed': '自動測試有沒通過的。',
  'ci.tests.none': '這個專案還沒有自動測試。',
  'ci.tests.why': '自動測試在每次改動後確認原本能用的功能沒有壞掉。',
  'ci.tests.fix': '打開這一步的紀錄，把錯誤訊息貼給 AI，請它修好並補上測試。',
  'ci.tests.fixNone': '請 AI 為主要功能加上自動測試。',
  'ci.secrets.step': '密碼和金鑰掃描',
  'ci.secrets.passed': '沒有找到像是密碼或金鑰的東西。',
  'ci.secrets.failed': '找到像是密碼或金鑰的東西，位置標在這次執行的錯誤裡。',
  'ci.secrets.hit': '這一行有像是密碼或金鑰的東西。',
  'ci.secrets.why': '金鑰外流後，別人可以用你的帳號、花你的錢。',
  'ci.secrets.fix': '請到該服務把這把金鑰作廢、換新的，並改成從環境變數讀取；只刪掉這一行不夠，舊的還在 git 歷史裡。',
  'ci.terms.step': '不能公開的詞',
  'ci.terms.passed': '沒有找到不能公開的詞。',
  'ci.terms.failed': '有 %s 行出現你列為不能公開的詞（詞本身不顯示）。',
  'ci.terms.hit': '這一行有你列為不能公開的詞（詞本身不顯示）。請把它換成假資料。',
  'ci.terms.none': '沒有設定不能公開的詞（repo 的 Settings → Secrets and variables → Actions 新增 BLOCKED_TERMS，一行一個詞）。',
  'ci.terms.why': '真實的姓名、地址、帳號一旦公開就收不回來。',
  'ci.terms.fix': '把那幾行的真實資料換成假資料（例如 Acme）。',
  'ci.deps.step': '套件安全檢查',
  'ci.deps.passed': '沒有找到高風險的已知漏洞。',
  'ci.deps.failed': '有用到的套件帶有高風險的已知漏洞。',
  'ci.deps.hit': '套件 %s %s 有已知的高風險安全漏洞（%s）。請 AI 把它升到修好的版本並跑測試。',
  'ci.deps.low': '另有 %s 個中低風險的漏洞，不擋，列出供參考：%s',
  'ci.deps.none': '沒有找到套件清單（lockfile），這一步略過。',
  'ci.deps.why': '有漏洞的套件可能讓別人入侵你的程式或偷走資料。',
  'ci.deps.fix': '請 AI 執行套件升級（例如 npm audit fix、更新 requirements.txt），再跑一次測試。',
} as const

type CoreKey = keyof typeof zhTW

const en: Record<CoreKey, string> = {
  'error.notGit': 'This folder ({path}) is not in a git repository, so it has no ledger. Use Project PM in the project\'s git folder, or run git init first.',
  'error.cannotWrite': 'Project PM could not write its data file ({reason}); nothing from this call was saved.',
  'error.corrupt': 'Project PM cannot read its data file {file} ({reason}). The file was left as it is; back it up, then fix or delete it.',
  'error.unknownTool': 'There is no tool named {name}.',
  'report.noPmYet': 'Recorded: {status}. This project has no PM yet; the PM will see this report on the board once there is one.',
  'report.recorded': 'Reported to the PM: {status}.',
  'report.recordedDetail': 'Reported to the PM: {status}. The full account is saved at {path}; a message to the PM only needs that path.',
  'report.itemMissing': '(There is no work item with id {id}; the commit was not recorded on one.)',
  'pm.claimed': 'This session ({actor}) is now the PM of "{project}".',
  'pm.tookOver': 'This session ({actor}) took over as the PM of "{project}" (from {before}).',
  'pm.notPm': 'This session ({actor}) is not the PM of "{project}" (the PM is {pm}).',
  'pm.released': 'This session is no longer the PM of "{project}"; the work items stay for the next PM.',
  'pm.status': 'Project "{project}" ({path})\nPM: {pm}\nWork items: {open} open of {total}\nBoard: {url}',
  'pm.nobody': '(nobody)',
  'pm.noBoardUrl': 'the web board is not running (run git pm open in the project folder)',
  'pm.badAction': 'action must be claim, release or status.',
  'board.noSessionsRead': '(The session records could not be read: {error}; the ledger is listed as usual.)',
  'board.ciChecking': '(Still asking GitHub about CI; look at the board again shortly.)',
  'board.noPush': '[pushed without the check] {n} commit(s) on the remote {branch} have no QA record (the latest is {sha}). Send them to QA, or give a reason with git pm skip.',
  'tool.pm.description': 'Become or stop being this project\'s PM, or see who the PM is and the web board\'s address. claim also returns the PM\'s instructions.',
  'tool.pm.action': 'claim: become the PM; release: step down; status: the current PM, the work item count and the board\'s address.',
  'tool.project': 'The project folder (optional). Without it, the folder this connection works in.',
  'tool.ledger.qaSha': 'The commit this verdict checked (optional). Without it, the project\'s HEAD.',
  'tool.ledger.commit': 'Record this commit on the work item (on update, optional); the pre-push check finds the item by it.',
  'tool.report.actor': 'This session\'s id (optional). Give it when a hook gave you a session id, so the board can match the two.',
  'tool.report.item': 'The work item this report is about (optional). With a commit, the commit is recorded on that item.',
  'tool.report.title': 'This session\'s name on the board (optional).',
  'hook.actorHint': 'When you call report, set actor to {actor}.',
  'cli.usage': `Usage: project-pm <command>

  mcp                         MCP server (stdio): every AI tool's MCP settings run this
  serve                       The web board and Streamable HTTP MCP (127.0.0.1 only)
  open                        Start serve when needed and open the board in the browser
  board [--all] [--done] [--json] Print the text board in the terminal (--json: the same as JSON)
  init [--yes] [--ci]         Set up Claude Code (by default only lists what would change)
  uninstall [--yes] [--hooks] Undo every file init changed
  hook claude-code <event>    Called by Claude Code's hooks
  check pre-push              Called by git's pre-push hook
  skip "<reason>"             Skip QA for this push on purpose; the reason shows on the board
  --version                   The version`,
  'cli.unknown': 'Unknown command: {command}',
  'cli.skipNeedsReason': 'Give a reason, for example: git pm skip "docs only"',
  'push.blocked': `✋ This push is on hold (Project PM)

Changes nobody has checked yet:
{lines}

Why: uploading work nobody checked can put broken code in front of the people who use it.

What you can do:
  1. Ask the AI to check it: {ask}, then push again once it passes.
  2. This change needs no check (say, only the docs changed):
       git pm skip "docs only"
     then push again. The reason shows on the board.`,
  'push.askItem': 'tell the PM "QA {code}"',
  'push.askNone': 'tell the PM "put the latest changes on the work list and QA them"',
  'push.lineItem': '  • {code} "{text}": {n} commit(s), the latest is {sha}',
  'push.lineNone': '  • No work item: {n} commit(s), the latest is {sha}',
  'push.unregistered': 'Unregistered push: {branch} ({sha})',
  'push.checkFailed': 'Project PM could not check this push ({reason}), so it goes through. The board will name any commit nobody checked.',
  'push.gitFailed': 'git could not list the commits {ref} would push',
  'push.notChecked': 'Project PM could not fully check this push ({reason}), so it goes through. The board lists it under Needs attention: make sure what was pushed got checked.',
  'board.pushNotChecked': '[push not checked] Project PM could not check the push of {when} ({reason}); the changes went up as they were. Make sure they got checked.',
  'skip.recorded': 'Recorded: {code} skips QA at {sha}, because "{reason}". You can push now; the board shows the skip.',
  'skip.recordedNew': 'Recorded: added {code} (an unregistered push), skipping QA at {sha}, because "{reason}". You can push now; the board shows the skip.',
  'agents.section': `## Project PM

Project PM keeps this project's work list and its QA. Every AI tool working in this project:

- Reports when it finishes, pauses, gets stuck or needs the person to decide, with project-pm's \`report\` tool (\`{tool}\` in Claude Code) and a one-line summary. Without the tool, ends its summary with a line "Delivery: done / in progress / stuck".
- Gets changes checked before they are pushed. Before a push, every commit needs a QA record or the push is stopped: ask the PM for QA, then push again once it passes.
- When a change needs no check (say, only the docs changed), asks the person to run \`git pm skip "<reason>"\`; the reason shows on the board. Never goes around the check with \`git push --no-verify\`.
- More in the \`project-pm\` skill.`,
  'agents.short': 'Project PM: report with project-pm\'s `report` tool when done or stuck; get changes checked before a push, or skip with `git pm skip "<reason>"`; more in the `project-pm` skill.',
  'skill.description': 'How to work in a project with Project PM: report where the work stands, get changes checked before a push, and skip the check on purpose when it is not needed.',
  'skill.body': `# Project PM

## Reporting
- When you finish, pause, get stuck, wait for the person, for CI or for a release, call project-pm's \`report\` tool (\`{tool}\` in Claude Code): status says which, summary says it in one plain sentence.
- Give the commit when there is one, and the item when you know the work item, so the pre-push check finds it.
- Without the tool, end your summary with a line "Delivery: done / in progress / stuck".

## QA
- Work is checked before it closes, by a session or agent that is not its owner; the verdict goes in with \`ledger\` update (qa, qa_by, qa_note).
- The verdict records the commit it checked. Change the code after it, and it needs checking again.

## Pushing
- Before a push, git's pre-push hook checks that every commit going out has a QA record; it stops the push otherwise and names the work items.
- When a change needs no check, ask the person to run \`git pm skip "<reason>"\`, then push again. The reason shows on the board.
- Never use \`git push --no-verify\`. It skips the check, and the board names the push as "pushed without the check" anyway.`,
  'init.heading': 'Project PM setup for "{project}" ({path})\n\nWhat would change:',
  'init.copy': '• Copy the program to {file} (every setting points at it, which pins this version)',
  'init.mcp': '• Add the MCP server to Claude Code: {command}',
  'init.text': '• Add this section to {file}:\n{lines}',
  'init.whole': '• Create {file}',
  'init.hooks': '• {file}: on {events}, run {command}',
  'init.prepush': '• git\'s pre-push hook: {file} (a hook already there becomes pre-push.local, and both run)',
  'init.alias': '• This project\'s git alias pm: {value} (so git pm skip works in any terminal)',
  'init.noClaude': 'The claude command was not found, so Claude Code\'s MCP settings were left alone. Install Claude Code, then run init again.',
  'init.modInstalled': 'Project PM\'s desktop mod is installed here and already serves the same tools and hooks; to avoid running both, init adds neither the MCP server nor Claude Code\'s hooks.',
  'init.mcpTaken': 'Claude Code already has a project-pm MCP server that init did not add, and init leaves it alone. To switch to this version, run claude mcp remove --scope user project-pm, then init again.',
  'init.agentsLong': 'The AGENTS.md files are close to 28 KiB together (some tools read 32 KiB at most), so the section is the one-line version and the details live in the skill.',
  'init.skillTaken': '{file} holds something else; init leaves it alone.',
  'init.gitignoreHint': 'This project has a .project-pm/ folder that .gitignore does not leave out, so a commit may upload it. Project PM keeps nothing there; if it holds work notes or real data, add a line .project-pm/ to .gitignore (init does not change it for you).',
  'init.aliasTaken': 'This project already has another git alias pm ({value}); init leaves it alone. To skip QA, type this instead: {command}',
  'init.ciTaken': '{file} holds something else; init leaves it alone.',
  'init.dryRun': '\nNothing was changed; this is only the list. When it looks right, run: project-pm init --yes',
  'init.done': '\nDone: {n} change(s). Each is recorded in install-log.json; project-pm uninstall --yes undoes them all.',
  'init.partly': '\n{n} change(s) made, but these did not work:\n{failed}',
  'init.mcpFailed': 'claude mcp add did not work',
  'init.mcpNotListed': 'claude mcp list does not show project-pm, so the MCP setting was taken back out.',
  'uninstall.nothing': 'There is no record of init, so there is nothing to undo.',
  'uninstall.item': '• Undo: {what}',
  'uninstall.dryRun': '\nNothing was changed; this is only the list. When it looks right, run: project-pm uninstall --yes',
  'uninstall.done': '\nDone: {n} change(s) undone.',
  'uninstall.failed': 'Could not undo: {what} ({reason}). It stays in the record; running uninstall --yes again tries it again.',
  'uninstall.failedFile': 'Could not undo: {what} ({reason}). It stays in the record: close whatever is using {file}, then run uninstall --yes again, or delete it by hand.',
  'uninstall.deleteLater': '{file} is the program running now, and Windows does not let it delete itself; it will be deleted once this command ends. If that still fails after a minute, a note will open to tell you.',
  'uninstall.deleteFailed': 'After uninstalling Project PM, this file still could not be deleted after a minute of trying, because something is still using it:\r\n\r\n{file}\r\n\r\nClose whatever is using it (an AI tool still open, say), then delete the file by hand.\r\n',
  'ci.name': 'Project PM QA',
  'ci.summaryTitle': '## Project PM QA',
  'ci.summaryHead': '| Check | Result | What happened | Why it matters | How to fix it |',
  'ci.pass': '✅ Passed',
  'ci.fail': '❌ Failed',
  'ci.skip': '⏭️ Skipped',
  'ci.tests.step': 'Automated tests',
  'ci.tests.passed': 'Every automated test passed.',
  'ci.tests.failed': 'Some automated tests failed.',
  'ci.tests.none': 'This project has no automated tests yet.',
  'ci.tests.why': 'Automated tests check, after every change, that what worked before still works.',
  'ci.tests.fix': 'Open this step\'s log, paste the error to the AI, and ask it to fix the code and add a test.',
  'ci.tests.fixNone': 'Ask the AI to add automated tests for the main features.',
  'ci.secrets.step': 'Passwords and keys',
  'ci.secrets.passed': 'Nothing that looks like a password or a key.',
  'ci.secrets.failed': 'Something that looks like a password or a key was found; the errors of this run say where.',
  'ci.secrets.hit': 'This line holds something that looks like a password or a key.',
  'ci.secrets.why': 'With a leaked key, others can use your account and spend your money.',
  'ci.secrets.fix': 'Revoke the key at its service, make a new one, and read it from an environment variable; deleting the line is not enough, since the old key stays in the git history.',
  'ci.terms.step': 'Words that must stay private',
  'ci.terms.passed': 'None of the private words was found.',
  'ci.terms.failed': '%s line(s) hold a word you listed as private (the word itself is not shown).',
  'ci.terms.hit': 'This line holds a word you listed as private (not shown). Replace it with made-up data.',
  'ci.terms.none': 'No private words are set (add BLOCKED_TERMS under the repository\'s Settings → Secrets and variables → Actions, one word per line).',
  'ci.terms.why': 'Real names, addresses and accounts cannot be taken back once they are public.',
  'ci.terms.fix': 'Replace the real data on those lines with made-up data (Acme, say).',
  'ci.deps.step': 'Package security',
  'ci.deps.passed': 'No known high-risk vulnerability in the packages.',
  'ci.deps.failed': 'A package in use has a known high-risk vulnerability.',
  'ci.deps.hit': 'The package %s %s has a known high-risk vulnerability (%s). Ask the AI to upgrade it to a fixed version and run the tests.',
  'ci.deps.low': '%s more of medium or low risk, not blocking, listed for reference: %s',
  'ci.deps.none': 'No package list (lockfile) was found, so this step was skipped.',
  'ci.deps.why': 'A vulnerable package can let others break into your program or take its data.',
  'ci.deps.fix': 'Ask the AI to upgrade the packages (npm audit fix, or newer versions in requirements.txt), then run the tests again.',
}

const CORE: Record<Lang, Record<CoreKey, string>> = { 'zh-TW': zhTW, en }

/** A core message in the language set for both the core and the mod's shared words. */
export function ct(key: CoreKey, params: Record<string, string | number> = {}): string {
  return CORE[getLang()][key].replace(/\{(\w+)\}/g, (whole, name: string) => (params[name] === undefined ? whole : String(params[name])))
}

/** The language: PROJECT_PM_LANG (en, zh-TW) when it names one, else the system's (any Chinese reads Traditional Chinese). */
export function initLang(env: NodeJS.ProcessEnv = process.env): Lang {
  const lang = resolveLang(env.PROJECT_PM_LANG, systemLocale())
  setLang(lang)

  return lang
}

export { getLang, setLang }
export type { Lang, CoreKey }
export const CORE_MESSAGES = CORE
