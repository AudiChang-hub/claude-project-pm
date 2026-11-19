# project-pm

[English](README.md)

給 AI 寫程式用的 PM：一份交辦清單、結案和 push 之前的驗收檢查，以及一張看得到每個 Session 進度的看板。它是一個 MCP server（MCP 是 AI 工具接上額外工具的標準方式）。

1.0 版只幫你設定、也只實際測過 **Claude Code 的命令列版**。其他支援 MCP 的 AI 工具也許接得上，但都還沒有實際試過。不需要 Node.js：下載一個程式，執行一次就好。

## 安裝

### 1. 下載

到專案的 [Releases 頁面](https://github.com/AudiChang-hub/claude-project-pm/releases)，下載符合你電腦的檔案：

| 電腦 | 檔案 |
| --- | --- |
| Windows | `project-pm-windows-x64.exe` |
| Apple 晶片的 Mac（M1 以後） | `project-pm-macos-arm64` |
| Intel 晶片的 Mac | `project-pm-macos-x64` |
| Linux | `project-pm-linux-x64` 或 `project-pm-linux-arm64` |

只從這個頁面下載。要確認檔案是真的，把它的 SHA-256 和同一頁 `SHA256SUMS` 裡對應的那一行比對：

- Windows（PowerShell）：`Get-FileHash .\project-pm-windows-x64.exe`
- Mac：`shasum -a 256 project-pm-macos-arm64`
- Linux：`sha256sum project-pm-linux-x64`

### 2. 第一次執行時放行

**為什麼電腦會警告：** 這個程式沒有程式碼簽章。簽章憑證每年都要付費，這個專案免費，所以沒有買。警告不代表程式有問題，只代表系統不知道是誰做的；所以第 1 步的比對很重要。

- **Windows：** 瀏覽器可能說這個檔案「不常下載」，請選「保留」。從檔案總管點兩下時若出現「Windows 已保護您的電腦」，按「其他資訊」→「仍要執行」。從終端機執行不一定會跳出這個視窗。
  - 如果開著「**智慧型應用程式控制**」（Smart App Control），Windows 可能直接擋下、沒有放行按鈕。這時請改用下面的 npm 版（要先裝 Node.js）。不需要為此關掉這項保護。
- **Mac：** 可能出現「無法打開，因為 Apple 無法檢查是否包含惡意軟體」。打開「系統設定」→「隱私權與安全性」，捲到最下面按「仍要打開」。或在終端機執行 `xattr -d com.apple.quarantine project-pm-macos-arm64`，這一行只是拿掉這個檔案「從網路下載」的標記。*Mac 的放行步驟還沒有在實機上驗證過。*
- **Linux：** 不會警告，但檔案還不能執行：`chmod +x project-pm-linux-x64`。

### 3. 設定專案

在終端機進到專案的資料夾（要是 git repo），執行：

```
./project-pm-windows-x64.exe init
```

（換成你的檔名）。它會列出打算改的每個檔，**但不會改**。確認沒問題後，加上 `--yes` 再執行一次。加 `--ci` 會一併加入 GitHub Actions 的品質檢查。

`init` 會把程式複製到 `~/.project-pm/bin/`，所有設定都指向這份複本，下載的檔案之後可以刪掉。它不改 PATH、不安裝其他東西，也不需要系統管理員權限。

## 會改哪些東西

- Claude Code 的 MCP 設定（`claude mcp add --scope user project-pm`），以及 `~/.claude/settings.json` 裡的 hook（hook 是 Claude Code 在固定時機自動執行的指令，例如你送出訊息時；這幾個是讓看板知道每個 Session 做到哪裡）。
- 專案 `AGENTS.md` 的一個段落；有 `CLAUDE.md` 時，在它開頭加一行 `@AGENTS.md`。
- Skill：`~/.claude/skills/project-pm/SKILL.md`。
- git 的 `pre-push` hook（每次 `git push` 之前 git 會先執行的檢查）：commit 驗收過才能 push。`git pm skip "<理由>"` 可以明確略過這一次，理由會記在看板上。
- 選填（`--ci`）：`.github/workflows/project-pm-qa.yml`。

每一項都記在 `~/.project-pm/install-log.json`。

## 移除

請在專案的資料夾裡執行，也就是當初執行 `init` 的那個資料夾：

```
~/.project-pm/bin/project-pm-1.0.0 uninstall --yes
```

（Windows 是 `project-pm-1.0.0.exe`）。每個檔都會回到安裝前的樣子。`uninstall --hooks` 只移除 git hook。

## npm 版（給有 Node.js 20 以上的開發者）

```
npx -y project-pm@1.0.0 init
```

它寫入的設定用 `npx -y project-pm@1.0.0` 啟動 server。

## 1.0 已知限制

- 程式沒有程式碼簽章（見上面）。Windows 開著「智慧型應用程式控制」時，請改用 npm 版。
- Mac 的放行步驟沒有在實機驗證過。Mac 版程式本身有在 GitHub 的 Mac 機器上建置並跑過測試。
- 只實際測過 Claude Code 的命令列版。Codex、GitHub Copilot、Antigravity、Cursor、Devin 等其他 AI 工具都還沒有試過，`init` 也不會幫它們設定；之後的版本才會支援。
