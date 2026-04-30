# Install Song Chau OneDrive Watcher as a Windows Scheduled Task.
# - Trigger: at user logon
# - Action: runs onedrive_continuous_sync.py --watch (loops forever, scans every 2 min)
# - On failure: restart up to 5 times
# - Logs: %LOCALAPPDATA%\SongChauOneDriveSync\sync.log
#
# Run from PowerShell (no admin needed):
#   cd "c:\Users\ASUS\OneDrive\Documents\he thong song chau\songchau-erp"
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install_onedrive_watcher.ps1
#
# Uninstall:
#   schtasks /Delete /TN "SongChauOneDriveSync" /F
#
# Tail the log:
#   Get-Content "$env:LOCALAPPDATA\SongChauOneDriveSync\sync.log" -Wait -Tail 50

$ErrorActionPreference = 'Stop'

$TaskName  = "SongChauOneDriveSync"
$ScriptDir = $PSScriptRoot
$Script    = Join-Path $ScriptDir "onedrive_continuous_sync.py"
$RepoRoot  = $ScriptDir
$LogDir    = Join-Path $env:LOCALAPPDATA "SongChauOneDriveSync"

if (-not (Test-Path $Script)) {
    Write-Error "Script not found: $Script"
    exit 1
}

# Find Python (prefer launcher 'py', fall back to 'python')
$PyCmd = Get-Command py -ErrorAction SilentlyContinue
if ($PyCmd) {
    $PyExe  = $PyCmd.Source
    $PyArgs = "-3 `"$Script`" --watch --interval 120"
} else {
    $PyCmd = Get-Command python -ErrorAction SilentlyContinue
    if (-not $PyCmd) {
        Write-Error "Python 3 not found in PATH. Install from python.org first."
        exit 1
    }
    $PyExe  = $PyCmd.Source
    $PyArgs = "`"$Script`" --watch --interval 120"
}

Write-Host "Python   : $PyExe"
Write-Host "Script   : $Script"
Write-Host "TaskName : $TaskName"

# Ensure paramiko installed
Write-Host "Installing paramiko (one-time)..."
& $PyExe -m pip install --quiet --user --disable-pip-version-check paramiko 2>&1 | Out-Null

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

# ---- Build the task ----
$Action = New-ScheduledTaskAction -Execute $PyExe -Argument $PyArgs -WorkingDirectory $RepoRoot

$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 30) -MultipleInstances IgnoreNew

$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Replace any prior instance
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "Continuous sync OneDrive to VPS Song Chau ERP" | Out-Null

Write-Host ""
Write-Host "OK - task installed." -ForegroundColor Green
Write-Host "  Triggers : at every user logon (process loops every 120s)"
Write-Host "  On error : auto-restart up to 5 times, 1 min apart"
Write-Host "  State    : $LogDir\state.json"
Write-Host "  Log      : $LogDir\sync.log"
Write-Host ""

Write-Host "Starting first run now..." -ForegroundColor Yellow
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$Info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ("  LastRunTime    : {0}" -f $Info.LastRunTime)
Write-Host ("  LastTaskResult : {0}  (0 = OK, 267009 = currently running)" -f $Info.LastTaskResult)
Write-Host ""

Write-Host "Tail the log live:"
Write-Host ('  Get-Content "' + $LogDir + '\sync.log" -Wait -Tail 30') -ForegroundColor Cyan
Write-Host ""
Write-Host "Open Task Scheduler GUI:"
Write-Host ("  taskschd.msc -> Task Scheduler Library -> " + $TaskName) -ForegroundColor Cyan
