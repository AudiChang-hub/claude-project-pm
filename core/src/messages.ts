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
  'pm.noBoardUrl': '網頁看板沒有在執行（執行 project-pm open 打開）',
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
  'hook.delivery': '「{project}」有 PM 在追蹤各 Session 的狀態。完成、暫停或卡住一項工作時，呼叫 project-pm 的 report 工具回報一次（status、一句話的 summary；有 commit 就填 commit，CI 還在跑就填 ci）。完整說明寫進 detail。{actor}',
  'hook.actorHint': '呼叫 report 時，actor 填 {actor}。',
  'hook.guidelines': '這個專案的開發準則（{file}）：\n{text}',
  'hook.guidelinesClipped': '（準則超過 {max} 字，已截短；完整內容請讀 {file}）',
  'hook.guidelinesError': '讀不到開發準則 {file}：{reason}',
  'cli.usage': `用法：project-pm <指令>

  mcp                         MCP server（stdio），各 AI 工具的 MCP 設定都寫這個
  serve                       網頁看板和 Streamable HTTP 的 MCP（只綁 127.0.0.1）
  open                        需要時啟動 serve，在瀏覽器打開看板
  board [--all] [--done]      在終端機印出文字看板
  init [--yes] [--ci]         設定 Claude Code（預設只列出要改的內容）
  uninstall [--yes] [--hooks] 還原 init 改過的每個檔
  hook claude-code <事件>     給 Claude Code 的 hook 呼叫
  check pre-push              給 git 的 pre-push hook 呼叫
  skip "<理由>"               明確略過這次 push 的驗收，理由會記在看板上
  --version                   版本`,
  'cli.unknown': '不認得的指令：{command}',
  'cli.skipNeedsReason': '請寫理由，例如：git pm skip "只改說明文字"',
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
  'pm.noBoardUrl': 'the web board is not running (run project-pm open)',
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
  'hook.delivery': '"{project}" has a PM following each session. When you finish, pause or get stuck on a piece of work, call project-pm\'s report tool once (status, a one-sentence summary; the commit when you committed, ci while CI still runs). Put the full account in detail. {actor}',
  'hook.actorHint': 'When you call report, set actor to {actor}.',
  'hook.guidelines': 'This project\'s development guidelines ({file}):\n{text}',
  'hook.guidelinesClipped': '(The guidelines run past {max} characters and were clipped; read {file} for all of them.)',
  'hook.guidelinesError': 'The development guidelines {file} could not be read: {reason}',
  'cli.usage': `Usage: project-pm <command>

  mcp                         MCP server (stdio): every AI tool's MCP settings run this
  serve                       The web board and Streamable HTTP MCP (127.0.0.1 only)
  open                        Start serve when needed and open the board in the browser
  board [--all] [--done]      Print the text board in the terminal
  init [--yes] [--ci]         Set up Claude Code (by default only lists what would change)
  uninstall [--yes] [--hooks] Undo every file init changed
  hook claude-code <event>    Called by Claude Code's hooks
  check pre-push              Called by git's pre-push hook
  skip "<reason>"             Skip QA for this push on purpose; the reason shows on the board
  --version                   The version`,
  'cli.unknown': 'Unknown command: {command}',
  'cli.skipNeedsReason': 'Give a reason, for example: git pm skip "docs only"',
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
