# v1 前置檢查：現在的 mod 在 Claude Code CLI 能跑到什麼程度（T-34 第 0 步）

日期：2026-11-19。對象：本分支的 mod 原始碼（`bc69acf`，v0.9.0 收尾中，含 `hooks/qa.ts`）。只觀察，沒有改任何程式。

## 結論

| 項目 | 結果 | 怎麼驗的 |
| --- | --- | --- |
| 載入 | 可以。hooks 模組載入，`/pm`、`/board` 都註冊成指令 | `-p` 實測＋debug log |
| `/pm` | **失敗**：回「無法取得此 Session 的 id（可能不在桌面版中），無法擔任 PM。」 | `-p` 實測 |
| board 工具 | **失敗**：「讀不到 Session 清單：… no connected MCP tool "list_sessions" on a server named "ccd_session_mgmt"」 | `-p` 實測（用假 id 繞過 `/pm` 後） |
| ledger 工具 | 可以：add、list、update 都正常，QA 結案關卡會擋 | `-p` 實測（同上） |
| 面板 | `-p`：開不出來（`ui.open: no-surface`）。互動模式：**沒實測**，依程式判斷會開出來，但只顯示「讀不到 Session 清單」 | `-p` 實測；互動模式讀程式 |
| Session 追蹤 | **大多失效**，而且有一處會「假成功」：非 PM 的 CLI Session 呼叫 report，回「已回報給 PM：done」，但什麼都沒寫 | `-p` 實測＋讀程式 |
| Agent 派工 | 可以：改成背景＋worktree、附上說明、task-notification 截成第一行＋詳細檔路徑、Agent 紀錄有存 | `-p` 實測（用假 id 繞過 `/pm` 後） |

一句話：**和桌面版綁死的是「我是誰」和「有哪些 Session」兩件事**（`ccd_session_mgmt` 的 `get_session`、`list_sessions`、`list_events`）。只要這兩件事有別的來源，ledger、QA 關卡、交付判斷、Agent 派工在 CLI 都跑得動。這也是 v1 把核心抽出來的直接理由。

## 測試環境

- CLI：`%LOCALAPPDATA%\Claude-Data\<帳號資料夾>\claude-code\2.1.326\<hash>\claude.exe`（Claude Code 2.1.326），不在 PATH 上。
- 假專案：scratchpad 裡的 `acme-demo`（git init、兩個檔案 `README.md`、`math.js`，作者 `demo <demo@example.invalid>`）。沒有用任何真實專案或真實資料。
- 載入方式：`--plugin-dir <本 worktree>`，並用 `--settings` 把已安裝的 `project-pm@local-mods`（快取裡是 0.7.0）關掉，所以測的是本分支的程式碼。
- 隔離：
  - `USERPROFILE`、`HOME` 指到 scratchpad 的假家目錄，mod 的資料（`~/.claude/project-pm/…`）全部寫在那裡，沒碰到真的 PM 資料。
  - `CLAUDE_CONFIG_DIR` 指回真的 `~/.claude`，只為了登入。
  - 一開始的兩次執行繼承了桌面版的環境變數（`CLAUDE_CODE_ENTRYPOINT=claude-desktop` 等），不算數；之後的測試都先清掉所有 `CLAUDE*`、`ANTHROPIC*`、`MCP_*` 變數，debug log 的 `cc_entrypoint=sdk-cli` 確認是純 CLI。下表的結果都來自乾淨環境。
- 對真實設定的影響：CLI 每次啟動會照常改寫 `~/.claude/.claude.json`（啟動計數之類，CLI 本來就會），並在 `~/.claude/projects/` 下留下假專案 `acme-demo` 的對話紀錄（測完已刪）。

## 逐項結果

### 1. 載入

debug log：

```
hooks module project-pm@inline loaded (worker, …); events: session.start,prompt.submit,tool.call,agent.spawn,turn.complete,session.receive,prompt.compose,command.run,ui.close,ui.render
$.command.register (project-pm): /pm listed
$.command.register (project-pm): /board listed
```

`--plugin-dir` 載入的外掛名稱是 `project-pm@inline`，所以 `pluginConfigs["project-pm@local-mods"]` 的語言設定不會套用，語言走 auto（這台是繁中）。正式安裝時不會有這個差異。

另外看到 CLI 內建一個 `cc-plugin-agents-md@builtin` 外掛（事件含 `prompt.context`、`agent.spawn`），表示 AGENTS.md 的處理已經是 Claude Code 內建功能。

### 2. `/pm`

```
project-pm: 無法取得此 Session 的 id（可能不在桌面版中），無法擔任 PM。
```

原因（debug log）：`$.mcp.call (project-pm): no tool "get_session" on a server named "ccd_session_mgmt"`。`identify()`（`hooks/actions.ts:305`）拿不到桌面版的 Session id，再去 `transcripts.json` 查也查不到，`claim()` 就拒絕。

### 3. 繞過 `/pm` 之後的 board、ledger

為了看後面的功能，在假家目錄的 `transcripts.json` 預先寫入「這次 CLI 的 session id → `local_acme-fake-pm`」（`--session-id` 指定 id）。這只是測試手段，正式使用沒有這個檔。之後 `/pm` 回「此 Session 已擔任「acme-demo」的 PM。」，board 和 ledger 註冊成功：

```
$.tool.register (project-pm): 2 tool(s) served at 127.0.0.1:5969/project-pm v2
MCP server "project-pm": Successfully connected (transport: http)
```

值得記下：引擎把 mod 註冊的工具當成一個本機 Streamable HTTP 的 MCP server（綁 127.0.0.1）。也就是說，**現在的 board、ledger 本來就是 MCP 工具**，搬到獨立的 MCP server 不改變模型看到的介面。

工具輸出（原文）：

```
已新增工作項目 T-01（id 1）。
T-01 (id 1) [open] Add a subtract function to math.js｜負責：未指派｜驗收條件：subtract(5,3) returns 2
```

```
讀不到 Session 清單：project-pm: $.mcp.call: no connected MCP tool "list_sessions" on a server named "ccd_session_mgmt"
```

```
無法將 T-01 標記為完成：還沒有驗收紀錄。派一個獨立的驗收 Agent（subagent_type: "Explore"，description 以「T-01 QA」開頭，只給 diff 範圍和驗收條件），通過後用 qa: "pass"、qa_by: "agent:<agentId>" 記錄再結案。…
```

- ledger：正常，QA 關卡（`qa.ts`）照設計擋下。
- board：整個看板拿不到，連 ledger 的部分也不顯示，因為 `board()` 在 Session 清單讀取失敗時直接回錯誤（`hooks/actions.ts:1229`）。

### 4. 面板

- `-p`：`[ERROR] project-pm: ui.open: no-surface: no surface is attached ($.session.surfaces() is empty)`。符合文件「`-p` 不顯示面板」。
- 互動模式：**沒實測成功**。在終端機分頁用同樣的隔離環境啟動互動模式，卡在第一次使用的「選擇主題」畫面，log 也寫明「hooks modules not loaded until workspace trust is accepted」。這兩個畫面要按鍵，這邊的終端機工具只能送整行指令，不能按鍵；要繞過就得改真的 `~/.claude/.claude.json`（主題、資料夾信任），所以沒做。
- 依程式判斷（`hooks/view.tsx:161-175`）：v2.1.287 起 mods 在終端機能畫面板，所以 `/pm` 成功後面板應該會開，但 Session 清單永遠讀不到，面板只會顯示「讀不到 Session 清單」的錯誤；ledger 區塊在這個錯誤狀態前就 return 了，也不會出現。要實測的話，使用者自己在終端機跑一次互動模式就能確認（見最後一節）。

### 5. Session 追蹤

| 機制 | 在 CLI | 依據 |
| --- | --- | --- |
| Session 清單、最後一則訊息（`list_sessions`、`list_events`） | 沒有 | 實測（`list_sessions` 不存在） |
| 自己的 id（`get_session`） | 沒有，所以 `mine`（自己的紀錄）永遠是空的 | 實測＋讀程式（`changeMine` 在 `mine` 為空時什麼都不做，`actions.ts:156`） |
| 任務清單、收尾摘要（`mcp__ccd_turn__update_plan`、`wrap_up`） | 沒有這兩個工具，hook 不會觸發 | 讀程式（這兩個是桌面版工具） |
| 背景指令、TodoWrite、turn.complete 的 hook | 會觸發，但寫入 `mine` 時因為沒有 id 而丟掉 | 讀程式 |
| 通知 PM（`$.session.send`） | `notifyPm` 一開始就因為沒有 id 而 return | 讀程式（`actions.ts:221`） |
| report 工具 | **假成功**：專案有 PM 時，非 PM 的 CLI Session 會拿到交付指示和 report 工具，呼叫後回「已回報給 PM：done。」，但沒有寫任何檔、也沒通知 PM | `-p` 實測（假家目錄的 `sessions/` 下沒有新檔）＋讀程式 |
| 「建立 PM Session」的提示列、封存 | 依賴 `start_session`、`archive_session`，CLI 沒有 | 讀程式 |

report 的假成功違反「如實回報」，v1 要修：沒有地方存的時候要明說存不了（見設計文件第 2 節）。這次依範圍不改程式，列為 v1.0 的項目。

### 6. Agent 派工

PM 呼叫 Agent（general-purpose，description「T-01 add subtract」）：

```
agent.spawn general-purpose: prompt rewritten by a hook
Created agent worktree at: …\acme-demo\.claude\worktrees\agent-a76686b0c4d24d038 on branch: worktree-agent-a76686b0c4d24d038
Waiting for background work to finish (subagent "T-01 add subtract").
prompt.submit: text rewritten by a hook (1408 -> 1277 chars)
```

- tool.call 改寫：有，背景執行、`isolation: worktree` 都生效。
- agent.spawn 說明：有附上（Agent 照格式回 `[狀態] 摘要` 並寫了詳細檔）。
- task-notification 截短：有，PM 收到的是第一行加詳細檔路徑：

  ```
  [waiting_user] I added subtract to math.js and staged it, but it isn't committed: `git commit` fails because no git nam…
  詳細：…/home/.claude/project-pm/reports/agents/2026-11-19T02-59-36-664Z-1.md
  ```

- Agent 紀錄：存進 PM 的 session 檔，狀態 `decide`（需要決定），worktree 路徑有記。
- Agent 沒 commit 成，是因為假 repo 沒設定 git 使用者，和 mod 無關。
- 前提是 PM 身分成立；正式 CLI 沒有 id，`isPmCall` 是 false，這些改寫都不會發生。

另外：`-p` 會等背景 Agent 做完才結束（「Waiting for background work to finish」）。第一次（環境沒清乾淨那次）在 Agent 回來後以 `No messages returned from query`、exit 1 結束，乾淨環境那次正常 exit 0；原因沒追，只記錄。

## 使用者想自己確認互動模式的面板時

在 PowerShell，先切到一個不重要的 git 資料夾（會用到你真的設定和 PM 資料）：

```powershell
$cli = Get-ChildItem "$env:LOCALAPPDATA\Claude-Data" -Recurse -Filter claude.exe | Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName
& $cli --plugin-dir "$HOME\.claude\local-mods\project-pm"
```

進去後打 `/pm`，預期看到「無法取得此 Session 的 id」；`/board` 預期面板出現但寫「讀不到 Session 清單」。
