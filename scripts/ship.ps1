param(
  [string]$Message = "",
  [switch]$Yes,
  [switch]$NoDeploy
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

function Invoke-Checked {
  param(
    [string]$Exe,
    [string[]]$ExeArgs
  )

  & $Exe @ExeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "$Exe failed with exit code $LASTEXITCODE"
  }
}

$branch = (& git branch --show-current).Trim()
if (-not $branch) {
  throw "Could not determine the current git branch."
}

$status = & git status --porcelain
if ($status) {
  Write-Host "Pending changes:"
  & git status -sb

  if (-not $Message.Trim()) {
    $Message = Read-Host "Commit message"
  }

  if (-not $Message.Trim()) {
    throw "Commit message is required when there are pending changes."
  }

  if (-not $Yes) {
    $confirm = Read-Host "Stage all changes, commit, and push branch '$branch'? Type y to continue"
    if ($confirm -notin @("y", "Y", "yes", "YES")) {
      throw "Cancelled before staging changes."
    }
  }

  Invoke-Checked -Exe "git" -ExeArgs @("add", "-A")
  Invoke-Checked -Exe "git" -ExeArgs @("commit", "-m", $Message)
  Invoke-Checked -Exe "git" -ExeArgs @("push", "-u", "origin", $branch)
} else {
  Write-Host "No pending git changes. Skipping commit and push."
}

if (-not $NoDeploy) {
  $wrangler = Join-Path $repoRoot "node_modules/.bin/wrangler.cmd"
  if (-not (Test-Path $wrangler)) {
    $wrangler = "wrangler"
  }

  Invoke-Checked -Exe $wrangler -ExeArgs @("deploy")
}
