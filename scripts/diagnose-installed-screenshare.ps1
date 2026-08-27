# ---------------------------------------------------------------------------
# عیب‌یابی «اشتراک صفحه دسکتاپ» روی نسخه‌ی نصب‌شده‌ی ویندوز
#
# اجرا (PowerShell معمولی کافی است):
#   powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-installed-screenshare.ps1
#
# نرم‌افزار را باز بگذارید، دکمه «اشتراک صفحه دسکتاپ» را بزنید و بعد این
# اسکریپت را اجرا کنید تا وضعیت واقعیِ در حال اجرا بررسی شود.
# خروجی کامل در فایل زیر ذخیره می‌شود و همان را برای من بفرستید:
#   %TEMP%\ums-screenshare-report.txt
# ---------------------------------------------------------------------------
$ErrorActionPreference = "Continue"
$report = Join-Path $env:TEMP "ums-screenshare-report.txt"
Start-Transcript -Path $report -Force | Out-Null

function Head($t) { Write-Host "`n== $t ==" -ForegroundColor Yellow }

Head "0) اطلاعات سیستم"
"OS      : " + (Get-CimInstance Win32_OperatingSystem).Caption
"Build   : " + [System.Environment]::OSVersion.Version
"User    : $env:USERNAME"
"Time    : " + (Get-Date)

Head "1) پروسه‌های در حال اجرا"
Get-Process -Name "UniversalMediaServer","ffmpeg" -ErrorAction SilentlyContinue |
  Select-Object Name, Id, StartTime, @{n="RAM(MB)";e={[math]::Round($_.WorkingSet64/1MB)}} |
  Format-Table -AutoSize | Out-String | Write-Host
$ffProc = Get-Process -Name ffmpeg -ErrorAction SilentlyContinue
if (-not $ffProc) {
  Write-Host "هیچ پروسه ffmpeg در حال اجرا نیست → یعنی ضبط صفحه اصلاً شروع نشده (یا بلافاصله بسته شده)." -ForegroundColor Red
} else {
  Write-Host "ffmpeg در حال اجراست ✔" -ForegroundColor Green
  try {
    $cl = (Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'").CommandLine
    Write-Host "خط فرمان ffmpeg:`n$cl"
  } catch { }
}

Head "2) پیدا کردن ffmpeg نصب‌شده"
$cands = @(
  "$env:LOCALAPPDATA\Programs\UniversalMediaServer\resources\ffmpeg.exe",
  "$env:LOCALAPPDATA\Programs\UniversalMediaServer\resources\app\resources\ffmpeg.exe",
  "$env:LOCALAPPDATA\Programs\UniversalMediaServer\resources\app.asar.unpacked\resources\ffmpeg.exe",
  "$env:ProgramFiles\UniversalMediaServer\resources\ffmpeg.exe",
  "$env:APPDATA\UniversalMediaServer\bin\ffmpeg.exe",
  "$PSScriptRoot\..\resources\ffmpeg.exe"
)
$ff = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ff) { $c = Get-Command ffmpeg -ErrorAction SilentlyContinue; if ($c) { $ff = $c.Source } }
if (-not $ff) {
  Write-Host "ffmpeg پیدا نشد! (علت قطعی سیاه‌بودن تصویر)" -ForegroundColor Red
} else {
  Write-Host "ffmpeg: $ff" -ForegroundColor Green
  (& $ff -hide_banner -version | Select-Object -First 1)
}

Head "3) پورت سرور پخش (۵۰۰۱) و اتصال تلویزیون"
$listen = Get-NetTCPConnection -State Listen -LocalPort 5001 -ErrorAction SilentlyContinue
if ($listen) { Write-Host "پورت 5001 در حال شنیدن است ✔" -ForegroundColor Green }
else { Write-Host "پورت 5001 باز نیست → سرور پخش بالا نیامده." -ForegroundColor Red }
Get-NetTCPConnection -State Established -LocalPort 5001 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, RemoteAddress, RemotePort |
  Format-Table -AutoSize | Out-String | Write-Host

Head "4) آیا سرور واقعاً تصویر می‌دهد؟ (دانلود ۵ ثانیه از desktop.ts)"
$tmp = Join-Path $env:TEMP "ums-desktop-probe.ts"
Remove-Item $tmp -ErrorAction SilentlyContinue
try {
  $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:5001/desktop.ts")
  $req.Timeout = 8000
  $req.ReadWriteTimeout = 8000
  $resp = $req.GetResponse()
  $s = $resp.GetResponseStream()
  $out = [System.IO.File]::Create($tmp)
  $buf = New-Object byte[] 65536
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt 5) {
    $n = $s.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $out.Write($buf, 0, $n)
  }
  $out.Close(); $s.Close(); $resp.Close()
  $size = (Get-Item $tmp).Length
  if ($size -gt 100KB) { Write-Host "استریم سالم است: $([math]::Round($size/1KB)) کیلوبایت در ۵ ثانیه ✔" -ForegroundColor Green }
  else { Write-Host "استریم تقریباً خالی است ($size بایت) → ffmpeg تصویری تولید نمی‌کند." -ForegroundColor Red }
} catch {
  Write-Host "اتصال به http://127.0.0.1:5001/desktop.ts ناموفق: $($_.Exception.Message)" -ForegroundColor Red
}
if ((Test-Path $tmp) -and $ff) {
  Head "4b) محتوای واقعی استریم (ffprobe/ffmpeg)"
  & $ff -hide_banner -i $tmp -t 1 -f null - 2>&1 | Select-Object -First 25 | Out-Host
}

Head "5) تست مستقیم ضبط دسکتاپ (gdigrab)"
if ($ff) {
  $vt = Join-Path $env:TEMP "ums-video-test.ts"
  & $ff -hide_banner -loglevel error -f gdigrab -framerate 15 -i desktop -t 3 -c:v libx264 -preset veryfast -f mpegts $vt 2>&1 | Out-Host
  if ($LASTEXITCODE -eq 0 -and (Test-Path $vt) -and (Get-Item $vt).Length -gt 50KB) {
    Write-Host "ضبط تصویر دسکتاپ سالم است ✔" -ForegroundColor Green
  } else {
    Write-Host "gdigrab ناموفق → دسترسی به تصویر دسکتاپ مسدود است (DRM/درایور/سطح دسترسی)." -ForegroundColor Red
  }
  Head "5b) شتاب‌دهنده‌های سخت‌افزاری موجود"
  & $ff -hide_banner -encoders 2>&1 | Select-String "nvenc|qsv|amf|libx264" | ForEach-Object { $_.Line }
}

Head "6) فایروال و کارت شبکه"
Get-NetFirewallRule -DisplayName "*Universal*" -ErrorAction SilentlyContinue |
  Select-Object DisplayName, Enabled, Direction, Action | Format-Table -AutoSize | Out-String | Write-Host
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" } |
  Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize | Out-String | Write-Host

Head "7) تنظیمات ذخیره‌شده‌ی برنامه"
$cfg = "$env:APPDATA\UniversalMediaServer\settings.json"
if (Test-Path $cfg) { Get-Content $cfg -Raw | Write-Host } else { Write-Host "settings.json پیدا نشد." }

Stop-Transcript | Out-Null
Write-Host "`nگزارش کامل ذخیره شد: $report" -ForegroundColor Cyan
Write-Host "همین فایل را باز کنید و متن آن را برای من بفرستید." -ForegroundColor Cyan
