$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

param(
  [int]$RestartDelaySec = 2,
  [int]$MaxBackoffSec = 30
)

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dataDir = Join-Path $root "data"
$botLog = Join-Path $dataDir "bot.log"
$watchdogLog = Join-Path $dataDir "bot-watchdog.log"
$tsxCli = Join-Path $root "node_modules\tsx\dist\cli.mjs"
$botEntry = Join-Path $root "src\irc\bot.ts"

if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir | Out-Null
}

function Write-WatchdogLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $line | Tee-Object -FilePath $watchdogLog -Append
}

if (-not (Test-Path (Join-Path $root "package.json"))) {
  throw "package.json non trovato in $root"
}

if (-not (Test-Path $tsxCli)) {
  Write-WatchdogLog "Dipendenze mancanti: eseguo npm install..."
  Push-Location $root
  try {
    npm install
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $tsxCli)) {
  throw "tsx non trovato in node_modules dopo npm install."
}

$attempt = 0
while ($true) {
  $attempt += 1
  Write-WatchdogLog "Avvio bot (tentativo $attempt)"
  Push-Location $root
  try {
    & node $tsxCli $botEntry *>> $botLog
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  if ($null -eq $exitCode) {
    $exitCode = 1
  }

  if ($exitCode -eq 0) {
    Write-WatchdogLog "Bot terminato con exit code 0 (shutdown). Watchdog si ferma."
    break
  }

  $delay = [Math]::Min($RestartDelaySec + [Math]::Floor($attempt / 3), $MaxBackoffSec)
  Write-WatchdogLog "Bot terminato con exit code $exitCode. Riavvio tra $delay secondi..."
  Start-Sleep -Seconds $delay
}
