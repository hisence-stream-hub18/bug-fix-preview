# بروزرسانی هوشمند + انتخاب و عیب‌یابی وابستگی‌ها

این سند سه چیز را پوشش می‌دهد:

1. آنچه در بیلد ویندوز/اندروید تغییر کرد (نصب هوشمند روی نسخهٔ قبلی)
2. سنجش وابستگی‌ها (`ffmpeg.exe` / `yt-dlp.exe` / `Setup.Screen.Capturer.Recorder.exe`) روی سیستم شما
3. عیب‌یابی حالت «دکمهٔ اشتراک صفحه کار می‌کند اما تلویزیون تصویر سیاه نشان می‌دهد»

---

## ۱) بیلد ویندوز — چه چیزی کامل شد

`scripts/build-windows.ps1`

| مرحله | جدید |
| --- | --- |
| 0/7 | نسخه از `package.json` خوانده می‌شود (یا `-Version 1.2.0`) و به بستهٔ Electron و `setup.exe` منتقل می‌شود |
| 3/7 | علاوه بر `ffmpeg.exe`، **`ffprobe.exe`** هم دانلود می‌شود (بدون آن تشخیص کدک/کیفیت استریم ناقص است) |
| 3/7 | سلامت ffmpeg بررسی می‌شود: وجود `gdigrab` (تصویر دسکتاپ)، `libx264`، `dshow` (صدا). ffmpeg بدون این‌ها = تصویر سیاه |
| 5/7 | **بازبینی کامل بودن بسته**: هر فایل `electron/*.cjs` (DLNA، SSDP، Chromecast، دانلودر، HLS remux، زیرنویس، پلاگین‌ها، پنل ریموت، …) و `.output/server`، `.output/public`، `plugins-src`، `extension`، `resources` باید در بسته باشند؛ وگرنه بیلد با خطا متوقف می‌شود |
| 6-7/7 | `setup.exe` با نسخه ساخته و یک کپی نسخه‌دار (`...-Setup-1.0.0.exe`) نگه داشته می‌شود |
| فایروال | قانون جدید برای `resources\ffmpeg.exe` هم اضافه شد (ffmpeg خودش هم استریم می‌فرستد) |

سوئیچ‌ها: `-SkipInstaller`، `-RefreshDeps` (دانلود تازهٔ وابستگی‌ها)، `-Version x.y.z`.

## ۲) `setup.exe` هوشمند شد (`scripts/installer.iss`)

- `AppId` ثابت + `AppVersion` → ویندوز نصب را «بروزرسانی» می‌شناسد، نه نصب دوم.
- اگر برنامه باز باشد بسته می‌شود (`taskkill` + `CloseApplications=force`).
- **نسخهٔ قبلی از رجیستری پیدا و بی‌صدا حذف می‌شود** (هر ۴ ریشه: HKLM/HKCU × 32/64).
- باقی‌مانده‌های نسخهٔ قدیمی پاک می‌شوند: نصب per-user در `%LOCALAPPDATA%\Programs\UniversalMediaServer`، کش‌های Electron (`Cache`, `Code Cache`, `GPUCache`).
- گزینهٔ «پاک‌سازی ابزارهای کهنه» → `ffmpeg/ffprobe/yt-dlp` دانلودشدهٔ نسخهٔ قبل در `%APPDATA%\UniversalMediaServer\bin` حذف می‌شود. **این مهم‌ترین علت ناهماهنگی وابستگی بین نسخه‌ها است.**
- تنظیمات و کتابخانهٔ کاربر دست نمی‌خورد.
- ابزارهای عیب‌یابی داخل `{app}\tools` نصب و در Start Menu شورتکات می‌گیرند.

## ۳) APK هوشمند شد (`scripts/build-android.ps1`)

- `versionName` از `package.json` و `versionCode` عددی صعودی (`major*10000+minor*100+patch`) در `android/app/build.gradle` نوشته می‌شود — بدون این، اندروید بروزرسانی را رد می‌کند.
- `-Sign` یک `release.keystore` **پایدار** می‌سازد/استفاده می‌کند (کلید ثابت = بروزرسانی روی نسخهٔ قبل ممکن).
- `-Install`: اول `adb install -r` (بروزرسانی با حفظ داده). اگر امضا/نسخه ناسازگار بود، خودکار `adb uninstall` و نصب تازه.
- `-Clean` برای پاک‌سازی خروجی و کش gradle.
- خروجی نسخه‌دار در `installer\UniversalMediaServer-<version>.apk`.

مثال کامل:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1 -Version 1.1.0 -RefreshDeps
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1 -Version 1.1.0 -Release -Sign -Install -AppUrl "http://192.168.1.10:8080"
```

---

## ۴) کدام نسخهٔ وابستگی برای سیستم شما بهتر است؟

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\benchmark-deps.ps1 -Download
# و برای اعمال بهترین گزینه روی برنامهٔ نصب‌شده (با Run as administrator):
powershell -ExecutionPolicy Bypass -File .\scripts\benchmark-deps.ps1 -Apply
```

این اسکریپت:

1. CPU/RAM/GPU را می‌خواند و می‌گوید برنامه چه پروفایلی انتخاب می‌کند (ضعیف/متوسط/قوی).
2. همهٔ `ffmpeg.exe` های سیستم را پیدا می‌کند (بستهٔ برنامه، `%APPDATA%\...\bin`، PATH) و با `-Download` چند بیلد رایج را هم می‌آورد: gyan essentials، gyan full، 7.1، BtbN n6.1.
3. برای هر کدام یک **ضبط واقعی دسکتاپ** با همان زنجیرهٔ برنامه (`gdigrab → h264 → mpegts`) اجرا می‌کند و `speed`، `fps` و درصد CPU را گزارش می‌دهد.
4. انکودرهای سخت‌افزاری `h264_nvenc / h264_qsv / h264_amf` را **عملاً** تست می‌کند (لیست شدن کافی نیست؛ درایور ممکن است باز نکند).
5. `yt-dlp` موجود را با آخرین نسخهٔ GitHub مقایسه می‌کند.
6. دستگاه صدای loopback (`virtual-audio-capturer` / `Stereo Mix`) را بررسی می‌کند.

**تفسیر نتیجه:** `speed ≥ 1.0x` یعنی سیستم پابه‌پای زمان واقعی جلو می‌رود (تصویر روان روی تلویزیون). `speed < 1` یعنی عقب‌افتادگی، پرش و در نهایت تصویر یخ‌زده. بین دو ffmpeg با speed برابر، آن که CPU کمتری می‌گیرد را بردارید.

---

## ۵) عیب‌یابی: دکمهٔ اشتراک صفحه کار می‌کند، ولی تلویزیون صفحهٔ سیاه نشان می‌دهد

«دکمه کار می‌کند» یعنی برنامه، تلویزیون را پیدا کرده و دستور `AVTransport → Play` را فرستاده و تلویزیون پلیرش را باز کرده. صفحهٔ سیاه یعنی **استریم به تلویزیون نمی‌رسد یا تلویزیون آن را باز نمی‌کند**. به همین ترتیب جلو بروید:

**گام ۱ — ffmpeg در برنامهٔ نصب‌شده سالم است؟**

```powershell
cd "<مسیر نصب>\UniversalMediaServer"
powershell -ExecutionPolicy Bypass -File .\tools\diagnose-screenshare.ps1
```

اگر «ffmpeg پیدا نشد» یا `gdigrab` خطا داد، مشکل همین‌جاست. تعمیر:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\repair-installed-screenshare.ps1 -InstallPath "<مسیر نصب>\UniversalMediaServer"
```

**گام ۲ — دو نسخهٔ ffmpeg با هم قاطی نشده‌اند؟** (شایع‌ترین ناهماهنگی بعد از چند بار بروزرسانی)

برنامه به این ترتیب ffmpeg را برمی‌دارد: `resources` کنار exe → `resources\app\resources` → پوشهٔ کاربر `%APPDATA%\UniversalMediaServer\bin` → PATH. پس یک ffmpeg کهنه در `bin` یا در PATH می‌تواند به‌جای نسخهٔ بستهٔ جدید استفاده شود:

```powershell
Get-ChildItem "$env:APPDATA\UniversalMediaServer\bin" -Filter *.exe |
  ForEach-Object { "{0}`t{1}" -f $_.FullName, (& $_.FullName -version 2>&1 | Select-Object -First 1) }
Get-Command ffmpeg -All -ErrorAction SilentlyContinue | Select-Object Source
```

هر نسخه‌ای که با `resources\ffmpeg.exe` برنامه یکی نیست را پاک کنید (یا `benchmark-deps.ps1 -Apply` را اجرا کنید که همین کار را می‌کند).

**گام ۳ — درایور صدای مجازی نصف‌ونیمه نصب است؟**
ffmpeg وقتی دستگاه صدای مشخص‌شده را نتواند باز کند، **کل** استریم (تصویر+صدا) را رد می‌کند → تلویزیون سیاه می‌ماند. تست:

```powershell
& "<مسیر نصب>\UniversalMediaServer\resources\ffmpeg.exe" -list_devices true -f dshow -i dummy
```

اگر `virtual-audio-capturer` نبود: `Setup.Screen.Capturer.Recorder.exe` را دوباره نصب کنید (نسخهٔ 0.13.3، **Run as administrator**) یا در خود برنامه اشتراک صفحه را «بدون صدا» شروع کنید. اگر بدون صدا تصویر آمد، مشکل ۱۰۰٪ همین بوده است.

**گام ۴ — انکودر سخت‌افزاری درایور را باز نمی‌کند؟**
`nvenc/qsv/amf` گاهی لیست می‌شود ولی هنگام اجرا خطا می‌دهد و پنجرهٔ پلیر تلویزیون سیاه می‌ماند. `benchmark-deps.ps1` این را نشان می‌دهد؛ اگر ستون انکودر سخت‌افزاری «کار نکرد» بود، در برنامه **انکود نرم‌افزاری (libx264)** را روشن کنید.

**گام ۵ — فایروال / شبکه:**
تلویزیون باید به پورت TCP سرور (پیش‌فرض 5001) برسد. اگر بعد از بروزرسانی مسیر نصب عوض شده باشد، قانون فایروال قدیمی به exe قدیمی اشاره می‌کند و بی‌اثر است — `setup.exe` جدید قوانین را حذف و از نو می‌سازد. بررسی دستی:

```powershell
netsh advfirewall firewall show rule name="Universal Media Server"
netsh advfirewall firewall show rule name="UMS ffmpeg"
Test-NetConnection -ComputerName <IP-تلویزیون> -Port 5001   # از سمت شبکه
```

همچنین شبکه باید **Private** باشد نه Public، و کامپیوتر و تلویزیون روی یک زیرشبکه (بدون AP isolation در روتر).

**گام ۶ — سازگاری خودِ تلویزیون:**
اگر ffmpeg سالم بود، دستگاه صدا سالم بود و شبکه باز بود ولی هنوز سیاه است، تلویزیون پروفایل DLNA فرستاده‌شده را نمی‌پسندد. در برنامه این‌ها را امتحان کنید: رزولوشن ۱۲۸۰→۹۶۰، fps ۱۵→۱۲، انکود نرم‌افزاری، و در صورت وجود، حالت پخش Chromecast/HLS به‌جای DLNA خام.

**گزارش کامل برای بررسی بعدی:**

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\collect-report.ps1
```
