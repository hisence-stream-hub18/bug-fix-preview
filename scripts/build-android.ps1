# ساخت کاملاً خودکار APK Android با Capacitor
param([string]$AppUrl='', [string]$Version='', [switch]$Release, [switch]$Sign, [switch]$Install, [switch]$Clean, [switch]$InternalWorkspace, [string]$OriginalRoot='')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'build-common.ps1')
Enter-AsciiBuildWorkspace -ScriptName 'build-android.ps1' -ForwardArguments @() -InternalWorkspace:$InternalWorkspace -OriginalRoot $OriginalRoot | Out-Null
$Root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path; Set-Location -LiteralPath $Root; if(-not $OriginalRoot){$OriginalRoot=$Root}

function Ensure-Jdk {
  $valid=$false
  if(Get-Command java -ErrorAction SilentlyContinue){try{$valid=((& java -version 2>&1|Select-Object -First 1)-match 'version "(21|22|23|24)')}catch{$valid=$false}}
  if(-not $valid){$winget=Get-Command winget -ErrorAction SilentlyContinue;if($winget){Invoke-Checked $winget.Source @('install','--id','EclipseAdoptium.Temurin.21.JDK','-e','--silent','--disable-interactivity','--accept-source-agreements','--accept-package-agreements') 'JDK 21 installation failed';Update-ProcessPath}}
  $java=Get-Command java -ErrorAction SilentlyContinue
  if(-not $java){$candidate=Get-ChildItem "$env:ProgramFiles\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue|Sort-Object Name -Descending|Select-Object -First 1;if($candidate){$env:JAVA_HOME=$candidate.FullName;$env:Path="$env:JAVA_HOME\bin;$env:Path";$java=Get-Command java -ErrorAction SilentlyContinue}}
  if(-not $java){throw 'JDK 21 could not be installed or located.'}
  if(-not $env:JAVA_HOME){$env:JAVA_HOME=(Split-Path (Split-Path $java.Source -Parent) -Parent)}
  Write-Host "Java: $(& java -version 2>&1|Select-Object -First 1)"
}

function Ensure-AndroidSdk {
  $sdk=if($env:ANDROID_SDK_ROOT){$env:ANDROID_SDK_ROOT}elseif($env:ANDROID_HOME){$env:ANDROID_HOME}else{Join-Path $env:LOCALAPPDATA 'Android\Sdk'}
  $manager=Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
  if(-not(Test-Path $manager)){
    $zip=Join-Path $env:TEMP 'android-commandlinetools.zip';$tmp=Join-Path $env:TEMP 'android-commandlinetools'
    Invoke-Download -Uri @('https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip') -OutFile $zip -TimeoutSec 600
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue;Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    New-Item -ItemType Directory -Force -Path (Split-Path $manager -Parent)|Out-Null
    Copy-Item -Path (Join-Path $tmp 'cmdline-tools\*') -Destination (Split-Path $manager -Parent) -Recurse -Force
  }
  $env:ANDROID_SDK_ROOT=$sdk;$env:ANDROID_HOME=$sdk;$env:Path="$sdk\platform-tools;$sdk\cmdline-tools\latest\bin;$env:Path"
  return @($sdk,$manager)
}

try {
  Write-Step '1/7 Prerequisites, atomic dependencies and native health check'
  Ensure-Jdk; $sdkInfo=Ensure-AndroidSdk; $sdk=$sdkInfo[0]; $manager=$sdkInfo[1]; Install-NodeDependencies

  Write-Step '2/7 Version and Android SDK packages'
  $pkgPath=Join-Path $Root 'package.json'
  if($Version){if($Version -notmatch '^\d+\.\d+\.\d+$'){throw 'Version format must be x.y.z.'};$raw=(Get-Content $pkgPath -Raw)-replace '("version"\s*:\s*")[^"]+("\s*,)',"`${1}$Version`${2}";[IO.File]::WriteAllText($pkgPath,$raw,(New-Object Text.UTF8Encoding($false)))}
  $VersionName=(Get-Content $pkgPath -Raw|ConvertFrom-Json).version;$v=$VersionName.Split('.');$VersionCode=[int]$v[0]*10000+[int]$v[1]*100+[int]$v[2]
  $compile='35';$buildTools='35.0.0'
  $yesFile=Join-Path $env:TEMP 'android-licenses.txt';(1..200|ForEach-Object{'y'})|Set-Content $yesFile -Encoding ascii
  $licenseCommand="`"$manager`" --sdk_root=`"$sdk`" --licenses < `"$yesFile`""
  Invoke-Checked 'cmd.exe' @('/d','/s','/c',$licenseCommand) 'Android SDK license acceptance failed'
  Invoke-Checked $manager @("--sdk_root=$sdk",'platform-tools',"platforms;android-$compile","build-tools;$buildTools") 'Android SDK package installation failed'

  Write-Step '3/7 TanStack/Vite web build'
  $env:NITRO_PRESET='node-server';Invoke-Checked 'npm.cmd' @('run','build') 'Web build failed'
  if(-not $AppUrl){$AppUrl=if($env:UMS_APP_URL){$env:UMS_APP_URL}else{'http://10.0.2.2:5001'};Write-Host "App URL was not supplied; using $AppUrl (override with -AppUrl or UMS_APP_URL)."}

  Write-Step '4/7 Capacitor configuration'
  $cfg=Get-Content 'capacitor.config.json' -Raw|ConvertFrom-Json
  $cfg|Add-Member server ([pscustomobject]@{url=$AppUrl;cleartext=$true}) -Force
  [IO.File]::WriteAllText((Join-Path $Root 'capacitor.config.json'),($cfg|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))

  Write-Step '5/7 Android synchronization'
  if($Clean -and (Test-Path 'android\app\build')){Remove-Item 'android\app\build' -Recurse -Force}
  if(-not(Test-Path 'android')){Invoke-Checked 'npx.cmd' @('--no-install','cap','add','android') 'Capacitor Android initialization failed'}
  Invoke-Checked 'npx.cmd' @('--no-install','capacitor-assets','generate','--android','--iconBackgroundColor','#0a1024','--splashBackgroundColor','#0a1024') 'Android asset generation failed'
  Invoke-Checked 'npx.cmd' @('--no-install','cap','sync','android') 'Capacitor synchronization failed'
  Invoke-Checked 'node' @('scripts\install-android-plugin.mjs') 'Native plugin installation failed'
  $gradle='android\app\build.gradle';$g=Get-Content $gradle -Raw;$g=$g-replace 'versionCode\s+\d+',"versionCode $VersionCode";$g=$g-replace 'versionName\s+"[^"]*"',"versionName `"$VersionName`"";[IO.File]::WriteAllText((Join-Path $Root $gradle),$g,(New-Object Text.UTF8Encoding($false)))

  Write-Step '6/7 APK compilation'
  Push-Location 'android';try{if($Clean){Invoke-Checked '.\gradlew.bat' @('clean','--no-daemon','--console=plain') 'Gradle clean failed'};$task=if($Release){'assembleRelease'}else{'assembleDebug'};Invoke-Checked '.\gradlew.bat' @($task,'--no-daemon','--console=plain','--stacktrace') 'Gradle build failed'}finally{Pop-Location}
  $apk=if($Release){Join-Path $Root 'android\app\build\outputs\apk\release\app-release-unsigned.apk'}else{Join-Path $Root 'android\app\build\outputs\apk\debug\app-debug.apk'}
  if($Release -and -not(Test-Path $apk)){$apk=Join-Path $Root 'android\app\build\outputs\apk\release\app-release.apk'}
  if(-not(Test-Path $apk)){throw "APK was not produced: $apk"}

  Write-Step '7/7 Signing, verification and artifact'
  if($Release -and $Sign){
    $ks=Join-Path $OriginalRoot 'release.keystore';$pass=if($env:UMS_KEYSTORE_PASSWORD){$env:UMS_KEYSTORE_PASSWORD}else{'umsrelease'}
    if(-not(Test-Path $ks)){Invoke-Checked 'keytool' @('-genkeypair','-noprompt','-keystore',$ks,'-alias','ums','-keyalg','RSA','-keysize','2048','-validity','10000','-storepass',$pass,'-keypass',$pass,'-dname','CN=UniversalMediaServer, O=UMS, C=IR') 'Keystore generation failed'}
    $signer=Get-ChildItem "$sdk\build-tools" -Filter 'apksigner.bat' -Recurse|Sort-Object FullName -Descending|Select-Object -First 1;if(-not $signer){throw 'apksigner was not found.'}
    $signed=Join-Path $Root 'app-release-signed.apk';Invoke-Checked $signer.FullName @('sign','--ks',$ks,'--ks-pass',"pass:$pass",'--key-pass',"pass:$pass",'--out',$signed,$apk) 'APK signing failed';Invoke-Checked $signer.FullName @('verify','--verbose',$signed) 'APK signature verification failed';$apk=$signed
  }
  $name="UniversalMediaServer-$VersionName"+$(if($Release){'-release.apk'}else{'-debug.apk'});$final=Copy-BuildArtifact $apk $OriginalRoot $name
  if($Install){$adb=Join-Path $sdk 'platform-tools\adb.exe';Invoke-Checked $adb @('install','-r','-d',$final) 'ADB installation failed'}
  Write-Host "`nBUILD SUCCESS" -ForegroundColor Green;Write-Ok "APK: $final"
} catch { Write-BuildFailure -Failure $_ -Root $Root; exit 1 }