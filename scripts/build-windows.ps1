# ساخت کاملاً خودکار نسخه Windows و Setup
param([switch]$SkipInstaller, [switch]$RefreshDeps, [string]$Version='', [switch]$InternalWorkspace, [string]$OriginalRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'build-common.ps1')
Enter-AsciiBuildWorkspace -ScriptName 'build-windows.ps1' -ForwardArguments @() -InternalWorkspace:$InternalWorkspace -OriginalRoot $OriginalRoot | Out-Null
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path; Set-Location -LiteralPath $Root; if(-not $OriginalRoot){$OriginalRoot=$Root}
$AppName='UniversalMediaServer'; $ResourcesDir=Join-Path $Root 'resources'; $PackDir=Join-Path $Root "electron-release\$AppName-win32-x64"

try {
  Write-Step '0/7 Version and environment'
  $pkgPath=Join-Path $Root 'package.json'
  if($Version){
    if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Version format must be x.y.z.'}
    $raw=(Get-Content -LiteralPath $pkgPath -Raw)-replace '("version"\s*:\s*")[^"]+("\s*,)',"`${1}$Version`${2}"
    [IO.File]::WriteAllText($pkgPath,$raw,(New-Object Text.UTF8Encoding($false)))
  }
  $AppVersion=(Get-Content -LiteralPath $pkgPath -Raw|ConvertFrom-Json).version

  Write-Step '1/7 Atomic dependency installation and native health check'
  Install-NodeDependencies

  Write-Step '2/7 TanStack/Vite web build'
  $env:NITRO_PRESET='node-server'
  Invoke-Checked 'npm.cmd' @('run','build') 'Web build failed'
  if((-not(Test-Path '.output\server\index.mjs')) -and (-not(Test-Path 'dist\server\index.mjs'))){throw 'Server bundle was not produced.'}

  Write-Step '3/7 FFmpeg, ffprobe and yt-dlp'
  New-Item -ItemType Directory -Force -Path $ResourcesDir | Out-Null
  $ffZip=Join-Path $env:TEMP 'ums-ffmpeg.zip'; $ffTmp=Join-Path $env:TEMP 'ums-ffmpeg'
  if($RefreshDeps){Remove-Item (Join-Path $ResourcesDir 'ffmpeg.exe'),(Join-Path $ResourcesDir 'ffprobe.exe'),(Join-Path $ResourcesDir 'yt-dlp.exe') -Force -ErrorAction SilentlyContinue}
  if((-not(Test-Path (Join-Path $ResourcesDir 'ffmpeg.exe'))) -or (-not(Test-Path (Join-Path $ResourcesDir 'ffprobe.exe')))){
    Invoke-Download -Uri @('https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip','https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip') -OutFile $ffZip -TimeoutSec 600
    Remove-Item $ffTmp -Recurse -Force -ErrorAction SilentlyContinue; Expand-Archive -LiteralPath $ffZip -DestinationPath $ffTmp -Force
    foreach($name in @('ffmpeg.exe','ffprobe.exe')){$hit=Get-ChildItem $ffTmp -Recurse -Filter $name|Select-Object -First 1;if(-not $hit){throw "$name was not found in the archive."};Copy-Item -LiteralPath $hit.FullName -Destination (Join-Path $ResourcesDir $name) -Force}
  }
  $ff=Join-Path $ResourcesDir 'ffmpeg.exe'; $fp=Join-Path $ResourcesDir 'ffprobe.exe'
  Invoke-Checked $ff @('-hide_banner','-version') 'ffmpeg validation failed'; Invoke-Checked $fp @('-hide_banner','-version') 'ffprobe validation failed'
  $features=((& $ff -hide_banner -devices 2>&1)-join "`n")+((& $ff -hide_banner -encoders 2>&1)-join "`n")
  if($features -notmatch 'gdigrab' -or $features -notmatch 'libx264'){throw 'Downloaded ffmpeg lacks gdigrab or libx264.'}
  $ytdlp=Join-Path $ResourcesDir 'yt-dlp.exe'; if(-not(Test-Path $ytdlp)){Invoke-Download -Uri @('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe') -OutFile $ytdlp -TimeoutSec 300}; Invoke-Checked $ytdlp @('--version') 'yt-dlp validation failed'
  $audio=Join-Path $ResourcesDir 'Setup.Screen.Capturer.Recorder.exe'; if(-not(Test-Path $audio)){Invoke-Download -Uri @('https://github.com/rdp/screen-capture-recorder-to-video-windows-free/releases/download/v0.13.3/Setup.Screen.Capturer.Recorder.v0.13.3.exe') -OutFile $audio -TimeoutSec 300}

  Write-Step '4/7 Electron packaging'
  $env:ELECTRON_GET_USE_PROXY='true'
  Invoke-Checked 'node' @('.\scripts\package-electron.mjs','--platform','win32','--arch','x64','--version',$AppVersion) 'Electron packaging failed'

  Write-Step '5/7 Package validation'
  $exe=Join-Path $PackDir "$AppName.exe"; if(-not(Test-Path $exe)){throw "Electron executable was not produced: $exe"}
  $appRoot=Join-Path $PackDir 'resources\app'; foreach($rel in @('.output\server\index.mjs','.output\public','electron','package.json')){if(-not(Test-Path (Join-Path $appRoot $rel))){throw "Incomplete Electron package: $rel"}}
  foreach($name in @('ffmpeg.exe','ffprobe.exe','yt-dlp.exe')){Copy-Item -LiteralPath (Join-Path $ResourcesDir $name) -Destination (Join-Path $PackDir "resources\$name") -Force}
  if($SkipInstaller){Write-Host "`nBUILD SUCCESS" -ForegroundColor Green; Write-Ok "App: $exe"; exit 0}

  Write-Step '6/7 Inno Setup discovery or installation'
  function Find-Iscc { @( "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object {Test-Path $_}|Select-Object -First 1 }
  $iscc=Find-Iscc
  if(-not $iscc){$winget=Get-Command winget -ErrorAction SilentlyContinue;if($winget){Invoke-Checked $winget.Source @('install','--id','JRSoftware.InnoSetup','-e','--silent','--disable-interactivity','--accept-source-agreements','--accept-package-agreements') 'Inno Setup installation failed';$iscc=Find-Iscc}}
  if(-not $iscc){$inno=Join-Path $env:TEMP 'innosetup.exe';Invoke-Download -Uri @('https://jrsoftware.org/download.php/is.exe') -OutFile $inno -TimeoutSec 300;Invoke-Checked $inno @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-') 'Inno Setup installation failed';$iscc=Find-Iscc}
  if(-not $iscc){throw 'Inno Setup could not be installed or located.'}

  Write-Step '7/7 Setup creation'
  Invoke-Checked $iscc @("/DAppVersion=$AppVersion",(Join-Path $Root 'scripts\installer.iss')) 'Installer build failed'
  $setup=Join-Path $Root 'installer\UniversalMediaServer-Setup.exe'; if(-not(Test-Path $setup)){throw 'Setup.exe was not produced.'}
  $versioned=Copy-BuildArtifact $setup $OriginalRoot "UniversalMediaServer-Setup-$AppVersion.exe"
  $final=Copy-BuildArtifact $setup $OriginalRoot 'UniversalMediaServer-Setup.exe'
  Write-Host "`nBUILD SUCCESS" -ForegroundColor Green; Write-Ok "Setup: $final"; Write-Ok "Versioned setup: $versioned"
} catch { Write-BuildFailure -Failure $_ -Root $Root; exit 1 }