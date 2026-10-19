# Board demo

`board.html` is an offline copy of the Project PM board, filled with a made-up
project ("Acme Storefront"). It draws the README images without touching any real
session or `~/.claude/project-pm/` data.

- The marks (completion ring, status dots, step bars), status labels and colors are
  copied from `hooks/view.tsx` and `hooks/sessions.ts`; the layout follows `renderPane()`.
  If those change, update this file to match.
- `board.html?view=hero` is the annotated light image; `board.html?view=pane&theme=dark`
  is the pane alone in dark mode.

To regenerate the images (Windows, Edge or Chrome installed), from the repository root:

```powershell
pwsh docs/demo/capture.ps1
```

The committed PNGs were then reduced to 256 colors to keep the README light:

```bash
python -c "from PIL import Image; [Image.open(f'docs/images/{n}.png').convert('RGB').quantize(256, dither=Image.Dither.FLOYDSTEINBERG).save(f'docs/images/{n}.png', optimize=True) for n in ('board-hero', 'board-dark')]"
```
