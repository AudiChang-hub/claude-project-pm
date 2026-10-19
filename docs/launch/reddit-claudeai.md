# r/ClaudeAI draft

A first-person share of what it is like to run many sessions at once, not a pitch. Fill in the two
`[In your own words: …]` spots before posting, and delete the brackets.

**Check the subreddit's current rules and flair before posting.** Reddit could not be read from the
session that wrote this, so they were not verified. On https://www.reddit.com/r/ClaudeAI/about/rules
look for: which flair fits a project you built (it has had a "Built with Claude" style flair),
whether a self-promotion disclosure is required, and whether links must be free to try (this one
is: MIT, no sign-up).

Attach `docs/images/board-hero.png` if the post type allows an image; otherwise the repository link
shows it.

---

## Title

```
I kept losing track of my parallel Claude Code sessions, so I had Claude Code build a PM session to watch the others
```

## Body

```
Upfront: this was built with Claude Code, and the repo has been developed the same way it works.
One "PM" session takes my requests, hands each one to a sub-session, and checks the work before
calling it done. I mostly talked to the PM.

[In your own words: one sentence on why you started running many sessions at once, or what made you
want this.]

What kept slipping with several sessions open on one project (mostly a business app I'm building):

- A session asked me a question, and I didn't notice for an hour.
- A session stopped with steps of its plan left, and nothing said so.
- A session said "CI is running, I'll deploy once it passes," and nobody came back to check.
- Every session ticks its whole checklist when its turn ends, so the sidebar looked done when the
  work wasn't.

So the PM keeps a board of every session in the project (what's waiting on me first) and a ledger
of what I asked for. Progress is counted from the ledger, not from the sessions' own checklists.

The part I didn't expect: most of the fixes came from actually using it, on itself and on that app.

- "CI is still running" was being treated as done. Now that session stays "waiting on CI" until
  GitHub says the run passed, and the PM won't close the work item before then.
- Work that was committed but not pushed or deployed showed as "ended." Now it has its own "not
  released" status and stays open.
- A session waiting on its own background tests showed as "stopped halfway."
- A report that merely quoted a status name like "waiting on CI" was read as if CI were still
  running.

Each time, the PM handed the fix to a sub-session, then checked the board again before closing the
item.

[In your own words: one honest sentence about what it's been like, e.g. what changed in how you
work, or what still bugs you.]

The board, the PM and its tools come in English and Traditional Chinese. It follows your system
language, `/pm lang en` or `/pm lang zh-TW` switches, and it reads sessions' reports in either
language whichever one it shows.

Caveats: it needs the Claude Code desktop app (Code tab). Everything stays in local JSON files; the
only network call is `gh` asking GitHub about CI with your own login.

It's open source (MIT) if you want to look or borrow the idea:
https://github.com/AudiChang-hub/claude-project-pm

How do you keep track when you run several sessions at once? Separate terminals, a notes file, a
rule of only N at a time? Curious what works for other people.
```

---

## 繁中對照（給自己看，不發）

### 標題

我常常搞不清楚同時開的多個 Claude Code Session 進度，所以讓 Claude Code 做了一個 PM Session 來盯其他 Session

### 內文

先說清楚：這是用 Claude Code 做的，而且這個 repo 本身的開發方式就是它的用法：由一個「PM」Session 接我的需求、把每件事交給子 Session，驗收過才算完成。我大多只跟 PM 說話。

[用你自己的話：一句話說你為什麼開始同時開很多 Session，或是什麼讓你想做這個。]

同一個專案開了好幾個 Session（大多是我在做的一個商業應用程式）時，常漏掉的事：

- 某個 Session 問了我問題，我一個小時後才發現。
- 某個 Session 計畫還剩幾步就停了，沒有任何提示。
- 某個 Session 說「CI 在跑，通過後我再部署」，然後沒人回頭確認。
- 每個 Session 收尾時都會把自己的清單全部勾掉，所以側欄看起來做完了，其實沒有。

所以 PM 會維護一個看板，列出專案裡每個 Session（等我回覆的排最前面），以及一份我交辦事項的清單。進度以這份清單計算，不看各 Session 自己的勾選清單。

沒想到的是：大部分的修正都是實際使用時發現的，用在它自己身上，也用在那個應用程式上。

- 「CI 還在跑」曾被當成完成。現在那個 Session 會維持「等待 CI」，直到 GitHub 確認那次執行通過；在那之前 PM 不會讓工作項目結案。
- 已經 commit、但還沒 push 或部署的工作，曾顯示「已結束」。現在有獨立的「待發布」狀態，會一直維持未完成。
- 在等自己背景測試的 Session，曾被顯示成「中途停下」。
- 回報裡只是引用了「等待 CI」這個狀態名稱，就被當成 CI 還在跑。

每次都是 PM 把修正交給子 Session，修完再回看板確認，才把那一項結案。

[用你自己的話：一句誠實的話講使用感受，例如工作方式有什麼改變，或還有什麼讓你困擾。]

看板、PM 和它的工具都有英文與繁體中文介面：預設跟隨系統語言，可以用 `/pm lang en` 或 `/pm lang zh-TW` 切換；不論顯示哪種語言，都讀得懂子 Session 用中文或英文寫的回報。

限制：需要 Claude Code 桌面版（Code 分頁）。資料都存在本機的 JSON 檔，唯一的網路呼叫是 `gh` 用你自己的登入向 GitHub 查 CI。

開源（MIT），想看看或借用這個做法的話：
https://github.com/AudiChang-hub/claude-project-pm

你們同時開好幾個 Session 時，都怎麼掌握進度？分開的終端機、一份筆記、限制同時只開幾個？想聽聽大家的做法。
