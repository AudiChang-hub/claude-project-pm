**Run many Claude Code sessions in parallel without losing track of any work.**

Project PM gives each project one PM session. You talk to the PM; it keeps a live board of every other session in the project and a ledger of everything you asked for, and it will not call the work done while a session is waiting on you, stopped halfway, still running in the background, waiting on CI, or not yet pushed or released.

It needs the Claude Code desktop app (Code tab) and a Claude Code version that supports function-hook mods (tested with 2.1.317).

```
/plugin install project-pm --marketplace AudiChang-hub/claude-project-pm
```

Then type `/pm` in a new session of your project.

## Highlights

Your own development rules, followed by every session of a project with a PM. A request that breaks them is asked about first, and an exception covers that one request only.

## Added

- **Development guidelines.** Point the new `guidelines` option at a Markdown file of your rules: an absolute path, `~/…`, or a path relative to each project's folder. The PM and every other session of a project with a PM get it in their system prompt each turn. The file is read fresh every turn, so an edit applies from the next turn with no reload, and its text stays on your machine. Set it with `/pm guidelines <file>`, clear it with `/pm guidelines off`, and check it with `/pm guidelines`.
- **The PM coordinates by the rules.** It carries out what the guidelines leave to a coordinator, such as version numbers, the order of pushes and deployments, and the definition of done. It also points out a session that breaks a rule.
- **Exceptions are asked for, one at a time.** A request that breaks the guidelines is not carried out until the session has named the rule and you have agreed to an exception. The exception covers that request alone: a similar request later is asked about again. The PM notes each approved exception on its work item.
- **The guidelines file is locked.** An edit to it (`Edit`, `MultiEdit`, `Write`, `NotebookEdit`) is refused unless your latest message in that session asks about the guidelines. The refusal tells the session to ask you first.

## Known limitations

- Desktop app only: the PM relies on the app's built-in session tools.
- The lock recognises a message about the guidelines by the words 準則, 守則 or "guideline". It covers the file-editing tools, not a shell command that writes the file.
- A guidelines file over 24,000 characters is cut, with a note to read the rest.
- Sessions of projects without a PM are not given the guidelines.

Full history: [CHANGELOG.md](https://github.com/AudiChang-hub/claude-project-pm/blob/main/CHANGELOG.md)
