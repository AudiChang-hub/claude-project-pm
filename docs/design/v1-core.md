# 設計：v1.0 跨平台核心 pm-core（T-34）

狀態：草案，等使用者決定第 9 節的取捨。這份文件不改任何現有程式。

背景：使用者選定 A 案，核心做成 MCP server，各平台用轉接層接上。目標使用者是不熟軟體工程的 Vibe Coder，要讓他們做出的軟體在品質、測試、安全上有一定水準，而且不限 Claude 桌面版。

依據：

- 第 0 步實測：[v1-cli-check.md](v1-cli-check.md)。現在的 mod 在 Claude Code CLI 能載入，ledger、QA 關卡、Agent 派工都能跑；失效的是「我是誰」和「有哪些 Session」，因為這兩件事只有桌面版的 `ccd_session_mgmt` 能回答。
- 跨平台查證報告：`~/.claude/project-pm/reports/agents/a226af2b1f31b0f10.md`（7 個平台、13 種形態，附官方來源）。下文引用它的來源代號，例如 [C3]、[X2]，網址列在第 10 節。
- 現有設計：[qa.md](qa.md)（QA 關卡，第 8 節已把核心和桌面版接線分開）、[agents.md](agents.md)（Agent 派工）。

## 摘要

| 問題 | 做法 |
| --- | --- |
| 核心是什麼 | 一個 Node 程式 `project-pm`，同時是 MCP server（stdio＋Streamable HTTP，不用 SSE）、網頁看板、git hook 和 CI 用的檢查指令 |
| 搬進核心的 | 交辦清單（ledger）、QA 關卡、交付判斷、CI 查詢、文字看板、網頁看板、Session 回報紀錄、Agent 紀錄 |
| 留在轉接層的 | 「我是誰」、Session 清單、面板、把說明塞進提示、改寫 Agent 呼叫、截短通知（各平台的 hook 才做得到） |
| 資料放哪 | 使用者層級 `~/.project-pm/`，不進 git；專案資料夾只放不含個資的設定和 AGENTS.md 段落 |
| 舊資料 | 先擴充、後收斂：核心讀新舊兩處，過渡期同時寫回舊檔，桌面版 mod 不用同時改 |
| 硬關卡在哪 | 在 git 和 CI，不在 AI 工具的 hook：pre-push 沒有 QA 通過就擋（可明確略過並留下紀錄），CI 跑測試、secret 掃描、真實資料掃描、套件安全檢查 |
| 分版 | ① Claude Code CLI＋核心＋網頁看板＋hook 和 CI 範本；② Codex、Copilot、Antigravity；③ Cursor、Devin |

## 1. 架構

### 1.1 全貌

```
            ┌──────────── 各 AI 工具（桌面或 CLI）────────────┐
            │  AGENTS.md 段落   Skills   hooks   MCP client   │
            └──────┬──────────────┬────────────┬──────────────┘
                   │第 2 層        │第 3 層     │ MCP（stdio 或 Streamable HTTP）
                   │（AI 主動回報）│（hook 指令）│
                   ▼              ▼            ▼
   ┌─────────────────────────── project-pm（核心）────────────────────────────┐
   │ MCP 工具：board / ledger / report / pm                                    │
   │ 交辦清單＋QA 關卡＋交付判斷＋CI 查詢（git、gh）＋文字看板                 │
   │ 網頁看板（127.0.0.1，token）  hook 指令（project-pm hook …）  check 指令 │
   └───────────────┬───────────────────────────────────────┬───────────────────┘
                   │ 讀寫                                  │ 第 1 層：git 和 CI 事實
                   ▼                                       ▼
          ~/.project-pm/（資料）                  專案的 git、GitHub（gh）
                   ▲
                   │ 同一份資料
   ┌───────────────┴────────────┐       ┌──────────────────────────────┐
   │ Claude 桌面版 mod（轉接層） │       │ git pre-push hook、CI 範本    │
   │ 面板、Session 清單、第 4 層 │       │（不依賴任何 AI 工具的硬關卡）│
   └────────────────────────────┘       └──────────────────────────────┘
```

### 1.2 核心程式的形態

一個 npm 套件 `project-pm`，執行檔同名，子指令：

| 指令 | 用途 |
| --- | --- |
| `project-pm mcp` | MCP server，stdio。各工具的 MCP 設定都寫這個 |
| `project-pm serve` | Streamable HTTP 的 MCP（`/mcp`）＋網頁看板（`/`），只綁 127.0.0.1 |
| `project-pm open` | 需要時啟動 `serve`，在瀏覽器打開看板 |
| `project-pm board` | 在終端機印出文字看板（和 MCP 的 board 工具同一份文字） |
| `project-pm init` | 偵測已安裝的工具，寫入 MCP 設定、AGENTS.md 段落、Skills、hook、CI 範本（第 5 節） |
| `project-pm uninstall` | 依安裝紀錄還原 `init` 改過的每個檔 |
| `project-pm hook <工具> <事件>` | 給各平台 hook 呼叫：從 stdin 讀事件 JSON，寫入 Session 回報（第 3 層） |
| `project-pm check pre-push` | git pre-push hook 呼叫（第 6 節） |
| `project-pm skip "<理由>"` | 明確略過這次 push 的 QA，理由記進交辦清單 |

為什麼 stdio 和 HTTP 都要：

- stdio：13 種形態都支援 [C1][X1][A1][V1][H1][U1][W1]，設定最簡單，Vibe Coder 不用管 port。
- Streamable HTTP：讓網頁看板和 MCP 共用一個常駐行程；也給不能啟動本機程式的形態（例如雲端 Session）留路。
- 不用 SSE：Antigravity CLI 明文不支援舊版 SSE，Codex 文件沒提 [A1][X1]。MCP 規格也已經用 Streamable HTTP 取代 2024-11-05 的 HTTP+SSE [M1]。另外，Streamable HTTP 本身允許伺服器選擇用 SSE 串流回應；核心不用：POST 一律回 `application/json`，GET 回 405（規格允許），工具都是一問一答，不需要串流。

實測補充：現在的 mod 用 `$.tool.register` 註冊的 board、ledger，引擎就是用本機 Streamable HTTP 的 MCP server 提供的（v1-cli-check.md 第 3 節）。換成獨立的 MCP server，模型看到的工具名稱和參數可以完全不變。

### 1.3 多個行程同時寫

每個 AI Session 會各自啟動一個 `project-pm mcp`（stdio），所以同一個專案的資料可能有好幾個行程同時寫。做法：

- 每個寫入都是「鎖定 → 重新讀 → 改 → 寫暫存檔 → rename」。鎖用 `<檔名>.lock`（建立時加 exclusive 旗標），超過 10 秒視為殘留鎖，可以清掉。
- 檔案有 `revision` 欄位，每寫一次加 1，方便看板判斷要不要重畫，也方便測試抓到遺失的更新。
- 過渡期舊版 mod 不會加鎖（1.4 節的雙寫），這段時間靠「寫之前重新讀、以工作項目為單位依 `updatedAt` 合併」降低覆蓋的機會。這是已知風險，列在第 8 節的驗證項目。

### 1.4 哪些邏輯搬進核心

#### 已經可以搬的範例：`hooks/qa.ts`

`qa.ts` 只 import 型別和 `messages.ts`，輸入輸出都是一般資料，「負責人是否已交付」由宿主傳入（qa.md 第 8 節）。v1 的做法就是把這個模式推廣到其他模組：判斷寫成純函式放進核心，讀寫和平台 API 由宿主（核心的 Node 層，或桌面版 mod）注入。

`messages.ts`（中英文字串，純資料）和 `agents.ts`（大多是純函式）也直接搬。

#### `hooks/actions.ts` 逐項

`actions.ts` 幾乎每個函式都拿 `$`（Claude Code 引擎）當參數，所以「搬」的意思是：判斷搬進核心，讀寫改用 Node 的 `fs` 和 `child_process` 重寫；桌面版專屬的留在 mod。

| 項目（行號） | 去向 | 說明 |
| --- | --- | --- |
| atom 狀態 `me`、`sessions`、`tracks`、`lastWords`、`ciChecks`、`pushChecks`、`projects`、`agents`、`confirm`、`busy`、`notice`、`isBandHidden`、`scope`（61-73） | 桌面版 | 引擎的 atom 是給面板重畫用的。核心改用自己的記憶體快取＋檔案 |
| `MGMT`、`STARTER`、`PANE`、`POLL_MS`、`STUCK_MS`（75-80） | 桌面版 | `ccd_session_mgmt`、`ccd_session`、面板 id、輪詢 |
| `GIT_TIMEOUT_MS`、`GH_TIMEOUT_MS`、`CI_RECHECK_MS`、`CI_CHECKS_PER_ROUND`（82-90） | 核心 | CI 查詢的參數。核心另加「整次 board 呼叫 10 秒內回」的上限（Codex 的 MCP 工具預設 60 秒逾時 [X1]） |
| `textOf`、`reason`、`sameJson`、`str`（96、103、348、1221） | 核心 | 小工具 |
| `dataDir`、`readJson`、`loadProject`、`saveProject`（109-135） | 核心（重寫） | 改成 `~/.project-pm/`，加鎖、revision、讀舊路徑（第 2 節） |
| `getMine`、`saveMine`、`changeMine`、`loadMine`（139-190） | 拆開 | 「一個 Session 的紀錄」這個概念搬進核心（`actors/<id>.json`）；誰來寫、何時寫由轉接層決定 |
| `INBOX_VERSION`、`UPDATE_MARK`、`updateOf`、`notifyPm`（192-248） | 桌面版 | `$.session.send` / `session.receive` 是引擎功能。核心不需要：大家寫同一份資料，看板直接讀 |
| `REPORT_TOOL`、`registerReportTool`、`report`（250-303） | 核心 | 變成核心的 `report` 工具。修掉 CLI 實測的假成功：沒有身分或寫不進去時回錯誤 |
| `isReporter`、`deliveryAsk`（253、824） | 核心＋各平台 | 「誰該回報」的判斷搬進核心；把說明放進提示的方式各平台不同（桌面版用 `prompt.compose`，其他平台用 AGENTS.md 段落） |
| `identify`、`rememberTranscript`、`transcriptOwner`、`transcriptsFile`（305-385） | 桌面版 | 靠 `get_session`。核心的身分改由 MCP 連線和 hook 事件提供（1.5 節） |
| `readLastWord`、`readTracks`、`catchUp`（391-450） | 桌面版 | 靠 `list_events` 讀別的 Session 的最後一則訊息 |
| `run`（452） | 核心（重寫） | 執行 git、gh，改用 `child_process.execFile`，不經過 shell |
| `askRun`、`askCommit`、`askCommitOrNewer`、`askCi`、`checkCi`、`verifyCi`（471-616） | 核心 | 第 1 層的 CI 事實，只依賴 git、gh |
| `checkPush`、`verifyPushes`（618-651） | 核心 | 第 1 層的 push 事實 |
| `readProjects`、`announce`（655-716） | 拆開 | 讀專案檔進核心；`announce`（通知 PM）在桌面版用 `$.ui.toast` 和 Session 訊息，其他平台改成網頁看板上的提示 |
| `refresh`、`saveRound`、`loadRound`、`refreshSoon`（727-815） | 拆開 | 「一輪檢查」的流程進核心；`list_sessions` 那段留桌面版。`rounds/` 的快取是為了桌面版重啟後立刻畫面板，核心不需要 |
| `ROLE`（817） | 核心 | PM 的指示文字，由核心提供，各平台各自放進提示或 AGENTS.md |
| `ensureTools`（838） | 桌面版 | 引擎重載後補註冊工具，核心的 MCP server 沒有這個問題 |
| `isBoardWanted`、`closesBoard`、`rememberBoard`、`openBoard`、`ensureBoard`（869-915） | 桌面版 | 面板 |
| `AGENT_OWNER`、`agentRecords`、`keptAgents`、`mirrorAgents`、`changeAgents`（917-941） | 核心 | Agent 紀錄存在核心；誰新增、誰更新由轉接層呼叫 |
| `isPmCall`、`isGitRepo`、`agentCallInput`、`agentDetailPath`、`startAgent`、`takeNotices`（943-1055） | 轉接層（Claude Code） | 靠 `tool.call`、`agent.spawn`、`prompt.submit` 改寫 Agent 呼叫和通知。實測在 CLI 也能跑（v1-cli-check.md 第 6 節），所以是 Claude Code 轉接層，不限桌面版。其中的純判斷（要不要隔離、說明文字）在 `agents.ts`，搬進核心 |
| `checkAgents`（1057） | 拆開 | `$.agent.list`（哪些 Agent 還活著）留轉接層；「commit 已合併就算完成」的 git 判斷進核心 |
| `registerTools`（1098） | 核心 | 工具定義（名稱、參數說明）進核心，桌面版不再自己註冊（第 3 節最後） |
| `claim`、`release`（1136-1161） | 核心 | 變成 `pm` 工具。身分由 1.5 節提供 |
| `startPmSession`、`dismissBand`、`archive`（1163-1219） | 桌面版 | `start_session`、`archive_session`、提示列 |
| `board`（1225） | 核心 | 文字看板。Session 清單來源改成可替換（桌面版給 `list_sessions`，其他平台給核心的 actors） |
| `ownerBlocker`（1263） | 核心 | 結案前的負責人檢查，需要的 Session 狀態由同一個可替換的來源提供 |
| `ledger`（1306） | 核心 | 交辦清單工具，已經呼叫 `qaUpdate` |

#### `hooks/sessions.ts` 逐項

`sessions.ts` 幾乎都是純函式，大多可以直接搬。要改的是它吃的 `Session` 型別：現在是桌面版 `list_sessions` 的格式，核心改成一個通用的 `Actor`（第 2.3 節），桌面版的 `Session` 由 mod 轉成 `Actor`。

| 項目（行號） | 去向 | 說明 |
| --- | --- | --- |
| `Status`、`STATUS`、`isActive`、`LOOK`（9-46） | 核心 | 狀態分類和排序進核心；`LOOK` 裡的顏色是畫面用的，跟著網頁看板和桌面版面板 |
| `itemCode`、`clip`、`ago`、`tookText`、各長度常數（48、996、938、1113、955-960） | 核心 | 小工具 |
| 等待、CI 相關的字詞判斷：`WAITING`、`CI_PENDING`、`CI_PASSED`、`reportedText`、`isCiPending`、`ciWords`、`ciTargets`、`ciTarget`、`ciVerdict`、`betterCi`（64-320） | 核心 | 第 2 層（從文字判斷）和第 1 層（gh 結果）的交界，純函式 |
| `reportOf`、`reportWords`、`latestWords`、`quoteOf`、`settledAt`（177-249） | 核心 | 回報的解析和引用 |
| `isBehind`、`liveTracks`（322-342） | 桌面版 | 比對桌面版清單的活動時間和 Session 檔，是「Session 檔可能落後」的補救 |
| `CAVEAT`、`NOTHING_LEFT`、`caveatOf`（344、347、873） | 核心 | 「摘要承認還有事沒做」的判斷 |
| `projectPath`、`projectName`、`projectKey`、`keyFile`、`groupProjects`（352-401） | 核心 | 專案的識別。v1 另外用 `git rev-parse --git-common-dir` 把任何 worktree 對到同一個專案，舊的路徑規則保留給讀舊檔 |
| `isScratch`（358） | 拆開 | 判斷桌面版的臨時資料夾，是桌面版的規則；核心改成「不在 git repo 裡就不能有交辦清單」 |
| `hasReport`、`backgroundOf`、`openSteps`（403、421、425） | 核心 | 讀 actor 紀錄 |
| `finishedTasks`（408） | 轉接層（Claude Code） | 解析 Claude Code 的 task-notification |
| 交付判斷：`VERB` 到 `DISCLAIMER` 的字詞、`ownCommitOf`、`commitOf`、`undeliveredOf`、`declaredOf`、`leftOf`、`isUndelivered`、`deliveryText`（432-870） | 核心 | 交付判斷的主體，純函式 |
| `Git` 型別、`isPushedContent` 和它的輔助函式（728-862） | 核心 | 已經用注入的 `Git` 函式，不碰 `$`，原樣搬 |
| `statusOf`（893） | 核心 | 輸入從 `Session` 改成 `Actor` |
| `ledgerRow`、`ledgerText`、`isDeliveredStatus`、`isDeliveredAgent`（963-994） | 核心 | 交辦清單的文字和「已交付」的定義 |
| `parseSessions`、`parseLastWord`（1003-1045） | 桌面版 | 解析 `ccd_session_mgmt` 的輸出 |
| `applyPlan`（1052） | 桌面版 | 解析 `mcp__ccd_turn__update_plan` |
| `planFromTodos`（1080） | 轉接層（Claude Code） | 解析 TodoWrite |
| `BoardInput`、`boardText`、`shownAgents`、`agentTime`、`AGENT_SHOWN_MS`（1093-1301） | 核心 | 文字看板 |
| `emptyProject`（1303） | 核心 | 新專案檔 |

其他檔案：

| 檔案 | 去向 |
| --- | --- |
| `hooks/qa.ts`、`hooks/messages.ts` | 核心，原樣 |
| `hooks/agents.ts` | 核心；`noticesOf`、`shortNotices`（Claude Code 的通知格式）放 Claude Code 轉接層 |
| `hooks/guidelines.ts` | `guidelinesPath`、`isSameFile`、`asksForGuidelines` 進核心；讀檔改寫；「沒問過就不准改準則檔」的擋法靠各平台的 PreToolUse 類 hook |
| `hooks/update.ts` | 桌面版（Claude Code 外掛更新後自動重載） |
| `hooks/view.tsx` | 桌面版面板；網頁看板另寫，共用核心給的資料 |
| `hooks/register.tsx` | 轉接層（Claude Code） |
| `types/index.d.ts` | 核心型別（`LedgerItem`、`QaRecord`、`ProjectFile`、`Report`、`AgentRecord`）搬進核心；`Session`、`Me` 留桌面版 |

#### 程式碼放哪

建議同一個 repo 改成兩部分（第 9 節決定 D6）：

```
core/          核心（純函式＋Node 層＋MCP server＋網頁看板＋CLI）
hooks/         桌面版／Claude Code 轉接層（mod），用相對路徑 import ../core 的純函式
```

mod 現在就用相對路徑 import（`./qa`），所以 import `../core/...` 不需要打包工具；要確認的是外掛安裝時會不會把 `core/` 一起複製（第 8 節 ① 的驗證項目）。mod 不 import 核心的 Node 層，只 import 純函式，讀寫仍然走 `$.fs`。

### 1.5 「我是誰」：沒有桌面版之後的身分

這是 CLI 實測失效的根本原因，所以單獨寫。

- **工具**：MCP `initialize` 時 client 會送 `clientInfo.name`（例如 Claude Code、Codex），核心記下來。
- **Session**：
  - stdio：大多數工具每個 Session 啟動一個 MCP 行程，核心在行程啟動時產生一個 actor id（`<工具>:<短亂數>`），整個連線都用它。
  - Streamable HTTP：用 `Mcp-Session-Id`。
  - hook：Claude Code 的 hook 事件 JSON 帶 `session_id`、`cwd` [C3]，其他平台的 hook 也多半帶類似欄位（② ③ 開工時逐一查證）。hook 寫的回報用 `<工具>:<session_id>`。
  - 問題：stdio 行程的 actor id 和 hook 的 `session_id` 對不起來。有兩個辦法，① 要先查證：(a) 工具啟動 MCP 行程時是否有環境變數帶 Session id（這次在 Claude Code 的 Bash 環境裡看到 `CLAUDE_CODE_SESSION_ID`，MCP 子行程有沒有還沒驗證）；(b) 沒有的話，`report` 工具接受選填的 `actor` 參數，AGENTS.md 段落請 AI 帶上 hook 給的 id。兩個都做不到時，看板把同一個資料夾、時間相近的兩個 actor 當成同一個 Session 顯示，並標「可能重複」。
- **桌面版**：mod 繼續用 `get_session` 的 `local_…` id，並在呼叫核心時帶上，所以舊資料的負責人欄位不用改。
- **PM**：專案檔記 `pmId`。PM 是「這個專案現在誰當 PM」，不是權限。核心不靠 PM 身分擋任何操作；「Agent 只能讀 ledger」這類限制由知道誰是 Agent 的轉接層執行（現在就是 `register.tsx:414` 在做）。

## 2. 資料

### 2.1 存在哪裡

| 選項 | 共用 | 個資 | 多人協作 | 缺點 |
| --- | --- | --- | --- | --- |
| A. 使用者層級 `~/.project-pm/`（建議） | 同一台電腦的所有工具都讀得到 | 不進 git，不會外流 | 不支援 | 換電腦不會跟著走；刪掉專案資料夾不會一起刪 |
| B. 專案資料夾 `.project-pm/`，加進 `.gitignore` | 同上 | 不進 git，但 Vibe Coder 可能誤把 `.gitignore` 那行刪掉 | 不支援 | 每個 worktree 一份，要另外對到主 repo；刪專案資料夾就沒了 |
| C. 專案資料夾 `.project-pm/`，進 git | 換電腦、多人都看得到 | **風險高**：交辦文字常有客戶名稱、真實資料、內部網址，Vibe Coder 不會檢查 | 會衝突：兩個人同時改 `ledger.json` 一定合併衝突 | 歷史永遠留在 git |

建議 A，理由：

- 個資：交辦清單的內容是使用者對 AI 說的話，常常夾帶真實資料。這個專案自己就有 BLOCKED_TERMS 掃描，說明真實資料外流是實際風險；放進 git 等於把風險交給最不會處理的人。
- 共用：目標是「同一個人在同一台電腦換著用不同 AI 工具」，A 就夠了。
- 多人協作：v1 不做。之後若要做，建議同步到 GitHub Issues（有權限控制、不會合併衝突），而不是把檔案放進 git（第 9 節 D2）。

路徑可以用環境變數 `PROJECT_PM_HOME` 改（測試和 CI 需要）。

專案資料夾裡只放兩種東西，都不含個資：

- AGENTS.md 的 project-pm 段落（第 5 節），進 git。
- `.project-pm.json`（選填）：這個專案的品管設定，例如 pre-push 要不要擋、CI 要跑哪些檢查。只有設定，沒有交辦內容，可以進 git。

`init` 會檢查 `.gitignore`：若專案裡有 `.project-pm/` 資料夾（例如使用者自己建的），提醒加進 `.gitignore`；不會自動改使用者的 `.gitignore` 以外的東西。

### 2.2 檔案

```
~/.project-pm/
  projects/<專案名>-<hash>.json   交辦清單、PM、revision（一個專案一檔）
  actors/<actor id>.json          每個 Session 的回報、任務清單、最後狀態（一個 Session 一檔，只有它自己寫）
  reports/<actor id>/<時間>.md    回報的詳細內容
  reports/agents/<agentId>.md     Agent 的詳細內容
  server.json                     serve 的 port、pid、token（只有使用者本人可讀）
  install-log.json                init 改過哪些檔、原本內容的備份位置
```

`<hash>` 沿用現在 `keyFile` 的規則，所以新舊檔名一一對應。

### 2.3 格式變更（只擴充）

```ts
type ProjectFile = {
  // 原有：key, name, path, pmId, isDismissed, ledger, nextId
  schema?: 2          // 沒有這個欄位 = 舊格式
  revision?: number   // 每次寫入加 1
}

type LedgerItem = {
  // 原有欄位不變（含 v0.9.0 的 criteria、qa）
  commits?: string[]  // 這個項目的 commit（report、Agent 回報時記下），pre-push 用
}

type QaRecord = {
  // 原有：result, by, at, note
  sha?: string        // 驗收時的 commit；pre-push 比對用（第 6 節）
}

type Actor = {        // 取代桌面版的 Session 在核心裡的角色
  id: string          // local_…（桌面版）、claude-code:<id>、codex:<id>、agent:<id>
  tool: string        // 來自 clientInfo 或 hook
  title: string
  cwd: string
  lastSeenAt: number
  state?: 'running' | 'idle' | 'asking'   // 第 3、4 層才有
  // 以下沿用現在的 Track：plan, recap, ask, report, background, agents …
}
```

規則和 v0.9.0 的 QA 欄位一樣：都是選填，舊檔沒有就當沒有，寫回時不補不需要的欄位（開發準則第 7 條）。

### 2.4 從現有 mod 資料遷移：先擴充、後收斂

現有資料在 `~/.claude/project-pm/`（how-it-works.md「Data and privacy」）。

| 階段 | 核心 | 桌面版 mod | 可以回到上一階段嗎 |
| --- | --- | --- | --- |
| E1（v1.0） | 讀：新路徑優先，沒有就讀舊路徑。寫：新路徑，**同時寫回舊路徑的 `projects/*.json`**（只寫舊格式有的欄位以外照抄，多的欄位舊 mod 會忽略） | 不改，照舊讀寫舊路徑 | 可以：舊路徑一直是完整的，移除核心就回到 v0.9 |
| E2（v1.1） | 同 E1 | 改成透過核心的純函式讀寫新路徑，也照樣寫回舊路徑 | 可以：舊路徑仍完整 |
| C1（v1.2 以後，所有使用中的 mod 都已更新） | 停止寫回舊路徑；仍會讀舊路徑（給沒遷移到的專案） | 只讀寫新路徑 | 要回去得先把新路徑複製回舊路徑（`project-pm export --legacy`） |
| C2（再下一版） | 不再讀舊路徑；第一次啟動時若發現舊檔還有沒搬的專案，搬過去並在看板提示一次 | 同 C1 | 同 C1 |

細節：

- 舊路徑的 `sessions/<id>.json`、`rounds/`、`transcripts.json` 是桌面版專屬，不搬，留給 mod。
- 舊路徑的 `reports/` 只讀不搬：看板的「詳細」連結照舊指向原檔。
- 雙寫的衝突：E1 時舊 mod 不加鎖。核心寫之前重新讀舊檔，以工作項目為單位用 `updatedAt` 比新舊，取新的那份再寫。仍可能在毫秒級的重疊時遺失一次更新，測試要涵蓋（第 8 節）。
- 每一階段由版本號決定，不靠偵測：核心讀 mod 的 `plugin.json` 版本，判斷 mod 是否已在 E2。

影響、驗證、回復：

- 影響：使用者的交辦清單換位置。對使用者沒有可見變化，除了 `~/.project-pm/` 多一個資料夾。
- 驗證：用舊格式的假資料（Acme demo）跑：E1 核心寫一筆 → 舊 mod 讀得到；舊 mod 寫一筆 → 核心讀得到；同時寫 1,000 次，數 revision 和項目數。
- 回復：E1、E2 都可以直接移除核心，舊路徑仍完整。

## 3. MCP 工具 API

### 3.1 原則

- server 名稱用 `project-pm`，所以在 Claude Code 裡工具名稱仍是 `mcp__project-pm__board`、`mcp__project-pm__ledger`、`mcp__project-pm__report`，PM 的指示文字和現有測試的語意都不用改。
- 每個工具同時回 `content`（給模型看的文字，和現在一字不差的格式）和 `structuredContent`（給網頁看板、測試、其他程式用的 JSON），並附 `outputSchema`。
- 錯誤分兩種：參數錯或關卡擋下時 `isError: false`、文字說明原因和怎麼補（現在的行為，模型才會照著修）；核心本身壞了（寫不了檔、資料損毀）時 `isError: true`。不再有 CLI 實測看到的「假成功」。
- 每次呼叫 10 秒內回。gh、git 的結果有快取，過期時先回快取並標「（CI 狀態查詢中）」，背景再查。
- 每個工具都接受選填的 `project`（資料夾路徑）。沒給時用 MCP 的 roots，再沒有就用行程的 cwd。

### 3.2 `board`

| 參數 | 型別 | 說明 |
| --- | --- | --- |
| `scope` | `project` \| `all` | 和現在相同 |
| `include_done` | boolean | 和現在相同 |
| `project` | string | 選填，見 3.1 |

回傳：

- `content`：現在的看板文字（需要處理、交辦清單、Session、Agent）。
- `structuredContent`：

  ```json
  {
    "project": { "name": "acme-demo", "path": "…", "pmId": "claude-code:1a2b" },
    "attention": [{ "kind": "qaAwaiting", "item": 3, "text": "…" }],
    "items": [{ "id": 3, "code": "T-03", "status": "open", "owner": "…", "qa": "awaiting", "criteria": "…" }],
    "actors": [{ "id": "…", "tool": "codex", "status": "unreleased", "title": "…", "said": "…", "at": 1795057177490 }],
    "agents": [{ "id": "…", "state": "verify", "item": 3, "commit": "3fa1c2e" }],
    "progress": { "done": 4, "total": 7 },
    "boardUrl": "http://127.0.0.1:47130/#p=…",
    "revision": 42
  }
  ```

和現在的差別：Session 清單的來源。桌面版有 `list_sessions` 時用它（mod 轉成 Actor 交給核心）；沒有時用 `actors/` 裡這個專案的紀錄。讀不到 Session 清單時**仍然回交辦清單**，只在 Session 段落寫明讀不到（現在整個看板失敗，見 v1-cli-check.md 第 3 節）。

### 3.3 `ledger`

參數和語意與現在完全相同：`action`（`add`、`update`、`list`）、`id`、`include_done`、`text`、`owner`、`status`（`open`、`done`、`dropped`）、`note`、`criteria`、`qa`（`pass`、`fail`、`skip`）、`qa_by`、`qa_note`、`force`。新增：

| 參數 | 說明 |
| --- | --- |
| `qa_sha` | 選填。記錄 QA 時驗收的 commit，沒給時用專案目前的 HEAD |
| `commit` | 選填。update 時加進這個項目的 `commits` |

回傳：`content` 和現在一樣（add、update 回改到的那一項，list 回清單）；`structuredContent` 是那一項或那份清單的 JSON。結案關卡的順序不變：force＋note → QA（`qaUpdate`）→ 負責人。

### 3.4 `report`

參數和現在相同：`status`（`done`、`in_progress`、`blocked`、`waiting_user`、`waiting_ci`、`waiting_release`）、`summary`、`delivery`（`not_needed`、`released`、`pending`）、`commit`、`ci`、`next`、`detail`。新增：

| 參數 | 說明 |
| --- | --- |
| `actor` | 選填。hook 給的 Session id（1.5 節的 b 方案） |
| `item` | 選填。對應的工作項目 id；有給且帶 `commit` 時，commit 記進該項目 |
| `title` | 選填。這個 Session 在看板上的名稱（桌面版以外沒有標題來源） |

回傳：「已回報給 PM：done」或「已記錄，但這個專案還沒有 PM」。專案不在 git repo、或寫不進檔時回錯誤，不再說已回報。

### 3.5 `pm`（新）

把 `/pm` 指令的功能變成工具，因為不是每個平台都能讓外掛加斜線指令。

| 參數 | 說明 |
| --- | --- |
| `action` | `claim`（當 PM）、`release`（卸任）、`status`（目前誰是 PM、看板網址） |

回傳：和現在 `/pm` 的回覆相同的文字；`claim` 另外附上 PM 的指示（現在 `/pm` 用 `context` 塞進對話的那段 `ROLE`），讓沒有 `prompt.compose` 的平台也拿得到。

### 3.6 不做成工具的

- `archive`、開新 Session：只有桌面版做得到，留在 mod。
- 準則檔的讀取：核心提供文字給轉接層，不開成工具（避免模型自己去改）。

### 3.7 桌面版 mod 和核心並存時

兩者都會提供名為 `project-pm` 的 MCP server，會撞名。規則：mod 啟動時看 Claude Code 的 MCP 設定，已經有核心的 `project-pm` 就不再 `$.tool.register` board、ledger、report，只做面板和 Session 清單。這是 E2（v1.1）才改 mod；E1 期間 `init` 偵測到桌面版 mod 已安裝時，**不**幫 Claude Code 加核心的 MCP 設定，避免撞名（CLI 才需要核心）。

## 4. 網頁看板

### 4.1 內容

和桌面版面板相同的資訊：完成度、需要處理、交辦清單（含 QA 狀態）、各 Session（標出是哪個工具）、Agent。依照全域的網頁 UI/UX 標準設計：375px 到桌面都成立、深色模式、狀態色符合 WCAG AA、空狀態和錯誤狀態有設計、尊重 `prefers-reduced-motion`。

更新方式：每 5 秒向 `/api/board` 要一次，帶 `If-None-Match`（revision），沒變就 304。不用 SSE 或 WebSocket，維持一種機制、好測。

### 4.2 安全

| 威脅 | 做法 |
| --- | --- |
| 同網路的其他電腦讀到 | 只綁 `127.0.0.1`（和 `::1`）。不提供綁 `0.0.0.0` 的選項 |
| 本機其他使用者或程式讀到 | `/api/*` 和 `/mcp` 都要 token。token 在 `serve` 第一次啟動時產生（32 bytes 亂數），存在 `~/.project-pm/server.json`，Windows 設成只有本人可讀的 ACL，其他系統 mode 600 |
| DNS rebinding（惡意網站把自己的網域解析到 127.0.0.1） | 檢查 `Host` 只能是 `127.0.0.1:<port>`、`localhost:<port>`；`/mcp` 另外檢查 `Origin`，不是本機就拒絕（MCP 規格對 Streamable HTTP 的要求 [M1]） |
| 網頁被別的網站嵌入或跨站請求 | 回應加 `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`；不開 CORS |
| token 外流到瀏覽紀錄 | 網址用 fragment 帶 token（`/#t=…`），fragment 不會送到伺服器也不進 Referer；頁面讀到後存進 `sessionStorage`，再用 `Authorization` header 送 |
| 從網頁改資料 | v1 唯讀。看板上的動作（結案、封存）只顯示「請對 PM 說…」，不提供按鈕（第 9 節 D4） |
| 看板內容含使用者的原話 | 全部當純文字輸出（不用 innerHTML），避免交辦文字裡的 HTML 被執行 |

### 4.3 怎麼開

- `project-pm open`：沒有在跑的 `serve` 就啟動一個（背景、閒置 30 分鐘自動結束），然後用系統瀏覽器打開帶 token 的網址。
- MCP 的 `board`、`pm status` 回傳裡附網址，AI 可以把連結給使用者。
- port：預設固定一個（例如 47130），被占用時往後找，實際用的寫進 `server.json`（第 9 節 D5）。
- 桌面版照樣用面板；網頁看板是其他平台的「面板」。

## 5. 安裝：`project-pm init`

### 5.1 流程

1. 偵測：PATH 上有沒有 `claude`、`codex`、`agy`、`copilot`、`agent`（Cursor CLI）、`devin`，以及各自的設定資料夾。只偵測這一版支援的工具，其他的列成「之後會支援」。
2. 列出打算改的每個檔和內容差異，問使用者要不要套用。預設只看不改；`--yes` 才直接套用。
3. 套用：每個被改的檔先備份，記進 `install-log.json`。
4. 驗證：對每個工具跑一次不花錢的檢查（例如 `claude mcp list` 看得到 `project-pm`），失敗就照紀錄還原那一項並說明。

所有寫入都用標記包起來，重跑 `init` 只更新標記內的內容，`uninstall` 只刪標記內的內容：

```markdown
<!-- project-pm:start v1 -->
…
<!-- project-pm:end -->
```

### 5.2 寫什麼

| 項目 | Claude Code（① 版） | 其他工具（② ③ 版，開工時查證確切路徑） |
| --- | --- | --- |
| MCP 設定 | `claude mcp add --scope user project-pm -- npx -y project-pm@<版本> mcp`（用官方指令，不直接改 JSON）[C1] | Codex：`~/.codex/config.toml` 的 `[mcp_servers.project-pm]` [X1]；Copilot CLI、Antigravity、Cursor、Devin 各自的設定檔 [H1][A1][U1][W1] |
| 指示 | 專案的 `AGENTS.md` 段落；若專案有 `CLAUDE.md` 且沒有 `@AGENTS.md`，在 `CLAUDE.md` 開頭加一行 `@AGENTS.md`（Claude Code 有 CLAUDE.md 時不讀 AGENTS.md [C2]） | 同一份 `AGENTS.md` 段落；Antigravity 的 `.agents/rules` 要 frontmatter，Cursor 的 rules 要 `.mdc` [A2][U2]，只有在該工具不讀 AGENTS.md 時才另寫 |
| Skills | `~/.claude/skills/project-pm/SKILL.md`：怎麼回報、怎麼派驗收、怎麼略過 | 各工具的 skills 目錄（格式都是 SKILL.md）[X10][A4][V4][U9][W1] |
| hooks（第 3 層） | 使用者層級 `~/.claude/settings.json`：Stop、UserPromptSubmit 等事件呼叫 `project-pm hook claude-code <事件>` | 各工具的 hook 設定 [X3][A3][H3][U3][W2] |
| git hook | 專案的 `.git/hooks/pre-push`（第 6 節） | 同左，和 AI 工具無關 |
| CI | 選填：`.github/workflows/project-pm-qa.yml`（第 6 節） | 同左 |

### 5.3 AGENTS.md 段落

- 內容：這個專案有 PM；完成、暫停、卡住時呼叫 `report`；沒有工具可用時，摘要最後寫一行交付狀態；程式改完要先驗收才能 push；怎麼略過。
- 上限：段落本身控制在 2 KiB 以內。Codex 把 AGENTS.md 和 AGENTS.override.md 等合計只讀 32 KiB [X2]，`init` 會算整條 AGENTS.md 鏈的大小，超過 28 KiB 就警告並改用「段落只放一行，指向 Skill」的精簡版。
- 為什麼 hooks 放使用者層級：Copilot 也會讀專案的 `.claude/settings.json` 裡的 hooks [V3]，放在專案裡會被兩個工具各執行一次；放使用者層級可以避免，也不會把個人設定 commit 進 repo。

### 5.4 前提

- 需要 Node.js（用 `npx` 執行）。Claude Code 原生安裝版不需要 Node，Vibe Coder 可能沒裝；`init` 偵測不到 Node 時，用白話說明怎麼裝。之後再考慮單一執行檔（第 9 節 D3）。
- `init` 不做任何需要登入的事；`gh` 沒登入時，看板的 CI 欄位寫「沒有登入 GitHub，看不到 CI 結果」，並給 `gh auth login` 的說明。

影響、驗證、回復：

- 影響：改使用者的 AI 工具設定和專案的 AGENTS.md、CLAUDE.md、git hook。
- 驗證：每個工具的 `init` → 檢查 → `uninstall` → 比對檔案和安裝前完全相同（含沒有 CLAUDE.md、已有 `@AGENTS.md`、已有別的 pre-push hook 等情況）。
- 回復：`project-pm uninstall`，依 `install-log.json` 還原；紀錄壞掉時，每個寫入都有標記，可以手動刪。

## 6. 品管關卡

### 6.1 為什麼放在 git 和 CI

「沒過 CI 不能結案」沒辦法用 AI 工具的 hook 統一做：Cursor 的 stop hook 擋不了、Copilot 連擋 8 次會強制結束、Codex 的 Stop 只能叫它繼續做 [U3][H3][X3]。而且使用者可以隨時換工具或直接自己改程式。git 的 pre-push 和 GitHub 的 CI 不管用哪個工具都會經過，所以硬關卡放這兩處；AI 工具的 hook 只用來回報（第 3 層），不當關卡。

### 6.2 pre-push hook

裝在 `.git/hooks/pre-push`。已經有 pre-push 時，原本的改名成 `pre-push.local`，新的先跑原本的再跑檢查。

檢查（`project-pm check pre-push`，從 stdin 讀 git 給的 ref）：

1. 這個專案沒有交辦清單（沒用 PM）：直接通過。
2. 要 push 的 commit 範圍裡，若每個 commit 都被某個 QA 通過或略過的紀錄蓋到（`qa.sha` 是要 push 的最新 commit，或是它的後代），通過。
3. 否則擋下，列出沒驗收的 commit 和對應的工作項目（從 `commits` 欄位找；找不到就寫「沒有對應的工作項目」）。
4. 明確略過：`project-pm skip "<理由>"`。它把「這個 HEAD 略過 QA，理由是…」記進交辦清單（找得到對應項目就記在那一項，找不到就新增一項「未登記的 push」），然後 `git push` 就會通過。看板上會出現「略過 QA：理由」，事後看得到。
5. `git push --no-verify` 會跳過所有 hook，沒辦法禁止。核心在下次看板更新時用 git 事實（第 1 層）發現「遠端有沒驗收的 commit」，列在需要處理，註明「push 時跳過了檢查」。

用 `project-pm skip` 而不是環境變數，因為 Windows PowerShell 和 bash 設環境變數的寫法不同，Vibe Coder 照抄容易錯；一個指令在哪個終端機都一樣。

訊息範例（中文；英文版同樣結構）：

```
✋ 這次 push 先擋下來了（Project PM）

還沒驗收的改動：
  • T-03「加入登入頁」：3 個 commit，最新的是 a1b2c3d

為什麼要擋：沒有檢查過就上傳，壞掉的程式可能直接影響使用的人。

接下來可以：
  1. 請 AI 驗收：對 PM 說「驗收 T-03」，通過後再 push 一次。
  2. 這次確定不用驗收（例如只改說明文字）：
       npx project-pm skip "只改說明文字"
     然後再 push。理由會記在看板上。
```

### 6.3 CI 範本

`init` 選填加入 `.github/workflows/project-pm-qa.yml`。設計重點：

| 步驟 | 做法 | 沒過時的白話訊息（例） |
| --- | --- | --- |
| 測試 | 依專案偵測：有 `package.json` 的 `test` 就跑 `npm test`（或 pnpm、yarn）；有 `pyproject.toml`、`tests/` 就跑 `pytest`。偵測不到時這一步顯示「略過」並在摘要寫「這個專案還沒有自動測試」 | 「自動測試有 2 個沒通過。打開下面的紀錄，把錯誤訊息貼給 AI，請它修好並補上測試。」 |
| secret 掃描 | gitleaks CLI（MIT 授權）掃整個歷史。不用需要授權金鑰的官方 action（組織帳號要授權，實作時再確認） | 「在 config.js 第 12 行找到像是密碼或金鑰的東西。請到該服務把這把金鑰作廢、換新的，並改成從環境變數讀取；只刪掉這一行不夠，舊的還在 git 歷史裡。」 |
| 真實資料掃描 | 沿用本 repo `ci.yml` 的 BLOCKED_TERMS 做法（qa.md 第 7 節）：名單只放 secret，輸出只有檔名和行號 | 「第 3 個檔案第 8 行有你列為不能公開的詞（詞本身不顯示）。請把它換成假資料。」 |
| 套件安全檢查 | osv-scanner（Apache-2.0），讀各種 lockfile；只擋已知的高風險漏洞，中低風險只在摘要列出 | 「你用的套件 xyz 1.2.0 有已知的安全漏洞，升到 1.2.5 就修好了。可以請 AI 執行升級並跑測試。」 |

共同規則：

- `permissions: contents: read`，第三方 action 用 commit SHA 釘選版本（不是 tag）。
- 每一步失敗時用 `::error title=…::` 標註，並在 `$GITHUB_STEP_SUMMARY` 寫一張表：哪一項、發生什麼事、為什麼重要、怎麼修。不用術語，術語非用不可時加一句解釋。
- 範本本身要在本 repo 的 CI 跑過（用 Acme demo 的假專案，故意放一個假金鑰、一個有漏洞的舊套件、一個假的禁用詞），確認每一步都會擋、訊息正確。
- 本 repo 現在的 `ci.yml` 不在這次範圍（main 上有別的工作），範本是新檔。

影響、驗證、回復：

- 影響：使用者 push 時可能被擋；CI 時間變長（gitleaks、osv-scanner 各約數十秒，實作時量）。
- 驗證：本機用 bare repo 當遠端，跑「沒 QA → 擋」「QA 通過 → 過」「QA 後又 commit → 擋」「skip → 過且有紀錄」「--no-verify → 看板標出」「已有 pre-push → 兩個都跑」；Windows（Git Bash 執行 hook）、macOS、Linux 都跑。
- 回復：`project-pm uninstall --hooks` 刪掉 hook 並把 `pre-push.local` 改回原名；CI 範本刪檔即可。

## 7. 各平台轉接表

### 7.1 四層

| 層 | 意思 | 來源 | 需要 AI 配合嗎 |
| --- | --- | --- | --- |
| 第 1 層：git 和 CI 事實 | 有沒有 commit、push、CI 過了沒、push 前有沒有驗收 | 核心執行 git、gh；pre-push；CI | 不需要 |
| 第 2 層：AI 主動回報 | AI 照 AGENTS.md 和 Skill 的指示呼叫 `report`、`ledger` | MCP 工具 | 需要，AI 可能忘記 |
| 第 3 層：hook 自動回報 | 每輪結束、工具呼叫時，平台的 hook 自動寫回報（最後一段話、任務清單、背景工作） | `project-pm hook …` | 不需要 |
| 第 4 層：即時追蹤 | 不靠 AI 和 hook，就知道有哪些 Session、誰在跑、誰在等使用者，並能就地操作（封存、開新 Session），在工具裡直接有面板 | 平台自己的 Session API 和 UI 擴充 | 不需要 |

所有形態都有第 1 層（核心只需要 git 和 gh）；第 2 層只需要 MCP 和 AGENTS.md，13 種形態都有。差別在第 3、4 層。

### 7.2 表

「最高」是這個形態做得到的最高一層；「看板」是使用者在哪裡看。

| 平台 | 形態 | 接法 | 最高 | 看板 | 注意 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | 桌面版 | 現有 mod（轉接層）＋核心的資料；E1 期間 mod 自己提供工具 | 4 | mod 面板 | 唯一有 Session 清單 API 的形態 |
| Claude Code | CLI | 核心 MCP（stdio）＋`@AGENTS.md`＋Skill＋使用者層級 hooks；裝了 mod 的話，mod 的 hook 也能用（實測 Agent 派工、`tool.call` 在 CLI 會跑） | 3（第 4 層部分：核心的 actors 清單，沒有封存、開 Session） | 網頁看板；終端機面板未實測 | `-p` 模式不顯示面板 [C5] |
| Codex | 桌面版（ChatGPT 桌面 App）＋IDE 擴充 | 核心 MCP（和 CLI 共用 `config.toml`）＋AGENTS.md＋Skill；桌面版的「設定 > Hooks」 | 2（桌面版的 hook 能用就是 3） | 網頁看板 | 桌面版讀 AGENTS.md、IDE 的 hooks 都未確認 [X2][X3]；② 開工時查 |
| Codex | CLI | 核心 MCP＋AGENTS.md＋Skill＋hooks（command 處理方式） | 3 | 網頁看板 | MCP 工具預設 60 秒逾時；`exec` 只載入受信任專案的 MCP [X1][X6]；Stop 只能叫它繼續 |
| Antigravity | 桌面（App、IDE） | 核心 MCP＋AGENTS.md＋Skill＋hooks（6 個事件，只有 command） | 3 | 網頁看板 | 外掛沒有 UI 元件 [A6] |
| Antigravity | CLI（`agy`） | 同上 | 3 | 網頁看板 | `-p` 遇到需要核准的工具會拒絕但 exit 0，CI 要檢查輸出內容 [A7] |
| Gemini CLI | CLI | 不列為目標 | — | — | 個人與免費方案已停用 [G0]；要讀 AGENTS.md 得另外設定 [G2] |
| VS Code＋Copilot | 編輯器 | 核心 MCP（`.vscode/mcp.json` 或使用者設定）＋AGENTS.md＋Skill；hooks 還在預覽 | 2（hooks 正式後是 3） | 網頁看板；之後可做 webview 擴充 [V6] | 也讀 `.claude/settings.json` 的 hooks，會重複執行 [V3] |
| Copilot | CLI | 核心 MCP＋AGENTS.md＋Skill＋hooks | 3 | 網頁看板 | agentStop 連擋 8 次會強制結束 [H3] |
| Cursor | 編輯器 | 核心 MCP＋AGENTS.md＋Skill＋hooks（18 個事件） | 3 | 網頁看板；可裝 Open VSX 擴充，面板能力未驗證 [U7] | stop 擋不了 [U3] |
| Cursor | CLI（`agent`） | 核心 MCP（共用 `mcp.json`）＋AGENTS.md | 2（hooks 確認後是 3） | 網頁看板 | 只確認 workspaceOpen 會在 CLI 跑 [U3]；`-p` 沒有 `--force` 會拒絕 [U5] |
| Devin（原 Windsurf） | 桌面 | 核心 MCP＋AGENTS.md＋Skill＋`.devin/hooks.v1.json` | 3 | 網頁看板 | Restricted Mode 下 hooks 不執行 [W1] |
| Devin | CLI | 同桌面版（同一套 harness）[W1] | 3 | 網頁看板 | `-p` 的輸出格式未確認 [W6]；③ 開工時查 |

所有形態的硬關卡都一樣：pre-push＋CI（第 6 節）。

## 8. 分版計畫

每一版都遵守：新功能先擴充、不刪舊的；每版有獨立的回復方法；沒跑到的驗證如實寫在 release 說明。

### ① v1.0：Claude Code CLI、核心、網頁看板、hook 和 CI 範本

範圍：

- `core/`：純函式（從 `hooks/` 搬，見 1.4 節）、Node 層、MCP server（stdio＋Streamable HTTP）、`board`、`ledger`、`report`、`pm` 四個工具。
- 網頁看板（唯讀，第 4 節）。
- `init`、`uninstall`：只支援 Claude Code（CLI）；偵測到桌面版 mod 時只提示、不加 MCP 設定（3.7 節）。
- `hook claude-code <事件>`：Stop、UserPromptSubmit、PostToolUse（TodoWrite、背景指令）寫 actor 紀錄。
- pre-push hook、`skip`、CI 範本。
- 資料遷移 E1（雙寫）。
- 修 report 的假成功（核心這邊；mod 那邊在 v1.1 改）。
- 桌面版 mod：**不改**（E1 期間 mod 照舊）。

先查證再實作的事：MCP 子行程拿不拿得到 Session id（1.5 節）；外掛安裝會不會帶上 `core/`（1.4 節）；mod 在終端機互動模式的面板（v1-cli-check.md 第 4 節沒實測）。

驗證：

| 類別 | 做什麼 | 何時跑 |
| --- | --- | --- |
| 單元測試 | 核心的純函式；把現有 `tests/pm.test.ts` 裡對應的案例（交付判斷、QA、看板文字）改成直接呼叫核心，中英文各一 | 每次 push、PR |
| MCP 協定測試 | 用 MCP SDK 的 client 啟動 `project-pm mcp`（stdio）和 `serve`（HTTP），列工具、呼叫每個工具、檢查 `content` 和 `structuredContent`；不需要模型 | 每次 push、PR；Windows、macOS、Linux |
| 並行寫入 | 10 個行程各寫 100 次，revision、項目數正確；舊格式雙寫的合併 | 每次 push、PR |
| 網頁看板 | 375px、1280px、淺色、深色截圖；安全：沒 token 回 401、偽造 Host 回 403、非本機 Origin 打 `/mcp` 回 403、只聽 127.0.0.1 | 每次 push、PR |
| git hook | bare repo 當遠端的六種情況（6.2 節） | 每次 push、PR；三個作業系統 |
| CI 範本 | 對 Acme demo 假專案（放假金鑰、舊套件、假禁用詞）跑範本，確認每步都擋、訊息正確 | 每次 push、PR |
| Claude Code headless | `claude -p --mcp-config <核心設定> --output-format json` 在 Acme demo 上跑固定劇本：新增工作、回報、結案被 QA 擋、記錄 QA 後結案。檢查 JSON 結果和核心的資料檔，不只看 exit code | 需要 API 金鑰，會花錢：手動或每週一次，用便宜的模型，限制花費（第 9 節 D9） |
| 遷移 | 用舊格式的假資料跑 E1，舊 mod（v0.9.0）同時開著，兩邊都看得到對方寫的 | 發版前手動一次 |

回復：

- 套件：`npm deprecate` 有問題的版本，使用者的 `init` 釘選版本（`project-pm@1.0.x`），改回上一版重跑 `init` 即可。
- 設定：`project-pm uninstall`。
- 資料：E1 雙寫，舊路徑一直完整；移除核心等於回到 v0.9.0，桌面版完全不受影響。

### ② v1.x：Codex、Copilot、Antigravity

範圍：`init` 支援 Codex（CLI、桌面版）、Copilot（CLI、VS Code）、Antigravity（CLI、桌面）；各自的 `hook <工具> <事件>`；AGENTS.md 大小檢查（Codex 32 KiB）；處理 Copilot 重複執行 Claude 的 hooks。也在這一段做 E2（桌面版 mod 改用核心的資料）。

先查證：報告裡這幾個平台的未確認項目（Codex 桌面版讀 AGENTS.md、Codex IDE 的 hooks、Antigravity 的外掛面板）；各平台 hook 事件 JSON 的欄位（Session id、cwd）；MCP 設定檔的確切路徑和寫法。

驗證：各 CLI 用 headless 在 CI 跑同一個劇本：`codex exec --json`（CI 要先把工作目錄設成受信任，否則不載入 MCP [X6]）、`copilot -p --output-format=json` [H5]、`agy -p`（輸出 json；不能只看 exit code，要檢查結果裡有沒有被拒絕的工具 [A7]）。每個平台需要各自的帳號或金鑰，花費同 D9。VS Code、桌面版沒有 headless，用手動清單驗證並在 release 說明寫明。

回復：每個平台的轉接是獨立的（`init --tool codex`、`uninstall --tool codex`），一個平台出問題只移除那一個，不影響其他；E2 出問題時 mod 退回 E1 版本，舊路徑仍完整。

### ③ v1.y：Cursor、Devin

範圍：`init` 支援 Cursor（編輯器、CLI）、Devin（桌面、CLI）；各自的 hook。可以評估 VS Code 系的 webview 擴充（Cursor、Devin 都能裝 Open VSX 擴充）當第 4 層的面板。也在這一段做資料遷移的 C1。

先查證：Cursor CLI 的 hooks 和子代理、Devin CLI `-p` 的輸出格式、兩者擴充的面板能力（報告標未確認）。

驗證：`agent -p --force --output-format json`（Cursor 管理員可以關掉這個模式 [U5]）、`devin -p`（格式查證後再寫檢查）。編輯器手動清單。

回復：同 ②，各平台獨立；C1 之後要回去需要 `project-pm export --legacy`，所以 C1 要等 ② ③ 都穩定一個版本以上再做。

## 9. 需要使用者決定的取捨

| # | 問題 | 選項 | 建議 | 理由 |
| --- | --- | --- | --- | --- |
| D1 | 交辦清單存在哪 | A 使用者層級 `~/.project-pm/`；B 專案資料夾、不進 git；C 專案資料夾、進 git | A | 個資不外流；同一台電腦的工具都能共用；Vibe Coder 不用管 `.gitignore`（2.1 節） |
| D2 | v1 要不要支援多人協作 | 不支援；之後同步到 GitHub Issues；把檔案放進 git | v1 不支援，之後評估 GitHub Issues | 檔案進 git 會合併衝突又有個資風險 |
| D3 | 怎麼發佈 | npm 套件（要 Node）；單一執行檔（Bun 或 Node SEA 編譯）；兩者都有 | ① 先 npm，之後加單一執行檔 | npm 最快能出；但 Claude Code 原生安裝版的使用者可能沒有 Node，`init` 要說明怎麼裝 |
| D4 | 網頁看板能不能操作 | 唯讀；可結案、封存（要 token＋防 CSRF） | 唯讀 | 只讀就沒有跨站請求的風險；操作仍透過 PM，關卡規則只有一個入口 |
| D5 | 看板 port | 固定預設（被占用時往後找）；每次隨機 | 固定預設 | 書籤、說明文件都好寫；實際 port 記在 `server.json` |
| D6 | 程式碼放哪 | 同一個 repo 分 `core/`、`hooks/`；核心另開 repo | 同一個 repo | mod 用相對路徑 import 核心的純函式，一次改動一個 PR、一份 CHANGELOG |
| D7 | 版號 | 核心和 mod 共用一個版號；分開 | 共用，從 1.0.0 開始 | 遷移階段靠版號判斷（2.4 節），共用最不會錯 |
| D8 | pre-push 的略過方式 | `project-pm skip "<理由>"`；環境變數；只能 `--no-verify` | `skip` 指令，`--no-verify` 事後在看板標出 | 不分終端機都一樣；理由留在看板上 |
| D9 | 需要模型的 headless 測試在 CI 怎麼跑 | 每次 PR；每週＋手動；只在發版前手動 | 每週＋手動，用便宜的模型、設花費上限 | 每次 PR 跑會持續花錢；不需要模型的測試（MCP 協定、hook、看板）每次都跑 |
| D10 | 桌面版 mod 在 v1 之後的角色 | 保留，當轉接層（面板、Session 清單、第 4 層）；逐步淘汰 | 保留 | 桌面版是唯一有第 4 層的形態 |
| D11 | Gemini CLI | 不支援；支援 | 不支援 | 個人與免費方案已停用 [G0]，目標使用者用不到 |
| D12 | CI 範本預設開哪些檢查 | 四項全開；只開 secret 和真實資料，測試和套件檢查由使用者選 | 四項全開，偵測不到測試時顯示「略過」而不是失敗 | Vibe Coder 不知道該選哪些；全開但不因為「沒有測試」就擋 |
| D13 | `init` 預設要不要直接改檔 | 只顯示差異，`--yes` 才改；直接改 | 只顯示差異 | 改的是使用者的 AI 工具設定和專案檔，先讓人看到 |

## 10. 來源

跨平台查證報告的代號（完整清單見該報告）：

- [C1] https://code.claude.com/docs/en/mcp
- [C2] https://code.claude.com/docs/en/memory
- [C3] https://code.claude.com/docs/en/hooks
- [C5] https://code.claude.com/docs/en/plugins/mods/overview
- [C6] https://code.claude.com/docs/en/headless
- [X1] https://learn.chatgpt.com/docs/extend/mcp.md
- [X2] https://learn.chatgpt.com/docs/agent-configuration/agents-md.md
- [X3] https://learn.chatgpt.com/docs/hooks.md
- [X6] https://learn.chatgpt.com/docs/non-interactive-mode.md
- [X10] https://learn.chatgpt.com/docs/skills-and-plugins.md
- [A1] https://antigravity.google/docs/mcp
- [A2] https://antigravity.google/docs/rules
- [A3] https://antigravity.google/docs/hooks
- [A4] https://antigravity.google/docs/plugins
- [A6] https://antigravity.google/docs/build-plugins
- [A7] https://antigravity.google/docs/cli/headless
- [G0] https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
- [G2] https://geminicli.com/docs/cli/gemini-md/
- [V1] https://code.visualstudio.com/docs/copilot/customization/mcp-servers
- [V3] https://code.visualstudio.com/docs/copilot/customization/hooks
- [V4] https://code.visualstudio.com/docs/copilot/customization/agent-skills
- [V6] https://code.visualstudio.com/api/extension-guides/webview
- [H1] https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
- [H3] https://docs.github.com/en/copilot/reference/hooks-configuration
- [H5] https://docs.github.com/en/copilot/how-tos/copilot-cli/automate-copilot-cli/run-cli-programmatically
- [U1] https://cursor.com/docs/context/mcp
- [U2] https://cursor.com/docs/context/rules
- [U3] https://cursor.com/docs/agent/hooks
- [U5] https://cursor.com/docs/cli/headless
- [U7] https://cursor.com/help/customization/extensions
- [U9] https://cursor.com/docs/agent/chat/commands
- [W1] https://docs.devin.ai/desktop/devin-local/customizations.md
- [W2] https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks.md
- [W6] https://docs.devin.ai/cli/reference/commands.md

這份文件新增的：

- [M1] MCP 規格 2025-11-25，Transports 章節：https://modelcontextprotocol.io/specification/2025-11-25/basic/transports 。2026-11-19 查閱，內容：Streamable HTTP 取代 HTTP+SSE；安全警告要求驗證 `Origin`（不合法回 403）、本機執行時只綁 127.0.0.1、應驗證所有連線；伺服器可以對 GET 回 405 表示不提供 SSE 串流。實測的 Claude Code 2.1.326 協商的版本也是 2025-11-25（v1-cli-check.md 第 3 節的 debug log）。

沒有另外查證、寫在文件裡要實作時再確認的：gitleaks 官方 action 對組織帳號的授權要求、osv-scanner 的授權與 action 版本、各平台 ② ③ 的設定檔確切路徑。
