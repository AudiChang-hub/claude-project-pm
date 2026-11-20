# Project PM：Claude Code 的專案 PM

[English](README.md) | **繁體中文**

[![CI](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml/badge.svg)](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**同時開很多個 Claude Code Session 和 Agent，你只跟一個 PM 說話，一件工作也不漏。**

<p align="center">
  <img src="docs/images/overview-zh-TW.png" alt="Project PM v1.0.0 一頁圖解：你從 Claude Code 桌面版或 CLI 跟 PM 說話，兩邊用同一個共用核心；PM 把工作交給 Session 或 Agent；結案和 push 前都要過 QA 關卡；v1.0 新增網頁看板、CI 範本和單一執行檔；以及每次派工的實測成本。" width="100%">
</p>

## 解決什麼問題

同一個專案開了好幾個 Session，工作就會漏掉：問題等你等了一小時、Session 還剩幾步就停了、說好「CI 跑完再部署」卻沒人回頭確認，而且每個 Session 收尾時都會把自己的清單全勾掉，不管事情做完了沒。

Project PM 讓專案裡的一個 Session 擔任 PM。它即時掌握每個 Session 和 Agent 的狀態，記下你交辦的每件事；只要還有事在等你、沒做完、等 CI，或還沒 push、還沒發布，它就不會說「都完成了」。

## v1.0 亮點

- **CLI 也能用。** 一份共用核心用 MCP 提供 PM 的工具，Claude Code 的命令列也有看板、交辦清單和 QA 關卡，而且和桌面版共用同一份交辦清單。
- **push 前先驗收。** git 的 pre-push hook 會擋下沒通過 QA 的 commit；`git pm skip "<理由>"` 可以明確放行一次，理由會留下紀錄。
- **給你的專案用的 CI 範本。** `init --ci` 加上 GitHub Actions：跑你的測試、找外洩的金鑰、有風險的套件和不能公開的詞。
- **一個程式，不用裝 Node.js。** Windows、macOS、Linux 都有單一執行檔（npm 版之後提供）。`init` 先列出要改的每個檔，`uninstall` 把每個檔還原。
- **網頁看板**，在瀏覽器裡看，唯讀，只在你自己的電腦上。

v0.9.x（QA 關卡、額度優先派工）：[CHANGELOG](CHANGELOG.md)

## 安裝

**Claude Code 桌面版**（Code 分頁）：

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

或點提示框旁的 **+** → **Plugins** → **Add marketplace** → 輸入 `AudiChang-hub/claude-project-pm` → **Add plugin**。接著在專案裡新開一個 Session，輸入 `/pm`。保持更新：`claude` → `/plugin` → **Marketplaces** → `claude-project-pm` → **Enable auto-update**。

**Claude Code CLI：** 從 [Releases](https://github.com/AudiChang-hub/claude-project-pm/releases) 下載你電腦用的檔，在專案資料夾裡加上 `init` 執行。沒加 `--yes` 之前不會改任何東西。npm 版（`npx`）之後的版本才提供。

逐步說明，以及 Windows 或 macOS 跳出警告時怎麼辦（放行步驟還沒實際驗證）：[core/README.zh-TW.md](core/README.zh-TW.md)。

## 支援平台

✅ 可用 · ◐ 部分

| 功能 | Claude Code 桌面版 | Claude Code CLI¹ |
| --- | :-: | :-: |
| 看板 | ✅ | ✅ |
| 交辦清單 | ✅ | ✅ |
| QA 關卡 | ✅ | ✅ |
| 交付判斷（git、CI） | ✅ | ◐ |
| 即時追蹤 Session | ✅ | ◐ |
| Agent 派工 | ✅ | ◐ |
| 開發準則 | ✅ | ✅ |
| CI 範本² | ✅ | ✅ |

¹ 在 Claude Code 2.1.326 實測。看板是網頁看板和 `project-pm board`。部分支援的地方：CI 狀態（git 有檢查）、只看得到裝了 hook 的 Session、不會自動設定 Agent。
² GitHub Actions，在你的 repo 每次 push 和 pull request 時執行。

這張表每次推版都會更新。

## PM 幫你守住什麼

- **等你回覆的排最前面**，附上原本的問題。
- **CI 要 GitHub 說通過才算**：PM 用 `gh` 查實際結果。
- **沒上線就不算完成**：有沒有 commit、push 由 git 判斷，有沒有發布看 Session 的回報。
- **沒做完、沒驗收的工作不能結案**，除非你明確同意。

<details>
<summary><b>看看板長什麼樣</b>（示範資料）</summary>
<br>
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/board-dark-zh-TW.png">
    <img src="docs/images/board-light-zh-TW.png" alt="示範專案的 Project PM 看板：工作項目完成 55%，負責人有 Session 也有 Agent；Agents 區塊有一個執行中、一個待驗收、一個已完成；Session 有待回覆、CI 失敗、未完成、待發布和執行中。" width="420">
  </picture>
</p>
</details>

每個狀態的意思、交付怎麼判斷、開發準則，以及 Mod 在你電腦上留下哪些資料：[運作方式](docs/how-it-works.zh-TW.md)。

## 指令（桌面版）

| 指令 | 作用 |
| --- | --- |
| `/pm` | 讓目前的 Session 擔任 PM，並打開看板 |
| `/pm off` | 卸任 PM；交辦清單留給下一任 |
| `/board` | 在任何 Session 打開或收合看板 |
| `/pm lang en`・`zh-TW`・`auto` | 看板和 PM 的語言；`auto` 跟隨系統 |
| `/pm guidelines <檔案>`・`off` | 讓 PM 和各 Session 遵守你的開發準則 |

在 CLI 裡，請 Claude 擔任 PM；`project-pm open` 會打開看板。

## 需求

- Claude Code 桌面版（Mod，已在 2.1.317 測試），或 Claude Code 的 CLI（核心，已在 2.1.326 測試）。
- 選用：已登入的 [GitHub CLI](https://cli.github.com/)，讓 PM 能查 CI。
- 會改檔案的 Agent 需要 git repo。在桌面版，Agent 跑在 PM 的程序裡，重開 Claude Code 會中斷它們，看板會標成「已中斷」。

## 授權

[MIT](LICENSE)。測試：`claude plugin test .`，以及在 `core/` 裡執行 `npm test`。
