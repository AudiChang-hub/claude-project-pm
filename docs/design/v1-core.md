# 設計：v1.0 跨平台核心 pm-core（T-34）

狀態：已定案（2026-11-19）。使用者對第 9 節 D1～D13 的決定已寫入整份文件；寫入時發現的 Q1～Q4 也已定案（9.1 節）。這份文件不改任何現有程式。

背景：使用者選定 A 案，核心做成 MCP server，各平台用轉接層接上。目標使用者是不熟軟體工程的 Vibe Coder，要讓他們做出的軟體在品質、測試、安全上有一定水準，而且不限 Claude 桌面版。

依據：

- 第 0 步實測：[v1-cli-check.md](v1-cli-check.md)。現在的 mod 在 Claude Code CLI 能載入，ledger、QA 關卡、Agent 派工都能跑；失效的是「我是誰」和「有哪些 Session」，因為這兩件事只有桌面版的 `ccd_session_mgmt` 能回答。
- 跨平台查證報告：`~/.claude/project-pm/reports/agents/a226af2b1f31b0f10.md`（7 個平台、13 種形態，附官方來源）。下文引用它的來源代號，例如 [C3]、[X2]，網址列在第 11 節。
- 現有設計：[qa.md](qa.md)（QA 關卡，第 8 節已把核心和桌面版接線分開）、[agents.md](agents.md)（Agent 派工）。

## 摘要

| 問題 | 做法 |
| --- | --- |
| 核心是什麼 | 一個程式 `project-pm`（Node 寫的），同時是 MCP server（stdio＋Streamable HTTP，不用 SSE）、網頁看板、git hook 和 CI 用的檢查指令 |
| 怎麼發布 | 主要是各作業系統的單一執行檔，使用者不用另外裝 Node；npm 套件保留給開發者。沒有程式碼簽章，是已知限制（D3） |
| 搬進核心的 | 交辦清單（ledger）、QA 關卡、交付判斷、CI 查詢、文字看板、網頁看板、Session 回報紀錄、Agent 紀錄 |
| 留在轉接層的 | 「我是誰」、Session 清單、面板、把說明塞進提示、改寫 Agent 呼叫、截短通知（各平台的 hook 才做得到） |
| 資料放哪 | 使用者層級 `~/.project-pm/`，不進 git；專案資料夾只放不含個資的設定和 AGENTS.md 段落 |
| 多人協作 | **已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）**。v1.0 已經寫的 `uid`、建立者、修改者、`rev` 保留，理由見 10.1 節；第 10 節的設計只留作紀錄，不會實作 |
| 舊資料 | 先擴充、後收斂：核心讀新舊兩處，過渡期同時寫回舊檔，桌面版 mod 不用同時改 |
| 硬關卡在哪 | 在 git 和 CI，不在 AI 工具的 hook：pre-push 沒有 QA 通過就擋（可明確略過並留下紀錄），CI 跑測試、secret 掃描、真實資料掃描、套件安全檢查 |
| 測試花費 | 不花錢：CI 只跑不需要 AI 模型的測試；需要模型的冒煙測試在發版前用使用者的 Claude 訂閱在本機手動跑，只跑 Claude Code（D9、Q2） |
| 分版 | ① v1.0：Claude Code CLI＋核心＋網頁看板＋hook 和 CI 範本＋單一執行檔（這一版）；② v1.1：E2（桌面版 mod 改用核心）。Claude Code 以外的平台（原本的 v1.2、v1.3）和多人協作都已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。核心不依賴特定平台的設計維持不變（MCP 工具、`hook <工具> <事件>`、使用者層級的資料、git 和 CI 的關卡），日後要重新支援其他平台也做得到，但目前不在計畫內 |

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

一個程式 `project-pm`，用 Node 寫，發布成兩種形式（D3）：

- **單一執行檔（主要）**：Windows、macOS、Linux 各一個檔，用 Node SEA 或 Bun 把程式和執行環境編在一起，使用者不用另外裝 Node。怎麼建置、怎麼安裝見 5.4、5.5 節。
- **npm 套件（給開發者）**：`npx project-pm …`，給已經有 Node、想看原始碼或參與開發的人。兩種形式的功能和指令完全相同。

子指令：

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
| `project-pm skip "<理由>"` | 明確略過這次 push 的 QA，理由記進交辦清單。使用者平常打的是 `init` 設定好的 `git pm skip "<理由>"`（6.2 節） |
| `project-pm sync on｜off｜resolve` | 已取消，不會實作（多人協作，第 10 節） |
| `project-pm terms upload` | 已取消，不會實作（屬於多人協作，10.4 節） |

為什麼 stdio 和 HTTP 都要：

- stdio：13 種形態都支援 [C1][X1][A1][V1][H1][U1][W1]，設定最簡單，Vibe Coder 不用管 port。
- Streamable HTTP：讓網頁看板和 MCP 共用一個常駐行程；也給不能啟動本機程式的形態（例如雲端 Session）留路。
- 不用 SSE：Antigravity CLI 明文不支援舊版 SSE，Codex 文件沒提 [A1][X1]。MCP 規格也已經用 Streamable HTTP 取代 2024-11-05 的 HTTP+SSE [M1]。另外，Streamable HTTP 本身允許伺服器選擇用 SSE 串流回應；核心不用：POST 一律回 `application/json`，GET 回 405（規格允許），工具都是一問一答，不需要串流。

實測補充：現在的 mod 用 `$.tool.register` 註冊的 board、ledger，引擎就是用本機 Streamable HTTP 的 MCP server 提供的（v1-cli-check.md 第 3 節）。換成獨立的 MCP server，模型看到的工具名稱和參數可以完全不變。

### 1.3 多個行程同時寫

每個 AI Session 會各自啟動一個 `project-pm mcp`（stdio），所以同一個專案的資料可能有好幾個行程同時寫。做法：

- 每個寫入都是「鎖定 → 重新讀 → 改 → 寫暫存檔 → rename」。鎖用 `<檔名>.lock`（建立時加 exclusive 旗標），超過 10 秒視為殘留鎖，可以清掉。
- 檔案有 `revision` 欄位，每寫一次加 1，方便看板判斷要不要重畫，也方便測試抓到遺失的更新。
- 每個工作項目另有自己的 `rev`（每寫一次加 1，E1 合併時也加 1）和 `uid`（不靠本機序號的穩定 id）。它們和建立者、修改者原本是給多人協作準備的；多人協作已取消（第 10 節），欄位保留，理由見 10.1 節。
- 過渡期舊版 mod 不會加鎖（2.4 節的雙寫），這段時間靠「寫之前重新讀、以工作項目為單位依 `updatedAt` 合併」降低覆蓋的機會。舊 mod 不認得 10.1 節的新欄位，合併時若舊檔那一份比較新但少了這些欄位，從核心那一份補回來，`rev` 加 1、`updatedBy.actor` 記成 `desktop-mod`（舊 mod 不記修改者）。這是已知風險，列在第 8 節的驗證項目。

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

同一個 repo 改成兩部分（第 9 節 D6，已定案）：

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
  - hook：Claude Code 的 hook 事件 JSON 帶 `session_id`、`cwd` [C3]，其他平台的 hook 也多半帶類似欄位（③ ④ 開工時逐一查證）。hook 寫的回報用 `<工具>:<session_id>`。
  - 問題：stdio 行程的 actor id 和 hook 的 `session_id` 對不起來。有兩個辦法，① 要先查證：(a) 工具啟動 MCP 行程時是否有環境變數帶 Session id（這次在 Claude Code 的 Bash 環境裡看到 `CLAUDE_CODE_SESSION_ID`，MCP 子行程有沒有還沒驗證）；(b) 沒有的話，`report` 工具接受選填的 `actor` 參數，AGENTS.md 段落請 AI 帶上 hook 給的 id。兩個都做不到時，看板把同一個資料夾、時間相近的兩個 actor 當成同一個 Session 顯示，並標「可能重複」。
- **桌面版**：mod 繼續用 `get_session` 的 `local_…` id，並在呼叫核心時帶上，所以舊資料的負責人欄位不用改。
- **PM**：專案檔記 `pmId`。PM 是「這個專案現在誰當 PM」，不是權限。核心不靠 PM 身分擋任何操作；「Agent 只能讀 ledger」這類限制由知道誰是 Agent 的轉接層執行（現在就是 `register.tsx:414` 在做）。

## 2. 資料

### 2.1 存在哪裡

| 選項 | 共用 | 個資 | 多人協作 | 缺點 |
| --- | --- | --- | --- | --- |
| A. 使用者層級 `~/.project-pm/`（採用，D1） | 同一台電腦的所有工具都讀得到 | 不進 git，不會外流 | 檔案本身不共用（多人協作已取消，第 10 節） | 換電腦不會跟著走；刪掉專案資料夾不會一起刪 |
| B. 專案資料夾 `.project-pm/`，加進 `.gitignore` | 同上 | 不進 git，但 Vibe Coder 可能誤把 `.gitignore` 那行刪掉 | 不支援 | 每個 worktree 一份，要另外對到主 repo；刪專案資料夾就沒了 |
| C. 專案資料夾 `.project-pm/`，進 git | 換電腦、多人都看得到 | **風險高**：交辦文字常有客戶名稱、真實資料、內部網址，Vibe Coder 不會檢查 | 會衝突：兩個人同時改 `ledger.json` 一定合併衝突 | 歷史永遠留在 git |

採用 A（D1 定案），理由：

- 個資：交辦清單的內容是使用者對 AI 說的話，常常夾帶真實資料。這個專案自己就有 BLOCKED_TERMS 掃描，說明真實資料外流是實際風險；放進 git 等於把風險交給最不會處理的人。
- 共用：目標原本是「同一個人在同一台電腦換著用不同 AI 工具」，A 就夠了；只支援 Claude 之後（9.2 節），是同一台電腦上的 Claude Code 桌面版和 CLI 共用。
- 多人協作：已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。原本 D2 的做法是同步到 GitHub Issues，而不是把檔案放進 git；這段設計留在第 10 節作為紀錄，不會實作。

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
  bin/project-pm-<版本>[.exe]     init 複製過來的單一執行檔，各工具的設定都指向它（5.4 節）
  （sync/、blocked-terms.txt：原本給多人協作，已取消，不會建立）
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
  // 原有欄位不變：id, text, owner, status, note, createdAt, updatedAt，以及 v0.9.0 的 criteria、qa
  commits?: string[]  // 這個項目的 commit（report、Agent 回報時記下），pre-push 用
  // 以下 v1.0 開始寫。原本給多人協作（已取消），保留的理由見 10.1 節
  uid?: string        // 穩定唯一 id（UUID v7），跨電腦不撞號
  createdBy?: Author  // 建立者
  updatedBy?: Author  // 最後修改者（修改時間沿用原有的 updatedAt）
  rev?: number        // 這一項每寫一次加 1
}

type Author = { actor: string; person?: string }   // Session／Agent id，和 GitHub 帳號（10.1 節）

type QaRecord = {
  // 原有：result, by, at, note
  sha?: string        // 驗收時的 commit；pre-push 比對用（第 6 節）
  byPerson?: string   // 驗收者的 GitHub 帳號（10.1 節）
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

規則和 v0.9.0 的 QA 欄位一樣：都是選填，舊檔沒有就當沒有，寫回時不補不需要的欄位（開發準則第 7 條）。所以舊項目不會被補上 `uid`（原本要在 v1.1 第一次同步時補，同步已取消）。`createdBy` 只在建立時寫，舊項目一直沒有；`updatedBy`、`rev` 在項目真的被修改時才寫。

### 2.4 從現有 mod 資料遷移：先擴充、後收斂

現有資料在 `~/.claude/project-pm/`（how-it-works.md「Data and privacy」）。

| 階段 | 核心 | 桌面版 mod | 可以回到上一階段嗎 |
| --- | --- | --- | --- |
| E1（v1.0） | 讀：新路徑優先，沒有就讀舊路徑。寫：新路徑，**同時寫回舊路徑的 `projects/*.json`**（只寫舊格式有的欄位以外照抄，多的欄位舊 mod 會忽略） | 不改，照舊讀寫舊路徑 | 可以：舊路徑一直是完整的，移除核心就回到 v0.9 |
| E2（v1.1） | 同 E1 | 改成透過核心的純函式讀寫新路徑，也照樣寫回舊路徑 | 可以：舊路徑仍完整 |
| C1（E2 之後、所有使用中的 mod 都已更新；目前沒有排進任何一版） | 停止寫回舊路徑；仍會讀舊路徑（給沒遷移到的專案） | 只讀寫新路徑 | 要回去得先把新路徑複製回舊路徑（`project-pm export --legacy`） |
| C2（再下一版） | 不再讀舊路徑；第一次啟動時若發現舊檔還有沒搬的專案，搬過去並在看板提示一次 | 同 C1 | 同 C1 |

細節：

- 舊路徑的 `sessions/<id>.json`、`rounds/`、`transcripts.json` 是桌面版專屬，不搬，留給 mod。
- 舊路徑的 `reports/` 只讀不搬：看板的「詳細」連結照舊指向原檔。
- 雙寫的衝突：E1 時舊 mod 不加鎖。核心寫之前重新讀舊檔，以工作項目為單位用 `updatedAt` 比新舊，取新的那份再寫；舊檔那份比較新時，舊 mod 不認得的欄位（`uid`、`createdBy`、`commits` 等）從核心那份補回（1.3 節）；`qa.sha`、`qa.byPerson` 只在兩份的 `qa.at` 相同時才補，因為舊 mod 可能記了一筆新的 QA。仍可能在毫秒級的重疊時遺失一次更新，測試要涵蓋（第 8 節）。
- 每一階段由版本號決定，不靠偵測：核心讀 mod 的 `plugin.json` 版本，判斷 mod 是否已在 E2。

影響、驗證、回復：

- 影響：使用者的交辦清單換位置。對使用者沒有可見變化，除了 `~/.project-pm/` 多一個資料夾。
- 驗證：用舊格式的假資料（Acme demo）跑：E1 核心寫一筆 → 舊 mod 讀得到；舊 mod 寫一筆 → 核心讀得到；同時寫 1,000 次，數 revision 和項目數。
- 回復：E1、E2 都可以直接移除核心，舊路徑仍完整。

## 3. MCP 工具 API

### 3.1 原則

- server 名稱用 `project-pm`，所以在 Claude Code 裡工具名稱仍是 `mcp__project-pm__board`、`mcp__project-pm__ledger`、`mcp__project-pm__report`，PM 的指示文字和現有測試的語意都不用改。
- 每個工具同時回 `content`（給模型看的文字，和現在一字不差的格式）和 `structuredContent`（給網頁看板、測試、其他程式用的 JSON），並附 `outputSchema`。
  - **2026-11-19 實測後改為預設只回文字（A 案，PM 依設計本意決定）。** 實測：Claude Code CLI 2.1.326 在工具同時回 `content` 和 `structuredContent` 時，交給模型的是 JSON，不是文字；看板、交辦清單、結案被擋的說明都是寫給模型讀的文字，換成 JSON 就失去「模型照著說明修」的設計本意。決定：MCP 的工具預設只回 `content`、`tools/list` 不附 `outputSchema`；環境變數 `PROJECT_PM_STRUCTURED=1` 才同時回 `structuredContent` 並附 `outputSchema`（其他值、沒設都視為關閉），給需要 JSON 的用戶端用。同一份 JSON 照樣在網頁看板的 `/api/board` 和 `project-pm board --json` 提供，不受開關影響。測試涵蓋開關打開和關閉兩種情況（`core/test/mcp.spec.ts`）。
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

add、update 同時寫 10.1 節的欄位（`uid`、`createdBy`、`updatedBy`、`rev`），模型不用帶任何新參數。（原本計畫 v1.1 起 `id` 另外接受同步過的 Issue 編號，隨多人協作取消。）

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

1. 偵測：PATH 上有沒有 `claude`，以及它的設定資料夾。（原本也要偵測 `codex`、`agy`、`copilot`、`agent`、`devin`，隨其他平台已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。）
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

| 項目 | Claude Code（① 版） | 其他工具（③ ④ 版，開工時查證確切路徑） |
| --- | --- | --- |
| MCP 設定 | `claude mcp add --scope user project-pm -- <執行檔的絕對路徑> mcp`（用官方指令，不直接改 JSON）[C1]。執行檔路徑是 `~/.project-pm/bin/project-pm-<版本>`，等於釘選版本；用 npm 安裝的開發者寫 `npx -y project-pm@<版本> mcp` | （其他工具的設定：Codex 的 `~/.codex/config.toml` [X1]，Copilot CLI、Antigravity、Cursor、Devin 各自的設定檔 [H1][A1][U1][W1]，隨其他平台已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）） |
| 指示 | 專案的 `AGENTS.md` 段落；若專案有 `CLAUDE.md` 且沒有 `@AGENTS.md`，在 `CLAUDE.md` 開頭加一行 `@AGENTS.md`（Claude Code 有 CLAUDE.md 時不讀 AGENTS.md [C2]） | 同一份 `AGENTS.md` 段落；Antigravity 的 `.agents/rules` 要 frontmatter，Cursor 的 rules 要 `.mdc` [A2][U2]，只有在該工具不讀 AGENTS.md 時才另寫 |
| Skills | `~/.claude/skills/project-pm/SKILL.md`：怎麼回報、怎麼派驗收、怎麼略過 | 各工具的 skills 目錄（格式都是 SKILL.md）[X10][A4][V4][U9][W1] |
| hooks（第 3 層） | 使用者層級 `~/.claude/settings.json`：Stop、UserPromptSubmit 等事件呼叫 `project-pm hook claude-code <事件>` | 各工具的 hook 設定 [X3][A3][H3][U3][W2] |
| git hook | 專案的 `.git/hooks/pre-push`（第 6 節），裡面寫執行檔的絕對路徑；專案 `.git/config` 的 alias `pm`，讓 `git pm skip` 不靠 PATH 也能用（6.2 節） | 同左，和 AI 工具無關 |
| CI | 選填：`.github/workflows/project-pm-qa.yml`（第 6 節） | 同左 |

### 5.3 AGENTS.md 段落

- 內容：這個專案有 PM；完成、暫停、卡住時呼叫 `report`；沒有工具可用時，摘要最後寫一行交付狀態；程式改完要先驗收才能 push；怎麼略過。
- 上限：段落本身控制在 2 KiB 以內。Codex 把 AGENTS.md 和 AGENTS.override.md 等合計只讀 32 KiB [X2]，`init` 會算整條 AGENTS.md 鏈的大小，超過 28 KiB 就警告並改用「段落只放一行，指向 Skill」的精簡版。
- 為什麼 hooks 放使用者層級：Copilot 也會讀專案的 `.claude/settings.json` 裡的 hooks [V3]，放在專案裡會被兩個工具各執行一次；放使用者層級可以避免，也不會把個人設定 commit 進 repo。

### 5.4 前提

- **不需要 Node.js**（D3 定案）。使用者從 GitHub Releases 下載自己作業系統的單一執行檔，在終端機執行一次 `init`。`init` 把自己複製到 `~/.project-pm/bin/project-pm-<版本>`，各工具的設定和 git hook 都寫這個絕對路徑。
- `init` **不改系統**：不幫使用者裝 Node 或任何執行環境，不改 PATH、登錄檔、系統設定，不需要系統管理員權限。它只改 5.2 節列出的檔，而且都記進 `install-log.json`，`uninstall` 能全部還原。
- 不用 `npx` 也不用 PATH 的原因：Claude Code 原生安裝版不需要 Node，Vibe Coder 多半沒裝；改 PATH 屬於改系統，而且要重開終端機才生效，容易讓人以為裝壞了。
- `init` 不做任何需要登入的事；`gh` 沒登入時，看板的 CI 欄位寫「沒有登入 GitHub，看不到 CI 結果」，並給 `gh auth login` 的說明。

### 5.5 單一執行檔：建置、下載、放行

建置（D3、D9：不花錢）：

- 在 GitHub Actions 的 release workflow 建置，Windows、macOS、Linux 的 runner 各編各的。公開 repo 用標準 runner 免費。
- 編譯工具用 Node SEA 或 Bun（`bun build --compile`）。v1.0 開工時兩個都試，比檔案大小、啟動時間、MCP SDK 和 `child_process` 能不能照常運作，選一個；這是技術選擇，不影響使用者。
- 目標：Windows x64、macOS arm64 和 x64、Linux x64 和 arm64（編譯工具實際支援哪些，實作時確認）。
- 每個檔約 50～100 MB，因為裡面帶了整個執行環境。這是不用另外裝 Node 的代價。
- release 附 `SHA256SUMS`；release 只能由 Actions 發布，第三方 action 用 commit SHA 釘選。
- macOS：Apple Silicon 不執行完全沒有簽章的程式，所以建置時做 ad-hoc 簽章（`codesign --sign -`，免費；它不是 Apple 的開發者簽章，擋不掉下面的 Gatekeeper 警告）。Bun 是否已自動做，實作時確認。
- 更新：不自動更新。新版本就是下載新檔再跑一次 `init`，設定改指向新的 `project-pm-<版本>`；舊版本的檔留著，回到舊版只要用舊檔再跑一次 `init`。

已知限制：沒有程式碼簽章。使用者不花錢，所以不買 Windows 的簽章憑證，也不付 Apple 開發者計畫的年費。第一次執行時作業系統會警告，安裝說明要用白話教怎麼放行：

| 系統 | 使用者會看到 | 說明要教的 |
| --- | --- | --- |
| Windows | 瀏覽器下載時可能說「不常下載」；從檔案總管點兩下時，SmartScreen 跳出「Windows 已保護您的電腦」 | 下載時選「保留」；SmartScreen 視窗按「其他資訊」→「仍要執行」。從終端機執行不一定會跳，兩種情況都寫。開著「智慧型應用程式控制」（Smart App Control）的電腦可能直接擋下、沒有放行按鈕。這列為已知限制，不申請簽章（9.1 節 Q1）；README 和 release 說明寫明：遇到這種情況改用 npm 版，要先裝 Node |
| macOS | 「無法打開，因為 Apple 無法檢查是否包含惡意軟體」 | 系統設定 →「隱私權與安全性」→ 最下面的「仍要打開」；或在終端機執行 `xattr -d com.apple.quarantine <檔案>`，並用一句話說明這行在做什麼。這些步驟沒有在實機驗證過（沒有 Mac，9.1 節 Q3），release 說明照實標註 |
| Linux | 沒有警告，但下載的檔案不能執行 | `chmod +x <檔案>` |

說明的原則：先講為什麼會警告（我們沒有付費買簽章，不代表程式有問題），再講怎麼確認檔案是真的（只從官方 Releases 頁下載、可以比對 SHA256），最後才是放行步驟。不叫使用者關掉防毒或系統的安全功能。

影響、驗證、回復：

- 影響：改使用者的 AI 工具設定和專案的 AGENTS.md、CLAUDE.md、git hook、`.git/config` 的 alias `pm`；在 `~/.project-pm/bin/` 放一個執行檔。
- 驗證：每個工具的 `init` → 檢查 → `uninstall` → 比對檔案和安裝前完全相同（含沒有 CLAUDE.md、已有 `@AGENTS.md`、已有別的 pre-push hook、已有別的 git alias `pm` 等情況）。用建置出來的單一執行檔跑，不是用原始碼跑。放行步驟在 CI 測不到：Windows（SmartScreen）發版前在實機照安裝說明走一次；macOS（Gatekeeper）沒有實機，不驗證，release 說明標「放行步驟未在實機驗證」（Q3）。
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
4. 明確略過：`git pm skip "<理由>"`（就是 `project-pm skip`，見下面）。它把「這個 HEAD 略過 QA，理由是…」記進交辦清單（找得到對應項目就記在那一項，找不到就新增一項「未登記的 push」），然後 `git push` 就會通過。看板上會出現「略過 QA：理由」，事後看得到。
5. `git push --no-verify` 會跳過所有 hook，沒辦法禁止。核心在下次看板更新時用 git 事實（第 1 層）發現「遠端有沒驗收的 commit」，列在需要處理，註明「push 時跳過了檢查」。

用指令而不是環境變數，因為 Windows PowerShell 和 bash 設環境變數的寫法不同，Vibe Coder 照抄容易錯；一個指令在哪個終端機都一樣。

為什麼是 `git pm skip`：D3 之後使用者沒有 Node，`npx project-pm` 不能用；`init` 又不改 PATH（5.4 節），直接打 `project-pm` 找不到。所以 `init` 在專案的 `.git/config` 加一個 alias `pm`，指向執行檔的絕對路徑（`git config alias.pm "!<路徑>"`）。git 一定在 PATH 上，`git pm skip "…"` 在 PowerShell、cmd、bash 都一樣。專案已經有別的 alias `pm` 時不覆蓋，訊息改印執行檔的完整路徑。`uninstall` 只在值仍是 `init` 寫的那個時才刪。用 npm 的開發者照樣可以打 `npx project-pm skip`。

訊息範例（中文；英文版同樣結構）：

```
✋ 這次 push 先擋下來了（Project PM）

還沒驗收的改動：
  • T-03「加入登入頁」：3 個 commit，最新的是 a1b2c3d

為什麼要擋：沒有檢查過就上傳，壞掉的程式可能直接影響使用的人。

接下來可以：
  1. 請 AI 驗收：對 PM 說「驗收 T-03」，通過後再 push 一次。
  2. 這次確定不用驗收（例如只改說明文字）：
       git pm skip "只改說明文字"
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

**Claude Code 以外的平台已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。** 本節 Claude Code 以外的部分（7.2 表裡的其他列、7.3 表裡的其他欄）保留當紀錄，不會實作。核心不依賴特定平台的設計維持不變（MCP 工具、`hook <工具> <事件>`、使用者層級的資料、git 和 CI 的關卡），日後要重新支援其他平台也做得到，但目前不在計畫內。

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
| Codex（已取消） | 桌面版（ChatGPT 桌面 App）＋IDE 擴充 | 核心 MCP（和 CLI 共用 `config.toml`）＋AGENTS.md＋Skill；桌面版的「設定 > Hooks」 | 2（桌面版的 hook 能用就是 3） | 網頁看板 | 桌面版讀 AGENTS.md、IDE 的 hooks 都未確認 [X2][X3]；③ 開工時查 |
| Codex（已取消） | CLI | 核心 MCP＋AGENTS.md＋Skill＋hooks（command 處理方式） | 3 | 網頁看板 | MCP 工具預設 60 秒逾時；`exec` 只載入受信任專案的 MCP [X1][X6]；Stop 只能叫它繼續 |
| Antigravity（已取消） | 桌面（App、IDE） | 核心 MCP＋AGENTS.md＋Skill＋hooks（6 個事件，只有 command） | 3 | 網頁看板 | 外掛沒有 UI 元件 [A6] |
| Antigravity（已取消） | CLI（`agy`） | 同上 | 3 | 網頁看板 | `-p` 遇到需要核准的工具會拒絕但 exit 0，CI 要檢查輸出內容 [A7] |
| Gemini CLI（不支援，D11） | CLI | 不列為目標 | — | — | 個人與免費方案已停用 [G0]；要讀 AGENTS.md 得另外設定 [G2] |
| VS Code＋Copilot（已取消） | 編輯器 | 核心 MCP（`.vscode/mcp.json` 或使用者設定）＋AGENTS.md＋Skill；hooks 還在預覽 | 2（hooks 正式後是 3） | 網頁看板；之後可做 webview 擴充 [V6] | 也讀 `.claude/settings.json` 的 hooks，會重複執行 [V3] |
| Copilot（已取消） | CLI | 核心 MCP＋AGENTS.md＋Skill＋hooks | 3 | 網頁看板 | agentStop 連擋 8 次會強制結束 [H3] |
| Cursor（已取消） | 編輯器 | 核心 MCP＋AGENTS.md＋Skill＋hooks（18 個事件） | 3 | 網頁看板；可裝 Open VSX 擴充，面板能力未驗證 [U7] | stop 擋不了 [U3] |
| Cursor（已取消） | CLI（`agent`） | 核心 MCP（共用 `mcp.json`）＋AGENTS.md | 2（hooks 確認後是 3） | 網頁看板 | 只確認 workspaceOpen 會在 CLI 跑 [U3]；`-p` 沒有 `--force` 會拒絕 [U5] |
| Devin（原 Windsurf）（已取消） | 桌面 | 核心 MCP＋AGENTS.md＋Skill＋`.devin/hooks.v1.json` | 3 | 網頁看板 | Restricted Mode 下 hooks 不執行 [W1] |
| Devin（已取消） | CLI | 同桌面版（同一套 harness）[W1] | 3 | 網頁看板 | `-p` 的輸出格式未確認 [W6]；④ 開工時查 |

所有形態的硬關卡都一樣：pre-push＋CI（第 6 節）。

### 7.3 配備表（資料來源）

給 README 的「支援平台」表用。列是功能，欄是平台；每格寫「v0.9.0 現況 → 目標（在哪一版達成）」。版本對應第 8 節：v1.0 是 ①，v1.1 是 ②（遷移 E2：桌面版 mod 改用核心）。原本的 v1.2（③ Codex、Copilot、Antigravity）、v1.3（④ Cursor、Devin）和多人協作都已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）；表上這幾欄和多人協作那一列只留作紀錄（註腳 ᵏ、ᵐ）。

圖例：✅ 可用、◐ 部分、🗓 規劃中、— 不支援。「目標」都是計畫，各版做完、驗證過才能改成 ✅ 放進 README。標了 ⁽ˡ⁾ 的五欄只會驗證到不需要模型的部分，放進 README 時寫「✅ 未實測」或「◐ 未實測」，不能只寫 ✅（Q2）。

| 功能 | Claude Code 桌面版 | Claude Code CLI | Codex（已取消 ⁽ᵐ⁾） | Copilot（已取消 ⁽ᵐ⁾） | Antigravity（已取消 ⁽ᵐ⁾） | Cursor（已取消 ⁽ᵐ⁾） | Devin（已取消 ⁽ᵐ⁾） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 看板面板 | ✅ → ✅ | — 〔實測 `-p`；互動模式讀程式〕 → ✅ v1.0 ⁽ᵃ⁾ | — → ✅ v1.2 ⁽ᵃ⁾ | — → ✅ v1.2 ⁽ᵃ⁾ | — → ✅ v1.2 ⁽ᵃ⁾ | — → ✅ v1.3 ⁽ᵃ⁾ | — → ✅ v1.3 ⁽ᵃ⁾ |
| 文字看板 | ✅ → ✅ | — 〔實測〕 → ✅ v1.0 | — → ✅ v1.2 | — → ✅ v1.2 | — → ✅ v1.2 | — → ✅ v1.3 | — → ✅ v1.3 |
| 交辦清單 | ✅ → ✅ | — 〔實測〕 ⁽ᵇ⁾ → ✅ v1.0 | — → ✅ v1.2 | — → ✅ v1.2 | — → ✅ v1.2 | — → ✅ v1.3 | — → ✅ v1.3 |
| QA 關卡 | ✅ → ✅ | — 〔實測〕 ⁽ᵇ⁾ → ✅ v1.0 | — → ◐ v1.0 ⁽ᶜ⁾ → ✅ v1.2 | — → ◐ v1.0 ⁽ᶜ⁾ → ✅ v1.2 | — → ◐ v1.0 ⁽ᶜ⁾ → ✅ v1.2 | — → ◐ v1.0 ⁽ᶜ⁾ → ✅ v1.3 | — → ◐ v1.0 ⁽ᶜ⁾ → ✅ v1.3 |
| 交付判斷（git 和 CI） | ✅ → ✅ | — 〔讀程式〕 → ✅ v1.0 | — → ◐ v1.0 ⁽ᵈ⁾ → ✅ v1.2 | — → ◐ v1.0 ⁽ᵈ⁾ → ✅ v1.2 | — → ◐ v1.0 ⁽ᵈ⁾ → ✅ v1.2 | — → ◐ v1.0 ⁽ᵈ⁾ → ✅ v1.3 | — → ◐ v1.0 ⁽ᵈ⁾ → ✅ v1.3 |
| 即時追蹤 Session | ✅ → ✅ | — 〔實測＋讀程式〕 → ◐ v1.0 ⁽ᵉ⁾ | — → ◐ v1.2 ⁽ᵉ⁾⁽¹⁾ | — → ◐ v1.2 ⁽ᵉ⁾⁽²⁾ | — → ◐ v1.2 ⁽ᵉ⁾ | — → ◐ v1.3 ⁽ᵉ⁾⁽³⁾ | — → ◐ v1.3 ⁽ᵉ⁾ |
| Agent 派工 | ✅ → ✅ | — 〔實測〕 ⁽ᶠ⁾ → ◐ v1.0 → ✅ v1.1 | — → ◐ v1.2 ⁽ᵍ⁾ | — → ◐ v1.2 ⁽ᵍ⁾ | — → ◐ v1.2 ⁽ᵍ⁾ | — → ◐ v1.3 ⁽ᵍ⁾ | — → ◐ v1.3 ⁽ᵍ⁾ |
| 開發準則 | ✅ → ✅ | ◐ 〔讀程式，未實測〕 ⁽ʰ⁾ → ✅ v1.0 | — → ◐ v1.2 ⁽ⁱ⁾ | — → ◐ v1.2 ⁽ⁱ⁾ | — → ◐ v1.2 ⁽ⁱ⁾ | — → ◐ v1.3 ⁽ⁱ⁾ | — → ◐ v1.3 ⁽ⁱ⁾ |
| CI 真實資料掃描 | — ⁽ʲ⁾ → ✅ v1.0 | — ⁽ʲ⁾ → ✅ v1.0 | — ⁽ʲ⁾ → ✅ v1.0 | — ⁽ʲ⁾ → ✅ v1.0 | — ⁽ʲ⁾ → ✅ v1.0 | — ⁽ʲ⁾ → ✅ v1.0 | — ⁽ʲ⁾ → ✅ v1.0 |
| 多人協作 | — → 已取消 ⁽ᵏ⁾ | — → 已取消 ⁽ᵏ⁾ | — → 已取消 ⁽ᵏ⁾ | — → 已取消 ⁽ᵏ⁾ | — → 已取消 ⁽ᵏ⁾ | — → 已取消 ⁽ᵏ⁾ | — → 已取消 ⁽ᵏ⁾ |

Claude Code CLI 這一欄的 v0.9.0 現況來自第 0 步（[v1-cli-check.md](v1-cli-check.md)，Claude Code 2.1.326）。〔實測〕是用 `-p` 實際跑過的；〔讀程式〕是看程式碼判斷、沒有跑。其他欄的 v0.9.0 都是「—」，因為 mod 只能裝在 Claude Code；它們的目標來自查證報告和第 7.2 節，都還沒實測。

註腳（功能）：

- ⁽ᵃ⁾ 桌面版以外的「面板」是網頁看板（第 4 節），不在工具視窗裡。Claude Code CLI 在 v0.9.0：`-p` 實測開不出面板（`ui.open: no-surface`）；互動模式沒實測，讀程式判斷面板會開，但只顯示「讀不到 Session 清單」，所以算不支援。
- ⁽ᵇ⁾ 實測：board、ledger 只在 `/pm` 成功後才註冊，而 `/pm` 在 CLI 失敗（拿不到 Session id）。用假的 Session id 繞過後，ledger 和 QA 關卡都正常，所以邏輯本身可用，卡在身分。
- ⁽ᶜ⁾ v1.0 起 pre-push hook 和 CI 範本不管用哪個 AI 工具都有效（第 6 節），所以是「部分」；要在交辦清單結案時擋，得等該平台接上核心的 MCP。
- ⁽ᵈ⁾ v1.0 起在終端機跑 `project-pm board` 就看得到這個 repo 的 git 和 CI 事實（第 1 層），但分不出是哪個 Session 做的；接上 MCP 和 hook 後才對得到 Session。
- ⁽ᵉ⁾ 「部分」= 第 3 層：靠 hook 在每輪結束、工具呼叫時自動回報，網頁看板列出回報過的 Session；沒有平台的 Session 清單 API，看不到沒裝 hook 的 Session，也不能封存、開新 Session。只有 Claude Code 桌面版有第 4 層。Claude Code CLI 在 v0.9.0：實測 report 回「已回報」但沒寫任何檔（假成功）；讀程式確認任務清單、收尾摘要、通知 PM 都因為沒有 Session id 而丟掉。
- ⁽ᶠ⁾ 實測：用假的 Session id 繞過 `/pm` 後，背景執行、worktree、附加說明、通知截短都正常；正式 CLI 沒有 PM 身分，所以都不會發生。v1.0 是「部分」，因為 v1.0 不改 mod（遷移 E1），PM 要靠 Skill 的指示自己附說明；v1.1 mod 改用核心的身分後恢復自動改寫。
- ⁽ᵍ⁾ 其他平台的子代理機制各不相同，v1 只做到：Skill 指示 PM 把說明附進子代理的 prompt、子代理用 `report` 回報、Agent 紀錄存進核心。像 Claude Code 那樣自動改寫子代理呼叫（強制背景、隔離、截短通知），要看各平台的 PreToolUse 能否改寫參數（Codex 可以 [X3]，其他未確認），該版開工時評估。
- ⁽ʰ⁾ 讀程式：準則由 `prompt.compose` 放進提示，不需要 Session id，所以「PM 在桌面版、這個 Session 在 CLI」時 CLI 會拿到準則（實測確認同一條路徑的交付指示有放進 CLI 的提示）；但 CLI 自己當不了 PM。改準則檔的擋法（`tool.call`）也不需要 id。這次的測試沒設定準則檔，所以沒實際驗證。v1.0 改由使用者層級的 UserPromptSubmit hook 每輪放進提示，不再依賴 PM 在桌面版。
- ⁽ⁱ⁾ 「部分」：AGENTS.md 段落指向準則檔，靠 AI 自己去讀（第 2 層）；「沒問過不能改準則檔」靠各平台的 PreToolUse 類 hook。能不能像 Claude Code 一樣每輪自動放進提示，看各平台有沒有對應的 hook 事件，該版開工時查證。
- ⁽ʲ⁾ v0.9.0 只有本 repo 自己的 CI 有這一步（qa.md 第 7 節），使用者的專案沒有。v1.0 的 CI 範本（第 6.3 節）是 GitHub Actions，和用哪個 AI 工具無關，所以所有欄同時變成 ✅。
- ⁽ᵏ⁾ 多人協作已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。原本的規劃是 v1.1 透過 `gh` 同步到 GitHub Issues（第 10 節，留作紀錄）。README 的配備表拿掉這一列。
- ⁽ᵐ⁾ Codex、Copilot、Antigravity、Cursor、Devin 這五欄已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。「→」後面的目標只留作紀錄；README 的配備表只留 Claude Code 桌面版和 CLI 兩欄。
- ⁽ˡ⁾ （隨 ⁽ᵐ⁾ 一起不再適用）未實測（Q2 定案）：使用者除了 Claude 之外沒有其他平台的訂閱或帳號，這五個平台不會用 AI 實際跑。驗證只到不需要模型的部分：MCP 協定、`init` 寫出的設定檔、hook（用錄好的事件 JSON），以及 `init`／`uninstall` 還原（第 8 節 ③ ④）。例外是和 AI 工具無關的兩列（CI 真實資料掃描、多人協作），它們在 CI 和 Claude Code 上驗證過就算數。

註腳（同一平台的桌面版和 CLI 有差異）：

- ⁽¹⁾ Codex：CLI 的 hooks 已正式推出；桌面版（ChatGPT 桌面 App）有「設定 > Hooks」，IDE 擴充的 hooks 未確認 [X3]，桌面版讀 AGENTS.md 也未逐字確認 [X2]。IDE 擴充可能只到第 2 層。
- ⁽²⁾ Copilot：CLI 的 hooks 已正式支援 [H3]；VS Code 的 hooks 還在預覽 [V3]，正式前 VS Code 只到第 2 層。VS Code 也會讀專案的 `.claude/settings.json` hooks，所以 hooks 要放使用者層級（第 5.3 節）。
- ⁽³⁾ Cursor：編輯器有 18 個 hook 事件；CLI 只確認 workspaceOpen 會跑 [U3]，確認前 Cursor CLI 只到第 2 層。
- Antigravity、Devin：桌面版和 CLI 用同一套 hook [A3][W1][W2]，表上沒有差異；差別只在 headless 測試（Antigravity `-p` 被拒絕仍 exit 0 [A7]、Devin `-p` 輸出格式未確認 [W6]），不影響功能。

## 8. 分版計畫

**2026-11-20 的分版調整（使用者決定，9.2 節）**：只支援 Claude、專注單人作業。分版改成 ① v1.0（這一版）、② v1.1 E2（桌面版 mod 改用核心）。② 原本的多人協作、③ v1.2（Codex、Copilot、Antigravity）、④ v1.3（Cursor、Devin）都取消，下面保留當紀錄。核心不依賴特定平台的設計維持不變（MCP 工具、`hook <工具> <事件>`、使用者層級的資料、git 和 CI 的關卡），日後要重新支援其他平台也做得到，但目前不在計畫內。

每一版都遵守：新功能先擴充、不刪舊的；每版有獨立的回復方法；沒跑到的驗證如實寫在 release 說明。

測試不花錢（D9）：

- CI（GitHub Actions，公開 repo 的免費額度）只跑不需要 AI 模型的測試：單元、MCP 協定、hook、看板、安裝。每次 PR 都跑。
- 需要模型的冒煙測試（headless 跑固定劇本）CI 不跑，改成發版前在本機手動跑，用使用者現有的訂閱額度，不另外申請 API 金鑰。
- 用 AI 實際跑的冒煙測試只有 Claude Code（使用者的 Claude 訂閱）。原本 Q2 對其他平台「只驗證不需要模型的部分、標未實測」的安排，隨其他平台取消而不再適用。

release 說明固定要寫的已知限制（Q1、Q3 定案）：

- 執行檔沒有程式碼簽章。Windows 開著「智慧型應用程式控制」時可能直接擋下、沒有放行按鈕；遇到這種情況改用 npm 版，要先裝 Node（README 的安裝說明也寫）。
- macOS 版：「放行步驟未在實機驗證」（沒有 Mac）。執行檔本身在 CI 的 macOS runner 上跑過測試。
- （原本 v1.2 起要寫「哪些平台未實測」，隨其他平台取消而不再適用。）

### ① v1.0：Claude Code CLI、核心、網頁看板、hook 和 CI 範本、單一執行檔

範圍：

- `core/`：純函式（從 `hooks/` 搬，見 1.4 節）、Node 層、MCP server（stdio＋Streamable HTTP）、`board`、`ledger`、`report`、`pm` 四個工具。工作項目從這一版起寫 10.1 節的欄位（`uid`、`createdBy`、`updatedBy`、`rev`）。原本是為 v1.1 的同步做準備；同步已取消，欄位保留，理由見 10.1 節。
- 單一執行檔：GitHub Actions 的建置和 release workflow、`SHA256SUMS`、白話的安裝和放行說明（5.5 節），以及 README 和 release 說明裡的已知限制（本節開頭）；npm 套件同時發布。
- 網頁看板（唯讀，第 4 節）。
- `init`、`uninstall`：只支援 Claude Code（CLI）；偵測到桌面版 mod 時只提示、不加 MCP 設定（3.7 節）。
- `hook claude-code <事件>`：Stop、UserPromptSubmit、PostToolUse（TodoWrite、背景指令）寫 actor 紀錄；UserPromptSubmit 同時把開發準則和交付指示放進提示（取代 mod 的 `prompt.compose`，CLI 不用等 PM 在桌面版）。準則檔的事後偵測（D17）：寫入類工具執行後、通知喚醒時、一輪結束時，比對這個 Session 這一輪開始時的基準（準則檔和準則設定），使用者沒同意就警告；只偵測、只警告，不自動還原。
- pre-push hook、`skip`（`git pm skip`）、CI 範本。
- 資料遷移 E1（雙寫）。
- 修 report 的假成功（核心這邊；mod 那邊在 v1.1 改）。
- 桌面版 mod：**不改**（E1 期間 mod 照舊）。

先查證再實作的事：MCP 子行程拿不拿得到 Session id（1.5 節）；外掛安裝會不會帶上 `core/`（1.4 節）；mod 在終端機互動模式的面板（v1-cli-check.md 第 4 節沒實測）；Node SEA 和 Bun 哪個編得出能正常跑的執行檔（5.5 節）；Windows「智慧型應用程式控制」實際怎麼擋（5.5 節；已定案列為已知限制，查的是 README 要怎麼描述）。

驗證：

| 類別 | 做什麼 | 何時跑 |
| --- | --- | --- |
| 單元測試 | 核心的純函式；把現有 `tests/pm.test.ts` 裡對應的案例（交付判斷、QA、看板文字）改成直接呼叫核心，中英文各一；新項目有 `uid`、`createdBy`、`rev`，舊項目沒被修改時不補欄位 | 每次 PR（CI） |
| MCP 協定測試 | 用 MCP SDK 的 client 啟動 `project-pm mcp`（stdio）和 `serve`（HTTP），列工具、呼叫每個工具、檢查 `content` 和 `structuredContent`；不需要模型 | 每次 PR（CI）；Windows、macOS、Linux |
| 單一執行檔 | 在三個作業系統建置執行檔，用建置出來的檔（不是原始碼）跑一次 MCP 協定測試和 `--version` | 每次 PR（CI）；三個作業系統 |
| 並行寫入 | 10 個行程各寫 100 次，revision、項目數正確；舊格式雙寫的合併，含新欄位從核心那份補回 | 每次 PR（CI） |
| 網頁看板 | 375px、1280px、淺色、深色截圖；安全：沒 token 回 401、偽造 Host 回 403、非本機 Origin 打 `/mcp` 回 403、只聽 127.0.0.1 | 每次 PR（CI） |
| git hook | bare repo 當遠端的六種情況（6.2 節），含 `git pm skip` | 每次 PR（CI）；三個作業系統 |
| 安裝 | `init` → 檢查 → `uninstall` → 檔案和安裝前完全相同（第 5 節的各種情況）；用建置出來的執行檔跑。`claude mcp add`、`claude mcp list` 不需要模型（是否需要登入，實作時確認；需要的話這一項改成發版前手動） | 每次 PR（CI）；三個作業系統 |
| CI 範本 | 對 Acme demo 假專案（放假金鑰、舊套件、假禁用詞）跑範本，確認每步都擋、訊息正確 | 每次 PR（CI） |
| 下載和放行 | 從 release 下載執行檔，照安裝說明在 Windows 上放行並跑 `init`。macOS 沒有實機（Q3），不驗證，release 說明標「放行步驟未在實機驗證」 | Windows：發版前手動一次（CI 模擬不了 SmartScreen）。macOS：不跑 |
| Claude Code 冒煙測試（需要模型） | `claude -p --mcp-config <核心設定> --output-format json` 在 Acme demo 上跑固定劇本：新增工作、回報、結案被 QA 擋、記錄 QA 後結案。檢查 JSON 結果和核心的資料檔，不只看 exit code | 發版前在本機手動跑，用使用者現有的 Claude 訂閱（Claude Code 已登入的帳號），不另外申請 API 金鑰；CI 不跑（D9） |
| 遷移 | 用舊格式的假資料跑 E1，舊 mod（v0.9.0）同時開著，兩邊都看得到對方寫的 | 發版前手動一次 |

回復：

- 執行檔：在 GitHub Releases 把有問題的版本改成 pre-release 並在說明加上警告，「最新版」就回到上一版；使用者下載上一版再跑一次 `init`，設定改指回舊版本的檔（5.5 節）。npm：`npm deprecate` 有問題的版本，`init` 寫的是釘選版本（`project-pm@1.0.x`），改回上一版重跑 `init` 即可。
- 設定：`project-pm uninstall`。
- 資料：E1 雙寫，舊路徑一直完整；移除核心等於回到 v0.9.0，桌面版完全不受影響。

### ② v1.1：E2（桌面版 mod 改用核心）

範圍：原本 Q4 定的「多人協作＋E2」，多人協作已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節），v1.1 只做 E2。

- **E2**（2.4 節）：桌面版 mod 改用核心的資料和身分；mod 這邊的 report 假成功一起修掉；mod 在核心已提供 `project-pm` MCP 時不再自己註冊工具（3.7 節）。

驗證：

- E2：同 2.4 節，用舊格式的假資料，新版 mod 和核心同時開著，兩邊都看得到對方寫的；舊路徑仍完整。發版前手動一次。
- 需要模型的冒煙測試：同 v1.0，只跑 Claude Code（桌面版和 CLI），用使用者的 Claude 訂閱在本機手動跑。

回復：E2 出問題時 mod 退回 E1 版本，舊路徑仍完整。

### ③ v1.2：Codex、Copilot、Antigravity（已取消）

**已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。以下保留當紀錄，不會實作。**

範圍：`init` 支援 Codex（CLI、桌面版）、Copilot（CLI、VS Code）、Antigravity（CLI、桌面）；各自的 `hook <工具> <事件>`；AGENTS.md 大小檢查（Codex 32 KiB）；處理 Copilot 重複執行 Claude 的 hooks。

先查證：報告裡這幾個平台的未確認項目（Codex 桌面版讀 AGENTS.md、Codex IDE 的 hooks、Antigravity 的外掛面板）；各平台 hook 事件 JSON 的欄位（Session id、cwd）；MCP 設定檔的確切路徑和寫法；各工具列出 MCP 設定的指令（例如 `codex mcp list`）不登入能不能跑。

驗證（Q2 定案：**未實測**）：

- 使用者沒有這三個平台的訂閱或帳號，所以不用 AI 實際跑。只驗證不需要模型的部分，每次 PR 在 CI 跑：MCP 協定（用 MCP SDK 的 client 模擬這個工具連進來）、`init` 寫出的設定檔內容、用錄好的事件 JSON 餵 `hook <工具> <事件>`、`init`／`uninstall` 還原。工具本身的列出設定指令不登入也能跑的話，一起在 CI 跑。
- release 說明和配備表標「未實測：只驗證到 MCP 協定、設定檔和 hook，沒有用 AI 實際跑過」。
- 日後有帳號時可以用的冒煙測試指令（現在不跑）：`codex exec --json`（要先把工作目錄設成受信任，否則不載入 MCP [X6]）、`copilot -p --output-format=json` [H5]、`agy -p`（輸出 json；不能只看 exit code，要檢查結果裡有沒有被拒絕的工具 [A7]）。

回復：每個平台的轉接是獨立的（`init --tool codex`、`uninstall --tool codex`），一個平台出問題只移除那一個，不影響其他。

### ④ v1.3：Cursor、Devin（已取消）

**已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。以下保留當紀錄，不會實作。** 資料遷移的 C1 原本排在這之後（v1.4 以後），現在沒有排進任何一版（2.4 節）。

範圍：`init` 支援 Cursor（編輯器、CLI）、Devin（桌面、CLI）；各自的 hook。可以評估 VS Code 系的 webview 擴充（Cursor、Devin 都能裝 Open VSX 擴充）當第 4 層的面板。資料遷移的 C1 不在這一版，等 ③ ④ 都穩定一個版本以上（v1.4 以後）。

先查證：Cursor CLI 的 hooks 和子代理、Devin CLI `-p` 的輸出格式、兩者擴充的面板能力（報告標未確認）。

驗證（Q2 定案：**未實測**）：同 ③。使用者沒有這兩個平台的帳號，只在 CI 驗證 MCP 協定、設定檔、hook、`init`／`uninstall`；release 說明和配備表標「未實測」。日後有帳號時可用的指令（現在不跑）：`agent -p --force --output-format json`（Cursor 管理員可以關掉這個模式 [U5]）、`devin -p`（格式查證後再寫檢查）。

回復：同 ③，各平台獨立；C1 之後要回去需要 `project-pm export --legacy`，所以 C1 要等 ③ ④ 都穩定一個版本以上再做。

## 9. 已定案的取捨

使用者在 2026-11-19 逐項決定。D2、D3、D9 和草案的建議不同，草案的建議寫在最後一欄的「原本的建議」供對照。

| # | 問題 | 結論 | 定案日期 | 理由與影響的章節 |
| --- | --- | --- | --- | --- |
| D1 | 交辦清單存在哪 | A：使用者層級 `~/.project-pm/`，不進 git | 2026-11-19 | 照原建議。個資不外流；同一台電腦的工具都能共用；Vibe Coder 不用管 `.gitignore`（2.1 節）。多人共用原本改走 D2 的 GitHub 同步，不是把檔案放進 git（D2 已在 2026-11-20 取消，9.2 節） |
| D2 | 要不要支援多人協作 | **2026-11-20 取消（9.2 節），以下是當時的結論，只留作紀錄。** 要做，當 v1.1 的主打。 v1.0 不同步，但工作項目先帶齊同步需要的欄位（`uid`、`createdBy`、`updatedBy`、`updatedAt`、`rev`），v1.1 不用遷移資料。v1.1 透過 `gh` 同步到 GitHub Issues（Projects 選填），不架伺服器；預設關閉，公開 repo 要警告並明確同意，上傳前用 `BLOCKED_TERMS` 同一份名單掃描，命中就擋 | 2026-11-19 | 原本的建議：v1 不支援，之後評估 GitHub Issues。改變的原因：使用者要把它當 v1.1 亮點。影響：摘要、1.3、2.1～2.4、3.3、7.3、第 8 節 ②、第 10 節（新增） |
| D3 | 怎麼發佈 | **主要發布各作業系統的單一執行檔**（Windows、macOS、Linux），用 Node SEA 或 Bun 編譯，在 GitHub Actions 建置；npm 套件保留給開發者。不買程式碼簽章憑證，列為已知限制；`init` 不幫使用者裝 Node、不改系統 | 2026-11-19 | 原本的建議：先 npm、之後加單一執行檔。改變的原因：使用者不希望 Vibe Coder 另外安裝執行環境。代價：每個檔約 50～100 MB；沒有簽章時 Windows 會跳 SmartScreen、macOS 會擋，安裝說明要用白話教怎麼放行（5.5 節）。影響：摘要、1.2、2.2、5.2、5.4、5.5、6.2、第 8 節 |
| D4 | 網頁看板能不能操作 | 唯讀 | 2026-11-19 | 照原建議。只讀就沒有跨站請求的風險；操作仍透過 PM，關卡規則只有一個入口（4.2 節） |
| D5 | 看板 port | 固定預設，被占用時往後找 | 2026-11-19 | 照原建議。書籤、說明文件都好寫；實際 port 記在 `server.json`（4.3 節） |
| D6 | 程式碼放哪 | 同一個 repo，分 `core/`、`hooks/` | 2026-11-19 | 照原建議。mod 用相對路徑 import 核心的純函式，一次改動一個 PR、一份 CHANGELOG（1.4 節） |
| D7 | 版號 | 核心和 mod 共用一個版號，從 1.0.0 開始 | 2026-11-19 | 照原建議。遷移階段靠版號判斷（2.4 節），共用最不會錯 |
| D8 | pre-push 的略過方式 | `skip` 指令；`--no-verify` 事後在看板標出 | 2026-11-19 | 照原建議。不分終端機都一樣；理由留在看板上。因為 D3 不再假設有 Node，指令的寫法從 `npx project-pm skip` 改成 `init` 設定的 `git pm skip`（6.2 節） |
| D9 | 需要模型的測試怎麼跑 | **不花錢。** CI 不跑需要 AI 模型的測試。不需要模型的測試（MCP 協定、hook、看板、安裝）每次 PR 都跑，用 GitHub Actions 的免費額度。需要模型的冒煙測試改成發版前在本機手動跑，用使用者現有的訂閱額度，不另外申請 API 金鑰 | 2026-11-19 | 原本的建議：每週＋手動，用便宜的模型、設花費上限。改變的原因：使用者不花錢。影響：摘要、第 8 節各版的驗證、10.5 節的驗證 |
| D10 | 桌面版 mod 在 v1 之後的角色 | 保留，當轉接層（面板、Session 清單、第 4 層） | 2026-11-19 | 照原建議。桌面版是唯一有第 4 層的形態 |
| D11 | Gemini CLI | 不支援 | 2026-11-19 | 照原建議。個人與免費方案已停用 [G0]，目標使用者用不到 |
| D12 | CI 範本預設開哪些檢查 | 四項全開，偵測不到測試時顯示「略過」而不是失敗 | 2026-11-19 | 照原建議。Vibe Coder 不知道該選哪些；全開但不因為「沒有測試」就擋（6.3 節） |
| D13 | `init` 預設要不要直接改檔 | 只顯示差異，`--yes` 才改 | 2026-11-19 | 照原建議。改的是使用者的 AI 工具設定和專案檔，先讓人看到（5.1 節） |

### 9.1 寫入決定時發現的問題（已定案）

寫入 D1～D13 時發現的四個問題，使用者在同一天決定：

| # | 問題 | 結論 | 定案日期 | 理由與影響的章節 |
| --- | --- | --- | --- | --- |
| Q1 | Windows「智慧型應用程式控制」擋下未簽章的執行檔時怎麼辦 | 列為已知限制，不申請簽章。README 和 release 說明寫明：遇到這種情況改用 npm 版，要先裝 Node | 2026-11-19 | 和 D3 一致：不花錢、不另外申請。這是少數會要使用者裝 Node 的情況，所以要寫清楚。影響：5.5 節、第 8 節開頭的「release 說明固定要寫的已知限制」 |
| Q2 | 使用者沒有訂閱的平台怎麼做冒煙測試 | 使用者除了 Claude 之外沒有其他平台的訂閱或帳號。Codex、Copilot、Antigravity、Cursor、Devin 都不用 AI 實際跑，只驗證不需要模型的部分（MCP 協定、設定檔、hook）；配備表和 release 說明標「未實測」。**2026-11-20 起不再適用**：只支援 Claude（9.2 節），README、release 說明和 CHANGELOG 拿掉這條已知限制 | 2026-11-19 | 和 D9 一致：不花錢、不另外申請帳號。影響：7.3 節（圖例和註腳 ˡ）、第 8 節開頭和 ③ ④ 的驗證 |
| Q3 | macOS 的下載和放行步驟由誰實機走一次 | 使用者沒有 Mac，不驗證。macOS 版的 release 說明標「放行步驟未在實機驗證」；執行檔本身仍在 CI 的 macOS runner 上跑測試 | 2026-11-19 | 如實回報沒驗到的部分。影響：5.5 節、第 8 節 ① 的驗證和 release 說明 |
| Q4 | v1.1 的範圍是否太大 | 拆開。v1.1：多人協作＋E2（桌面版外掛改用核心）。v1.2：Codex、Copilot、Antigravity。v1.3：Cursor、Devin。資料遷移的 C1 順延到 v1.4 以後。**2026-11-20 改（9.2 節）**：v1.1 只有 E2；v1.2、v1.3 取消；C1 沒有排進任何一版 | 2026-11-19 | 讓 v1.1 專心在主打的多人協作。影響：摘要、1.5、2.4、5.2、7.2、7.3、第 8 節、第 11 節 |

### 9.2 2026-11-20 的變更（已定案）

使用者在 2026-11-20 決定（同一天稍早曾先決定只拿掉 Devin、把 v1.2 和 v1.3 合併，最後定為下表）：

| # | 問題 | 結論 | 定案日期 | 理由與影響的章節 |
| --- | --- | --- | --- | --- |
| D14 | 多人協作（D2）還做不做 | **取消，不會實作。** 第 10 節的設計只留作紀錄。v1.0 已經寫的 `uid`、`createdBy`、`updatedBy`、`rev` 保留 | 2026-11-20 | 只支援 Claude、專注單人作業（理念：「人人都成為 CEO」）。欄位保留：刪欄位要分兩版（開發準則第 7 條），`uid` 和 `rev` 在多個行程同時寫入時本來就有用（10.1 節）。影響：摘要、1.2、1.3、2.1～2.3、3.3、7.3、第 8 節、D2、第 10 節、README 的配備表 |
| D15 | 要支援哪些平台 | **只支援 Claude**（Claude Code 桌面版和 CLI）。Codex、Copilot、Antigravity、Cursor、Devin 都取消，原本的 v1.2、v1.3 取消 | 2026-11-20 | 只支援 Claude、專注單人作業。核心不依賴特定平台的設計維持不變（MCP 工具、`hook <工具> <事件>`、使用者層級的資料、git 和 CI 的關卡），日後要重新支援其他平台也做得到，但目前不在計畫內。Q2「其他平台未實測」的已知限制不再適用。影響：摘要、2.1、5.1、5.2、第 7 節、7.3、第 8 節、Q2、Q4、README 的配備表、`core/README*`、release 說明、CHANGELOG `[1.0.0]` |
| D16 | 分版 | ① v1.0（這一版）；② v1.1：E2（桌面版 mod 改用核心）。資料遷移的 C1 沒有排進任何一版 | 2026-11-20 | 多人協作和其他平台都取消後只剩 E2。影響：摘要、2.4、7.3、第 8 節、Q4 |
| D17 | 準則檔被改了，事後偵測要不要自動還原 | **只偵測、只警告，不自動還原（A 案）。** 每個 Session 在使用者說話時記下準則路徑的基準（內容 hash、是不是連結、連到哪裡、實際位置），key 是 Session id 加上設定的準則路徑；這個 Session 的寫入類工具執行後、通知喚醒時、一輪結束時重新比對。內容變了、被清空、被刪除、變成連結或改連到別處、變成讀不到的網路路徑，而且這一輪使用者沒同意改準則，就告訴 AI，並列進看板的「需要處理」七天，歸屬寫發現它的 Session，文字寫「可能是這個 Session、其他 Session 或你自己改的」，附上還原方法：`~/.project-pm/guidelines/copies/` 裡的唯讀備份，內容是使用者上一次說話時（或之後同意修改時）的準則檔，同一輪第二次未經同意的改動也沿用同一份。基準替這一輪看過的每個檔各留一份，準則在同一輪內被關掉再打開、或被 `git rm --cached` 再 `git add` 回來，也還是指向這一份（第四輪 QA 必須修 2）；這一輪中途才被指定的檔，備份是當時的內容，警告寫明不一定是使用者同意過的；專案的準則檔另外附 `git log -p`。不給 `git checkout`：改動已經 add 或 commit 時，它會還原成被改過的版本（第三輪 QA 必須修 2）。專案的準則檔只有在確實位於 repo 裡面時才備份。準則設定被改（`git rm`／`git mv` 準則檔、改了 `.project-pm.json`、關掉或打開準則、從專案的檔退到使用者的檔、設定讀不到）也一樣警告（第三輪 QA 必須修 1），基準跟著新設定重記，不拿新檔比對舊檔。Project PM 絕不寫入、改名或刪除準則檔 | 2026-11-20 | 自動還原必須跨 Session 判斷「是誰改的、有沒有經過同意」。使用者常同時開好幾個 Session，兩輪 QA 都發現判斷會錯：誤還原同意過的修改、把偷改的內容洗白、換成連結就能躲過；錯的時候還會蓋掉使用者自己的修改。警告不改任何東西，誤報的代價很低。抓不到故意繞過的修改（自己跑 hook 重記基準、刪掉基準檔），README 的已知限制寫明。影響：第 8 節 v1.0 範圍、CHANGELOG `[1.0.0]`、`core/README*` |

## 10. 多人協作（已取消）

**已取消（2026-11-20，使用者決定：只支援 Claude、專注單人作業，見 9.2 節）。本節不會實作，內容保留作為當時的設計紀錄。** 原本的 D2：多人協作是 v1.1 的主打。v1.0 不同步，但資料結構先準備好，v1.1 打開同步時不用遷移資料。

目標情境：兩三個人（或同一個人的兩台電腦）做同一個 GitHub repo，各自用自己的 AI 工具和 PM，看到同一份交辦清單和 QA 紀錄；誰建的、誰改的、誰驗收的都看得出來。

### 10.1 v1.0 先帶的欄位

**這些欄位保留（D14）。** 多人協作取消後，v1.0 已經寫進資料的 `uid`、`createdBy`、`updatedBy`、`rev` 不刪：

- 刪欄位要分兩版（開發準則第 7 條）：先停止使用、再移除，v1.0 已經寫出去的檔才不會被下一版讀壞。
- `uid` 和 `rev` 在單人作業也有用：每個 AI Session 各自啟動一個 `project-pm`，同一個專案常有好幾個行程同時寫（1.3 節）。`rev` 記下每一項被寫過幾次（E1 合併時也加 1），查遺失的更新、比兩份副本時是線索；`uid` 是不靠本機數字序號的穩定 id。目前的程式只寫入它們、不靠它們做判斷：E1 合併比的是數字 `id` 和 `updatedAt`（2.4 節）。
- `createdBy`、`updatedBy` 記下是哪個 Session 或 Agent 建立、最後修改這一項；目前沒有功能依賴它們（QA 關卡比的是負責人和驗收者），留著不影響任何行為，要拿掉也得照第 7 條分兩版。

都是選填的新欄位，遵守 2.3 節「只擴充」：舊欄位不改型別、不改意思；舊檔沒有就當沒有；寫回時不幫舊項目補欄位。

| 欄位 | 型別 | 意思 | 什麼時候寫 |
| --- | --- | --- | --- |
| `uid` | string | 工作項目的穩定唯一 id，用 UUID v7（前段是時間、後段是亂數），不同電腦同時新增也不會撞號。現有的數字 `id` 和 `T-03` 代號照舊，只是「這台電腦上的短代號」 | v1.0 起新增的項目，建立時寫。舊項目在 v1.1 第一次同步時才補（同步前只有一台電腦有它，不會撞號） |
| `createdBy` | `Author` | 建立者 | 建立時 |
| `updatedBy` | `Author` | 最後修改者 | 每次修改 |
| `updatedAt` | number | 修改時間（原有欄位，意思不變） | 每次修改 |
| `rev` | number | 這一項的修改次數，每改一次加 1。v1.1 用它和上次同步時的值比，判斷哪一邊改過 | 每次修改；舊項目第一次被核心修改時從 1 開始 |
| `QaRecord.byPerson` | string | 驗收者是哪個人（`by` 仍是 Session 或 Agent id） | 記錄 QA 時 |

```ts
type Author = {
  actor: string     // Session 或 Agent 的 id（1.5 節），只在這台電腦有意義
  person?: string   // 哪個人：GitHub 帳號（gh 有登入時取 `gh api user` 的 login，快取在記憶體）；沒登入就不寫
}
```

為什麼要分 `actor` 和 `person`：多人協作看的是「哪個人」，但 PM 的關卡（負責人不能驗收自己的工作、Agent 要先合併才能結案）看的是「哪個 Session 或 Agent」。兩個都留，v1.1 才不用回頭猜。

`ProjectFile.revision`（2.3 節）不變，仍是整個檔的寫入次數，給看板判斷要不要重畫；`rev` 是單一項目的，給同步判斷衝突。

### 10.2 v1.1 的同步方式

- **對象**：專案 git 的 `origin` 所在的 GitHub repo（`gh repo view` 取得）。工作項目同步成 Issues；GitHub Projects 只當選填的顯示看板，資料以 Issues 為準（用 Projects 要多一個 `project` 權限，使用者自己 `gh auth refresh -s project`）。
- **認證**：沿用 `gh` 的登入，核心不存任何 token，不架伺服器，不需要使用者額外申請任何東西。`gh` 沒登入時同步不啟動，看板寫明原因和 `gh auth login` 的說明。
- **時機**：`project-pm sync` 手動跑一次；開啟同步後，`board`、`ledger` 被呼叫時若距離上次同步超過 60 秒就在背景同步（不違反 3.1 節「10 秒內回」，先回本機資料）。讀取用 ETag 條件式請求，沒變的回 304，不吃 GitHub 的 API 額度。
- **本機仍是主要的**：離線、`gh` 出錯、GitHub 掛掉時一切照舊，只是看板的同步欄寫「上次同步：…前，失敗原因：…」，下次再補。
- **同步狀態**：`~/.project-pm/sync/<專案名>-<hash>.json`，記每個 `uid` 對到哪個 Issue、上次同步時兩邊的內容（三方合併的基準）、ETag。
- **不同步的**：PM 是誰（`pmId`）、Session 和 Agent 的紀錄、回報的詳細檔、看板設定。這些只在本機有意義，而且最常夾帶細節。每個人有自己的 PM。

對應關係：

| project-pm | GitHub | 說明 |
| --- | --- | --- |
| 工作項目 | 一個 Issue，加 label `project-pm` | GitHub 上手動開、加了這個 label 的 Issue 也會變成工作項目 |
| `text` | Issue 標題（第一行）＋內文 | |
| `criteria`、`note`、`commits` | 內文的「驗收條件」「備註」「相關 commit」段落 | |
| `status` | `open` → 開啟；`done` → 關閉（completed）；`dropped` → 關閉（not planned） | |
| 負責人 `owner` | Assignee：負責人的 `person` | Session 或 Agent 的 id 不上傳；別人的看板顯示「@帳號 的 Session」 |
| QA 紀錄 | 一則 Issue 留言（固定格式：結果、驗收者的帳號、commit、說明），另加 label `qa:pass`、`qa:fail` 或 `qa:skipped` 顯示最新結果 | 留言只增不改，所以 QA 的歷史在 GitHub 上完整留著；本機的 `qa` 仍是最新一筆 |
| `uid`、`rev` | 內文最後的隱藏標記 `<!-- project-pm:v1 uid=… rev=… -->` | 讓兩台電腦認得同一項 |
| `createdBy`、`updatedBy` 的 `person` | Issue 作者、最後編輯者（GitHub 自己記） | `actor` 不上傳 |
| 代號 | Issue 編號 `#12` | 同步過的項目在每台電腦都顯示 `#12`，對話裡說「#12」大家指的是同一項；還沒同步的照舊顯示 `T-05`。`ledger` 的 `id` 兩種都收 |

pre-push 關卡（6.2 節）在多人時照樣成立：QA 紀錄的 `sha` 和項目的 `commits` 會同步，所以 A 驗收過的 commit，B push 時也認得。

### 10.3 衝突怎麼處理

用三方比較：本機現在的內容、GitHub 現在的內容、上次同步時的內容（同步狀態檔裡的基準）。

| 情況 | 處理 |
| --- | --- |
| 只有一邊改過（比 `rev` 和 Issue 的 `updated_at`） | 用改過的那一邊 |
| 兩邊都改，但改的是不同欄位 | 逐欄合併，兩邊的修改都留下，`rev` 加 1 後寫回兩邊 |
| 兩邊把同一個欄位改成不同的值 | **不自動選**。兩邊都不覆蓋，這一項標成「同步衝突」列進看板的需要處理，並排顯示兩個版本。使用者或 PM 用 `ledger update` 寫入要的版本（`rev` 加 1，下次同步就以它為準），或用 `project-pm sync resolve <代號> --keep local｜github` |
| QA 紀錄 | 留言只增不改，兩邊的都留下；本機的 `qa` 取時間最新的一筆。若上次同步後兩邊記了**不同的結果**，列為衝突，衝突解決前結案關卡當成「還沒通過」 |
| `commits` | 取聯集 |
| 有人在 GitHub 網頁上直接關掉 Issue | 照 GitHub 的狀態改成 `done` 或 `dropped`（GitHub 是共用的事實，不能假裝沒發生）；如果沒有通過的 QA 紀錄，看板列出「在 GitHub 上直接關閉，沒有驗收紀錄」 |
| Issue 被刪除或轉到別的 repo | 本機不刪，標「GitHub 上已不存在」列進需要處理，由使用者決定 |
| 寫入時剛好有人也在寫 | GitHub 的寫入 API 不支援條件式更新（實作時查證），所以「寫之前重讀、寫完再讀一次比 `rev` 標記」；不一致就當成兩邊都改，回到上面的規則 |

### 10.4 隱私

同步會把交辦文字送到 GitHub。即使之後改掉，Issue 的編輯紀錄仍看得到，所以防線要在上傳之前。

- **預設關閉**。只能在終端機用 `project-pm sync on` 開啟，MCP 工具不提供開啟的功能，AI 不能自己決定上傳。開啟時用白話列出會上傳什麼、不會上傳什麼、上傳到哪個 repo。
- **公開 repo**：開啟前用 `gh repo view --json visibility` 檢查。是公開的就先警告「這個 repo 是公開的，交辦清單和驗收紀錄會被任何人看到」，要使用者輸入 repo 名稱確認，`--yes` 不能略過這一步。之後每次同步都再檢查一次：repo 從私人變成公開時，暫停同步、重新取得同意。
- **上傳前掃描**：用和 CI 的 `BLOCKED_TERMS` 同一套名單、同一套比對方式（qa.md 第 7 節：一行一個詞、不分大小寫、固定字串比對）掃描每一個要上傳的欄位（標題、內文、QA 說明）。命中的項目整項不上傳，看板寫「#12 的備註含有你列為不能公開的詞（詞本身不顯示），沒有同步。請改寫後再同步。」；其他沒命中的項目照常同步。
- **名單只有一份**：GitHub 的 secret 寫進去後讀不回來，所以名單的正本放在本機 `~/.project-pm/blocked-terms.txt`（不進 git，只有本人可讀，和 `server.json` 同樣的權限設定）。`project-pm terms upload` 用 `gh secret set BLOCKED_TERMS` 把它寫成 repo 的 secret，CI 和同步才會用同一份。名單是空的時，開啟同步會提醒「還沒設定不能公開的詞，掃描不會擋任何東西」，要再確認一次。

### 10.5 影響、驗證、回復

- 影響：使用者的交辦內容會出現在 GitHub 上（只在開啟後）；會用掉 `gh` 的 API 額度（條件式請求不計）。v1.0 只多寫幾個欄位，沒有可見變化。
- 驗證（都不需要 AI 模型，照 D9 不花錢）：
  - 每次 PR 在 CI 跑：三方合併的每一種情況（上表）、名單掃描（命中不上傳、不印出詞本身）、公開 repo 的確認流程。GitHub API 用假的伺服器（錄好的回應），不碰真的 repo。
  - 每次 PR 在 CI 跑：兩個 `PROJECT_PM_HOME` 模擬兩台電腦，同時新增、同時修改同一項，確認 `uid` 不撞、衝突有列出、沒有遺失的修改。
  - 發版前手動一次：用使用者自己的 GitHub 帳號開一個私人的測試 repo，兩台電腦（或兩個 `PROJECT_PM_HOME`）用 Acme demo 的假資料跑一輪；再把它切成公開，確認同步暫停。GitHub 免費帳號就能做。
- 回復：`project-pm sync off` 停止同步，本機資料完整不受影響；GitHub 上已經建立的 Issue 不會自動刪除（避免誤刪別人的資料），要刪由使用者自己在 GitHub 上處理。同步程式有問題時退回 v1.0，v1.0 本來就帶著這些欄位，不需要轉換資料。

## 11. 來源

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

沒有另外查證、寫在文件裡要實作時再確認的：gitleaks 官方 action 對組織帳號的授權要求、osv-scanner 的授權與 action 版本、各平台 ③ ④ 的設定檔確切路徑。

2026-11-19 定案時加入、同樣還沒查證的（都標了「實作時確認」）：Node SEA 和 Bun 支援的目標平台、檔案大小、macOS ad-hoc 簽章的做法；Windows SmartScreen 和「智慧型應用程式控制」對未簽章執行檔的實際行為；macOS 放行步驟在各版本的寫法；GitHub Actions 對公開 repo 標準 runner 的免費範圍；`claude mcp add`／`list` 是否需要登入；GitHub Issues API 的條件式寫入和 ETag 行為。
