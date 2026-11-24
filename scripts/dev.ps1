$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Starting Woqu backend (Go :8080) and frontend (Vite :5173)..." -ForegroundColor Cyan

$env:WOQU_DEV = "1"
$env:WOQU_DATA_DIR = Join-Path $root "data"

$backendJob = Start-Process -FilePath "go" -ArgumentList "run", "./cmd/woqu" -WorkingDirectory (Join-Path $root "backend") -PassThru -NoNewWindow
$frontendJob = Start-Process -FilePath "pnpm" -ArgumentList "dev" -WorkingDirectory (Join-Path $root "frontend") -PassThru -NoNewWindow

Write-Host "Backend PID: $($backendJob.Id) | Frontend PID: $($frontendJob.Id)" -ForegroundColor Green
Write-Host "Open http://localhost:5173 in your browser. Press Ctrl+C to stop both." -ForegroundColor Yellow

try {
    Wait-Process -Id $backendJob.Id, $frontendJob.Id
} finally {
    if (!$backendJob.HasExited) { Stop-Process -Id $backendJob.Id -Force -ErrorAction SilentlyContinue }
    if (!$frontendJob.HasExited) { Stop-Process -Id $frontendJob.Id -Force -ErrorAction SilentlyContinue }
}
