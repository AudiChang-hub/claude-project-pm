# Launch kit

Drafts and steps for making the repository public-facing. Each step is a public action, run only
after the owner has approved it. Steps 1–3 are done (v0.9.0 is the latest release); v0.9.1 (step 4)
and v1.0.0 (step 5) are prepared, not released; the posts have not been made.

| File | What it is | Status |
| --- | --- | --- |
| [repo-metadata.md](repo-metadata.md) | Repository description, topics and the `gh` command that sets them | Applied 2026-10-19 |
| [release-v1.0.0.md](release-v1.0.0.md) | Release notes for `v1.0.0`: the core, for Claude Code's command line; the same text `.github/release-notes.md` gives the release | Ready, not released |
| [release-v0.9.1.md](release-v0.9.1.md) | Release notes for `v0.9.1`: sessions a usage limit stopped need attention, and the PM picks them up | Ready, not released |
| [release-v0.9.0.md](release-v0.9.0.md) | Release notes for `v0.9.0`: a QA gate, quota-first hand-offs and a CI real-data scan | Published 2026-11-19 |
| [release-v0.8.0.md](release-v0.8.0.md) | Release notes for `v0.8.0`: the PM hands work to agents, and spends far fewer tokens | Published 2026-11-18 |
| [release-v0.7.1.md](release-v0.7.1.md) | Release notes for `v0.7.1`: released sessions, cherry-picked commits and closed work items | Published 2026-11-16 |
| [release-v0.7.0.md](release-v0.7.0.md) | Release notes for `v0.7.0`: development guidelines | Published 2026-11-09 |
| [release-v0.6.1.md](release-v0.6.1.md) | Release notes for `v0.6.1`: sessions report in fields, and the PM hears at once | Published 2026-11-06 |
| [release-v0.5.1.md](release-v0.5.1.md) | Release notes for `v0.5.1`: fixes to how reports are read | Published 2026-10-20 |
| [release-v0.5.0.md](release-v0.5.0.md) | Release notes for `v0.5.0`: the English and Traditional Chinese interface | Published 2026-10-19 |
| [release-v0.4.0.md](release-v0.4.0.md) | Release notes for `v0.4.0`, as published (before the English UI) | Published 2026-10-19 |
| [reddit-claudeai.md](reddit-claudeai.md) | r/ClaudeAI post: a first-person share (mentions the English and Traditional Chinese UI), with a Traditional Chinese reading copy | Two spots for the owner's own words |
| [awesome-claude-code.md](awesome-claude-code.md) | Notes for the awesome-claude-code "Recommend a Resource" web form | On or after 2026-10-31, by the owner |
| [show-hn.md](show-hn.md) | Show HN title and first comment | On hold, not posting |

## Order

1. ~~**Push** `main` and check that CI passes on GitHub.~~ Done 2026-10-19.

2. ~~**Description and topics**~~ (see [repo-metadata.md](repo-metadata.md)). Done 2026-10-19.

3. ~~**Tag and release**~~ `v0.3.2` through `v0.9.0` are published; `v0.9.0` is the latest
   (https://github.com/AudiChang-hub/claude-project-pm/releases/tag/v0.9.0).

4. **Push and release `v0.9.1`** (sessions a usage limit stopped need attention; `.claude-plugin/plugin.json` is already 0.9.1). Push first
   and wait for CI to pass, then:

   ```bash
   git push origin main
   ```

   ```bash
   gh release create v0.9.1 --repo AudiChang-hub/claude-project-pm --target main --title "v0.9.1" --notes-file docs/launch/release-v0.9.1.md
   ```

   For later releases: bump `.claude-plugin/plugin.json`, write `docs/launch/release-v<version>.md`,
   and run the same command with that version.

5. **Release `v1.0.0`** by pushing its tag, not with `gh release create`: from v1.0.0 on,
   `.github/workflows/release.yml` builds the five programs on a `v*` tag, tests them, and publishes
   the release with `SHA256SUMS` and the text of `.github/release-notes.md` (the same as
   [release-v1.0.0.md](release-v1.0.0.md)). It stops when the tag is not the version of both
   `core/package.json` and `.claude-plugin/plugin.json` (D7). Before the tag:
   - Try a build by hand first (Actions → Release → Run workflow): it publishes nothing, and its
     artifacts are the programs to download and allow as a person would (SmartScreen).
   - v1.0.0 is not published to npm (decided 2026-11-19): without the `NPM_TOKEN` repository
     secret, release.yml skips the npm job, and the READMEs and release text say the npm version
     comes later.
   - **npm later:** once the owner has made the npm account and set `NPM_TOKEN` (only they can),
     release a patch (bump both versions, tag `v1.0.1`): the same workflow then publishes it to
     npm too. Then turn "npm comes later" in the READMEs, `core/README*.md` and the release text
     back into the `npx` instructions, and Smart App Control's way out (the npm version).

   ```bash
   git push origin main
   git tag v1.0.0 && git push origin v1.0.0
   ```

6. **r/ClaudeAI**: the English interface the draft mentions shipped in `v0.5.0`, so it can go out
   now. Fill in the two `[In your own words: …]` spots in [reddit-claudeai.md](reddit-claudeai.md), check the subreddit's rules and flair, then post by hand.

7. **awesome-claude-code**, on or after **2026-10-31** (14 days after the first commit, 2026-10-17):
   the owner fills in the web form by hand; pull requests and `gh` submissions are not accepted.
   See [awesome-claude-code.md](awesome-claude-code.md).

Show HN is on hold; [show-hn.md](show-hn.md) is kept for later.
