param(
  [string]$At = '09:00'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'ShanZhuInsightDailyCollection'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entrypoint = [IO.Path]::GetFullPath((Join-Path $projectRoot 'src\cli.mjs'))
$nodePath = Get-Command node -CommandType Application -ErrorAction Stop |
  Select-Object -First 1 -ExpandProperty Source
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}" collect' -f $entrypoint) `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal `
  -UserId $identity `
  -LogonType Interactive `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)
$task = New-ScheduledTask `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Collect local creator metrics for ShanZhu Insight.'

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Write-Host "Installed $TaskName. Daily trigger: $At."
