# Launch kit

Drafts and steps for making the repository public-facing. Each step is a public action, run only
after the owner has approved it. Steps 1–3 are done; the posts have not been made.

| File | What it is | Status |
| --- | --- | --- |
| [repo-metadata.md](repo-metadata.md) | Repository description, topics and the `gh` command that sets them | Applied 2026-10-19 |
| [release-v0.4.0.md](release-v0.4.0.md) | Release notes for `v0.4.0`, as published (before the English UI) | Published 2026-10-19 |
| [reddit-claudeai.md](reddit-claudeai.md) | r/ClaudeAI post: a first-person share (mentions the English and Traditional Chinese UI), with a Traditional Chinese reading copy | Two spots for the owner's own words |
| [awesome-claude-code.md](awesome-claude-code.md) | Notes for the awesome-claude-code "Recommend a Resource" web form | On or after 2026-10-31, by the owner |
| [show-hn.md](show-hn.md) | Show HN title and first comment | On hold, not posting |

## Order

1. ~~**Push** `main` and check that CI passes on GitHub.~~ Done 2026-10-19.

2. ~~**Description and topics**~~ (see [repo-metadata.md](repo-metadata.md)). Done 2026-10-19.

3. ~~**Tag and release**~~ `v0.3.2` and `v0.4.0` are published; `v0.4.0` is the latest
   (https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.4.0). For a later release,
   bump `.claude-plugin/plugin.json`, then:

   ```bash
   gh release create v<version> --repo AudiChang-hub/claude-project-pm --target main --title "v<version>" --notes-file docs/launch/release-v<version>.md
   ```

4. **r/ClaudeAI**, after the release that ships the English interface (the draft mentions it): fill in the two `[In your own words: …]` spots in
   [reddit-claudeai.md](reddit-claudeai.md), check the subreddit's rules and flair, then post by hand.

5. **awesome-claude-code**, on or after **2026-10-31** (14 days after the first commit, 2026-10-17):
   the owner fills in the web form by hand; pull requests and `gh` submissions are not accepted.
   See [awesome-claude-code.md](awesome-claude-code.md).

Show HN is on hold; [show-hn.md](show-hn.md) is kept for later.
