Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'MaitianInsightDailyCollection'
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removed $TaskName when present."
