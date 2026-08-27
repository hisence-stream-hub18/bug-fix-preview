# زیرساخت مشترک ساخت Windows و Android - سازگار با Windows PowerShell 5.1
Set-StrictMode -Version 2.0

$script:BuildStage = 'Bootstrap'
$script:BuildCommand = ''
$script:BuildLog = ''
$script:RepairSummary = 'Not required'

function Write-Step([string]$Text) {
  $script:BuildStage = $Text
  Write-Host "`n== $Text ==" -ForegroundColor Yellow
}

function Write-Ok([string]$Text) { Write-Host $Text -ForegroundColor Green }

function Format-CommandArgument([string]$Value) {
  if ($Value -match '[\s"]') { return '"' + ($Value -replace '"','\"') + '"' }
  return $Value
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory=$true)][string]$FilePath,
    [string[]]$ArgumentList=@(),
    [string]$FailureMessage='Command failed'
  )
  $displayArgs = @($ArgumentList | ForEach-Object { Format-CommandArgument ([string]$_) }) -join ' '
  $script:BuildCommand = "$FilePath $displayArgs".Trim()
  Write-Host "> $script:BuildCommand" -ForegroundColor DarkGray
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $FilePath @ArgumentList 2>&1 | Tee-Object -Variable commandOutput | ForEach-Object { Write-Host $_ }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $oldPreference
  }
  $script:BuildLog = (@($commandOutput) | Out-String).Trim()
  if ($exitCode -ne 0) {
    throw "$FailureMessage (exit code $exitCode)"
  }
}

function Get-ToolVersion([string]$Command, [string[]]$Arguments=@('--version')) {
  try { return ((& $Command @Arguments 2>$null | Select-Object -First 1) -as [string]).Trim() } catch { return 'unavailable' }
}

function Write-BuildFailure {
  param([System.Management.Automation.ErrorRecord]$Failure, [string]$Root)
  $nodeVersion = Get-ToolVersion 'node'
  $npmVersion = Get-ToolVersion 'npm.cmd'
  Write-Host "`nBUILD FAILED" -ForegroundColor Red
  Write-Host "Stage: $script:BuildStage"
  Write-Host "Command: $(if($script:BuildCommand){$script:BuildCommand}else{'n/a'})"
  Write-Host "Exit/Exception: $($Failure.Exception.Message)"
  Write-Host "Project: $Root"
  Write-Host "Node: $nodeVersion"
  Write-Host "npm: $npmVersion"
  Write-Host "Platform: $([Environment]::OSVersion.VersionString) / $([Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"
  Write-Host "Native repair: $script:RepairSummary"
  if ($script:BuildLog) {
    Write-Host "`nError output:" -ForegroundColor Red
    Write-Host $script:BuildLog
  }
  Write-Host "`nThe build stopped safely. No manual npm install is required; rerun this script after resolving the reported network/system error." -ForegroundColor Yellow
}

function Invoke-Download {
  param([Parameter(Mandatory=$true)][string[]]$Uri, [Parameter(Mandatory=$true)][string]$OutFile, [int]$Retries=3, [int]$TimeoutSec=180)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $parent = Split-Path $OutFile -Parent
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  foreach ($url in $Uri) {
    for ($attempt=1; $attempt -le $Retries; $attempt++) {
      try {
        Remove-Item "$OutFile.part" -Force -ErrorAction SilentlyContinue
        Write-Host "Downloading ($attempt/$Retries): $url"
        $request = [Net.HttpWebRequest]::Create($url)
        $request.Timeout = $TimeoutSec * 1000
        $request.ReadWriteTimeout = $TimeoutSec * 1000
        $request.UserAgent = 'UMS-Build/2.0'
        $response = $request.GetResponse()
        try {
          $input = $response.GetResponseStream()
          $output = [IO.File]::Create("$OutFile.part")
          try {
            $buffer = New-Object byte[] 1048576
            $received = 0L
            while (($count = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
              $output.Write($buffer, 0, $count); $received += $count
              if ($response.ContentLength -gt 0) {
                Write-Progress -Activity 'Downloading build dependency' -Status "$([Math]::Round($received/1MB,1)) MB" -PercentComplete ([int](100*$received/$response.ContentLength))
              }
            }
          } finally { $output.Dispose(); $input.Dispose(); Write-Progress -Activity 'Downloading build dependency' -Completed }
        } finally { $response.Dispose() }
        if ((Get-Item "$OutFile.part").Length -lt 1024) { throw 'Downloaded file is unexpectedly small' }
        Move-Item "$OutFile.part" $OutFile -Force
        return
      } catch {
        Remove-Item "$OutFile.part" -Force -ErrorAction SilentlyContinue
        if ($attempt -eq $Retries) { Write-Warning "Download failed: $url ($($_.Exception.Message))" }
        else { Start-Sleep -Seconds ([Math]::Min(2*$attempt, 6)) }
      }
    }
  }
  throw "Automatic download failed: $OutFile"
}

function Update-ProcessPath {
  $machine = [Environment]::GetEnvironmentVariable('Path','Machine')
  $user = [Environment]::GetEnvironmentVariable('Path','User')
  $env:Path = "$machine;$user;$env:Path"
}

function Get-WindowsArch {
  $arch = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  if ($arch -eq 'x64') { return 'x64' }
  throw "Only Windows x64 is supported by the locked native build dependencies. Detected: $arch"
}

function Ensure-NodeLts {
  if ($env:OS -ne 'Windows_NT') { throw 'This build script must run on Windows 10/11 x64.' }
  $valid = $false
  if (Get-Command node -ErrorAction SilentlyContinue) {
    try { $major = [int]((& node --version).TrimStart('v').Split('.')[0]); $valid = ($major -ge 20 -and $major -lt 25) } catch { $valid = $false }
  }
  if (-not $valid) {
    Write-Host 'Installing a supported Node.js LTS release silently...'
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
      Invoke-Checked $winget.Source @('install','--id','OpenJS.NodeJS.LTS','-e','--silent','--disable-interactivity','--accept-source-agreements','--accept-package-agreements') 'Node.js installation failed'
      Update-ProcessPath
    }
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20-24 could not be installed automatically.' }
  $major = [int]((& node --version).TrimStart('v').Split('.')[0])
  if ($major -lt 20 -or $major -ge 25) { throw "Unsupported Node.js version: $(& node --version). Install could not select Node 20-24." }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm is missing from the Node.js installation.' }
  Get-WindowsArch | Out-Null
  $env:npm_config_yes='true'; $env:npm_config_audit='false'; $env:npm_config_fund='false'; $env:npm_config_progress='false'; $env:npm_config_optional='true'
  Write-Host "Node $(& node --version) | npm $(& npm.cmd --version) | Windows x64"
}

function Test-NativeBindings {
  & node -e "require('lightningcss');require('@tailwindcss/oxide');console.log('NATIVE OK')" 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { return $false }
  & node -e "const fs=require('fs');for(const p of ['node_modules/lightningcss-win32-x64-msvc/lightningcss.win32-x64-msvc.node','node_modules/@tailwindcss/oxide-win32-x64-msvc/tailwindcss-oxide.win32-x64-msvc.node']){if(!fs.existsSync(p))throw new Error('Missing native file: '+p)}" 2>&1 | ForEach-Object { Write-Host $_ }
  return ($LASTEXITCODE -eq 0)
}

function Install-NodeDependencies {
  Ensure-NodeLts
  if (-not (Test-Path 'package-lock.json')) { throw 'package-lock.json is required for a reproducible build.' }
  $npmArgs = @('ci','--include=optional','--foreground-scripts','--no-audit','--no-fund','--no-progress')
  $script:RepairSummary = 'Clean npm ci from the committed lockfile'
  Invoke-Checked 'npm.cmd' $npmArgs 'Atomic dependency installation failed'
  Write-Host 'Verifying native bindings and locked dependency tree...'
  if (-not (Test-NativeBindings)) {
    $script:RepairSummary = 'Native health check failed; one automatic clean npm ci retry was attempted'
    Write-Warning 'Native binding health check failed. Rebuilding node_modules once from package-lock.json...'
    Remove-Item 'node_modules' -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-Checked 'npm.cmd' $npmArgs 'Automatic native dependency repair failed'
    if (-not (Test-NativeBindings)) { throw 'Native bindings are still unavailable after a clean lockfile restore.' }
  }
  Invoke-Checked 'npm.cmd' @('ls','lightningcss','lightningcss-win32-x64-msvc','@tailwindcss/oxide','@tailwindcss/oxide-win32-x64-msvc','--depth=2') 'Native dependency tree validation failed'
  $script:RepairSummary = 'Native health check passed from package-lock.json'
}

function Enter-AsciiBuildWorkspace {
  param([string]$ScriptName, [string[]]$ForwardArguments, [switch]$InternalWorkspace, [string]$OriginalRoot)
  if ($env:OS -ne 'Windows_NT') { throw 'This script must run on Windows.' }
  $source = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  Set-Location -LiteralPath $source
  $temp = Join-Path ([IO.Path]::GetTempPath()) 'ums-build'
  New-Item -ItemType Directory -Force -Path $temp | Out-Null
  $env:TMP=$temp; $env:TEMP=$temp
  Write-Host "Project path: $source"
  Write-Host "Temporary files: $temp"
  return $false
}

function Copy-BuildArtifact {
  param([string]$Source, [string]$OriginalRoot, [string]$Name)
  if (-not $OriginalRoot) { $OriginalRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
  if (-not (Test-Path -LiteralPath $Source)) { throw "Build artifact was not created: $Source" }
  $destinationRoot = Join-Path $OriginalRoot 'installer'
  New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
  $destination = Join-Path $destinationRoot $Name
  $sourceFull = [IO.Path]::GetFullPath($Source); $destinationFull = [IO.Path]::GetFullPath($destination)
  if ($sourceFull -ne $destinationFull) { Copy-Item -LiteralPath $Source -Destination $destination -Force }
  return $destinationFull
}