# Launch kit

Drafts for making the repository public-facing. **Nothing here has been applied or posted.**
Each step below is a public action; run it only after the owner has approved it.

| File | What it is |
| --- | --- |
| [repo-metadata.md](repo-metadata.md) | Repository description, topics and the `gh` command that sets them |
| [release-v0.3.2.md](release-v0.3.2.md) | Release notes body for `v0.3.2` (used as `--notes-file`) |
| [show-hn.md](show-hn.md) | Show HN title, URL and first comment |
| [reddit-claudeai.md](reddit-claudeai.md) | r/ClaudeAI post |
| [awesome-claude-code.md](awesome-claude-code.md) | Answers for the awesome-claude-code "Recommend a Resource" issue form |

## Order

1. **Push** the local commits on `main`:

   ```bash
   git push origin main
   ```

   Then check that the CI workflow passes on GitHub (the README badge reads its result).

2. **Description and topics** (see [repo-metadata.md](repo-metadata.md)):

   ```bash
   gh repo edit AudiChang-hub/claude-project-pm --description "One PM session per project for Claude Code: a live board of every session (waiting on you, stopped mid-plan, CI still running) and a ledger of the work you asked for." --add-topic claude-code --add-topic claude-code-plugin --add-topic ai-agents --add-topic project-management --add-topic developer-tools
   ```

3. **Tag and release** `v0.3.2` (matches `.claude-plugin/plugin.json`); `gh release create` makes the tag on `main`:

   ```bash
   gh release create v0.3.2 --repo AudiChang-hub/claude-project-pm --target main --title "v0.3.2" --notes-file docs/launch/release-v0.3.2.md
   ```

4. **Posts**, once the release is out: [Show HN](show-hn.md), [r/ClaudeAI](reddit-claudeai.md).

5. **awesome-claude-code**: submit through the web issue form, by a person, **not before 2026-10-31**
   (the list needs 14 days since the first commit, 2026-10-17, or 100 stars). See [awesome-claude-code.md](awesome-claude-code.md).
