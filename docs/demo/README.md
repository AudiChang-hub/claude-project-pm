# README images

The README images are drawn from two offline pages filled with made-up data. Nothing here reads a
real session or `~/.claude/project-pm/`.

| Page | Images | Used in |
| --- | --- | --- |
| `overview.html?lang=en` · `?lang=zh-TW` | `overview.png` · `overview-zh-TW.png` | The top of each README |
| `board.html?lang=…&theme=light` · `&theme=dark` | `board-light.png`, `board-dark.png` and their `-zh-TW` versions | *See the board*, chosen by GitHub's light or dark theme (`<picture>`) |

- `overview.html` is the v0.9.0 one-page overview: the v0.8.0 sessions-and-agents diagram with the
  QA layer (`docs/design/qa.md`) below it. Its four costs are the T-30 quota measurements in
  input-equivalent tokens (PM rule 10 in `hooks/messages.ts`).
- `board.html` is the PM's pane for a made-up project ("Acme Storefront"). Its marks (ring, status
  dots, agent diamonds, step bars) and colors are copied from `hooks/view.tsx` and
  `hooks/sessions.ts`, its words from `hooks/messages.ts` (only the keys the pane uses), and its
  layout follows `renderPane()`. When those change, update this page to match.

To regenerate (Windows, with Edge or Chrome), from the repository root:

```powershell
pwsh docs/demo/capture.ps1
```

Name images to redraw only those (`pwsh docs/demo/capture.ps1 overview.png`). Every shot is
transparent outside its rounded corners, so GitHub's light or dark page shows through. Then crop
each to its content and reduce it to 256 colors, keeping the transparency:

```bash
python -c "from PIL import Image; [(lambda p: (lambda im: im.crop(im.getchannel('A').getbbox()).quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(p, optimize=True))(Image.open(p).convert('RGBA')))(f'docs/images/{n}.png') for n in ('overview', 'overview-zh-TW', 'board-light', 'board-dark', 'board-light-zh-TW', 'board-dark-zh-TW')]"
```
