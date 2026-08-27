# ساخت خروجی ویندوز (EXE + Setup) — راهنمای گام‌به‌گام

هدف: از سورس پروژه به `UniversalMediaServer.exe` و سپس فایل نصبی
`installer\UniversalMediaServer-Setup.exe` برسیم. همهٔ فرمان‌ها در **PowerShell**
و در **ریشهٔ پروژه** اجرا می‌شوند.

---

## 1) ساخت تک‌دستوری (پیشنهادی)

از هر مسیری، حتی مسیری دارای فاصله یا حروف فارسی، این فرمان را اجرا کنید:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\build-windows.ps1"
```

ساخت همیشه در همان مسیر پروژه انجام می‌شود و هیچ کپی یا انتقالی به پوشهٔ دیگر
صورت نمی‌گیرد؛ برای ابزارهای native فقط نام کوتاه 8.3 همان پوشه استفاده می‌شود تا
مسیرهایی مانند `New folder16` باعث خطای `UNLOADABLE_DEPENDENCY` یا `No such file`
در Rolldown/Vite نشوند. Node.js LTS، npm، bindingهای native
Lightning CSS/Tailwind، FFmpeg/FFprobe، yt-dlp، Electron و Inno Setup نیز بدون
prompt نصب یا ترمیم می‌شوند. `package-lock.json` هیچ‌گاه حذف نمی‌شود.

خروجی نهایی به مسیر اصلی برمی‌گردد:

```text
installer\UniversalMediaServer-Setup.exe
installer\UniversalMediaServer-Setup-1.0.0.exe
```

> متن `PS C:\...>` فقط اعلان PowerShell است و نباید دوباره تایپ یا paste شود.
> پس از `cd "D:\مسیر پروژه"` کلید Enter بزنید، یا دو فرمان را با `;` جدا کنید.
> چسباندن `npm` بلافاصله بعد از کوتیشن مسیر خطاست.

## 2) پیش‌نیازها (در صورت شکست نصب خودکار)

| مورد | نسخه | بررسی | لینک |
| --- | --- | --- | --- |
| Windows | 10 یا 11 (x64) | `winver` | — |
| Node.js LTS | 18 یا بالاتر (پیشنهاد 20/22) | `node --version` | nodejs.org |
| npm | همراه Node | `npm --version` | — |
| Git (اختیاری) | هر نسخه | `git --version` | git-scm.com |
| Inno Setup | 6.x | `iscc /?` | jrsoftware.org/isdl.php |
| ffmpeg (اختیاری) | هر نسخه | `ffmpeg -version` | فقط برای «اشتراک صفحه دسکتاپ» |

اگر `iscc` شناخته نشد، مسیرش را به PATH همان پنجره اضافه کنید:

```powershell
$env:Path += ";C:\Program Files (x86)\Inno Setup 6"
iscc /?
```

اجازهٔ اجرای اسکریپت‌ها (فقط همین پنجره، امن‌ترین حالت):

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

---

## 3) گرفتن سورس

```powershell
cd $HOME\Desktop
git clone https://github.com/hisence-stream-hub3/media-stream-hub.git
cd screen-share-speed-adjuster
```

مسیر اصلی می‌تواند فاصله یا حروف فارسی داشته باشد؛ bootstrap مشترک ساخت را در
مسیر امن انجام می‌دهد و artifact نهایی را بازمی‌گرداند.

---

## 4) گزینه‌های اسکریپت

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

گزینه `-Version 1.2.0` نسخه، `-RefreshDeps` دانلود ابزارها و `-SkipInstaller`
فقط بسته Electron را کنترل می‌کنند. تمام فرمان‌های npm/winget/installer بدون
ورودی تعاملی اجرا می‌شوند و شکست هر وابستگی ضروری exit code ناموفق می‌دهد.

خروجی مورد انتظار:

```
electron-release\UniversalMediaServer-win32-x64\UniversalMediaServer.exe
```

تست سریع قبل از ساخت Setup:

```powershell
.\electron-release\UniversalMediaServer-win32-x64\UniversalMediaServer.exe
```

---

## 5) مسیر دستی (اگر خواستید مرحله‌به‌مرحله ببینید)

```powershell
# 4.1 بیلد وب — پریست node-server الزامی است
$env:NITRO_PRESET = "node-server"
npm run build

# 4.2 تأیید وجود باندل سرور (یکی از این دو باید باشد)
Test-Path .output\server\index.mjs
Test-Path dist\server\index.mjs

# 4.3 بسته‌بندی Electron (باینری Electron 37.4.0 دانلود می‌شود، ~100MB)
node .\scripts\package-electron.mjs --platform win32 --arch x64
```

---

## 6) ساخت فایل نصبی با Inno Setup

```powershell
iscc scripts\installer.iss
```

خروجی:

```
installer\UniversalMediaServer-Setup.exe
```

این نصب‌کننده به‌صورت خودکار (نیاز به دسترسی Administrator دارد):

- برنامه را در `C:\Program Files\UniversalMediaServer` نصب می‌کند
- شورتکات منوی استارت و دسکتاپ می‌سازد
- سه قانون فایروال اضافه می‌کند: خود برنامه، `TCP 5001` (HTTP رسانه)،
  `UDP 1900` (کشف SSDP/UPnP) — بدون این‌ها تلویزیون سرور را نمی‌بیند
- در حذف برنامه، همان قوانین فایروال را پاک می‌کند

---

## 6) بعد از نصب — چک‌لیست عملکرد

1. برنامه را اجرا کنید؛ در «تنظیمات» پورت (پیش‌فرض 5001) و IP شبکه را ببینید.
2. تلویزیون را روشن و روی **همان** شبکه/Wi‑Fi قرار دهید.
3. «دستگاه‌های شبکه» → «جست‌وجو»؛ نام واقعی تلویزیون باید ظاهر شود.
4. اگر چیزی پیدا نشد: در Windows Defender Firewall شبکه را روی **Private**
   بگذارید و مطمئن شوید سرویس «SSDP Discovery» فعال است:

```powershell
Get-Service SSDPSRV, upnphost | Select-Object Name, Status
Start-Service SSDPSRV
```

5. تست دستی سرور از خود کامپیوتر (باید 200 یا 206 برگردد):

```powershell
(Invoke-WebRequest "http://localhost:5001/desc.xml" -UseBasicParsing).StatusCode
```

---

## 7) خطاهای رایج و رفع سریع

| پیام / نشانه | علت | راه‌حل |
| --- | --- | --- |
| `Cannot resolve entry module ...vite.config.ts` | نسخهٔ قدیمی پروژه یا اجرای مستقیم `vite build` با config loader پیش‌فرض | نسخهٔ جدید را دریافت کنید و فقط `build-windows.ps1` را اجرا کنید؛ فرمان build باید شامل `--configLoader runner` باشد |
| `Server bundle not found in .output/server or dist/server` | بیلد بدون `NITRO_PRESET=node-server` انجام شده | `$env:NITRO_PRESET="node-server"` سپس `npm run build` |
| `@electron/packager is not installed` | نصب پکیج‌ها کامل نشده | `npm install` |
| دانلود Electron گیر می‌کند / timeout | شبکه یا نیاز به میرور | `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"` و تکرار مرحله 4.3 |
| `iscc : The term 'iscc' is not recognized` | Inno Setup در PATH نیست | `$env:Path += ";C:\Program Files (x86)\Inno Setup 6"` |
| `running scripts is disabled on this system` | ExecutionPolicy | `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
| پنجرهٔ برنامه سفید می‌ماند | باندل ناقص | پوشهٔ `electron-release` را پاک و مرحله 3 را از نو اجرا کنید |
| تلویزیون پیدا نمی‌شود | فایروال / شبکهٔ Public / VPN | قوانین فایروال (مرحله 5)، شبکه Private، VPN و شبکهٔ مهمان را خاموش کنید |
| «فرمت پشتیبانی نمی‌شود» روی تلویزیون | لینک صفحه بود نه ویدیوی مستقیم | قبل از پخش، برنامه لینک را resolve می‌کند؛ اگر ادامه داشت گزینهٔ HLS transcode را در تنظیمات فعال کنید |
| «اشتراک صفحه دسکتاپ» کار نمی‌کند | ffmpeg نصب نیست | ffmpeg را نصب و به PATH اضافه کنید |

---

## 8) پاک‌سازی و ساخت مجدد از صفر

```powershell
Remove-Item -Recurse -Force node_modules, .output, dist, electron-release, installer -ErrorAction SilentlyContinue
npm install
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
iscc scripts\installer.iss
```

---

## 9) ویندوز 7/8 (فعلاً پشتیبانی نمی‌شود)

Electron 37 فقط ویندوز 10/11 را پشتیبانی می‌کند. برای ویندوز 7/8 باید
`electronVersion` در `scripts/package-electron.mjs` به `22.3.27` تغییر کند و
همهٔ رنگ‌های `oklch` در `src/styles.css` به hex/rgb تبدیل شوند (Chromium 108
هنوز `oklch` را نمی‌شناسد). این کار یک تغییر جداگانه است.

## به‌روزرسانی نسخه جدید (پخش، همخوانی صدا/تصویر، ترجمه زیرنویس، VLC)

### ساخت ستاپ ویندوز (setup.exe)

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
# اسکریپت خودش iscc را هم اجرا می‌کند؛ در صورت نبود Inno Setup:
iscc scripts\installer.iss
```

نکته‌ها:

- وجود `resources\ffmpeg.exe` اجباری است؛ اگر نباشد اسکریپت با خطا متوقف می‌شود
  (بدون ffmpeg نه اشتراک صفحه کار می‌کند، نه تبدیل IPTV، نه اصلاح همخوانی صدا و تصویر).
- خروجی برنامه: `electron-release\UniversalMediaServer-win32-x64\UniversalMediaServer.exe`
- خروجی نصب‌کننده: `installer\UniversalMediaServer-Setup.exe`
- فایل `ffmpeg.exe` توسط installer داخل `{app}\resources` کپی می‌شود.

### ساخت APK اندروید

```powershell
# نسخه دیباگ (قابل نصب مستقیم روی گوشی)
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1

# نسخه ریلیز (نیاز به امضا)
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1 -Release
```

### قابلیت‌های جدید

- **همخوانی صدا و تصویر**: اسلایدر ±۳ ثانیه در «تنظیمات» و داخل پلیر. مقدار مثبت صدا را
  با تأخیر پخش می‌کند و مقدار منفی تصویر را عقب می‌اندازد. روی استریم ارسالی به تلویزیون
  با `-itsoffset` و `aresample=async` در ffmpeg اعمال می‌شود (رفع مشکل تلویزیون هایسنس).
- **حالت عملکرد سبک**: تشخیص خودکار سیستم/گوشی ضعیف؛ کاهش بافر، حذف بلور و انیمیشن و
  کاهش نرخ پرس‌وجوی شبکه.
- **پشتیبانی کامل فرمت‌ها در پلیر**: MP4/MKV/AVI/MOV/WebM (بومی)، HLS (hls.js)،
  MPEG-DASH (dash.js)، MPEG-TS/M2TS/FLV (mpegts.js)، یوتیوب (امبد رسمی).
- **ترجمه آنلاین زیرنویس**: خواندن SRT/VTT/ASS، تشخیص خودکار زبان و ترجمه به فارسی
  با کش محلی.
- **دکمه پخش در VLC**: در پلیر و کنار هر لینک ذخیره‌شده/مستقیم؛ روی ویندوز vlc.exe و
  روی اندروید از طریق intent مخصوص VLC.

### تعمیر نسخه نصب‌شده اگر اشتراک صفحه دسکتاپ کار نکرد

اگر بعد از نصب، دکمه «اشتراک صفحه دسکتاپ» خطای ffmpeg/DirectShow داد یا تصویر به تلویزیون نرفت، از روی سورس پروژه این دستور را اجرا کنید:

```powershell
cd "D:\lavable\New folder (10)\stream-weaver-helper-main"
powershell -ExecutionPolicy Bypass -File .\scripts\repair-installed-screenshare.ps1 -InstallPath "D:\نرم افزار های نصب شده سیستم\Universal Media Serverman\UniversalMediaServer"
```

این اسکریپت `ffmpeg.exe` سالم را هم کنار برنامه نصب‌شده و هم داخل `%APPDATA%\UniversalMediaServer\bin` می‌گذارد، نصب‌کننده صدای مجازی را اجرا می‌کند، دستگاه‌های صدای DirectShow را نشان می‌دهد و یک تست کوتاه از گرفتن تصویر دسکتاپ انجام می‌دهد.

---

## بروزرسانی هوشمند و وابستگی‌ها

نصب روی نسخهٔ قبلی، سنجش سرعت `ffmpeg`/`yt-dlp` و عیب‌یابی تصویر سیاه تلویزیون در [UPGRADE-AND-DEPS.md](./UPGRADE-AND-DEPS.md) توضیح داده شده است.
