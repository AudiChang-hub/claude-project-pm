# Renders docs/demo/board.html into the README images with headless Edge (or Chrome).
# Usage, from the repository root:  pwsh docs/demo/capture.ps1
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$browser = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Needs Microsoft Edge or Google Chrome.' }
$userData = Join-Path ([IO.Path]::GetTempPath()) 'project-pm-capture'
$page = 'file:///' + ($root -replace '\\', '/') + '/docs/demo/board.html'

$shots = @(
  @{ Name = 'board-hero.png'; Query = 'view=hero'; Size = '1280,1240' },
  @{ Name = 'board-dark.png'; Query = 'view=pane&theme=dark'; Size = '580,1600' }
)
foreach ($shot in $shots) {
  $out = Join-Path $root "docs/images/$($shot.Name)"
  $argv = @('--headless=new', '--disable-gpu', '--hide-scrollbars', "--user-data-dir=$userData", '--force-device-scale-factor=2',
    "--window-size=$($shot.Size)", '--virtual-time-budget=10000', "--screenshot=$out", "${page}?$($shot.Query)")
  Start-Process -FilePath $browser -ArgumentList $argv -Wait -NoNewWindow
  Write-Output "wrote $out"
}
