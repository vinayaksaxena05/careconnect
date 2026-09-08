<#
.SYNOPSIS
  Run the CareConnect backend (FastAPI) and frontend (Next.js) together for local dev.

.DESCRIPTION
  Opens two PowerShell windows:
    backend  -> uvicorn app.main:app --reload   (http://localhost:<BackendPort>, docs at /docs)
    frontend -> npm run dev                      (http://localhost:<FrontendPort>)
  The backend uses backend\.venv if present, otherwise 'python -m uvicorn' from PATH.
  Close the two windows (or Ctrl+C in each) to stop.

.EXAMPLE
  .\dev.ps1

.EXAMPLE
  .\dev.ps1 -Install                 # pip install + npm install first
  .\dev.ps1 -BackendPort 8000        # override ports
#>
[CmdletBinding()]
param(
  [int]$BackendPort  = 5000,
  [int]$FrontendPort = 3000,
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
$root     = $PSScriptRoot
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

foreach ($d in @($backend, $frontend)) {
  if (-not (Test-Path $d)) { throw "Directory not found: $d" }
}

# --- resolve the backend server command -------------------------------------
$venvUvicorn = Join-Path $backend '.venv\Scripts\uvicorn.exe'
if (Test-Path $venvUvicorn) {
  $backendCmd = "& `"$venvUvicorn`" app.main:app --reload --port $BackendPort"
} else {
  Write-Warning "backend\.venv not found - using 'python -m uvicorn' from PATH."
  $backendCmd = "python -m uvicorn app.main:app --reload --port $BackendPort"
}

# --- optional dependency install ------------------------------------------------
if ($Install) {
  $venvPy = Join-Path $backend '.venv\Scripts\python.exe'
  if (Test-Path $venvPy) { $py = $venvPy } else { $py = 'python' }
  Write-Host '==> Installing backend dependencies' -ForegroundColor Cyan
  & $py -m pip install -r (Join-Path $backend 'requirements.txt')
  Write-Host '==> Installing frontend dependencies' -ForegroundColor Cyan
  Push-Location $frontend
  try { npm install } finally { Pop-Location }
}

# --- launch ------------------------------------------------------------------
$backendLaunch = "Set-Location `"$backend`"; " +
                 "`$env:PORT='$BackendPort'; " +
                 "Write-Host 'CareConnect backend  -> http://localhost:$BackendPort  (docs: /docs)' -ForegroundColor Green; " +
                 $backendCmd

$frontendLaunch = "Set-Location `"$frontend`"; " +
                  "Write-Host 'CareConnect frontend -> http://localhost:$FrontendPort' -ForegroundColor Green; " +
                  "npm run dev -- --port $FrontendPort"

Write-Host "Starting CareConnect (backend :$BackendPort, frontend :$FrontendPort)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backendLaunch
Start-Process powershell -ArgumentList '-NoExit', '-Command', $frontendLaunch

Write-Host ''
Write-Host "  backend  : http://localhost:$BackendPort  (docs: /docs)" -ForegroundColor Gray
Write-Host "  frontend : http://localhost:$FrontendPort" -ForegroundColor Gray
Write-Host 'Two terminal windows opened. Close them (or Ctrl+C in each) to stop.' -ForegroundColor Gray
