# Project PM：Claude Code 的專案 PM

一個專案往往同時開著好幾個 Claude Code Session，各自做不同的事。**Project PM** 會為每個專案指派一個 PM Session：你只要跟 PM 對話，它就能掌握所有子 Session 的進度、等你回覆的問題、中途停下的工作，以及你交辦過的每一件事，確保沒有工作被遺漏。

## 功能

- **自動追蹤每個 Session**：每個 Session 會把自己的任務清單、收尾摘要、待決策問題、最新指令與最後回報寫成一份紀錄，PM 隨時讀得到。
- **專案狀態報告**（`mcp__project-pm__board`）：PM 回報前先讀這份報告，「需要處理」排在最前面：
  - 等你回覆的 Session
  - 已停止、但任務清單仍有未完成步驟的 Session
  - 收尾摘要提到「尚未部署／尚未提交」等未完成事項
  - 仍開啟的 PR
  - 尚未指派負責 Session 的工作項目
- **工作項目清單**（`mcp__project-pm__ledger`）：你交代 PM 的每件事都以 T-01、T-02… 編號登記並指派負責的 Session，PM 確認真正完成後才會結案。專案進度以工作項目計算，而不是看各 Session 自己的勾選清單。
- **CI 沒跑完就不算完成**：Session 最後一輪的回報如果說 CI 還在跑、或要等 CI 通過才部署，狀態會標成「等待 CI」，不管停了多久都不會變成「已結束」。這時負責的工作項目也不能結案，除非使用者明確確認，並在備註寫明。
- **PM 行為準則**：PM 回報前一定先看狀態報告；實作交給子 Session，自己不改程式碼；「需要處理」還沒清空之前，不會說「都完成了」。
- **專案看板面板**：
  - 完成率圓環，以及執行中、待回覆、中斷・未完成三項指標
  - Session 卡片：狀態燈號與逐步進度條；封存按鈕要滑過卡片才會出現，按下後還需再確認一次
  - 可切換「本專案／全部」
  - PM 會在子 Session 開始等你回覆、或中途停下時跳出通知
- **新專案提示**：還沒有 PM 的專案，輸入框上方會出現「建立 PM Session」或「由此 Session 擔任」的選項。

## 安裝

需要支援 function hooks Mod 的 Claude Code（已在 2.1.299 測試）。PM 會用到 Claude Code 桌面版（Code 分頁）內建的 Session 管理工具，所以請在桌面版中使用。

在終端機的 Claude Code 提示字元輸入：

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

或在 shell 執行：

```bash
claude plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

在桌面版中（無法使用 `/plugin`）：點提示框旁的 **+** → **Plugins** → **Add marketplace**，輸入 `AudiChang-hub/claude-project-pm`，再點 **Add plugin**。

安裝後新開的 Session 才會載入。

## 使用方式

| 指令 | 作用 |
| --- | --- |
| `/pm` | 指定目前的 Session 為這個專案的 PM，並開啟專案看板 |
| `/pm off` | 卸任 PM（工作項目會保留，由下一任 PM 接手） |
| `/board` | 在任何 Session 開啟或收合專案看板 |

接著直接跟 PM 對話，例如：

- 「目前有沒有漏掉的工作？」
- 「幫我把匯出 CSV 交給商品列表那個 Session 做。」
- 「哪些 Session 在等我回覆？」

## 運作方式與資料

- 每個 Session 只寫自己的紀錄檔：`~/.claude/project-pm/sessions/<session id>.json`。
- 每個專案一份檔案，記錄 PM 與工作項目：`~/.claude/project-pm/projects/<專案>-<hash>.json`。
- 所有資料都存在本機，不會傳到任何外部服務。Session 清單、紀錄讀取與封存，都是透過桌面版內建的 `ccd_session_mgmt` 工具完成。
- Mod 安裝前就開著的 Session 沒有追蹤紀錄，看板只會顯示它們最後一則訊息。

## 開發

```bash
claude plugin validate .
claude plugin test .
```

## 授權

MIT
