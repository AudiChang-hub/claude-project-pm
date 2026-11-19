# Project PM：Claude Code 的專案 PM

[English](README.md) | **繁體中文**

[![CI](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml/badge.svg)](https://github.com/AudiChang-hub/claude-project-pm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**同時開很多個 Claude Code Session 和 Agent，你只跟一個 PM 說話，一件工作也不漏。**

<p align="center">
  <img src="docs/images/overview-zh-TW.png" alt="Project PM v0.9.0 一頁圖解：你只跟 PM 說話，PM 把工作交給 Session 或 Agent；QA 關卡（驗收條件、push 前派獨立驗收 Agent、沒通過不能結案），以及每次派工的實測成本。" width="100%">
</p>

## 解決什麼問題

同一個專案開了好幾個 Session，工作就會漏掉：問題等你等了一小時、Session 還剩幾步就停了、說好「CI 跑完再部署」卻沒人回頭確認，而且每個 Session 收尾時都會把自己的清單全勾掉，不管事情做完了沒。

Project PM 讓專案裡的一個 Session 擔任 PM。它即時掌握每個 Session 和 Agent 的狀態，記下你交辦的每件事；只要還有事在等你、沒做完、等 CI，或還沒 push、還沒發布，它就不會說「都完成了」。

## 快速上手

需要 Claude Code 桌面版（Code 分頁）。

1. 安裝：

   ```
   /plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
   ```

   桌面版：點提示框旁的 **+** → **Plugins** → **Add marketplace** → 輸入 `AudiChang-hub/claude-project-pm` → **Add plugin**。

2. 在專案裡新開一個 Session，輸入 `/pm`。它會成為 PM、打開看板，並告訴你有哪些事在等你。
3. 直接跟 PM 說話：「有沒有漏掉的工作？」「找出沒有頁面描述的頁面。」「哪些 Session 在等我回覆？」
4. 保持更新。第三方 Plugin，Claude Code 不會自己更新：在終端機執行 `claude` → `/plugin` → **Marketplaces** → `claude-project-pm` → **Enable auto-update**，或手動執行 `claude plugin update project-pm@claude-project-pm`。

## 支援平台

✅ 可用 · ◐ 部分 · 🗓 規劃中 · — 不支援

| 功能 | Claude Code 桌面版 | Claude Code CLI¹ | Codex² | Copilot² | Antigravity² | Cursor² | Devin² |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 看板面板 | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| 文字看板 | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| 交辦清單 | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| QA 關卡 | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| 交付判斷（git、CI） | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| 即時追蹤 Session | ✅ | 🗓 v1.0 | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.2⁴ | 🗓 v1.2⁴ |
| Agent 派工 | ✅ | 🗓 v1.0 | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.1⁴ | 🗓 v1.2⁴ | 🗓 v1.2⁴ |
| 開發準則 | ✅ | 🗓 v1.0 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.1 | 🗓 v1.2 | 🗓 v1.2 |
| CI 真實資料掃描³ | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 | 🗓 v1.0 |

¹ v0.9.0 實測（Claude Code 2.1.326）：`/pm` 在 CLI 無法啟用（拿不到 Session id），所以看板、交辦清單、QA 關卡、Agent 派工都還不能用。v1.0 起由共用核心支援；即時追蹤和 Agent 派工在 v1.0 只做到部分。
² 含 App（或編輯器）和 CLI，兩者有差異時會加註。
³ v1.0 提供 GitHub Actions 範本，和用哪個 AI 工具無關。本 repo 自己的 CI 已經在用。
⁴ Claude Code 桌面版以外只能做到部分：靠 hook 自動回報，看不到沒裝 hook 的 Session，也不能開新 Session。

這張表每次推版都會更新。

## v0.9.0 亮點

- **QA 關卡。** 每個工作項目都有驗收條件。程式變更 push 前，PM 會派一個獨立的驗收 Agent，只給它 diff 和驗收條件；沒有 QA 通過（或附理由的略過），交辦清單不讓結案，驗收者也不能是負責人。看板會列出待 QA 和 QA 不通過的項目。
- **額度優先派工。** 既有 Session 要 1 小時內有活動、還沒做很多輪，PM 才交給它（約 1.8 萬等值輸入 tokens）。喚醒閒置的大 Session 約要 84 萬，所以小事改開新 Session（7 萬）或 Agent（唯讀約 6 萬）。
- **CI 擋真實資料。** 本 repo 的 CI 會掃描所有追蹤的檔案，找出真實資料；名單存在 secret，不進 repo。給你的專案用的 CI 範本在 v1.0 提供。

v0.8.0 加入了 Agent：在獨立 worktree 背景工作，PM 合併後才算完成（[發布說明](https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.8.0)）。

[CHANGELOG](CHANGELOG.md) · [QA 怎麼運作](docs/design/qa.md) · [Agent 怎麼運作](docs/design/agents.md)

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

## 指令

| 指令 | 作用 |
| --- | --- |
| `/pm` | 讓目前的 Session 擔任 PM，並打開看板 |
| `/pm off` | 卸任 PM；交辦清單留給下一任 |
| `/board` | 在任何 Session 打開或收合看板 |
| `/pm lang en`・`zh-TW`・`auto` | 看板和 PM 的語言；`auto` 跟隨系統 |
| `/pm guidelines <檔案>`・`off` | 讓 PM 和各 Session 遵守你的開發準則 |

## 需求

- **Claude Code 桌面版**（Code 分頁）：PM 會用到它內建的 Session 工具。
- 支援 function hooks Mod 的 Claude Code，已在 2.1.317 測試。
- 選用：已登入的 [GitHub CLI](https://cli.github.com/)，讓 PM 能查 CI。
- 會改檔案的 Agent 需要 git repo。Agent 跑在 PM 的程序裡，重開 Claude Code 會中斷它們，看板會標成「已中斷」。

## 授權

[MIT](LICENSE)。測試：`claude plugin validate .` 與 `claude plugin test .`，不需要登入。
