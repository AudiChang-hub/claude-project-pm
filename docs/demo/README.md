# README images

The README and how-it-works images are drawn from made-up data ("Acme Storefront"). Nothing here reads a real
session, `~/.claude/project-pm/` or `~/.project-pm/`.

| Source | Images | Used in |
| --- | --- | --- |
| `overview.html?lang=en` · `?lang=zh-TW` | `overview.png` · `overview-zh-TW.png` | The top of each README |
| `hero.html?lang=…&theme=light` · `&theme=dark` | `hero-light.png`, `hero-dark.png` and their `-zh-TW` versions | The first screen of each README (`<picture>`) |
| `board.html?lang=…&theme=light` · `&theme=dark` | `board-light.png`, `board-dark.png` and their `-zh-TW` versions | *See the board*, chosen by GitHub's light or dark theme (`<picture>`) |
| `board.html?lang=…&theme=light&view=states` | `how-states.png` · `how-states-zh-TW.png` | The status table in docs/how-it-works*.md |
| `webboard.mts` (the real web board) | `web-board-light.png`, `web-board-dark.png` and their `-zh-TW` versions; `how-qa*.png`, `how-guidelines*.png` | The CLI part of each README; docs/how-it-works*.md |
| `webboard.mts` with `terminal.html` (the core's real output) | `cli-chat.png`, `cli-board.png` and their `-zh-TW` versions | *See it in the CLI* in each README |

- `overview.html` is the v1.2.0 one-page overview: the two ways in (the desktop app through the mod,
  which uses the core from v1.1 on, and the CLI through the core's MCP server and hooks) on one shared
  core and one ledger, the v0.8.0 sessions-and-agents diagram, the QA layer (`docs/design/qa.md`) with
  the pre-push hook, and v1.1's three new pieces (one ledger for both, a clearer board, the web board
  opened from the pane). It does not show T-48 (the PM managing its own context) yet. Its four costs
  are the T-30 quota measurements in input-equivalent tokens (PM rule 10 in `hooks/messages.ts`, which
  the core's PM gets too); it shows no other number.
- `board.html` is the PM's pane for a made-up project ("Acme Storefront"). Its marks (ring, status
  dots, agent diamonds, step bars) and colors are copied from `hooks/view.tsx` and
  `hooks/sessions.ts`, its words from `hooks/messages.ts` (only the keys the pane uses), and its
  layout follows `renderPane()`. The line under the progress counts the open items by kind as
  `openBreakdown` in `hooks/qa.ts` does (T-42: "5 open: 2 awaiting QA · 3 on track"), each item once,
  in `OPEN_COLOR`'s colors. Each session card has its context line as `contextLine` in
  `hooks/context.ts` writes it (T-48: "context 118k · idle 12m · wake ≈12k"), from the page's
  `CONTEXT` figures, which `webboard.mts` seeds too, all under the 200k hand-over threshold so
  *Needs attention* holds no hand-over. When those change, update this page to match. `view=states` shows
  only the session cards of the statuses under *Needs attention*, with a usage limit (whose words are
  Claude Code's own error, in English in either language) and a session waiting on CI added.
- `hero.html` is a schematic Claude Code desktop window: the person asks the PM whether anything is
  slipping, and the PM answers from what the board pane beside it (`board.html` in an iframe) shows.
  Keep its answer in step with `board.html`'s fixture.
- `terminal.html` is a schematic terminal (T-46), dark in both of GitHub's themes. `webboard.mts` fills it
  with the core's own output for the board scene: `cli-chat` shows the first lines of what the board tool
  answers the model, and `cli-board` what `project-pm board` prints for people (`git pm board`, the alias
  init adds), down to its work items. Only the question and the PM's answer are written in the page; keep
  the answer in step with the board scene's data. `node --import tsx ../docs/demo/webboard.mts --cli-text`
  (and `--zh`) prints that output to check against. The shots are scaled to 1600 px wide and reduced like
  the others.
- `webboard.mts` takes its pictures of the core's own web board: it writes made-up data into a
  temporary `PROJECT_PM_HOME` (and a temporary home folder), starts `serve()` from
  `core/src/http.ts` on it, and captures the page with headless Edge or Chrome over the DevTools
  protocol. Only git and gh are answered by the script (gh says the CI run failed), so every word on
  the page is the core's, with one exception: the project's folder. Since T-47 the web board takes in
  only plain absolute folders, so the project is kept at a made-up one (`C:\code\acme-storefront`,
  never read) and the script shows it, in the page's text and in the CLI output, as
  `~/code/acme-storefront`. Each session carries a made-up context size (T-48), as the core's Stop
  hook records it. A shot fails if the page still shows that folder's real spelling or a full session
  id.

To regenerate (Windows, with Edge or Chrome), from the repository root:

```powershell
pwsh docs/demo/capture.ps1
```

Name images to redraw only those (`pwsh docs/demo/capture.ps1 overview.png`). The web board's images
come from the core, with its dev dependencies (from the repository root):

```powershell
cd core; npm ci; node scripts/web-assets.mjs; node --import tsx ../docs/demo/webboard.mts; cd ..
```

Every page shot is transparent outside its rounded corners, so GitHub's light or dark page shows
through. Then crop each to its content and reduce it to 256 colors, keeping the transparency:

```bash
python -c "from PIL import Image; [(lambda p: (lambda im: im.crop(im.getchannel('A').getbbox()).quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(p, optimize=True))(Image.open(p).convert('RGBA')))(f'docs/images/{n}.png') for n in ('overview', 'overview-zh-TW', 'board-light', 'board-dark', 'board-light-zh-TW', 'board-dark-zh-TW')]"
```

The hero images are scaled to 1600 px wide and `how-states*.png` kept at 1000 px before reducing. The
web board's shots are rectangles: round their corners (radius 28 px for the README ones, 24 px for
the how-it-works crops), scale them to 1600 px (README) or 1100 px (crops) wide, then reduce them the
same way. The README ones end on a clean break, below the first work item past the Sessions column,
so no fade is needed (a fade reduced to 256 colors shows as grey bands); when the Sessions column is
the longer one, as now, the whole page is kept. The how-it-works crops stop their top padding short
of the element above, so no sliver of its border shows.
