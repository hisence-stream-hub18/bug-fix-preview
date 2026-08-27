# Universal Media Server - System & Install Diagnostic
# گزارش کامل نسخه نصب‌شده را می‌سازد تا برای پشتیبانی/Lovable ارسال شود.
# اجرا:  powershell -ExecutionPolicy Bypass -File .\scripts\collect-report.ps1

$ErrorActionPreference = "SilentlyContinue"

$AppDir = "D:\نرم افزار های نصب شده سیستم\Universal Media Serverman\UniversalMediaServer"
if ($args.Count -ge 1 -and $args[0]) { $AppDir = $args[0] }

$Out = Join-Path $env:USERPROFILE "Desktop\UMS-report.txt"
$L = New-Object System.Collections.Generic.List[string]
function Add-Line($s) { $L.Add([string]$s) }
function Section($t) { Add-Line ""; Add-Line ("=== " + $t + " ===") }

Section "TIME / OS"
Add-Line (Get-Date -Format s)
Add-Line ("OS: " + (Get-CimInstance Win32_OperatingSystem).Caption + " build " + [Environment]::OSVersion.Version)
Add-Line ("CPU: " + (Get-CimInstance Win32_Processor | Select-Object -First 1 -Expand Name))
Add-Line ("Cores: " + (Get-CimInstance Win32_Processor | Select-Object -First 1 -Expand NumberOfLogicalProcessors))
Add-Line ("RAM GB: " + [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1))
Add-Line ("GPU: " + ((Get-CimInstance Win32_VideoController | Select-Object -Expand Name) -join ", "))
Add-Line ("Node: " + (node --version)); Add-Line ("npm: " + (npm --version))

Section "APP FOLDER"
Add-Line ("Path: " + $AppDir)
Add-Line ("Exists: " + (Test-Path $AppDir))
if (Test-Path $AppDir) {
  Get-ChildItem $AppDir -Filter *.exe | ForEach-Object { Add-Line ("exe: " + $_.Name + "  " + $_.Length + "  " + $_.LastWriteTime) }
  $res = Join-Path $AppDir "resources"
  Get-ChildItem $res -Recurse -Include ffmpeg.exe,yt-dlp.exe,*.asar -ErrorAction SilentlyContinue |
    ForEach-Object { Add-Line ("res: " + $_.FullName.Replace($AppDir,"") + "  " + [math]::Round($_.Length/1MB,2) + " MB") }
}

Section "BUNDLED TOOL VERSIONS"
foreach ($n in @("ffmpeg.exe","yt-dlp.exe")) {
  $p = Get-ChildItem $AppDir -Recurse -Filter $n -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) {
    Add-Line ("--- " + $p.FullName)
    if ($n -eq "ffmpeg.exe") { Add-Line ((& $p.FullName -hide_banner -version 2>&1 | Select-Object -First 3) -join "`n") }
    else { Add-Line ((& $p.FullName --version 2>&1 | Select-Object -First 1)) }
  } else { Add-Line ($n + ": NOT FOUND") }
}
Add-Line ("ffmpeg on PATH: " + ((where.exe ffmpeg 2>$null) -join "; "))

Section "AUDIO / SCREEN CAPTURE DEVICES (dshow)"
$ff = (Get-ChildItem $AppDir -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($ff) {
  $dev = & $ff.FullName -hide_banner -list_devices true -f dshow -i dummy 2>&1
  Add-Line (($dev | Select-Object -First 40) -join "`n")
} else { Add-Line "ffmpeg not available - cannot list devices" }
Add-Line ("virtual-audio-capturer registered: " + (Test-Path "HKLM:\SOFTWARE\Classes\CLSID\{8E14549A-DB61-4309-AFA1-3578E927E933}"))
Add-Line ("screen-capture-recorder registered: " + (Test-Path "HKLM:\SOFTWARE\Classes\CLSID\{4EA69364-2C8A-4AE6-A561-56E4B5044439}"))

Section "SCREEN SHARE DRY RUN (5s to nul)"
if ($ff) {
  $t = & $ff.FullName -hide_banner -loglevel error -f gdigrab -framerate 15 -i desktop -t 2 -f null - 2>&1
  Add-Line ("gdigrab: " + (($t | Select-Object -First 10) -join " | ")); if (-not $t) { Add-Line "gdigrab: OK" }
  $a = & $ff.FullName -hide_banner -loglevel error -f dshow -i audio="virtual-audio-capturer" -t 2 -f null - 2>&1
  Add-Line ("virtual audio: " + (($a | Select-Object -First 10) -join " | ")); if (-not $a) { Add-Line "virtual audio: OK" }
  $n = & $ff.FullName -hide_banner -loglevel error -f lavfi -i testsrc=size=320x240:rate=10 -t 1 -c:v h264_nvenc -f null - 2>&1
  Add-Line ("h264_nvenc: " + $(if ($n) { (($n | Select-Object -First 5) -join " | ") } else { "OK" }))
}

Section "NETWORK / PORTS"
Add-Line ((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } | ForEach-Object { $_.InterfaceAlias + " " + $_.IPAddress }) -join "`n")
Add-Line ("Port 5001 in use: " + [bool](Get-NetTCPConnection -LocalPort 5001 -ErrorAction SilentlyContinue))
Add-Line ("Firewall rules: " + ((Get-NetFirewallRule -DisplayName "*Universal Media Server*","*UMS*" -ErrorAction SilentlyContinue | ForEach-Object { $_.DisplayName + "=" + $_.Enabled + "/" + $_.Action }) -join "; "))
Add-Line ("Network profile: " + ((Get-NetConnectionProfile | ForEach-Object { $_.Name + "=" + $_.NetworkCategory }) -join "; "))

Section "RUNNING PROCESSES"
Add-Line ((Get-Process | Where-Object { $_.ProcessName -match "UniversalMediaServer|ffmpeg|electron|yt-dlp" } | ForEach-Object { $_.ProcessName + " pid=" + $_.Id + " mem=" + [math]::Round($_.WorkingSet64/1MB) + "MB" }) -join "`n")

Section "APP LOGS (userData)"
$ud = Join-Path $env:APPDATA "UniversalMediaServer"
Add-Line ("userData: " + $ud + " exists=" + (Test-Path $ud))
if (Test-Path $ud) {
  Get-ChildItem $ud -Recurse -Include *.log,*.json -ErrorAction SilentlyContinue | Select-Object -First 20 |
    ForEach-Object { Add-Line ("file: " + $_.FullName.Replace($ud,"") + " " + $_.Length) }
  Get-ChildItem $ud -Recurse -Filter *.log -ErrorAction SilentlyContinue | Select-Object -First 3 | ForEach-Object {
    Add-Line ("--- tail " + $_.Name); Add-Line ((Get-Content $_.FullName -Tail 60) -join "`n")
  }
  $pl = Join-Path $ud "plugins"
  Add-Line ("plugins dir: " + (Test-Path $pl) + " -> " + ((Get-ChildItem $pl -ErrorAction SilentlyContinue | Select-Object -Expand Name) -join ", "))
}

Section "WINDOWS EVENT ERRORS (app, last 24h)"
Add-Line ((Get-WinEvent -FilterHashtable @{LogName="Application";Level=2;StartTime=(Get-Date).AddDays(-1)} -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match "UniversalMediaServer|electron|ffmpeg" } | Select-Object -First 10 |
  ForEach-Object { $_.TimeCreated.ToString("s") + " :: " + ($_.Message -split "`n")[0] }) -join "`n")

[IO.File]::WriteAllText($Out, ($L -join "`r`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "گزارش ساخته شد: $Out" -ForegroundColor Green
Write-Host "محتوای آن در کلیپ‌بورد کپی شد؛ در چت Lovable پیست کنید." -ForegroundColor Green
Get-Content $Out -Raw | Set-Clipboard
Get-Content $Out
