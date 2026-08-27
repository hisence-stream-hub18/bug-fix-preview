# ساخت APK اندروید — یک دستور

اسکریپت ساخت، Node.js، JDK 21، Android SDK و پکیج‌های Capacitor را بدون prompt
بررسی و در صورت نیاز نصب می‌کند. پروژه ابتدا در یک مسیر کوتاه ASCII ساخته می‌شود
تا فاصله یا حروف فارسی مسیر اصلی باعث خطای Vite/Rolldown نشوند.

## ساخت Debug APK

این برنامه SSR است؛ بنابراین نشانی برنامه Windows در شبکه را بدهید:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android.ps1" -AppUrl "http://192.168.1.10:5001"
```

خروجی در `installer\UniversalMediaServer-1.0.0-debug.apk` قرار می‌گیرد.

## ساخت و امضای Release APK

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\build-android.ps1" -AppUrl "http://192.168.1.10:5001" -Release -Sign
```

فایل `release.keystore` در ریشه پروژه اصلی نگهداری و در Git نادیده گرفته می‌شود.
برای تعیین رمز اختصاصی بدون prompt، متغیر `UMS_KEYSTORE_PASSWORD` را پیش از ساخت
تنظیم کنید؛ رمز در log چاپ نمی‌شود. برای نصب روی گوشی متصل، `-Install` را اضافه کنید.

## رفتار خودکار

- Node.js LTS، npm، JDK 21، Android command-line tools و platform-tools آماده می‌شوند.
- platform و build-tools متناسب با Gradle نصب و licenseها خودکار پذیرفته می‌شوند.
- npm با lockfile و optional dependencyها اجرا می‌شود؛ bindingهای Lightning CSS و
  Tailwind Oxide آزمایش و در صورت خرابی بدون حذف lockfile ترمیم می‌شوند.
- Gradle با `--no-daemon --console=plain` اجرا می‌شود و منتظر ورودی نمی‌ماند.
- APK پس از بررسی وجود و، در حالت امضاشده، تأیید signature به `installer` منتقل می‌شود.

## نکته مهم PowerShell

متن `PS C:\...>` اعلان PowerShell است؛ آن را تایپ یا paste نکنید. فقط بخش بعد از
علامت `>` را وارد کنید. پس از `cd "D:\مسیر پروژه"` Enter بزنید، یا دو فرمان را
با `;` جدا کنید.
