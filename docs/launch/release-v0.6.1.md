**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, still running in the background, waiting on CI, or not yet pushed or released.

It follows v0.5.1 and includes v0.5.2 and v0.6.0. It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.317).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

Sessions now tell the PM where their work stands, in fields rather than in prose, and the PM hears about it the moment it happens.

## Added

- **Sessions report in fields.** In a project with a PM, the other sessions get a `report` tool and are asked to call it whenever they finish, pause or get stuck: a `status` (`done`, `in_progress`, `blocked`, `waiting_user`, `waiting_ci`, `waiting_release`), a one-sentence `summary`, and the `commit`, the `ci` run still going and the `delivery` (`not_needed`, `released`, `pending`) when they apply. The board goes by these fields, never by the wording of the summary, and git and GitHub still check the commit and the CI run it names. The report shows on the session's card and on the PM's board. A session that cannot call the tool still ends its recap with the delivery line, as before.
- **The PM hears at once.** When a session reports or ends a turn, it sends the PM a one-line update; the PM's mod takes it in before it reaches the PM's conversation and redraws the board right away. No extra turn, no tokens. In the desktop app the board ran its round about 0.1 s after the update arrived. Only a PM whose mod can take updates in is sent one, and the 30-second poll stays as a fallback.
- **Open sessions update themselves.** Once `claude plugin update` installs a newer copy of the mod, each session still running the old one shows a toast and runs `/reload-plugins` as soon as it is idle (never mid-turn), and its subagents reload with it. Sessions running a copy older than 0.5.2 need one `/reload-plugins`, or a restart of the app, to get this.

## Fixed

- A session no longer logs that it could not reach the PM when the PM had in fact taken the update in. The app reports a delivery the receiver consumed as "did not accept it".

## Known limitations

- Desktop app only: the PM relies on the app's built-in session tools.
- A report holds for the turn that made it. A later turn that ends without its own report (a background job waking the session, say) falls back to reading what the session wrote.
- Sessions that do not call the tool are still judged from what they wrote, facts first; phrasing the board does not recognise falls through to *Ended*.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
