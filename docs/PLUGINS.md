# ساخت افزونه برای Universal Media Server

افزونه‌ها در پوشه‌ی زیر نصب می‌شوند و با هر ریستارت برنامه بارگذاری می‌گردند:

```
%APPDATA%\universal-media-server\plugins\<plugin-id>\
```

ساختار حداقلی یک افزونه:

```
my-plugin/
  plugin.json
  index.cjs
```

`plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "افزونه نمونه",
  "version": "1.0.0",
  "description": "یک قابلیت جدید بدون آپدیت کل نرم‌افزار",
  "main": "index.cjs"
}
```

`index.cjs` — یک ماژول CommonJS با تابع `activate(host)`:

```js
module.exports = {
  activate(host) {
    host.log("plugin started, app version:", host.version);

    // ثبت یک کانال IPC اختصاصی برای این افزونه
    host.ipcMain.handle("plugin:my-plugin:hello", () => ({ ok: true }));

    // افزودن مدیا به مخزن برنامه
    // host.addMedia({ title: "...", url: "..." });

    // ارسال رویداد به رابط کاربری
    // host.emit({ type: "plugin", id: "my-plugin", message: "..." });
  },
  deactivate() {
    // آزادسازی منابع
  },
};
```

امکاناتی که در `host` در اختیار افزونه است: `version`, `paths`, `ipcMain`, `emit`,
`addMedia`, `mediaStatus`, `screen`, `tools`, `log`.

نصب: صفحه‌ی «افزونه‌ها و وابستگی‌ها» → دکمه «نصب افزونه (zip یا پوشه)».
هر افزونه را می‌توان بدون حذف، فعال یا غیرفعال کرد.

## افزونه نمونه: «شنود صدا و ترجمه فارسی»

سورس در `plugins-src/live-listen/` و بسته آماده در `public/live-listen-plugin.zip`
(از صفحه «افزونه‌ها و وابستگی‌ها» با دکمه «افزونه نمونه (ZIP)» قابل دانلود است).

ساختار: `plugin.json` + `index.cjs` (پروسه اصلی) + `window.html` (رابط کاربری پنجره).
تکنیک‌های به‌کاررفته که در افزونه‌های بعدی هم استفاده کنید:

- ساخت پنجره مستقل با `BrowserWindow` و `loadFile` (contextIsolation روشن، nodeIntegration خاموش)
- ثبت کانال IPC با پیشوند `plugin:<id>:` برای جلوگیری از تداخل
- `deactivate()` که پنجره و کانال‌ها را آزاد می‌کند
- استفاده از `host.emit` برای اطلاع‌رسانی به رابط کاربری برنامه
