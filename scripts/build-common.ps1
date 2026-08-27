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
  Write-Host "`nThe build stopped safely. No manual npm install is required; resolve the reported error and rerun this script." -ForegroundColor Yellow
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
  $env:npm_config_yes='true'; $env:npm_config_audit='false'; $env:npm_config_fund='false'; $env:npm_config_progress='false'
  Remove-Item Env:npm_config_optional -ErrorAction SilentlyContinue
  Write-Host "Node $(& node --version) | npm $(& npm.cmd --version) | Windows x64"
}

function Invoke-Soft {
  # Runs a command, streams its output, and returns the exit code instead of throwing.
  param([string]$FilePath, [string[]]$ArgumentList=@())
  $displayArgs = @($ArgumentList | ForEach-Object { Format-CommandArgument ([string]$_) }) -join ' '
  $script:BuildCommand = "$FilePath $displayArgs".Trim()
  Write-Host "> $script:BuildCommand" -ForegroundColor DarkGray
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $FilePath @ArgumentList 2>&1 | Tee-Object -Variable commandOutput | ForEach-Object { Write-Host $_ }
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  $script:BuildLog = (@($commandOutput) | Out-String).Trim()
  return $exitCode
}

function Get-PackageVersion {
  param([string]$Name)
  $json = Get-Content -LiteralPath (Join-Path (Get-Location) 'package.json') -Raw | ConvertFrom-Json
  foreach ($section in @('optionalDependencies','devDependencies','dependencies')) {
    $bag = $json.$section
    if ($bag -and $bag.PSObject.Properties.Name -contains $Name) { return ([string]$bag.$Name).TrimStart('^','~') }
  }
  return ''
}

function Test-NativeBindings {
  & node -e "require('lightningcss');require('@tailwindcss/oxide');console.log('NATIVE OK')" 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { return $false }
  & node -e "const fs=require('fs');for(const p of ['node_modules/lightningcss-win32-x64-msvc/lightningcss.win32-x64-msvc.node','node_modules/@tailwindcss/oxide-win32-x64-msvc/tailwindcss-oxide.win32-x64-msvc.node']){if(!fs.existsSync(p))throw new Error('Missing native file: '+p)}" 2>&1 | ForEach-Object { Write-Host $_ }
  return ($LASTEXITCODE -eq 0)
}

function Repair-NativeBindings {
  # Installs the exact Windows x64 binaries the locked versions require.
  $lightning = Get-PackageVersion 'lightningcss-win32-x64-msvc'
  $oxide = Get-PackageVersion '@tailwindcss/oxide-win32-x64-msvc'
  if (-not $lightning) { $lightning = Get-PackageVersion 'lightningcss' }
  if (-not $oxide) { $oxide = Get-PackageVersion '@tailwindcss/oxide' }
  Write-Host "Repairing Windows x64 native bindings (lightningcss $lightning / oxide $oxide)..."
  Invoke-Soft 'npm.cmd' @('install','--no-save','--include=optional','--force','--no-audit','--no-fund','--no-progress',"lightningcss-win32-x64-msvc@$lightning","@tailwindcss/oxide-win32-x64-msvc@$oxide") | Out-Null
}

function Install-NodeDependencies {
  Ensure-NodeLts
  # The public npm registry is enforced so a lockfile produced on another
  # machine/registry can never break an end-user build.
  $env:npm_config_registry = 'https://registry.npmjs.org/'
  $env:npm_config_include = 'optional'

  $lockUsable = $false
  if (Test-Path 'package-lock.json') {
    $lockUsable = ((Invoke-Soft 'node' @('scripts\verify-lockfile.mjs')) -eq 0)
  }
  if (-not $lockUsable) {
    Write-Warning 'The lockfile is missing or not reproducible on this machine. Regenerating it from package.json...'
    $script:RepairSummary = 'Lockfile regenerated from package.json against registry.npmjs.org'
    Remove-Item 'package-lock.json' -Force -ErrorAction SilentlyContinue
    Invoke-Checked 'npm.cmd' @('install','--package-lock-only','--include=optional','--no-audit','--no-fund','--no-progress') 'Lockfile generation failed'
  } else {
    $script:RepairSummary = 'Clean npm ci from the committed lockfile'
  }

  # One atomic install. Nothing later in the build touches node_modules again.
  $npmCi = @('ci','--include=optional','--foreground-scripts','--no-audit','--no-fund','--no-progress')
  if ((Invoke-Soft 'npm.cmd' $npmCi) -ne 0) {
    Write-Warning 'npm ci failed. Rebuilding node_modules from scratch...'
    $script:RepairSummary = 'npm ci failed; full clean reinstall was performed automatically'
    Remove-Item 'node_modules' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item 'package-lock.json' -Force -ErrorAction SilentlyContinue
    Invoke-Checked 'npm.cmd' @('install','--include=optional','--foreground-scripts','--no-audit','--no-fund','--no-progress') 'Atomic dependency installation failed'
  }

  Write-Host 'Health check: native bindings for Windows x64...'
  if (-not (Test-NativeBindings)) {
    Write-Warning 'Native binding health check failed. Installing the missing Windows x64 binaries...'
    $script:RepairSummary = 'Windows x64 native binaries were repaired automatically'
    Repair-NativeBindings
    if (-not (Test-NativeBindings)) {
      Write-Warning 'Still failing. Performing a full clean reinstall as the last automatic step...'
      $script:RepairSummary = 'Full clean reinstall plus native binary repair'
      Remove-Item 'node_modules' -Recurse -Force -ErrorAction SilentlyContinue
      Invoke-Checked 'npm.cmd' @('install','--include=optional','--foreground-scripts','--no-audit','--no-fund','--no-progress') 'Automatic native dependency repair failed'
      Repair-NativeBindings
      if (-not (Test-NativeBindings)) {
        throw 'Native bindings (lightningcss / @tailwindcss/oxide) are unavailable for Windows x64 after every automatic repair. Check the internet connection or antivirus blocking .node files, then rerun this script.'
      }
    }
  }
  Invoke-Soft 'npm.cmd' @('ls','lightningcss','lightningcss-win32-x64-msvc','@tailwindcss/oxide','@tailwindcss/oxide-win32-x64-msvc','--depth=2') | Out-Null
  Write-Ok 'NATIVE OK - dependency tree is reproducible.'
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