# Renders docs/demo/overview.html and docs/demo/board.html into the README images with headless Edge (or Chrome).
# Usage, from the repository root:  pwsh docs/demo/capture.ps1 [image names…]   (no names: every image)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Needs Microsoft Edge or Google Chrome.' }
$userData = Join-Path ([IO.Path]::GetTempPath()) 'project-pm-capture'
$demo = 'file:///' + ($root -replace '\\', '/') + '/docs/demo'

# Shots are transparent outside their rounded corners, so GitHub's light or dark page shows through;
# docs/demo/README.md crops them to their content.
$shots = @(
  @{ Name = 'overview.png'; Page = 'overview.html'; Query = 'lang=en'; Size = '1200,2200'; Transparent = $true },
  @{ Name = 'overview-zh-TW.png'; Page = 'overview.html'; Query = 'lang=zh-TW'; Size = '1200,2200'; Transparent = $true },
  @{ Name = 'board-light.png'; Page = 'board.html'; Query = 'lang=en&theme=light'; Size = '504,2200'; Transparent = $true },
  @{ Name = 'board-dark.png'; Page = 'board.html'; Query = 'lang=en&theme=dark'; Size = '504,2200'; Transparent = $true },
  @{ Name = 'board-light-zh-TW.png'; Page = 'board.html'; Query = 'lang=zh-TW&theme=light'; Size = '504,2200'; Transparent = $true },
  @{ Name = 'board-dark-zh-TW.png'; Page = 'board.html'; Query = 'lang=zh-TW&theme=dark'; Size = '504,2200'; Transparent = $true }
)
$only = $args
foreach ($shot in $shots) {
  if ($only -and $shot.Name -notin $only) { continue }
  $out = Join-Path $root "docs/images/$($shot.Name)"
  $argv = @('--headless=new', '--disable-gpu', '--hide-scrollbars', "--user-data-dir=$userData", '--force-device-scale-factor=2',
    "--window-size=$($shot.Size)", '--virtual-time-budget=10000', "--screenshot=$out")
  if ($shot.Transparent) { $argv += '--default-background-color=00000000' }
  $argv += "$demo/$($shot.Page)?$($shot.Query)"
  Start-Process -FilePath $browser -ArgumentList $argv -Wait -NoNewWindow
  Write-Output "wrote $out"
}
