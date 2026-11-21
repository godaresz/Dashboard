# ------------------------------------------------------------------
#  ตั้งให้ Windows รัน sync-from-share.ps1 อัตโนมัติทุก ๆ N นาที (เบื้องหลัง ไม่ต้องเปิดหน้าต่างค้าง)
#  ใช้ Task Scheduler ที่มากับ Windows (ชื่องาน "BP-Dashboard-Sync") — ไม่ต้องติดตั้งโปรแกรมเพิ่ม
#  ถ้าบริษัทไม่อนุญาตให้สร้าง Scheduled Task ให้ใช้ auto-sync.bat แทน
#
#  วิธีใช้:  powershell -ExecutionPolicy Bypass -File tools\install-sync-task.ps1
#  ยกเลิก:   powershell -ExecutionPolicy Bypass -File tools\install-sync-task.ps1 -Uninstall
# ------------------------------------------------------------------
param(
    [int]$Minutes = 5,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'BP-Dashboard-Sync'

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "ลบงานอัตโนมัติ $TaskName แล้ว"
    exit 0
}

$script = Join-Path $PSScriptRoot 'sync-from-share.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw "ไม่พบไฟล์ $script" }

$action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger  = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
            -RepetitionInterval (New-TimeSpan -Minutes $Minutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# รันในชื่อผู้ใช้ปัจจุบัน (ต้องใช้สิทธิ์ของผู้ใช้นี้ในการเข้าโฟลเดอร์แชร์และ GitHub)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'ซิงก์ไฟล์วัดความดัน พขร. จากโฟลเดอร์แชร์ขึ้น GitHub Dashboard' -Force | Out-Null

Write-Host "✔ ตั้งงานอัตโนมัติ '$TaskName' แล้ว — ตรวจโฟลเดอร์ทุก $Minutes นาที"
Write-Host "  ดูประวัติการทำงานได้ที่: $(Join-Path $PSScriptRoot 'sync.log')"
