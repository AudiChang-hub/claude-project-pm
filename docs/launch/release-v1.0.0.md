## project-pm 1.0.0

Project PM now works in Claude Code's command line too: one program serves the PM's board, ledger and QA gate over MCP, holds a push whose commits nobody checked, and can add a QA workflow for GitHub Actions to your project. What changed: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/v1.0.0/CHANGELOG.md). The desktop app's mod shares this version number and is otherwise unchanged since v0.9.1; update it from the marketplace as before.

Project PM 現在也能在 Claude Code 的命令列版使用：一個程式用 MCP 提供 PM 的看板、交辦清單和 QA 關卡，擋下沒人驗收過的 push，也能幫你的專案加上 GitHub Actions 的品質檢查。桌面版的 mod 版號跟著改成這一版，內容和 v0.9.1 相同，照原本的方式從 marketplace 更新。

Download the file for your computer below, then follow the install guide: [English](https://github.com/AudiChang-hub/claude-project-pm/blob/v1.0.0/core/README.md) · [中文](https://github.com/AudiChang-hub/claude-project-pm/blob/v1.0.0/core/README.zh-TW.md).

| Computer | File |
| --- | --- |
| Windows | `project-pm-windows-x64.exe` |
| Mac, Apple chip | `project-pm-macos-arm64` |
| Mac, Intel chip | `project-pm-macos-x64` |
| Linux | `project-pm-linux-x64`, `project-pm-linux-arm64` |

Check the file against `SHA256SUMS` before you run it. There is no npm version yet; it comes in a later release. 目前沒有 npm 版，之後的版本才提供。

### Known limits / 已知限制

- **Not code-signed / 沒有程式碼簽章.** Windows and macOS warn the first time; the install guide shows how to allow it. With Windows **Smart App Control** on, the program may be blocked with no way to allow it, and for now there is no other way to run it: the npm version comes later. 第一次執行時 Windows、macOS 會警告，安裝說明有放行步驟；Windows 開著「智慧型應用程式控制」時可能直接擋下，目前沒有其他方式可以執行，npm 版之後才推出。
- **Windows: the steps to allow a program downloaded from the web were not checked / Windows 從網路下載後的放行步驟還沒實際驗證.** The program, built on Windows, was run there; the SmartScreen steps for a download were not tried. 程式本身在 Windows 上建置後實際執行過，但從網路下載後 SmartScreen 的放行流程還沒試過。
- **macOS: the steps to allow the program were not checked on a real Mac / macOS 的放行步驟未在實機驗證.** The Mac programs were built and tested on GitHub's macOS runners. Mac 版程式本身有在 GitHub 的 macOS 機器上建置並跑過測試。
- **Only Claude Code has been tested (2.1.326) / 只實際測過 Claude Code（2.1.326）.** `init` sets up Claude Code's command line only; Codex, Copilot, Antigravity, Cursor, Devin and other AI tools have not been tried at all. `init` 只設定 Claude Code 的命令列版；Codex、Copilot、Antigravity、Cursor、Devin 等其他 AI 工具都還沒有試過。
