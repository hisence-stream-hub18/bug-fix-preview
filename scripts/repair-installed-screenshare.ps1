# تعمیر سریع «اشتراک صفحه دسکتاپ» روی نسخه نصب‌شده ویندوز
# اجرا نمونه:
# powershell -ExecutionPolicy Bypass -File .\scripts\repair-installed-screenshare.ps1 -InstallPath "D:\نرم افزار های نصب شده سیستم\Universal Media Serverman\UniversalMediaServer"

param(
  [string]$InstallPath = "",
  [string]$ProjectPath = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Text) { Write-Host "`n== $Text ==" -ForegroundColor Yellow }
function Write-Ok([string]$Text) { Write-Host $Text -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host $Text -ForegroundColor DarkYellow }

function Test-Ffmpeg([string]$File) {
  if (-not $File -or -not (Test-Path $File)) { return $false }
  $item = Get-Item $File -ErrorAction SilentlyContinue
  if (-not $item -or $item.Length -le 0) { return $false }
  try {
    & $File -hide_banner -version *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Find-InstalledExe([string]$Root) {
  $candidates = @()
  if ($Root) {
    $candidates += (Join-Path $Root "UniversalMediaServer.exe")
    $candidates += (Join-Path $Root "UniversalMediaServer\UniversalMediaServer.exe")
    if (Test-Path $Root) {
      $hit = Get-ChildItem -Path $Root -Recurse -Filter "UniversalMediaServer.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hit) { $candidates += $hit.FullName }
    }
  }
  $candidates += "$env:ProgramFiles\UniversalMediaServer\UniversalMediaServer.exe"
  $candidates += "${env:ProgramFiles(x86)}\UniversalMediaServer\UniversalMediaServer.exe"
  $candidates += "$env:LOCALAPPDATA\Programs\UniversalMediaServer\UniversalMediaServer.exe"
  return ($candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1)
}

function Download-Ffmpeg([string]$Dest) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Dest -Parent) | Out-Null
  $zip = Join-Path $env:TEMP "ums-ffmpeg.zip"
  $tmp = Join-Path $env:TEMP "ums-ffmpeg-extract"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  $urls = @(
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip"
  )
  foreach ($url in $urls) {
    try {
      Write-Host "Downloading ffmpeg from $url"
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      Expand-Archive -Path $zip -DestinationPath $tmp -Force
      $found = Get-ChildItem -Path $tmp -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
      if ($found) {
        Copy-Item $found.FullName $Dest -Force
        if (Test-Ffmpeg $Dest) { return $true }
      }
    } catch {
      Write-Warn "دانلود از این آدرس ناموفق بود: $($_.Exception.Message)"
    }
  }
  return $false
}

if (-not $ProjectPath) { $ProjectPath = (Split-Path $PSScriptRoot -Parent) }
$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)

Write-Step "1) پیدا کردن نسخه نصب‌شده"
$exe = Find-InstalledExe $InstallPath
if (-not $exe) {
  throw "UniversalMediaServer.exe پیدا نشد. مسیر دقیق پوشه نصب را با -InstallPath بدهید."
}
$exeDir = Split-Path $exe -Parent
Write-Ok "برنامه نصب‌شده: $exe"

Write-Step "2) آماده‌سازی ffmpeg"
$srcFfmpeg = Join-Path $ProjectPath "resources\ffmpeg.exe"
if (-not (Test-Ffmpeg $srcFfmpeg)) {
  Write-Warn "ffmpeg سالم در سورس پروژه پیدا نشد؛ دانلود می‌شود."
  if (-not (Download-Ffmpeg $srcFfmpeg)) { throw "دانلود/آماده‌سازی ffmpeg ناموفق بود." }
}
Write-Ok "ffmpeg سورس سالم است: $srcFfmpeg"

$appDataBin = Join-Path $env:APPDATA "UniversalMediaServer\bin"
$targets = @(
  (Join-Path $exeDir "resources\ffmpeg.exe"),
  (Join-Path $exeDir "resources\app\resources\ffmpeg.exe"),
  (Join-Path $appDataBin "ffmpeg.exe")
)
foreach ($target in $targets) {
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
  Copy-Item $srcFfmpeg $target -Force
  if (-not (Test-Ffmpeg $target)) { throw "کپی ffmpeg سالم نشد: $target" }
  Write-Ok "کپی شد: $target"
}

Write-Step "3) آماده‌سازی yt-dlp"
$srcYtdlp = Join-Path $ProjectPath "resources\yt-dlp.exe"
if (Test-Path $srcYtdlp) {
  foreach ($target in @((Join-Path $exeDir "resources\yt-dlp.exe"), (Join-Path $appDataBin "yt-dlp.exe"))) {
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Copy-Item $srcYtdlp $target -Force
    Write-Ok "کپی شد: $target"
  }
} else {
  Write-Warn "yt-dlp.exe در resources پروژه نبود؛ فقط روی اشتراک صفحه اثر ندارد."
}

Write-Step "4) نصب/بررسی صدای مجازی"
$scr = Join-Path $ProjectPath "resources\Setup.Screen.Capturer.Recorder.exe"
if (Test-Path $scr) {
  Write-Host "اگر پنجره نصب باز شد، ادامه دهید. اگر Chrome باز است، اجازه بستن خودکار بدهید."
  try {
    Start-Process -FilePath $scr -ArgumentList "/S" -Wait
  } catch {
    Write-Warn "اجرای نصب‌کننده صدای مجازی ناموفق بود: $($_.Exception.Message)"
  }
} else {
  Write-Warn "Setup.Screen.Capturer.Recorder.exe پیدا نشد؛ تصویر کار می‌کند ولی صدا ممکن است منتقل نشود."
}

Write-Step "5) تست ffmpeg و دستگاه‌های صدا"
$ff = Join-Path $exeDir "resources\ffmpeg.exe"
& $ff -hide_banner -version | Select-Object -First 1
Write-Host "`nDirectShow audio devices:"
& $ff -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Select-String -Pattern 'DirectShow audio devices|".*"' | ForEach-Object { $_.Line }

Write-Step "6) تست سریع تصویر دسکتاپ"
$testFile = Join-Path $env:TEMP "ums-video-test.ts"
& $ff -hide_banner -loglevel error -f gdigrab -framerate 10 -i desktop -t 2 -c:v libx264 -preset ultrafast -f mpegts $testFile
if ($LASTEXITCODE -eq 0 -and (Test-Path $testFile)) {
  Write-Ok "تست تصویر دسکتاپ سالم است. برنامه را کامل ببندید و دوباره باز کنید."
} else {
  Write-Warn "تست تصویر خطا داد؛ خروجی بالا را بفرستید."
}

Write-Host "`nDone. حالا Universal Media Server را ببندید و دوباره اجرا کنید، سپس دکمه اشتراک صفحه دسکتاپ را تست کنید." -ForegroundColor Cyan