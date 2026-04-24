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
    [string]$Command,
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
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

  Invoke-Checked "git" @("add", "-A")
  Invoke-Checked "git" @("commit", "-m", $Message)
  Invoke-Checked "git" @("push", "-u", "origin", $branch)
} else {
  Write-Host "No pending git changes. Skipping commit and push."
}

if (-not $NoDeploy) {
  Invoke-Checked "npm" @("run", "deploy")
}
