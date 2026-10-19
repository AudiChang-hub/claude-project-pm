# Launch kit

Drafts for making the repository public-facing. **Nothing here has been applied or posted.**
Each step below is a public action; run it only after the owner has approved it.

| File | What it is | Status |
| --- | --- | --- |
| [repo-metadata.md](repo-metadata.md) | Repository description, topics and the `gh` command that sets them | Ready |
| [release-v0.4.0.md](release-v0.4.0.md) | Release notes body for `v0.4.0` (used as `--notes-file`) | Ready |
| [reddit-claudeai.md](reddit-claudeai.md) | r/ClaudeAI post: a first-person share, with a Traditional Chinese reading copy | Two spots for the owner's own words |
| [awesome-claude-code.md](awesome-claude-code.md) | Notes for the awesome-claude-code "Recommend a Resource" web form | On or after 2026-10-31, by the owner |
| [show-hn.md](show-hn.md) | Show HN title and first comment | On hold, not posting |

## Order

1. **Push** the local commits on `main`, then check that CI passes on GitHub:

   ```bash
   git push origin main
   ```

2. **Description and topics** (see [repo-metadata.md](repo-metadata.md)):

   ```bash
   gh repo edit AudiChang-hub/claude-project-pm --description "One PM session per project for Claude Code: a live board of every session (waiting on you, stopped mid-plan, CI still running) and a ledger of the work you asked for." --add-topic claude-code --add-topic claude-code-plugin --add-topic ai-agents --add-topic project-management --add-topic developer-tools
   ```

3. **Tag and release** `v0.4.0` (matches `.claude-plugin/plugin.json`); `gh release create` makes the tag on `main`:

   ```bash
   gh release create v0.4.0 --repo AudiChang-hub/claude-project-pm --target main --title "v0.4.0" --notes-file docs/launch/release-v0.4.0.md
   ```

4. **r/ClaudeAI**, once the release is out: fill in the two `[In your own words: …]` spots in
   [reddit-claudeai.md](reddit-claudeai.md), check the subreddit's rules and flair, then post by hand.

5. **awesome-claude-code**, on or after **2026-10-31** (14 days after the first commit, 2026-10-17):
   the owner fills in the web form by hand; pull requests and `gh` submissions are not accepted.
   See [awesome-claude-code.md](awesome-claude-code.md).

Show HN is on hold; [show-hn.md](show-hn.md) is kept for later.
