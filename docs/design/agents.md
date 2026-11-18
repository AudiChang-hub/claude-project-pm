# 設計：PM 派工給 Agent（T-24，只設計、未實作）

狀態：已實作（見 CHANGELOG 的 Unreleased）。第 6 節第 1～6 項實測都成立，走主要做法。示意畫面：[agents.html](agents.html)（`?lang=zh-TW`、`?theme=dark`）。

實作和本文的差異：
- 已完成的 Agent 超過一小時後，面板只寫「另有 n 個已完成的 Agent」，沒有展開按鈕。board 工具加 `include_done: true` 時會全部列出。
- worktree 的路徑和分支從結束通知的 `<worktree>` 取得（實測第 4 項），不需要寫進回報合約。
- Agent 寫了被要求的詳細檔時，PM 讀到的是那個檔案；沒寫時，mod 把它的完整回覆存成 `reports/agents/<agentId>.md`。

使用者永遠只跟 PM 說話。PM 派工時可以開 Session，也可以開 Agent。中途要調整時，使用者告訴 PM，PM 用 SendMessage 轉給 Agent。已實測：背景 Agent 會在下一個工具回合收到訊息並照做，約 17 秒內生效。

## 摘要

| 問題 | 做法 | 依據 |
| --- | --- | --- |
| 開 Session 還是 Agent | PM 指示裡的規則；拿不準時開 Session | §1 |
| 會寫檔的 Agent | mod 在 PM 的 `Agent` 呼叫上強制 `isolation: "worktree"`、背景執行；唯讀類型的 Agent 不受影響 | §2 |
| 開發準則 | 可以自動附上：用 `agent.spawn` hook 改寫 Agent 的 `prompt` | §3 |
| 追蹤 | 開始：`Agent` 的工具結果。進行中：`$.agent.list()`。結束：`<task-notification>`（含結果和耗用）。都記在 PM 的紀錄檔，負責人可以是 `agent:<id>` | §4 |
| 省 token | 完整結果存成詳細檔，PM 只讀第一行 | §4.3 |
| 看板 | 新增 Agents 區塊和菱形標記；指標只加一行小字；負責人看得出是 Session 還是 Agent | §5 |

## 1. 何時開 Session、何時開 Agent

| 開 Session | 開 Agent |
| --- | --- |
| 之後還會追問、需要它記得做過什麼 | 做完就能結束，不會再追問 |
| 要 commit、push、等 CI、發布 | 唯讀：查資料、比對、讀紀錄、寫報告 |
| 要花超過十幾分鐘，或步驟多、可能中途卡住 | 幾分鐘內就做完的小改動（交給 PM 驗收） |
| 使用者會想直接打開來看、或自己跟它說話 | 多個彼此獨立的查詢，可以平行跑 |

拿不準時開 Session。Agent 的限制：

- 一律在背景執行（`run_in_background: true`），PM 不會被卡住，使用者可以繼續跟 PM 說話。
- 最後的回覆只用 T-23 的短格式：第一行 `[狀態, commit] 一行摘要`，第二行 `詳細：<檔案路徑>`。完整內容寫進詳細檔。
- 不能 push、不能發布，也不會等 CI。需要這些的工作，改開 Session。
- 無法在中途問使用者。需要使用者決定時，結束並回報 `waiting_user`，由 PM 問使用者，再用 SendMessage 回覆 Agent，或開一個新的 Agent 接手。

提議加進 PM 指示（`role.text`）的段落：

> 派工前先決定開 Session 還是 Agent。之後會追問、要 commit／push／等 CI／發布、或要花較久的，開 Session；做完就結束、唯讀、或幾分鐘內完成的小改動，開 Agent。拿不準時開 Session。開 Agent 時，description 以工作項目代號開頭（例如「T-12 比對撥款報表」），並把 ledger 的負責人設成 `agent:<agentId>`。使用者要調整進行中的 Agent 時，用 SendMessage 轉達給它。

## 2. 檔案安全

會寫檔的 Agent，規則和 Session 一樣：在自己的 git worktree 裡工作、只在本機 commit、不 push、交給 PM 驗收。唯讀的 Agent 留在原本的資料夾。

mod 不只靠指示，也在 PM 的 Session 裡把關。做法是一個 `tool.call` hook，掛在 `Agent` 上，只在 PM 本身的 loop 生效（`e.agentId` 沒有值）：

1. `run_in_background` 一律設成 `true`。
2. `subagent_type` 不在唯讀清單時，如果 `isolation` 沒有填，就補上 `"worktree"`。唯讀清單是 `Explore`、`Plan`、`claude-code-guide`，可以用設定擴充。PM 只要選唯讀類型，就不會開 worktree；其他類型一律預設隔離。
3. 不在 git repo 裡的專案沒有 worktree 可用。這時寫檔的 Agent 會被拒絕（`deny`），理由寫「這個資料夾不是 git repo，會寫檔的工作請改開 Session」。

選擇改寫、而不是拒絕：拒絕會讓 PM 多跑一輪重試，改寫則直接就是安全的設定。其他 Session 的 Agent 呼叫一律不動。

## 3. 開發準則自動附進 Agent

可行。引擎的 `agent.spawn` 事件可以改寫 `prompt`（型別說明寫 "A rewrite is the prompt the subagent runs with"），而且模型呼叫 `Agent` 工具時一定會觸發這個事件。PM 的 mod 在 prompt 後面附上一段：

- v0.7.0 的開發準則檔（`guidelines` 選項），每次重新讀取，超過 24,000 字就截短，和 Session 一樣。
- 回報合約：最後一則訊息只用短格式；完整內容寫到 `~/.claude/project-pm/reports/agent-<agentId>/<時間>.md`。路徑由 mod 事先算好，直接寫進 prompt。
- 這次的工作項目代號，以及禁止事項：不 push、不發布、不改 ledger。

例外：

- `fork` 類型的 Agent 會繼承 PM 的整段對話，準則本來就在裡面；仍會附上回報合約。
- workflow 啟動的 Agent，在某些情況下 prompt 是固定的佔位文字，改寫不會生效。PM 不會用 workflow 派工，這次不處理。
- 如果實測發現改寫沒有生效（§6 第 1 項），就退回 PM 指示：「開 Agent 時，把開發準則和回報格式寫進 brief」。

## 4. 追蹤

### 4.1 紀錄

每個 Agent 一筆，存在 PM 自己的紀錄檔（`sessions/<PM id>.json` 新增 `agents` 欄位）。看板本來就會讀這個檔，PM 的程序重啟後紀錄也還在。

```ts
type AgentRecord = {
  id: string                  // agentId
  description: string         // 「T-12 比對撥款報表」
  item: number | null         // 從 description 開頭的 T-12 解析
  type: string                // subagent_type
  isolated: boolean           // 有沒有 worktree
  startedAt: number
  endedAt?: number
  state: 'running' | 'done' | 'verify' | 'decide' | 'failed' | 'lost'
  result?: string             // 回覆第一行，最多 120 字
  detail?: string             // 詳細檔路徑
  commit?: string             // 從第一行解析
  tokens?: number; tools?: number; durationMs?: number
}
```

### 4.2 生命週期

| 時點 | 來源 | 記錄 |
| --- | --- | --- |
| 開始 | PM 的 `tool.call` hook 拿到 `Agent` 的工具結果（`result.agentId`） | 新增一筆，`running` |
| 進行中 | 每 30 秒輪詢 `$.agent.list()` | 依它的 `status` 更新 |
| 結束 | `prompt.submit` 收到 `<task-notification>`，其中 `<task-id>` 是已知的 agentId | `<status>`、`<result>` 第一行、`<usage>`（`subagent_tokens`、`tool_uses`、`duration_ms`） |
| 消失 | 標成 `running`，但 `$.agent.list()` 已經沒有它（例如程序重啟） | `lost` |

結束時的狀態判斷：

- 失敗或被停掉（`failed`、`killed`）→ `failed`。
- 回覆第一行寫 `waiting_user` 或 `blocked` → `decide`，需要使用者決定。
- 有 commit 而且有 worktree → `verify`，等 PM 驗收。等 PM 合併進專案分支，也就是 commit 或同樣的修改出現在本機的主要分支上（用 T-21 的比對方式），才變成 `done`。
- 其他 → `done`。

同一個 agentId 可能收到不只一次通知（Agent 被追加訊息後再次結束），所以是更新同一筆，不會新增。

### 4.3 省 token：完整結果不進 PM 的對話

`<task-notification>` 的 `<result>` 會帶 Agent 最後一則訊息的全文。PM 的 `prompt.submit` hook 會把全文存成詳細檔，只在對話裡保留第一行和「詳細：路徑」。即使 Agent 沒有照短格式寫，PM 也只讀到一行。

### 4.4 ledger

- 負責人可以寫 `agent:<agentId>`，`add` 和 `update` 照樣接受。
- 結案檢查（`ownerBlocker`）：`running`、`failed`、`lost`、`decide` 會擋下；`verify` 也會擋，理由是「Agent 的 commit 還沒合併，請先驗收」；只有 `done` 可以結案。`force` 照舊可用。
- 一個工作項目可以先交給 Agent、之後改交給 Session，換人就是改負責人。

## 5. 看板

畫面請看 [agents.html](agents.html)，中英文和深淺色都有。

- 標記：Session 用圓點，Agent 用同色系的小菱形。在卡片、工作項目的負責人、board 文字裡都一樣，一眼就分得出來。
- Agents 區塊放在「工作項目」和「Sessions」之間，因為 Agent 生命短、變化快。卡片顯示：
  - 第一行：菱形、任務名稱、經過時間（進行中顯示「已執行 3 分鐘」，結束後顯示「耗時 2 分 20 秒」）。
  - 第二行：狀態、工作項目代號、類型、是否在 worktree。
  - 第三行：結果第一行；進行中的則顯示「進行中」。
  - 結束的卡片多一行耗用（tokens、工具次數），以及「詳細」按鈕（同 T-23）。
- 已完成的 Agent 只保留最近 1 小時，之後收進「顯示已結束的 Agent（n）」。
- 指標：「執行中」的數字包含 Agent，下面加一行小字「其中 Agent 2」。「尚未完成」包含 `failed`、`decide`、`verify`、`lost`。不另外加一格，避免面板變寬。
- 負責人：工作項目那一列寫「負責　◆ Agent・T-12 比對撥款報表・執行中」。board 文字寫「負責：Agent a9baf6…（執行中）」。
- 需要處理：
  - `failed`、`lost`：「[Agent 失敗] T-12 比對撥款報表：結果第一行」。
  - `decide`：「[Agent 待決定] … 問題第一行」。
  - `verify`：「[Agent 待驗收] … commit 3fa1c2e 在 worktree，尚未合併」。
- board 工具：新增 `## Agents` 一節，每個 Agent 一行，`include_done` 時才列出已完成的。

## 6. 風險、未確定的事，以及怎麼驗證

| # | 風險或未確定 | 怎麼驗證 | 不成立時 |
| --- | --- | --- | --- |
| 1 | 在桌面版，`agent.spawn` 的 prompt 改寫是否真的會生效 | 在 PM Session 用一個 hook 加入標記，叫 Agent 回覆它看到的標記 | 改由 PM 指示要求寫進 brief（§3） |
| 2 | `tool.call` 改寫 `Agent` 的 `isolation`、`run_in_background` 是否會被接受 | 同一個測試，確認 `$.agent.list()` 顯示在背景執行，而且在 worktree 裡 | 改成拒絕，理由說明要怎麼重填 |
| 3 | `prompt.submit` 改寫 `<task-notification>` 文字是否會被接受，模型看到的是不是改寫後的內容 | 改寫成固定字串，請 PM 複述 | 只靠回報合約要求短格式，並在看板標出「回覆過長」 |
| 4 | Agent 改到哪個 worktree 和分支，工具結果有沒有提供 | 看 worktree 模式下的 `Agent` 結果欄位和通知內容 | 回報合約要求第一行附上分支名稱 |
| 5 | PM 的程序結束時，背景 Agent 也會跟著結束 | 開一個長時間的 Agent，再重新載入 PM | 標成 `lost` 列進需要處理，由 PM 重派。桌面版的記憶體管理在有 Agent 執行時不會暫停該 Session（已在桌面版程式碼確認） |
| 6 | Agent 跑在 PM 的 Session 裡，可以呼叫 PM 的 `board`、`ledger` 工具 | 叫測試 Agent 呼叫 `ledger list` | mod 在 `e.agentId` 有值時拒絕 `ledger` 的 add 和 update，`board` 只能讀 |
| 7 | 通知可能重複，或在 PM 忙碌時延後送達 | 讓 Agent 結束兩次（中途追加訊息） | 以 agentId 去重，以最後一次為準 |
| 8 | 多個會寫檔的 Agent 同時改同一處，PM 合併時衝突 | 兩個 Agent 改同一個檔案 | PM 指示規定：同一組檔案一次只派一個 Agent；衝突時改開 Session 處理 |
| 9 | 耗用的數字只在通知裡，前景 Agent 沒有通知 | 確認背景是強制的（第 2 項） | 前景 Agent 從工具結果的 `totalTokens` 取得 |
| 10 | 使用者以為 Agent 也能直接對話 | 看板卡片不提供開啟 Agent 的入口，只有「詳細」 | README 說明：調整 Agent 一律透過 PM |

## 7. 實作範圍（確認後才做）

- `hooks/agents.ts`（新檔）：AgentRecord、`tool.call`／`agent.spawn`／`prompt.submit` 三個 hook、輪詢 `$.agent.list()`、ledger 結案檢查。
- `hooks/sessions.ts`：board 文字的 `## Agents` 一節、負責人格式。
- `hooks/view.tsx`：Agents 區塊、菱形標記、指標的小字。
- `hooks/messages.ts`：中英文文字和 PM 指示段落。
- 測試：用假的 `Agent` 結果、`$.agent.list()` 和通知，涵蓋開始、結束、重複通知、消失、worktree 改寫、唯讀類型、結案擋下、通知截短，中英文各跑一次。
- 第 1 到 3 項的實機驗證要在實作前先做，因為它們決定 §2 到 §4 走哪一條路。
