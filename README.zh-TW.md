# Project PM：Claude Code 的專案 PM

[English](README.md) | **繁體中文**

**同時開很多個 Claude Code Session，也不會漏掉任何一件工作。**

[![CI](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml/badge.svg)](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

一個專案往往同時開著好幾個 Claude Code Session，各自做不同的事。**Project PM** 會為每個專案指派一個 PM Session：你只要跟 PM 對話，它就能掌握所有子 Session 的進度、等你回覆的問題、中途停下的工作，以及你交辦過的每一件事；只要還有 Session 在等你、做到一半停下、或 CI 還沒跑完，PM 就不會說「都完成了」。

<p align="center">
  <img src="docs/images/board-hero.png" alt="示範專案的 Project PM 看板：工作項目完成 44%，一個 Session 待回覆、一個 CI 失敗、一個中斷且還有 4 項步驟未完成。" width="100%">
</p>

<sub>畫面為示範資料。</sub>

## 解決什麼問題

同一個專案開了五個、十個 Session 之後，很容易漏掉：

- 某個 Session 一小時前問了你問題，之後就一直停在那裡。
- 某個 Session 任務清單還剩三步就停了，沒有任何提示。
- 某個 Session 說「CI 在跑，通過後我再部署」，然後沒有人回頭確認。
- 每個 Session 收尾時都會把自己的清單全部勾掉，所以側欄看起來全綠，不代表你交代的事真的做完。

Project PM 會讀取每個 Session 的任務清單、收尾摘要與待決策問題，到 GitHub 確認 CI 結果，並把需要你處理的事排在看板最前面。

## 快速上手

需要 **Claude Code 桌面版（Code 分頁）**，詳見[需求](#需求)。

1. 安裝。在 Claude Code 提示字元輸入：

   ```
   /plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
   ```

   桌面版無法使用 `/plugin`：點提示框旁的 **+** → **Plugins** → **Add marketplace**，輸入 `AudiChang-hub/claude-project-pm`，再點 **Add plugin**。

   也可以在 shell 執行：

   ```bash
   claude plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
   ```

2. 在專案裡新開一個 Session（安裝前就開著的 Session 不會載入），輸入：

   ```
   /pm
   ```

   這個 Session 就成為專案的 PM，會開啟看板並報告目前有哪些事在等你。

3. 接著直接跟 PM 對話，例如：「目前有沒有漏掉的工作？」「幫我把匯出 CSV 交給商品列表那個 Session 做。」「哪些 Session 在等我回覆？」

## 功能

**每個專案一個看板。** 面板列出專案裡的 Session，最需要處理的排最前面；每張卡片有狀態燈號、逐步進度條、目前進行的步驟，以及最新的收尾摘要或問題。

| 狀態 | 何時出現 |
| --- | --- |
| 待回覆 | Session 這一輪以問題結束，等你決定。 |
| CI 失敗 | 最後回報說 CI 在跑，而 GitHub 上那次執行失敗。 |
| 未完成 | 已停止，但任務清單仍有未完成步驟。 |
| 等待 CI | 最後回報說 CI 還沒跑完，GitHub 也還沒確認通過。 |
| 執行中 | Session 正在工作。 |
| 背景執行 | 回報說有作業在背景繼續跑（45 分鐘內）。 |
| 已結束／長期閒置 | 沒有待辦；超過 3 天沒活動為長期閒置。預設收合。 |

上方是完成率圓環與三項指標（執行中、待回覆、未完成・待 CI），可切換「本專案／全部」。

**工作項目清單。** 你交代 PM 的每件事都以 T-01、T-02… 編號登記，並指派負責的 Session。專案進度以工作項目計算，而不是看各 Session 自己的勾選清單。負責的 Session 可以在別的專案資料夾工作（例如修共用函式庫的 Session），看板一樣會顯示它的標題和狀態；只有封存或找不到時才標「負責人失聯」。

**CI 沒跑完就不算完成。** Session 最後一輪的回報如果說 CI 還在跑、或要等 CI 通過才部署，狀態會標成「等待 CI」，不管停了多久都不會變成「已結束」。這時 PM 會在該 Session 的資料夾用 `gh` 查實際結果：回報裡有 run id 就查那個 run，有 commit 就查那個 commit，都沒有就查資料夾當時的 `HEAD`（只限在回報之前就提交的）。通過就不再標「等待 CI」，失敗則標成「CI 失敗」。查詢結果會快取：通過的不再重查，失敗的 5 分鐘後重查，還在跑或查不到的 1 分鐘後重查。沒裝 `gh` 或不在 GitHub 時，照文字判斷。

**未完成的工作不能結案。** 負責 Session 還在執行中、待回覆、未完成、等待 CI、CI 失敗或背景執行時，ledger 會拒絕把工作項目標成完成；除非使用者明確確認，並由 PM 在備註寫明。

**收尾摘要的未完成事項。** 摘要寫到「尚未部署」「還沒提交」「not yet deployed」「still needs」這類字眼時列為「需追蹤」；「沒有任何未提交的修改」這種表示已經做完的雙重否定不算。

**只看最新一輪。** 收尾摘要只算寫下它的那一輪；之後沒有重新收尾的回合，舊摘要就不再算數。紀錄檔如果漏記了後面的回合，改用對話紀錄的最後一則訊息判斷。

**像 PM 一樣做事。** PM 回報前一定先看看板；實作交給子 Session，自己不改程式碼；把子 Session 的問題原文轉述給你；封存前先問你；「需要處理」還沒清空之前，不會說「都完成了」。子 Session 開始等你回覆、CI 失敗、或中途停下時，PM 會跳出通知。

**整理 Session。** 卡片上的封存按鈕要滑過才會出現，按下後還需再確認一次（會提醒未完成步驟、開啟中的 PR 或已釘選）。還沒有 PM 的專案，輸入框上方會出現「建立 PM Session」或「由此 Session 擔任」的選項。

<p align="center">
  <img src="docs/images/board-dark.png" alt="深色模式的完整看板：工作項目與六個進行中的 Session，包含執行中與背景執行。" width="420">
</p>

## 使用方式

| 指令 | 作用 |
| --- | --- |
| `/pm` | 指定目前的 Session 為這個專案的 PM，並開啟專案看板 |
| `/pm off` | 卸任 PM（工作項目會保留，由下一任 PM 接手） |
| `/board` | 在任何 Session 開啟或收合專案看板 |

PM 有兩個專屬工具（不需要你自己呼叫）：

- `mcp__project-pm__board`：專案狀態報告（需要處理的事項、工作項目、所有 Session）。`scope: "all"` 看所有專案，`include_done: true` 一併列出已結束的 Session 與已完成的工作項目。
- `mcp__project-pm__ledger`：工作項目的 `add`、`update`（負責人、狀態 `open`／`done`／`dropped`、備註）與 `list`。

專案以 Session 的工作資料夾區分；`.claude/worktrees/` 或 `.worktrees/` 底下的 git worktree 算在它所屬的 repository。

## 需求

- **Claude Code 桌面版的 Code 分頁。** PM 會用到桌面版內建的 Session 工具（`ccd_session_mgmt` 列出、讀取與封存 Session；`ccd_session` 建立 PM Session），各 Session 也是透過桌面版的 `update_plan` 與 `wrap_up` 回報任務清單。改用 `TodoWrite` 管理任務的 Session 也會追蹤。
- **支援 function hooks Mod 的 Claude Code。** 已在 2.1.299 測試。
- **選用：已登入的 [GitHub CLI](https://cli.github.com/)（`gh`）**，用來向 GitHub 確認 CI。沒有的話，CI 狀態依 Session 的回報文字判斷。
- 由組織統一管理 Claude Code 的環境中，PM 的角色指示（`prompt.compose` hook）只有在組織把此 Plugin 列入 managed settings 時才會生效；看板與工作項目不受影響。

## 介面語言

看板、PM 的指示與工具輸出目前是繁體中文。狀態判斷同時讀得懂中文與英文，子 Session 用哪種語言工作都可以。

## 運作方式與資料

- 每個 Session 只寫自己的紀錄檔：`~/.claude/project-pm/sessions/<session id>.json`（任務清單、最後的收尾摘要、待決策問題、最新指令與最後回報，皆有截斷）。
- 每個專案一份檔案，記錄 PM 與工作項目：`~/.claude/project-pm/projects/<專案>-<hash>.json`。
- Mod 本身不會把資料傳到任何地方。Session 清單、紀錄讀取與封存，都是透過桌面版內建的工具完成。查 CI 時會在該 Session 的資料夾執行 `git` 與 `gh`，`gh` 會用你自己的登入向 GitHub 查詢，和你手動執行一樣。
- Mod 安裝前就開著的 Session 沒有追蹤紀錄，看板只會顯示它們最後一則訊息。
- 執行 `/reload-plugins` 後，PM 的 `board`／`ledger` 工具會在 PM 的下一輪（下一則訊息或通知叫醒）重新註冊，不必重開 Session。

## 開發

```bash
claude plugin validate .
claude plugin test .
```

測試（`tests/pm.test.ts`）在 Claude Code 的 plugin 測試環境中執行，桌面版、磁碟與 `gh` 都以記憶體模擬，不需要登入或 API key。CI 會在每次 push 與 pull request 執行這兩個指令。

`docs/demo/board.html` 用虛構資料繪製 README 的截圖，說明見 [docs/demo/README.md](docs/demo/README.md)。

變更紀錄見 [CHANGELOG.md](CHANGELOG.md)。

## 授權

[MIT](LICENSE)
