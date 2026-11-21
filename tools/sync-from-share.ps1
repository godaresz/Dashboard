# ------------------------------------------------------------------
#  ซิงก์ไฟล์ Excel วัดความดัน จากโฟลเดอร์แชร์ในบริษัท -> GitHub
#  ถ้ามีไฟล์ใหม่ / ไฟล์ถูกแก้ไข / ไฟล์ถูกลบ  จะ commit + push ให้อัตโนมัติ
#  แล้ว GitHub Actions จะสร้าง Dashboard ใหม่ให้เอง (~1-2 นาที)
#
#  วิธีใช้ (ครั้งแรกให้รันเองด้วยมือ 1 ครั้ง เพื่อ login GitHub):
#     powershell -ExecutionPolicy Bypass -File tools\sync-from-share.ps1
# ------------------------------------------------------------------
param(
    [string]$Source = '\\la26032\scan\1.Data Cross Dock Center\31.ลงข้อมูลวัดความดัน พขร. TPT',
    [string]$Repo   = (Split-Path -Parent $PSScriptRoot),
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$LogFile = Join-Path $PSScriptRoot 'sync.log'

function Log([string]$msg) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
    Write-Host $line
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    # เก็บ log ไว้ไม่เกิน ~2000 บรรทัด
    $all = Get-Content -LiteralPath $LogFile -Encoding UTF8
    if ($all.Count -gt 2000) { $all | Select-Object -Last 1500 | Set-Content -LiteralPath $LogFile -Encoding UTF8 }
}

function Invoke-Git {
    # git เขียนข้อความลง stderr บ่อย ๆ — ไม่ให้ PowerShell ถือเป็น error
    $ErrorActionPreference = 'Continue'
    $out = & git.exe -C $Repo -c core.quotepath=false @args 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') ล้มเหลว: $($out -join ' ')" }
    return $out
}

try {
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw 'ไม่พบโปรแกรม git — ติดตั้ง Git for Windows ก่อน (https://git-scm.com)' }
    if (-not (Test-Path -LiteralPath $Source)) { throw "เข้าโฟลเดอร์แชร์ไม่ได้: $Source" }

    $files = @(Get-ChildItem -LiteralPath $Source -File |
        Where-Object { $_.Extension -in '.xlsx', '.xlsm' -and $_.Name -notlike '~$*' })
    if ($files.Count -eq 0) { Log 'ไม่พบไฟล์ .xlsx ในโฟลเดอร์แชร์ — ไม่ทำอะไร'; exit 0 }

    # ดึงของล่าสุดจาก GitHub ก่อน
    Invoke-Git checkout -q $Branch | Out-Null
    Invoke-Git pull -q --ff-only origin $Branch | Out-Null

    $dst = Join-Path $Repo 'data'
    if (-not (Test-Path -LiteralPath $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }

    # คัดลอกเฉพาะไฟล์ที่เปลี่ยน (ขนาด/เวลาแก้ไขต่างกัน)
    foreach ($f in $files) {
        $target = Join-Path $dst $f.Name
        $t = Get-Item -LiteralPath $target -ErrorAction SilentlyContinue
        if ($t -and $t.Length -eq $f.Length -and $t.LastWriteTimeUtc -eq $f.LastWriteTimeUtc) { continue }
        try {
            Copy-Item -LiteralPath $f.FullName -Destination $target -Force
            (Get-Item -LiteralPath $target).LastWriteTimeUtc = $f.LastWriteTimeUtc
        } catch {
            Log "คัดลอกไม่ได้ (อาจกำลังบันทึกไฟล์อยู่) จะลองใหม่รอบหน้า: $($f.Name) — $($_.Exception.Message)"
            exit 0
        }
    }

    # ลบไฟล์ใน data/ ที่ไม่มีในโฟลเดอร์แชร์แล้ว
    $names = $files | ForEach-Object { $_.Name }
    Get-ChildItem -LiteralPath $dst -File |
        Where-Object { $_.Extension -in '.xlsx', '.xlsm', '.xls' -and $names -notcontains $_.Name } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; Log "ลบไฟล์ที่ไม่มีในแชร์แล้ว: $($_.Name)" }

    Invoke-Git add -A -- data | Out-Null
    & git.exe -C $Repo diff --cached --quiet -- data
    if ($LASTEXITCODE -eq 0) { Log 'ไม่มีการเปลี่ยนแปลง'; exit 0 }

    $changed = (Invoke-Git diff --cached --name-only -- data) -join ', '
    Invoke-Git commit -q -m ("อัปเดตข้อมูลวัดความดันอัตโนมัติ {0:yyyy-MM-dd HH:mm}" -f (Get-Date)) | Out-Null
    Invoke-Git push -q origin $Branch | Out-Null
    Log "อัปโหลดขึ้น GitHub แล้ว: $changed"
}
catch {
    Log "ผิดพลาด: $($_.Exception.Message)"
    exit 1
}
