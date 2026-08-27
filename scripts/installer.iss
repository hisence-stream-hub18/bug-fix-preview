; اسکریپت Inno Setup برای ساخت فایل نصبی هوشمند ویندوز (Windows 10/11 x64)
; اجرا:  iscc /DAppVersion=1.0.0 scripts\installer.iss
;
; این نسخه «هوشمند» است:
;   • نسخه قدیمی نصب‌شده را (از هر مسیری: Program Files یا LocalAppData) پیدا
;     و پیش از نصب، بی‌صدا حذف می‌کند.
;   • اگر برنامه در حال اجراست، آن را می‌بندد (وگرنه فایل‌ها قفل می‌مانند).
;   • باقی‌مانده‌های نسخه قبل (bin کهنه با ffmpeg/yt-dlp قدیمی، کش Electron،
;     قوانین فایروال تکراری) را پاک می‌کند تا با نسخه جدید ناهماهنگ نشود.
;   • تنظیمات کاربر (config.json / کتابخانه) حفظ می‌شود.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExe "UniversalMediaServer.exe"
#define MediaPort "5001"
#define AppNameFull "Universal Media Server"

[Setup]
AppId={{7C4F0B4E-9E2E-4C2B-9E01-A1B2C3D40001}
AppName={#AppNameFull}
AppVersion={#AppVersion}
AppVerName={#AppNameFull} {#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher=UniversalMediaServer
DefaultDirName={autopf}\UniversalMediaServer
DefaultGroupName={#AppNameFull}
OutputDir=..\installer
OutputBaseFilename=UniversalMediaServer-Setup
Compression=lzma2
SolidCompression=yes
SetupIconFile=..\public\favicon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppNameFull} {#AppVersion}
WizardStyle=modern
; قوانین فایروال و حذف نسخه قبلی نیاز به دسترسی مدیر دارند
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
MinVersion=10.0
; بستن خودکار برنامهٔ در حال اجرا (به‌جای پیام «فایل قفل است»)
CloseApplications=force
RestartApplications=no
DisableDirPage=auto
DirExistsWarning=no
UsePreviousAppDir=yes

[Files]
Source: "..\electron-release\UniversalMediaServer-win32-x64\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; ffmpeg/ffprobe برای اشتراک صفحه، تبدیل IPTV و اصلاح همخوانی صدا و تصویر لازم است
Source: "..\resources\ffmpeg.exe"; DestDir: "{app}\resources"; Flags: ignoreversion
Source: "..\resources\ffprobe.exe"; DestDir: "{app}\resources"; Flags: ignoreversion skipifsourcedoesntexist
; yt-dlp: تبدیل لینک صفحات وب به استریم مستقیم برای تلویزیون و دانلود
Source: "..\resources\yt-dlp.exe"; DestDir: "{app}\resources"; Flags: ignoreversion skipifsourcedoesntexist
; درایور صدای مجازی (virtual-audio-capturer) برای شنیدن صدای دسکتاپ روی تلویزیون
Source: "..\resources\Setup.Screen.Capturer.Recorder.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist
; ابزارهای عیب‌یابی، همراه برنامه نصب می‌شوند
Source: "..\scripts\diagnose-screenshare.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\scripts\repair-installed-screenshare.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\scripts\benchmark-deps.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\scripts\collect-report.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion skipifsourcedoesntexist

[Tasks]
Name: "virtualaudio"; Description: "نصب درایور صدای مجازی (برای شنیدن صدای دسکتاپ روی تلویزیون)"; GroupDescription: "پیش‌نیازها"
Name: "freshdeps"; Description: "پاک‌سازی ابزارهای کهنهٔ نسخه قبل (ffmpeg/yt-dlp دانلودشده) — پیشنهاد می‌شود"; GroupDescription: "پیش‌نیازها"

[Icons]
Name: "{group}\{#AppNameFull}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppNameFull}"; Filename: "{app}\{#AppExe}"
Name: "{group}\عیب‌یابی اشتراک صفحه"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoExit -File ""{app}\tools\diagnose-screenshare.ps1"""
Name: "{group}\سنجش سرعت وابستگی‌ها"; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -NoExit -File ""{app}\tools\benchmark-deps.ps1"""

[Run]
; پیش‌نیاز صدا: بدون آن اشتراک صفحه فقط تصویر دارد
Filename: "{tmp}\Setup.Screen.Capturer.Recorder.exe"; Parameters: "/S"; Flags: runhidden skipifdoesntexist; Tasks: virtualaudio; StatusMsg: "نصب درایور صدای مجازی…"; RunOnceId: "InstallVirtualAudio"
; --- قوانین فایروال: بدون این‌ها تلویزیون سرور را نمی‌بیند ---
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Universal Media Server"""; Flags: runhidden; StatusMsg: "پیکربندی فایروال ویندوز…"; RunOnceId: "ResetFirewallApp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Universal Media Server"" dir=in action=allow program=""{app}\{#AppExe}"" enable=yes profile=any"; Flags: runhidden; StatusMsg: "پیکربندی فایروال ویندوز…"; RunOnceId: "AddFirewallApp"
; ffmpeg هم مستقیم استریم می‌فرستد؛ بدون اجازه، تلویزیون تصویر سیاه می‌گیرد
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UMS ffmpeg"""; Flags: runhidden; RunOnceId: "ResetFirewallFfmpeg"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""UMS ffmpeg"" dir=in action=allow program=""{app}\resources\ffmpeg.exe"" enable=yes profile=any"; Flags: runhidden; RunOnceId: "AddFirewallFfmpeg"
; پورت HTTP سرور رسانه (پیش‌فرض 5001)
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UMS HTTP {#MediaPort}"""; Flags: runhidden; RunOnceId: "ResetFirewallHttp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""UMS HTTP {#MediaPort}"" dir=in action=allow protocol=TCP localport={#MediaPort} enable=yes profile=any"; Flags: runhidden; RunOnceId: "AddFirewallHttp"
; کشف SSDP / UPnP روی UDP 1900
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UMS SSDP 1900"""; Flags: runhidden; RunOnceId: "ResetFirewallSsdp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""UMS SSDP 1900"" dir=in action=allow protocol=UDP localport=1900 enable=yes profile=any"; Flags: runhidden

Filename: "{app}\{#AppExe}"; Description: "اجرای برنامه"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Universal Media Server"""; Flags: runhidden; RunOnceId: "DelRuleApp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UMS ffmpeg"""; Flags: runhidden; RunOnceId: "DelRuleFfmpeg"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UMS HTTP {#MediaPort}"""; Flags: runhidden; RunOnceId: "DelRuleHttp"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""UMS SSDP 1900"""; Flags: runhidden; RunOnceId: "DelRuleSsdp"

[Code]
const
  UNINST_KEY = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{7C4F0B4E-9E2E-4C2B-9E01-A1B2C3D40001}_is1';

{ محل نصب/حذف نسخهٔ قبلی را در هر ۴ ریشهٔ ممکن جست‌وجو می‌کند }
function ReadPrevValue(ValueName: string; var Value: string): Boolean;
begin
  Result :=
    RegQueryStringValue(HKLM64, UNINST_KEY, ValueName, Value) or
    RegQueryStringValue(HKLM32, UNINST_KEY, ValueName, Value) or
    RegQueryStringValue(HKCU64, UNINST_KEY, ValueName, Value) or
    RegQueryStringValue(HKCU32, UNINST_KEY, ValueName, Value);
end;

procedure KillRunningApp;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppExe} /T', '',
       SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ حذف بی‌صدای نسخهٔ قبل، هر نسخه‌ای که باشد }
procedure UninstallPrevious;
var
  Cmd, Params: string;
  Code: Integer;
begin
  if not ReadPrevValue('UninstallString', Cmd) then
    Exit;
  Cmd := RemoveQuotes(Cmd);
  if not FileExists(Cmd) then
    Exit;
  Params := '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-';
  if Exec(Cmd, Params, '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Sleep(1500);
end;

{ باقی‌مانده‌های نسخهٔ قدیمی که باعث ناهماهنگی وابستگی‌ها می‌شوند }
procedure CleanLegacyLeftovers;
var
  OldDir: string;
begin
  { نصب‌های قدیمیِ per-user که در LocalAppData مانده‌اند }
  OldDir := ExpandConstant('{localappdata}\Programs\UniversalMediaServer');
  if DirExists(OldDir) and (CompareText(OldDir, ExpandConstant('{app}')) <> 0) then
    DelTree(OldDir, True, True, True);

  { کش Electron نسخهٔ قبل — با باینری جدید سازگار نیست }
  DelTree(ExpandConstant('{userappdata}\UniversalMediaServer\Cache'), True, True, True);
  DelTree(ExpandConstant('{userappdata}\UniversalMediaServer\Code Cache'), True, True, True);
  DelTree(ExpandConstant('{userappdata}\UniversalMediaServer\GPUCache'), True, True, True);
  DelTree(ExpandConstant('{userappdata}\Universal Media Server\GPUCache'), True, True, True);
end;

{ ابزارهای دانلودشدهٔ نسخهٔ قبل (ffmpeg/yt-dlp کهنه) — دلیل رایج تصویر سیاه }
procedure CleanStaleTools;
begin
  DeleteFile(ExpandConstant('{userappdata}\UniversalMediaServer\bin\ffmpeg.exe'));
  DeleteFile(ExpandConstant('{userappdata}\UniversalMediaServer\bin\ffprobe.exe'));
  DeleteFile(ExpandConstant('{userappdata}\UniversalMediaServer\bin\yt-dlp.exe'));
  DeleteFile(ExpandConstant('{userappdata}\Universal Media Server\bin\ffmpeg.exe'));
  DeleteFile(ExpandConstant('{userappdata}\Universal Media Server\bin\yt-dlp.exe'));
end;

function InitializeSetup(): Boolean;
begin
  KillRunningApp;
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
  begin
    KillRunningApp;
    UninstallPrevious;
    CleanLegacyLeftovers;
    if WizardIsTaskSelected('freshdeps') then
      CleanStaleTools;
  end;
end;

{ در حذف کامل، فقط باینری‌های کمکی پاک می‌شوند و تنظیمات کاربر می‌ماند }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DelTree(ExpandConstant('{userappdata}\UniversalMediaServer\bin'), True, True, True);
    DelTree(ExpandConstant('{userappdata}\UniversalMediaServer\Cache'), True, True, True);
    DelTree(ExpandConstant('{userappdata}\UniversalMediaServer\GPUCache'), True, True, True);
  end;
end;
