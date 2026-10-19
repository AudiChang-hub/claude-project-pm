# Board demo

`board.html` is an offline copy of the Project PM board, filled with a made-up
project ("Acme Storefront"). It draws the README images without touching any real
session or `~/.claude/project-pm/` data.

- The marks (completion ring, status dots, step bars) and status colors are copied from
  `hooks/view.tsx` and `hooks/sessions.ts`, the board's words from `hooks/messages.ts`
  (only the keys the pane uses); the layout follows `renderPane()`. If those change, update
  this file to match.
- `board.html?view=hero` is the annotated light image; `board.html?view=pane&theme=dark`
  is the pane alone in dark mode. Add `&lang=zh-TW` for the Traditional Chinese board, with
  its own made-up data and callouts; the default is English.
- `README.md` uses `board-hero.png` and `board-dark.png`; `README.zh-TW.md` uses
  `board-hero-zh-TW.png` and `board-dark-zh-TW.png`.

To regenerate the images (Windows, Edge or Chrome installed), from the repository root:

```powershell
pwsh docs/demo/capture.ps1
```

The committed PNGs were then reduced to 256 colors to keep the README light:

```bash
python -c "from PIL import Image; [Image.open(f'docs/images/{n}.png').convert('RGB').quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(f'docs/images/{n}.png', optimize=True) for n in ('board-hero', 'board-dark', 'board-hero-zh-TW', 'board-dark-zh-TW')]"
```
