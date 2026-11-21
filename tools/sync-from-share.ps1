# ------------------------------------------------------------------
#  ซิงก์ไฟล์ Excel วัดความดัน จากโฟลเดอร์แชร์ในบริษัท -> GitHub
#  ไม่ต้องติดตั้งโปรแกรมใด ๆ  ใช้แค่ PowerShell ที่มากับ Windows
#
#  ตรวจไฟล์ .xlsx ในโฟลเดอร์แชร์ เทียบกับไฟล์ใน GitHub (data/)
#  ถ้ามีไฟล์ใหม่ / ถูกแก้ไข / ถูกลบ  จะอัปโหลดผ่าน GitHub API ให้อัตโนมัติ
#  แล้ว GitHub Actions จะสร้าง Dashboard ใหม่ให้เอง (~1-2 นาที)
#
#  ครั้งแรก:   ดับเบิลคลิก setup-token.bat   (ใส่ GitHub token 1 ครั้ง)
#  ซิงก์ทันที: ดับเบิลคลิก sync-now.bat
#  ซิงก์ต่อเนื่อง: ดับเบิลคลิก auto-sync.bat (เปิดหน้าต่างทิ้งไว้ ตรวจทุก 5 นาที)
# ------------------------------------------------------------------
param(
    [string]$Source = '\\la26032\scan\1.Data Cross Dock Center\31.ลงข้อมูลวัดความดัน พขร. TPT',
    [string]$Owner  = 'godaresz',
    [string]$RepoName = 'Dashboard',
    [string]$Branch = 'main',
    [string]$RemoteDir = 'data',
    [switch]$SetToken,
    [switch]$Loop,
    [int]$IntervalMinutes = 5
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
# ใช้ proxy ของบริษัท (ถ้ามี) ด้วยสิทธิ์ผู้ใช้ Windows ปัจจุบัน
try { [System.Net.WebRequest]::DefaultWebProxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials } catch {}

$Here      = $PSScriptRoot
$LogFile   = Join-Path $Here 'sync.log'
$TokenFile = Join-Path $Here 'token.dat'
$Api       = "https://api.github.com/repos/$Owner/$RepoName"
$Exts      = @('.xlsx', '.xlsm')

function ErrText($err) {
    $m = $err.Exception.Message
    $ln = $err.InvocationInfo.ScriptLineNumber
    if ($ln) { $m += " (บรรทัด $ln)" }
    return $m
}

function Log([string]$msg) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $msg
    Write-Host $line
    try {
        Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
        $all = @(Get-Content -LiteralPath $LogFile -Encoding UTF8)
        if ($all.Count -gt 2000) { $all | Select-Object -Last 1500 | Set-Content -LiteralPath $LogFile -Encoding UTF8 }
    } catch {}
}

# ---------- token (เข้ารหัสด้วย Windows DPAPI — ถอดได้เฉพาะผู้ใช้นี้บนเครื่องนี้) ----------
if ($SetToken) {
    Write-Host ''
    Write-Host 'วาง GitHub token (Fine-grained, สิทธิ์ Contents: Read and write เฉพาะ repo นี้) แล้วกด Enter'
    $sec = Read-Host -AsSecureString 'Token'
    if ($sec.Length -lt 20) { Write-Host 'token สั้นเกินไป — ยกเลิก'; exit 1 }
    $enc = $sec | ConvertFrom-SecureString
    [IO.File]::WriteAllText($TokenFile, $enc, [Text.Encoding]::ASCII)
    Write-Host "บันทึก token (เข้ารหัส) แล้วที่ $TokenFile"
    exit 0
}

function Get-Token {
    if (-not (Test-Path -LiteralPath $TokenFile)) { throw 'ยังไม่ได้ตั้ง token — ดับเบิลคลิก setup-token.bat ก่อน' }
    $raw = ((Get-Content -LiteralPath $TokenFile -Raw) -replace '\s', '')   # ตัดบรรทัดว่าง/ช่องว่างท้ายไฟล์
    try { $sec = ConvertTo-SecureString -String $raw }
    catch { throw 'ถอดรหัส token ไม่ได้ (token ถูกบันทึกโดยผู้ใช้/เครื่องอื่น หรือไฟล์เสีย) — ดับเบิลคลิก setup-token.bat ใหม่' }
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-GH([string]$Method, [string]$Url, $Body = $null) {
    $headers = @{
        Authorization          = "Bearer $script:Token"
        Accept                 = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent'           = 'bp-dashboard-sync'
    }
    $p = @{ Method = $Method; Uri = $Url; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $Body) {
        $p.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
        $p.ContentType = 'application/json; charset=utf-8'
    }
    try { return Invoke-RestMethod @p }
    catch {
        $code = $null
        try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        if ($code -eq 404) { return $null }
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        if ($code -eq 401) { $detail = 'token ไม่ถูกต้องหรือหมดอายุ — รัน setup-token.bat ใหม่' }
        if ($code -eq 403) { $detail = "ไม่มีสิทธิ์ (token ต้องมีสิทธิ์ Contents: Read and write) — $detail" }
        throw "GitHub API $Method ล้มเหลว ($code): $detail"
    }
}

# อ่านไฟล์แบบแชร์ได้ (อ่านได้แม้มีคนเปิดไฟล์ Excel ค้างไว้)
function Read-Bytes([string]$path) {
    $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    try {
        $buf = New-Object byte[] $fs.Length
        $read = 0
        while ($read -lt $buf.Length) {
            $n = $fs.Read($buf, $read, $buf.Length - $read)
            if ($n -le 0) { break }
            $read += $n
        }
        return ,$buf
    } finally { $fs.Dispose() }
}

# ค่า SHA ของไฟล์แบบเดียวกับที่ GitHub ใช้ (git blob sha1) — ใช้เทียบว่าไฟล์เปลี่ยนหรือไม่
function Get-BlobSha([byte[]]$bytes) {
    $hdr = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)`0")
    $all = New-Object byte[] ($hdr.Length + $bytes.Length)
    [Array]::Copy($hdr, 0, $all, 0, $hdr.Length)
    [Array]::Copy($bytes, 0, $all, $hdr.Length, $bytes.Length)
    $sha1 = [Security.Cryptography.SHA1]::Create()
    try { return (($sha1.ComputeHash($all) | ForEach-Object { $_.ToString('x2') }) -join '') }
    finally { $sha1.Dispose() }
}

function Sync-Once {
    if (-not (Test-Path -LiteralPath $Source)) { throw "เข้าโฟลเดอร์แชร์ไม่ได้: $Source" }
    $local = @(Get-ChildItem -LiteralPath $Source -File |
        Where-Object { $Exts -contains $_.Extension.ToLower() -and $_.Name -notlike '~$*' })
    if ($local.Count -eq 0) { Log 'ไม่พบไฟล์ .xlsx ในโฟลเดอร์แชร์ — ไม่ทำอะไร'; return }

    $remote = @{}
    $list = Invoke-GH GET "$Api/contents/$RemoteDir`?ref=$Branch"
    foreach ($item in @($list)) { if ($item -and $item.type -eq 'file') { $remote[$item.name] = $item } }

    $changes = 0
    foreach ($f in $local) {
        try { $bytes = Read-Bytes $f.FullName }
        catch { Log "อ่านไฟล์ไม่ได้ (อาจกำลังบันทึกอยู่) จะลองใหม่รอบหน้า: $($f.Name)"; continue }
        $sha = Get-BlobSha $bytes
        $old = $remote[$f.Name]
        if ($old -and $old.sha -eq $sha) { continue }
        $body = @{
            message = ('อัปเดตข้อมูลวัดความดันอัตโนมัติ: {0} ({1:yyyy-MM-dd HH:mm})' -f $f.Name, (Get-Date))
            content = [Convert]::ToBase64String($bytes)
            branch  = $Branch
        }
        if ($old) { $body.sha = $old.sha }
        Invoke-GH PUT "$Api/contents/$RemoteDir/$([Uri]::EscapeDataString($f.Name))" $body | Out-Null
        Log ($(if ($old) { 'อัปเดตไฟล์: ' } else { 'เพิ่มไฟล์ใหม่: ' }) + $f.Name)
        $changes++
    }

    # ไฟล์ Excel ใน GitHub ที่ไม่มีในโฟลเดอร์แชร์แล้ว -> ลบออก
    $names = $local | ForEach-Object { $_.Name }
    foreach ($name in @($remote.Keys)) {
        $ext = [IO.Path]::GetExtension($name).ToLower()
        if (($Exts + '.xls') -notcontains $ext -or $names -contains $name) { continue }
        $body = @{ message = "ลบไฟล์ที่ไม่มีในโฟลเดอร์แชร์แล้ว: $name"; sha = $remote[$name].sha; branch = $Branch }
        Invoke-GH DELETE "$Api/contents/$RemoteDir/$([Uri]::EscapeDataString($name))" $body | Out-Null
        Log "ลบไฟล์: $name"
        $changes++
    }

    if ($changes -eq 0) { Log 'ไม่มีการเปลี่ยนแปลง' }
    else { Log "อัปโหลดแล้ว $changes ไฟล์ — Dashboard จะอัปเดตภายใน ~2 นาที" }
}

try { $script:Token = Get-Token } catch { Log "ผิดพลาด: $(ErrText $_)"; exit 1 }

if ($Loop) {
    Log "เริ่มซิงก์อัตโนมัติทุก $IntervalMinutes นาที (ปิดหน้าต่างนี้เพื่อหยุด)"
    while ($true) {
        try { Sync-Once } catch { Log "ผิดพลาด: $(ErrText $_)" }
        Start-Sleep -Seconds ($IntervalMinutes * 60)
    }
} else {
    try { Sync-Once } catch { Log "ผิดพลาด: $(ErrText $_)"; exit 1 }
}
