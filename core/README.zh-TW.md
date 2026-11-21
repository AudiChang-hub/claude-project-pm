# project-pm

[English](README.md)

給 Claude Code 用的 PM：一份交辦清單、結案和 push 之前的驗收檢查，以及一張看得到每個 Session 進度的看板。它是一個 MCP server（MCP 是 Claude Code 接上額外工具的方式）。

Project PM **只支援 Claude Code**；它會幫你設定 Claude Code 的命令列版。不需要 Node.js：下載一個程式，執行一次就好。

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

- **Windows：** 瀏覽器可能說這個檔案「不常下載」，請選「保留」。從檔案總管點兩下時若出現「Windows 已保護您的電腦」，按「其他資訊」→「仍要執行」。從終端機執行不一定會跳出這個視窗。*Windows 從網路下載後的放行步驟還沒實際驗證過；程式本身已經在 Windows 上執行過。*
  - 如果開著「**智慧型應用程式控制**」（Smart App Control），Windows 可能直接擋下、沒有放行按鈕。目前沒有其他方式可以執行：可以替代的 npm 版還沒推出（見下面）。不需要為此關掉這項保護。
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
- 專案 `CLAUDE.md` 的一個段落（沒有就建立）。v1.0 裝的會寫在 `AGENTS.md`，下次執行 `init` 時搬進 `CLAUDE.md`；不論哪一版裝的，`uninstall` 都會把兩個檔還原。
- Skill：`~/.claude/skills/project-pm/SKILL.md`。
- git 的 `pre-push` hook（每次 `git push` 之前 git 會先執行的檢查）：commit 驗收過才能 push。`git pm skip "<理由>"` 可以明確略過這一次，理由會記在看板上。
- 選填（`--ci`）：`.github/workflows/project-pm-qa.yml`。

如果你在 GitHub 上設了分支保護，要求檢查通過才能 merge，請把這份 workflow 加的**兩個**檢查都設成必要：**Project PM 品質檢查**和**不能公開的詞**（掃描你放在 `BLOCKED_TERMS` secret 裡的詞）。這是兩個分開的檢查，只把第一個設成必要的話，詞的掃描沒過還是能 merge。（workflow 是英文版時，名稱是 **Project PM QA** 和 **Words that must stay private**。）

每一項都記在 `~/.project-pm/install-log.json`。

## 移除

請在專案的資料夾裡執行，也就是當初執行 `init` 的那個資料夾：

```
~/.project-pm/bin/project-pm-1.1.0 uninstall --yes
```

（Windows 是 `project-pm-1.1.0.exe`；檔名帶的是你安裝的版號）。每個檔都會回到安裝前的樣子。`uninstall --hooks` 只移除 git hook。

## npm 版（之後提供）

給有 Node.js 20 以上的開發者用的 npm 版（`npx -y project-pm@<版號> init`）已經規劃，但**還沒推出**：目前沒有任何版本發到 npm。目前請用上面的執行檔。

## 已知限制

- 程式沒有程式碼簽章（見上面）。Windows 開著「智慧型應用程式控制」時可能直接擋下，目前沒有其他方式可以執行；npm 版要之後的版本才推出。
- Project PM 還沒有發到 npm。
- 開發準則檔會擋住 AI 用編輯工具去改。繞過這道擋的修改（用指令改、其他 Session 改、你自己用編輯器改），以及準則設定被改（`git rm` 準則檔、改了 `.project-pm.json`、關掉準則），只會在事後被發現，列在看板的「需要處理」；Project PM 不會自動把檔案改回去。要還原的話，警告裡會附上 `~/.project-pm/guidelines/copies/` 裡的唯讀備份，是你上一次說話時這個檔的內容，請 AI 把它複製回去。抓不到的情況：故意繞過偵測的修改，以及背景指令在一輪結束後、你下一次說話前做的修改。
- Windows 從網路下載後的放行步驟（SmartScreen）還沒實際驗證過。程式本身在 Windows 上建置後實際執行過。
- Mac 的放行步驟沒有在實機驗證過。Mac 版程式本身有在 GitHub 的 Mac 機器上建置並跑過測試。
