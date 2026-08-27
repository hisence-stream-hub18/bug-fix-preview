# عیب‌یابی «اشتراک صفحه دسکتاپ»
# اجرا:  powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-screenshare.ps1
$ErrorActionPreference = "Continue"

Write-Host "== 1) پیدا کردن ffmpeg ==" -ForegroundColor Yellow
$cands = @(
  "$env:LOCALAPPDATA\Programs\UniversalMediaServer\resources\ffmpeg.exe",
  "$env:LOCALAPPDATA\Programs\UniversalMediaServer\resources\app\resources\ffmpeg.exe",
  "$env:APPDATA\UniversalMediaServer\bin\ffmpeg.exe",
  "$PSScriptRoot\..\resources\ffmpeg.exe"
)
$ff = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ff) { $c = Get-Command ffmpeg -ErrorAction SilentlyContinue; if ($c) { $ff = $c.Source } }
if (-not $ff) { Write-Host "ffmpeg پیدا نشد!" -ForegroundColor Red; exit 1 }
Write-Host "ffmpeg: $ff" -ForegroundColor Green
& $ff -hide_banner -version | Select-Object -First 1

Write-Host "`n== 2) دستگاه‌های صدای DirectShow ==" -ForegroundColor Yellow
& $ff -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Select-String -Pattern 'DirectShow|"' | ForEach-Object { $_.Line }

Write-Host "`n== 3) تست فقط تصویر (gdigrab) — باید بدون خطا 3 ثانیه ضبط کند ==" -ForegroundColor Yellow
& $ff -hide_banner -loglevel error -f gdigrab -framerate 15 -i desktop -t 3 -c:v libx264 -preset veryfast -f mpegts "$env:TEMP\ums-video-test.ts"
if ($LASTEXITCODE -eq 0) { Write-Host "تصویر سالم است (خطای I/O مربوط به صداست)." -ForegroundColor Green }
else { Write-Host "gdigrab خطا داد — مشکل از دسترسی به تصویر دسکتاپ است." -ForegroundColor Red }

Write-Host "`n== 4) تست تصویر + صدا برای هر دستگاه ==" -ForegroundColor Yellow
$devs = (& $ff -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Select-String '"(.+)" \(audio\)' | ForEach-Object { $_.Matches[0].Groups[1].Value })
if (-not $devs) { Write-Host "هیچ دستگاه صدایی نیست → Stereo Mix را فعال یا Screen Capturer Recorder را نصب کنید." -ForegroundColor Red }
foreach ($d in $devs) {
  Write-Host "-> $d"
  & $ff -hide_banner -loglevel error -f gdigrab -framerate 15 -i desktop -f dshow -i "audio=$d" -t 3 -c:v libx264 -preset veryfast -c:a aac -f mpegts "$env:TEMP\ums-av-test.ts" 2>&1 | Out-Host
  if ($LASTEXITCODE -eq 0) { Write-Host "   OK" -ForegroundColor Green } else { Write-Host "   ناموفق" -ForegroundColor DarkYellow }
}

Write-Host "`nنتیجه را همین‌جا کپی کنید." -ForegroundColor Cyan
