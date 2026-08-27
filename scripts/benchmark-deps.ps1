# سنجش و انتخاب بهترین نسخهٔ وابستگی‌ها برای *این* کامپیوتر
#
# چه کاری می‌کند؟
#   1) ffmpeg های موجود روی سیستم (بستهٔ برنامه، bin کاربر، PATH) را پیدا می‌کند
#      و اختیاراً چند بیلد رایج را هم دانلود می‌کند (essentials / full / 7.1 / n6.1).
#   2) برای هر ffmpeg یک ضبط واقعی دسکتاپ (gdigrab) با همان تنظیمات برنامه اجرا
#      و سرعت (fps واقعی، speed، مصرف CPU) را اندازه می‌گیرد.
#   3) انکودرهای سخت‌افزاری (nvenc/qsv/amf) را تست عملی می‌کند — نه فقط لیست.
#   4) yt-dlp و درایور صدای مجازی را بررسی می‌کند.
#   5) بهترین گزینه را اعلام و با -Apply آن را در مسیر برنامه جایگزین می‌کند.
#
# اجرا:
#   powershell -ExecutionPolicy Bypass -File .\scripts\benchmark-deps.ps1
#   ... -Download        بیلدهای پیشنهادی ffmpeg را هم دانلود و مقایسه کن
#   ... -Apply           بهترین ffmpeg را در نصب برنامه جایگزین کن
#   ... -Seconds 8       طول هر تست (پیش‌فرض 5)

param(
  [switch]$Download,
  [switch]$Apply,
  [int]$Seconds = 5
)

$ErrorActionPreference = "Continue"
$Work = Join-Path $env:TEMP "ums-dep-bench"
New-Item -ItemType Directory -Force -Path $Work | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Info($m) { Write-Host $m -ForegroundColor Cyan }
function Ok($m) { Write-Host $m -ForegroundColor Green }
function Warn($m) { Write-Host $m -ForegroundColor Yellow }

# ---------------------------------------------------------------------------
# 0) مشخصات سیستم — پروفایل برنامه بر همین اساس تصمیم می‌گیرد
# ---------------------------------------------------------------------------
Info "== مشخصات سیستم =="
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cores = [int]$cpu.NumberOfLogicalProcessors
$ramGb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$gpus = (Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join " · "
Write-Host ("CPU: {0} ({1} رشته)" -f $cpu.Name.Trim(), $cores)
Write-Host ("RAM: {0} GB" -f $ramGb)
Write-Host ("GPU: {0}" -f $gpus)
$tierHint = if ($cores -le 2 -or $ramGb -le 4) { "ضعیف (960p/12fps)" } elseif ($cores -le 4) { "متوسط (1152p/15fps)" } else { "قوی (1280p/20-25fps)" }
Write-Host ("پروفایل پیش‌بینی‌شدهٔ برنامه: {0}" -f $tierHint)

# ---------------------------------------------------------------------------
# 1) پیدا کردن همهٔ ffmpeg های سیستم — دقیقاً همان مسیرهایی که برنامه می‌گردد
# ---------------------------------------------------------------------------
Info "`n== ffmpeg های موجود =="
$installRoots = @(
  "$env:ProgramFiles\UniversalMediaServer",
  "${env:ProgramFiles(x86)}\UniversalMediaServer",
  "$env:LOCALAPPDATA\Programs\UniversalMediaServer"
)
$cands = New-Object System.Collections.Generic.List[string]
foreach ($r in $installRoots) {
  foreach ($rel in @("resources\ffmpeg.exe", "resources\app\resources\ffmpeg.exe", "ffmpeg.exe")) {
    $p = Join-Path $r $rel
    if (Test-Path $p) { $cands.Add((Resolve-Path $p).Path) }
  }
}
foreach ($p in @(
    "$env:APPDATA\UniversalMediaServer\bin\ffmpeg.exe",
    (Join-Path $PSScriptRoot "..\resources\ffmpeg.exe")
  )) {
  if (Test-Path $p) { $cands.Add((Resolve-Path $p).Path) }
}
$onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($onPath) { $cands.Add($onPath.Source) }

if ($Download) {
  $builds = @(
    @{ Name = "gyan-essentials-latest"; Url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" },
    @{ Name = "gyan-full-latest"; Url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-full.zip" },
    @{ Name = "gyan-7.1-essentials"; Url = "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip" },
    @{ Name = "btbn-n6.1-gpl"; Url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-win64-gpl-6.1.zip" }
  )
  foreach ($b in $builds) {
    $dir = Join-Path $Work $b.Name
    $exe = Join-Path $dir "ffmpeg.exe"
    if (-not (Test-Path $exe)) {
      try {
        Info ("دانلود " + $b.Name + " …")
        $zip = Join-Path $Work ($b.Name + ".zip")
        Invoke-WebRequest -Uri $b.Url -OutFile $zip -UseBasicParsing
        $ex = Join-Path $Work ($b.Name + "-x")
        if (Test-Path $ex) { Remove-Item $ex -Recurse -Force }
        Expand-Archive $zip -DestinationPath $ex -Force
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Get-ChildItem $ex -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1 |
          ForEach-Object { Copy-Item $_.FullName $exe -Force }
        Get-ChildItem $ex -Filter "ffprobe.exe" -Recurse | Select-Object -First 1 |
          ForEach-Object { Copy-Item $_.FullName (Join-Path $dir "ffprobe.exe") -Force }
      } catch { Warn ("دانلود " + $b.Name + " ناموفق بود") }
    }
    if (Test-Path $exe) { $cands.Add($exe) }
  }
}

$list = $cands | Sort-Object -Unique
if (-not $list) { Warn "هیچ ffmpeg پیدا نشد. اول برنامه را نصب یا -Download را اجرا کنید."; exit 1 }
$list | ForEach-Object { Write-Host " • $_" }

function Get-FfVersion($bin) {
  $l = (& $bin -hide_banner -version 2>&1 | Select-Object -First 1)
  if ($l -match "ffmpeg version (\S+)") { return $Matches[1] }
  return "?"
}

# ---------------------------------------------------------------------------
# 2) تست واقعی: ضبط دسکتاپ با همان زنجیرهٔ برنامه (gdigrab → h264 → mpegts)
#    speed>1 یعنی سیستم راحت جلو می‌رود؛ speed<1 یعنی تصویر روی تلویزیون
#    عقب می‌افتد/می‌پرد.
# ---------------------------------------------------------------------------
function Test-Encode($bin, $encoder) {
  $safeName = ($encoder -replace '[^a-zA-Z0-9_-]', '_')
  $output = Join-Path $Work ("encode-" + $safeName + ".ts")
  $log = Join-Path $Work ("encode-" + $safeName + ".log")
  $stdout = Join-Path $Work ("encode-" + $safeName + ".out")
  Remove-Item $output, $log, $stdout -Force -ErrorAction SilentlyContinue
  $ffArgs = @(
    "-hide_banner", "-nostats", "-loglevel", "info",
    "-f", "gdigrab", "-framerate", "15", "-i", "desktop",
    "-t", "$Seconds",
    "-vf", "scale=1280:-2",
    "-c:v", $encoder
  )
  if ($encoder -eq "libx264") {
    $ffArgs += @(
      "-preset", "veryfast", "-tune", "zerolatency",
      "-profile:v", "baseline", "-pix_fmt", "yuv420p",
      "-g", "30", "-keyint_min", "30",
      "-x264-params", "bframes=0:scenecut=0:sync-lookahead=0:rc-lookahead=0"
    )
  }
  $ffArgs += @("-b:v", "4000k", "-y", "-f", "mpegts", $output)

  $sw = [Diagnostics.Stopwatch]::StartNew()
  $proc = Start-Process -FilePath $bin -ArgumentList $ffArgs -NoNewWindow -PassThru `
    -RedirectStandardError $log -RedirectStandardOutput $stdout
  $cpuSamples = @()
  while (-not $proc.HasExited) {
    Start-Sleep -Milliseconds 400
    $sample = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($sample) { $cpuSamples += $sample.CPU }
  }
  $proc.WaitForExit()
  $sw.Stop()
  $err = Get-Content $log -Raw -ErrorAction SilentlyContinue
  $size = if (Test-Path $output) { (Get-Item $output).Length } else { 0 }
  $fatal = $err -match "(?im)^(?:.*\s)?(?:fatal|conversion failed|error while opening encoder|error initializing output stream|cannot load|device setup failed|no capable devices found|unknown encoder)\b"
  $okRun = ($proc.ExitCode -eq 0) -and ($size -gt 18800) -and (-not $fatal)
  $speed = 0.0
  if ($err -match "speed=\s*([\d.]+)x") { $speed = [double]$Matches[1] }
  $fps = 0.0
  if ($err -match "\bfps=\s*([\d.]+)") { $fps = [double]$Matches[1] }
  $cpuSec = if ($cpuSamples.Count) { [math]::Round(($cpuSamples[-1]), 2) } else { 0 }
  $cpuPct = if ($sw.Elapsed.TotalSeconds -gt 0) { [math]::Round(100 * $cpuSec / ($sw.Elapsed.TotalSeconds * $cores), 1) } else { 0 }
  $result = [pscustomobject]@{
    ok      = $okRun
    speed   = $speed
    fps     = $fps
    cpuPct  = $cpuPct
    elapsed = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    error   = if ($okRun) { "" } else {
      $detail = (($err -split "`n") | Where-Object {
        $_ -match "fatal|conversion failed|error while opening|error initializing|cannot load|device setup failed|no capable devices|unknown encoder"
      } | Select-Object -First 1)
      if ($detail) { $detail.Trim() } elseif ($proc.ExitCode -ne 0) { "ffmpeg exit code $($proc.ExitCode)" } else { "فایل خروجی معتبر تولید نشد" }
    }
  }
  Remove-Item $output, $stdout -Force -ErrorAction SilentlyContinue
  return $result
}

Info "`n== تست عملی هر ffmpeg (ضبط $Seconds ثانیه از دسکتاپ) =="
$results = @()
foreach ($bin in $list) {
  $ver = Get-FfVersion $bin
  $enc = (& $bin -hide_banner -encoders 2>&1) -join "`n"
  $dev = (& $bin -hide_banner -devices 2>&1) -join "`n"
  $hasGdi = $dev -match "gdigrab"
  $hasDshow = $dev -match "dshow"
  Write-Host ("`n--- {0}  (نسخه {1})" -f $bin, $ver)
  if (-not $hasGdi) { Warn "  gdigrab ندارد → برای اشتراک صفحه بی‌فایده است"; continue }

  $hwList = @("h264_nvenc", "h264_qsv", "h264_amf") | Where-Object { $enc -match $_ }
  $encoders = @("libx264") + $hwList
  foreach ($e in $encoders) {
    $r = Test-Encode $bin $e
    if ($r.ok) {
      Ok ("  {0,-12} speed={1,-5} fps={2,-5} CPU~{3}%" -f $e, $r.speed, $r.fps, $r.cpuPct)
    } else {
      Warn ("  {0,-12} کار نکرد: {1}" -f $e, $r.error)
    }
    $results += [pscustomobject]@{
      Bin = $bin; Version = $ver; Encoder = $e; Ok = $r.ok
      Speed = $r.speed; Fps = $r.fps; CpuPct = $r.cpuPct; Dshow = $hasDshow
    }
  }
}

# ---------------------------------------------------------------------------
# 3) انتخاب برنده: اول باید کار کند، بعد سرعت (speed) بالاتر و CPU کمتر
# ---------------------------------------------------------------------------
Info "`n== نتیجه =="
$good = $results | Where-Object { $_.Ok -and $_.Dshow }
if (-not $good) { $good = $results | Where-Object { $_.Ok } }
if (-not $good) { Warn "هیچ ترکیبی کار نکرد. خروجی بالا را برای خطا ببینید."; exit 1 }

$best = $good | Sort-Object -Property @{ Expression = "Speed"; Descending = $true }, @{ Expression = "CpuPct"; Descending = $false } | Select-Object -First 1
$good | Sort-Object Speed -Descending | Format-Table Version, Encoder, Speed, Fps, CpuPct, Bin -AutoSize
Ok ("بهترین برای این سیستم: ffmpeg {0} با انکودر {1} (speed={2}x, CPU~{3}%)" -f $best.Version, $best.Encoder, $best.Speed, $best.CpuPct)
Write-Host ("مسیر: {0}" -f $best.Bin)
if ($best.Encoder -eq "libx264") {
  Write-Host "انکودر سخت‌افزاری روی این سیستم قابل استفاده نبود → در برنامه گزینهٔ «انکود نرم‌افزاری» را روشن بگذارید."
} else {
  Write-Host ("انکودر سخت‌افزاری {0} کار می‌کند → در برنامه حالت خودکار/GPU را انتخاب کنید." -f $best.Encoder)
}

# ---------------------------------------------------------------------------
# 4) yt-dlp و درایور صدای مجازی
# ---------------------------------------------------------------------------
Info "`n== yt-dlp =="
$ytCands = @(
  "$env:ProgramFiles\UniversalMediaServer\resources\yt-dlp.exe",
  "$env:LOCALAPPDATA\Programs\UniversalMediaServer\resources\yt-dlp.exe",
  "$env:APPDATA\UniversalMediaServer\bin\yt-dlp.exe",
  (Join-Path $PSScriptRoot "..\resources\yt-dlp.exe")
) | Where-Object { Test-Path $_ }
if ($ytCands) {
  foreach ($y in $ytCands) {
    $v = (& $y --version 2>&1 | Select-Object -First 1)
    Write-Host (" • {0} → {1}" -f $y, $v)
  }
  try {
    $latest = (Invoke-RestMethod "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" -Headers @{ "User-Agent" = "ums" }).tag_name
    Write-Host ("آخرین نسخهٔ منتشرشده: {0}" -f $latest)
    Write-Host "yt-dlp قدیمی = خطای «لینک پیدا نشد» در پخش لینک‌های وب. اگر عقب است بروزرسانی کنید:"
    Write-Host ("  & '{0}' -U" -f $ytCands[0])
  } catch { Warn "بررسی آخرین نسخه ناموفق بود (اینترنت)." }
} else {
  Warn "yt-dlp پیدا نشد → پخش/دانلود لینک‌های وب کار نمی‌کند."
}

Info "`n== دستگاه‌های صدای DirectShow =="
$dev = (& $best.Bin -hide_banner -list_devices true -f dshow -i dummy 2>&1) -join "`n"
$audio = ([regex]::Matches($dev, '"([^"]+)"\s*\r?\n[^\n]*audio', "IgnoreCase") | ForEach-Object { $_.Groups[1].Value })
if (-not $audio) { $audio = ([regex]::Matches($dev, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }) }
$loop = $audio | Where-Object { $_ -match "virtual-audio-capturer|stereo mix|what u hear|loopback" }
if ($loop) { Ok ("دستگاه صدای دسکتاپ: " + ($loop -join " · ")) }
else {
  Warn "virtual-audio-capturer / Stereo Mix پیدا نشد → تلویزیون تصویر می‌گیرد ولی صدا نه."
  Write-Host "  Setup.Screen.Capturer.Recorder.exe را نصب کنید (در setup.exe گزینه‌اش هست)."
}

# ---------------------------------------------------------------------------
# 5) اعمال برنده روی نصب برنامه
# ---------------------------------------------------------------------------
if ($Apply) {
  Info "`n== اعمال بهترین ffmpeg روی نصب برنامه =="
  $targets = $installRoots | Where-Object { Test-Path (Join-Path $_ "resources") } |
    ForEach-Object { Join-Path $_ "resources\ffmpeg.exe" }
  if (-not $targets) { Warn "مسیر نصب برنامه پیدا نشد؛ کپی دستی لازم است." }
  foreach ($t in $targets) {
    if ((Resolve-Path $best.Bin).Path -eq (Resolve-Path $t -ErrorAction SilentlyContinue).Path) { continue }
    try {
      Stop-Process -Name "UniversalMediaServer" -Force -ErrorAction SilentlyContinue
      Copy-Item $best.Bin $t -Force
      $srcProbe = Join-Path (Split-Path $best.Bin -Parent) "ffprobe.exe"
      if (Test-Path $srcProbe) { Copy-Item $srcProbe (Join-Path (Split-Path $t -Parent) "ffprobe.exe") -Force }
      Ok ("جایگزین شد: {0}" -f $t)
    } catch { Warn ("کپی ناموفق (PowerShell را Run as administrator اجرا کنید): {0}" -f $t) }
  }
  # ffmpeg کهنهٔ دانلودشدهٔ نسخهٔ قبل، جلوی نسخهٔ جدید را می‌گیرد
  $stale = "$env:APPDATA\UniversalMediaServer\bin\ffmpeg.exe"
  if ((Test-Path $stale) -and ((Resolve-Path $stale).Path -ne (Resolve-Path $best.Bin).Path)) {
    Remove-Item $stale -Force -ErrorAction SilentlyContinue
    Ok "ffmpeg کهنه در پوشهٔ کاربر پاک شد."
  }
}

Info "`nپایان. برای عیب‌یابی تصویر سیاه: .\scripts\diagnose-screenshare.ps1"
