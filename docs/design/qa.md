# 設計：由 mod 強制執行測試與品管（T-31）

狀態：已實作（見 CHANGELOG 的 Unreleased）。使用者選定 B 案：驗收紀錄寫進 ledger，結案由 mod 把關，驗收交給獨立的 Agent。

## 摘要

| 問題 | 做法 |
| --- | --- |
| 驗收條件寫在哪 | 工作項目新增選填欄位 `criteria`，add 或 update 時填 |
| 驗收結果寫在哪 | 工作項目新增選填欄位 `qa`：`{ result, by, at, note }` |
| 誰來驗收 | PM 派一個獨立的 Agent（Explore），description 以「T-xx QA」開頭，只給 diff 範圍和驗收條件 |
| 怎麼把關 | ledger 標成 done 時，沒有 `qa=pass`（或附理由的 `skipped`）就拒絕；驗收者不能是負責人 |
| 例外 | `force: true` 加 note 仍可強制結案，和現在一樣 |
| 看板 | 「需要處理」列出待 QA、QA 不通過；工作項目那一行顯示 QA 狀態；面板也一樣 |
| 舊資料 | 沒有這兩個欄位的項目照常讀寫，不做遷移 |

## 1. 資料格式

```ts
type QaRecord = {
  result: 'pass' | 'fail' | 'skipped'
  by: string      // 驗收者：agent:<agentId>、local_… Session id，或 user
  at: number      // 記錄時間（ms）
  note: string    // fail 的原因、skipped 的理由；pass 可留空
  commit?: string // 記錄時專案的 HEAD（短 sha），追溯驗收的是哪個版本；不在 git 裡時沒有
}

type LedgerItem = {
  // …原有欄位不變
  criteria?: string   // 驗收條件
  qa?: QaRecord       // 最近一次驗收；新的紀錄取代舊的
}
```

兩個欄位都是選填。舊的紀錄檔沒有它們，讀取時就當作「沒有驗收條件、沒有驗收紀錄」，寫回時也不補欄位（開發準則第 7 條：先擴充，不遷移）。

## 2. ledger 工具的新參數

| 參數 | 值 | 說明 |
| --- | --- | --- |
| `criteria` | 字串 | add、update 時可填；空字串清除 |
| `qa` | `pass`、`fail`、`skip` | 記錄一次驗收。`skip` 存成 `skipped` |
| `qa_by` | 字串 | 驗收者。`pass`、`fail` 必填；`skip` 沒填時記成 PM 自己 |
| `qa_note` | 字串 | `fail` 的原因、`skip` 的理由（`skip` 必填） |

`qa` 的參數有錯時（值不對、少了 `qa_by`、`skip` 沒有理由、驗收者等於負責人），整個 update 被拒絕，什麼都不改，回覆寫明要補什麼。

驗收者和負責人比對時先去掉前後空白、不分大小寫（`LOCAL_OPEN`、` agent:A1 ` 都算同一個）。新寫入的負責人會先去掉前後空白；舊資料照原樣保存，所有比對負責人的地方（結案關卡、看板、面板）都用同樣的規則找到它。

QA 紀錄跟著負責人和這一輪工作：
- 換了負責人（去空白、不分大小寫後不同），舊的紀錄作廢。
- 結案或放棄後重新打開（status 改回 open），舊的紀錄作廢。
- 每次記錄時，mod 用 `git rev-parse HEAD` 取專案的 HEAD，存成 `commit`。結案時不比對它，看板和 ledger 會顯示。

`criteria` 不是字串（數字、null）時忽略，保留原值；空字串才清除。

## 3. 結案關卡

`status: "done"`（原本不是 done）時依序檢查，第一個不過的就拒絕，什麼都不改：

1. 帶 `force: true` 且 note 不是空的：直接結案（不檢查以下各項，和現在一樣）。
2. QA：這次 update 之後的 `qa` 必須存在，結果是 `pass` 或 `skipped`，而且 `by` 不等於這次 update 之後的負責人。
   - 沒有紀錄：說明要派「T-xx QA」Agent，通過後用 `qa: "pass"`、`qa_by: "agent:<agentId>"` 記錄；不需要驗收的用 `skip` 加理由。
   - `fail`：附上不通過的原因，請交回負責人修正後重新驗收。
   - 驗收者是負責人：請派獨立的 Agent 重新驗收。
3. 負責人：原本的檢查（CI、未交付、Agent 還沒完成），不變。

QA 先檢查，因為它不用問 GitHub 或 git。同一次 update 可以同時記錄 `qa: "pass"` 和 `status: "done"`。結案被擋（QA 不過或負責人關卡）時，同一次 update 帶的驗收紀錄仍然存下來，只有狀態不改，回覆以「QA 已記錄，但結案被擋：」開頭並寫原因；沒有帶驗收紀錄的被擋 update 則什麼都不改。標成 `dropped` 不需要驗收。Agent 本來就不能改 ledger，維持不變。

## 4. 看板

「已交付」的判斷：負責的 Session 狀態是「已結束」「待發布」「等待 CI」，或已經封存、不在清單裡（它不會再做什麼）；負責的 Agent 是「已完成」「待驗收」，或在 PM 自己專案的看板上已經找不到紀錄（超過 AGENTS_KEPT 被清掉）。其他專案或不是 PM 的看板沒有 Agent 紀錄，判斷不了，不算已交付。

需要處理（只看 open 的項目）：

```
- [待 QA] T-12「匯出 CSV」：商品列表頁（已結束）已交付，還沒有驗收紀錄。派一個「T-12 QA」Agent 驗收
- [QA 不通過] T-12「匯出 CSV」：修 bug 沒有重現測試（agent:a7）
```

工作項目那一行，有紀錄或待 QA 時加上 QA 狀態（有 commit 時一併顯示），有驗收條件時也列出（截短）：

```
- T-12 (id 12) [open] 匯出 CSV｜負責：商品列表頁（已結束）｜QA 通過（agent:a7，於 3fa1c2e）｜驗收條件：欄位依範本排序
```

沒有紀錄、負責人也還沒交付時不顯示 QA，讓還在做的項目保持簡短。ledger 工具的 list 也一樣：有紀錄才顯示。

面板：進度卡在「n 項進行中」下面多一行，列出「n 項 QA 不通過」（錯誤色）和「n 項待 QA」（警告色），沒有時不顯示；每個工作項目在負責人那一行下面加上 QA 狀態，通過綠色、不通過紅色、待 QA 橘色、略過灰色。

## 5. PM 指示（第 13 條）

- 登記工作時用 `criteria` 寫驗收條件。
- 程式變更在 push 前，派一個獨立的驗收 Agent（`subagent_type: "Explore"`），description 以「T-xx QA」開頭。
- prompt 只給 diff 範圍（commit 或分支）和驗收條件，不給開發者的結論或回報。
- QA Agent 不是負責人，不要把 owner 改成它；它回報後用 `qa`、`qa_by: "agent:<agentId>"` 記錄。
- 不需要驗收的（例如只改文件），`qa: "skip"` 加理由。

## 6. QA 範本

PM 開的 Agent，description 符合 `^T-\d+ QA`（不分大小寫）時，mod 在 `agent.spawn` 附上驗收範本，取代一般的回覆格式：

1. diff 是否只包含這個工作項目的標的（鐵律）。
2. 修 bug 有沒有重現測試，而且修正之前會失敗（準則第 3 條）。在專案資料夾以外取出修正前的版本跑，不改專案的檔案。
3. 測試、validate 是否通過：實際執行，看 exit code。
4. 版號和 CHANGELOG 是否照開發準則。
5. 有沒有夾帶 secret、token 或本機設定。
6. 改到介面時，看實際畫面；做不到就寫明，不能當作通過。

回報第一行：`[pass] 摘要` 或 `[fail] 摘要`。沒做到的檢查不算通過。

順便修正：唯讀的 Agent（Explore、Plan、claude-code-guide）不能寫檔，原本的說明卻要它把細節寫進詳細檔。改成：唯讀 Agent 把細節接在第一行後面、寫在同一則回覆裡，由 mod 存成 `reports/agents/<agentId>.md`（存檔的機制原本就有）。會寫檔的 Agent 照舊寫詳細檔。

## 7. CI：真實資料掃描

`.github/workflows/ci.yml` 新增一步「Scan for blocked terms」：

- 名單放在 repo secret `BLOCKED_TERMS`，一行一個詞，絕不進 repo。
- secret 沒設定時，這一步顯示 skipped，不算失敗（job 層的 env 判斷 secret 是否為空，step 用 `if:` 跳過；fork 來的 PR 拿不到 secret，也是 skipped）。
- 名單寫到 `$RUNNER_TEMP`（repo 以外），去掉空白行（空的樣式會比對到每一行），用 `git grep -n -I -i -F -f` 比對所有追蹤的檔案。
- 輸出只有檔名和行號（`cut -d: -f1,2`），每處一則 `::error file=…,line=…::` 標註，不印出比對到的內容或名單。

使用者要在 GitHub 的 Settings → Secrets and variables → Actions 新增 `BLOCKED_TERMS`。

## 8. 可移植的核心與 Desktop 專屬的部分

長期目標是讓這套品管也能用在 Claude Code CLI、Codex、Antigravity、VS Code 等其他 AI 開發工具，所以 QA 的判斷寫成不依賴 Claude Desktop 或 Claude Code 引擎（`$`）的純函式，集中在 `hooks/qa.ts`。現在還不拆成獨立套件。

| 可移植的核心 | 位置 | 依賴 |
| --- | --- | --- |
| 工作項目的 QA 欄位（`criteria`、`QaRecord`） | `types/index.d.ts` | 只有型別 |
| 記錄驗收的驗證（`qaOfInput`）、結案關卡（`qaBlocker`）、一次 update 的 QA 判斷（`qaUpdate`） | `hooks/qa.ts` | `messages.ts` |
| 看板的待 QA／QA 不通過（`qaShown`、`qaText`、`qaAttention`） | `hooks/qa.ts` | `messages.ts` |
| QA Agent 的辨認（`isQaDescription`）和範本（`qaBrief`） | `hooks/qa.ts` | `messages.ts` |
| 所有文字（中英文） | `hooks/messages.ts` | 無，純資料 |

`hooks/qa.ts` 只 import 型別和 `messages.ts`，輸入輸出都是一般資料：工作項目、工具參數、時間。「負責人是否已交付」由宿主判斷後傳入（`qaShown` 的布林值、`qaAttention` 的 `isDelivered`），核心不知道 Session 或 Agent 長什麼樣子。測試裡有一個不經過引擎、直接呼叫核心的測試。

| Desktop 專屬的接線層 | 位置 | 做什麼 |
| --- | --- | --- |
| ledger 工具 | `hooks/actions.ts` | 註冊工具、讀寫紀錄檔，呼叫 `qaUpdate`，通過後再跑負責人關卡（問 GitHub、git） |
| 已交付的定義 | `hooks/sessions.ts`（`isDeliveredStatus`、`isDeliveredAgent`） | 用 Desktop 的 Session 狀態和 Agent 紀錄判斷 |
| 看板 | `hooks/sessions.ts`（`boardText`） | 把 `qaAttention` 的結果放進「需要處理」，工作項目列加上 `qaText` |
| 面板 | `hooks/view.tsx` | 顯示計數和每項的 QA 狀態與顏色 |
| 範本附加 | `hooks/register.tsx`（`agent.spawn`）、`hooks/agents.ts`（`briefOf`） | 用 `isQaDescription` 判斷，把 `qaBrief` 的文字接在 Agent 的 prompt 後面 |
| CI 掃描 | `.github/workflows/ci.yml` | 跟宿主無關，任何 repo 都能用 |

移植到其他工具時，要另寫的是：工作項目存在哪裡、怎麼判斷負責人已交付、怎麼把範本交給驗收的 Agent（或其他工具的子代理）。

## 9. 已知限制

- `qa_by` 只防誤用，不驗證真的有人或 Agent 驗收過。PM 可以填任何不是負責人的名字（例如 `user` 或一個不存在的 `agent:` id），mod 都會接受。它擋的是「負責人自己驗收自己」這種誤用，不是刻意繞過；真正的保證來自 PM 指示要它派獨立的 QA Agent，以及使用者看得到的看板與 ledger 紀錄。
- `force` 加 note 仍可不經 QA 結案，由使用者明確同意時使用。
- 結案時不比對 `commit`：驗收後又有新的 commit，舊的 pass 仍然有效。`commit` 只用來追溯。

## 10. 不在這次範圍

- README 和 overview 圖（T-32）。
- QA Agent 的回報不會自動寫進 ledger：由 PM 讀了之後記錄，避免一行摘要被誤判。
