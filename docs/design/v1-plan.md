# 實作計畫：v1.0（T-37）

依據：[v1-core.md](v1-core.md) 第 8 節 ①，以及各章節的細節。D1～D13、Q1～Q4 已定案，這份計畫只拆工作、不改設計。

## 共同做法

- 程式放在 `core/`（D6），是一個 npm 套件（`core/package.json`，名稱 `project-pm`）。外掛本身（`hooks/`、`types/`、`.claude-plugin/`）在 v1.0 一行都不改（遷移 E1）。
- 純函式不複製：核心直接 import `hooks/qa.ts`、`hooks/messages.ts`、`hooks/sessions.ts`、`hooks/agents.ts` 這些不碰引擎的模組（1.4 節列為「核心」的部分），由 esbuild 打包。E2（v1.1）再把檔案實際搬進 `core/`、改由 mod import。核心自己才有的中英文字串放在 `core/src/messages.ts`。
- 執行期不依賴任何 npm 套件：MCP（JSON-RPC、stdio、Streamable HTTP）自己實作，單一執行檔才小、才好審。開發用的套件（TypeScript、tsx、esbuild、MCP SDK 的 client、postject）只在 `devDependencies`。
- 測試用 Node 內建的 `node:test`，檔名 `*.spec.ts`。不用 `*.test.ts`，因為 `claude plugin test .` 會執行資料夾底下所有 `*.test.ts`。每個會輸出文字的測試，中英文各跑一次。
- 示範和測試資料一律用 Acme（假的 git repo 建在暫存資料夾），資料路徑用 `PROJECT_PM_HOME` 指到暫存資料夾，不碰使用者真正的 `~/.project-pm/` 和 `~/.claude/project-pm/`。
- 每個里程碑結束：`npm test`（core）、`claude plugin test .`（原有 95 個測試）、`claude plugin validate .` 都要通過，再 commit。

實作時的命名對照（不改設計，只是沿用既有欄位）：

- 設計 2.3 節的 `QaRecord.sha`：v0.9.0 的 `QaRecord` 已經有 `commit`（給 QA 時專案的 HEAD），意思相同，核心沿用 `commit`、不另加 `sha`。核心寫入完整的 40 字元 SHA，舊資料的 7 字元短 SHA 也照樣能比對（git 認得）。

## 里程碑

### M1 核心資料與工具

範圍：資料層和四個工具的邏輯，還沒有 MCP。

- 資料路徑 `~/.project-pm/`（`PROJECT_PM_HOME` 可改），檔案配置照 2.2 節。
- 專案識別：`git rev-parse --show-toplevel` 和 `--git-common-dir`，任何 worktree 都對到主 repo；不在 git repo 裡就沒有交辦清單（1.4 節 `isScratch` 一列）。檔名沿用 `keyFile` 規則，新舊一一對應。
- 寫入：鎖定 → 重新讀 → 改 → 暫存檔 → rename；`<檔名>.lock` 用 exclusive 旗標建立，超過 10 秒視為殘留鎖；`revision` 每寫一次加 1（1.3 節）。
- 遷移 E1（2.4 節）：讀新路徑，沒有就讀 `~/.claude/project-pm/projects/`；寫新路徑並寫回舊路徑；寫之前以工作項目為單位依 `updatedAt` 合併舊檔，舊檔那份比較新時補回 `uid`、`createdBy`、`commits` 等欄位，`qa.at` 相同時才補 QA 的新欄位。
- `ledger`：參數和語意照 3.3 節（含 `qa_sha`、`commit`），結案關卡順序 force＋note → `qaUpdate` → 負責人；寫 10.1 節的 `uid`（UUID v7）、`createdBy`、`updatedBy`、`rev`，舊項目沒被修改時不補欄位。
- `report`：寫 `actors/<actor id>.json`，`detail` 存成 `reports/<actor id>/<時間>.md`；不在 git repo、寫不進檔時回錯誤，不再假成功（3.4 節）。
- `pm`：`claim`、`release`、`status`（3.5 節），`claim` 附上 PM 指示。
- `board`：文字看板沿用 `boardText`，Session 清單來源改成 `actors/`；同時產生 `structuredContent`（3.2 節）。讀不到 Session 清單時仍回交辦清單。
- 第 1 層：從 `hooks/actions.ts` 移植 CI 和 push 查詢（`git`、`gh` 用 `execFile`，不經過 shell），結果快取，整次 board 10 秒內回。

驗收條件：

1. 單元測試涵蓋：ledger 的 add、update、list，QA 關卡（沒有 QA、QA 失敗、驗收者是負責人、skip 沒理由、force＋note），新欄位（新項目有、舊項目沒被修改時沒有），report 寫入 actor 和詳細檔、不在 git repo 時回錯誤，pm claim／release／status，board 的文字和 structuredContent。每一組中英文各一。
2. 並行寫入：10 個行程各寫 100 次，項目數和 `revision` 正確。
3. 遷移 E1：用舊格式的假資料，核心寫的舊 mod 讀得到（舊路徑的檔是合法的舊格式，原有欄位不變），舊檔寫的核心讀得到，舊檔比較新時新欄位被補回。
4. 原有的 `claude plugin test .` 95 個測試全部通過。

### M2 MCP server 和 Claude Code CLI

範圍：`project-pm mcp`（stdio）、`project-pm board`、`project-pm hook claude-code <事件>`、命令列入口。

- MCP：`initialize`（記下 `clientInfo.name`）、`tools/list`、`tools/call`、`ping`；四個工具同時回 `content` 和 `structuredContent`，附 `outputSchema`；錯誤分類照 3.1 節。
- 身分（1.5 節）：先查 MCP 子行程拿不拿得到 Claude Code 的 Session id（環境變數）；拿得到就用 `claude-code:<session_id>`，和 hook 對得上；拿不到用 `<工具>:<短亂數>`，`report` 接受選填的 `actor`。
- hook：`UserPromptSubmit`（記下最後一句指示；把交付指示和開發準則放進提示）、`Stop`（最後一段話、狀態）、`PostToolUse`（TodoWrite 的任務清單、背景指令），寫 actor 紀錄。

驗收條件：

1. 協定測試：用 MCP SDK 的 client 啟動 `project-pm mcp`，列工具、呼叫每個工具，檢查 `content`、`structuredContent` 和錯誤；不需要模型。
2. hook 測試：用錄好的事件 JSON 餵 `hook claude-code <事件>`，actor 紀錄正確；`UserPromptSubmit` 輸出的提示文字中英文各一。
3. 實測：Claude Code CLI 2.1.326 用 `-p`，在暫存資料夾的 Acme 假 repo 跑 `pm claim`、`ledger add`、`board`、結案被 QA 擋、記錄 QA 後結案，檢查 JSON 結果和資料檔。用使用者現有的 Claude 登入（D9），不碰真實專案。

### M3 網頁看板

範圍：`project-pm serve`、`project-pm open`、網頁看板（第 4 節）。

- `serve`：Streamable HTTP 的 `/mcp`（POST 回 `application/json`、GET 回 405、`Mcp-Session-Id`）、`/api/board`（`ETag`＝revision，沒變回 304）、`/`（看板頁）。只綁 127.0.0.1，port 預設 47130、被占用往後找，寫進 `server.json`；閒置 30 分鐘結束。
- 安全照 4.2 節：token（32 bytes，`server.json` 只有本人可讀）、`Host` 檢查、`/mcp` 的 `Origin` 檢查、CSP、`nosniff`、不開 CORS、token 用 fragment 帶入後存 `sessionStorage`、全部用 `textContent` 輸出。
- 看板頁唯讀（D4）：完成度、需要處理、交辦清單（含 QA）、各 Session（標出工具）、Agent。375px 到桌面都能用、深色模式、WCAG AA、空狀態和錯誤狀態、`prefers-reduced-motion`。

驗收條件：

1. 安全測試：沒 token 回 401、偽造 `Host` 回 403、非本機 `Origin` 打 `/mcp` 回 403、只聽 127.0.0.1、`ETag` 沒變回 304。
2. HTTP 的 MCP 協定測試（同 M2，走 `/mcp`）。
3. 在瀏覽器實際打開（Acme 假資料）：375px、1280px、深色模式各檢查一次，空狀態和錯誤狀態也看過；修好看到的問題。

### M4 init、pre-push hook、skip

範圍：`project-pm init`、`project-pm uninstall`、`project-pm check pre-push`、`project-pm skip`（第 5、6 節，只支援 Claude Code）。

- `init`：偵測 `claude`；列出要改的每個檔和差異，預設不改，`--yes` 才套用（D13）；偵測到桌面版 mod 時只提示、不加 MCP 設定（3.7 節）。寫入：`claude mcp add --scope user`、AGENTS.md 段落（含 2 KiB 上限和 28 KiB 檢查）、`CLAUDE.md` 的 `@AGENTS.md`、Skill、使用者層級 hooks、`.git/hooks/pre-push`、`.git/config` 的 alias `pm`、選填的 CI 範本。每個寫入有標記，備份並記進 `install-log.json`；`init` 把執行檔複製到 `~/.project-pm/bin/project-pm-<版本>`。不改 PATH，不裝 Node（5.4 節）。
- `uninstall`：依 `install-log.json` 還原；alias 只在值沒變時才刪；`pre-push.local` 改回原名。
- pre-push 檢查照 6.2 節的五點；`skip` 記進交辦清單；`--no-verify` 由看板事後標出。

驗收條件：

1. bare repo 當遠端的六種情況（6.2 節），含 `git pm skip`，在本機跑。
2. `init` → `uninstall` 後，每個檔和安裝前完全相同：沒有 `CLAUDE.md`、已有 `@AGENTS.md`、已有別的 pre-push hook、已有別的 git alias `pm`。設定檔寫在暫存的假家目錄，不碰使用者真正的設定。
3. `init` 預設不改任何檔。

### M5 CI 範本

範圍：`core/templates/project-pm-qa.yml`（6.3 節）和本 repo 的核心 CI。

- 範本四步：測試（偵測 npm、pnpm、yarn、pytest；偵測不到顯示「略過」）、gitleaks、`BLOCKED_TERMS`、osv-scanner；`permissions: contents: read`、第三方 action 用 commit SHA 釘選、`::error` 和 `$GITHUB_STEP_SUMMARY` 的白話表。
- 本 repo 新增 `.github/workflows/core.yml`：每次 PR 在 Windows、macOS、Linux 跑核心的測試（不需要模型，D9）。原本的 `ci.yml` 不動。

驗收條件：

1. 範本的 YAML 能被解析；不需要網路的步驟（測試偵測、`BLOCKED_TERMS`）用 Acme 假專案在本機的 bash 跑過，擋得下、訊息正確、不印出禁用詞。
2. gitleaks、osv-scanner 兩步和整個範本要在 GitHub 上跑才算驗證，v1.0 本機做不到的部分寫進報告。

### M6 單一執行檔和 npm 建置

範圍：esbuild 打包成單一 JS、npm 套件（`bin`）、Node SEA 單一執行檔、release workflow（5.5 節）。

- 開工時比較 Node SEA 和 Bun（5.5 節）。這台電腦沒有 Bun，本機只能建置 Node SEA；選擇和理由寫進報告。
- `.github/workflows/release.yml`：在三個作業系統建置執行檔、附 `SHA256SUMS`、macOS 做 ad-hoc 簽章、第三方 action 用 SHA 釘選。只在推 tag 時跑；這次不推 tag。
- README、release 說明的已知限制（第 8 節開頭：沒有簽章、智慧型應用程式控制改用 npm 版、macOS 放行步驟未在實機驗證）寫進安裝說明草稿。

驗收條件：

1. 本機（Windows x64）建出 `project-pm.exe`，用建出來的檔跑 `--version` 和 MCP 協定測試、`init`／`uninstall` 測試。
2. `npm pack` 的內容只有該有的檔，`npx` 方式也能啟動 `mcp`。
3. 記下檔案大小。

## 回報

每個里程碑完成時回 PM 一行 `[M<n> done, <sha>] <摘要>`。全部完成後把狀態、測試數量和結果、實測項目、沒驗證到的項目、需要使用者做的事寫進報告檔（放在這組 Session 共用的筆記資料夾，`T-37-v1-report.md`），回報時附上路徑。
