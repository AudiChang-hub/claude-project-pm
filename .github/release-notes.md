## project-pm {{VERSION}}

Download the file for your computer below, then follow the install guide: [English](https://github.com/AudiChang-hub/claude-project-pm/blob/{{TAG}}/core/README.md) · [中文](https://github.com/AudiChang-hub/claude-project-pm/blob/{{TAG}}/core/README.zh-TW.md).

| Computer | File |
| --- | --- |
| Windows | `project-pm-windows-x64.exe` |
| Mac, Apple chip | `project-pm-macos-arm64` |
| Mac, Intel chip | `project-pm-macos-x64` |
| Linux | `project-pm-linux-x64`, `project-pm-linux-arm64` |

Check the file against `SHA256SUMS` before you run it. npm: `npx -y project-pm@{{VERSION}} init` (Node.js 20 or later).

### Known limits / 已知限制

- **Not code-signed / 沒有程式碼簽章.** Windows and macOS warn the first time; the install guide shows how to allow it. With Windows **Smart App Control** on, the program may be blocked with no way to allow it: use the npm version (needs Node.js). 第一次執行時 Windows、macOS 會警告，安裝說明有放行步驟；Windows 開著「智慧型應用程式控制」時可能直接擋下，請改用 npm 版（要先裝 Node.js）。
- **Windows: the steps to allow a program downloaded from the web were not checked / Windows 從網路下載後的放行步驟還沒實際驗證.** The program, built on Windows, was run there; the SmartScreen steps for a download were not tried. 程式本身在 Windows 上建置後實際執行過，但從網路下載後 SmartScreen 的放行流程還沒試過。
- **macOS: the steps to allow the program were not checked on a real Mac / macOS 的放行步驟未在實機驗證.** The Mac programs were built and tested on GitHub's macOS runners. Mac 版程式本身有在 GitHub 的 macOS 機器上建置並跑過測試。
- **Only Claude Code has been tested / 只實際測過 Claude Code.** `init` sets up Claude Code's command line only; Codex, Copilot, Antigravity, Cursor, Devin and other AI tools have not been tried at all. `init` 只設定 Claude Code 的命令列版；Codex、Copilot、Antigravity、Cursor、Devin 等其他 AI 工具都還沒有試過。
