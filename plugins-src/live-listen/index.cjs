// نمونه‌ی افزونه برای Universal Media Server
// ---------------------------------------------------------------------------
// این افزونه در پروسه‌ی اصلی (main) اجرا می‌شود و یک پنجره‌ی مستقل باز می‌کند
// که در آن صدای میکروفون/استریو‌میکس شنیده، تایپ و به فارسی ترجمه می‌شود.
//
// تکنیک کلی ساخت افزونه:
//   1) plugin.json  → شناسه، نام، نسخه و فایل ورودی
//   2) index.cjs    → یک ماژول CommonJS با activate(host) و deactivate()
//   3) host         → { version, paths, ipcMain, emit, addMedia, tools, log }
//   4) هر UI اضافی را با BrowserWindow خودتان بسازید (require("electron"))
//   5) کانال‌های IPC را با پیشوند plugin:<id>: نام‌گذاری کنید تا تداخل نشود.

const path = require("node:path");
const { BrowserWindow, ipcMain, app, session } = require("electron");

const CH_OPEN = "plugin:live-listen:open";
const CH_CLOSE = "plugin:live-listen:close";

let win = null;
let hostApi = null;

function createWindow() {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }
  win = new BrowserWindow({
    width: 460,
    height: 560,
    minWidth: 340,
    minHeight: 320,
    title: "شنود صدا",
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#0b1020",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // برای Web Speech API و درخواست ترجمه
      webSecurity: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.on("closed", () => {
    win = null;
  });
  void win.loadFile(path.join(__dirname, "window.html"));
  return win;
}

module.exports = {
  activate(host) {
    hostApi = host || {};
    hostApi.log?.("live-listen plugin activated, app version:", hostApi.version);

    // اجازه‌ی دسترسی به میکروفون برای پنجره‌ی افزونه
    try {
      session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
        if (permission === "media" || permission === "audioCapture") return cb(true);
        return cb(true);
      });
    } catch {
      /* در برخی نسخه‌ها لازم نیست */
    }

    // کانال‌های اختصاصی افزونه — از رابط کاربری یا افزونه‌های دیگر قابل صداست
    try {
      ipcMain.removeHandler(CH_OPEN);
      ipcMain.removeHandler(CH_CLOSE);
    } catch {
      /* ثبت نشده بود */
    }
    ipcMain.handle(CH_OPEN, () => {
      createWindow();
      return { ok: true };
    });
    ipcMain.handle(CH_CLOSE, () => {
      if (win && !win.isDestroyed()) win.close();
      return { ok: true };
    });

    // پنجره را بلافاصله (پس از آماده‌شدن اپ) باز می‌کنیم تا نمونه قابل مشاهده باشد.
    if (app.isReady()) createWindow();
    else app.once("ready", () => createWindow());

    hostApi.emit?.({
      type: "plugin",
      id: "live-listen",
      message: "افزونه شنود صدا فعال شد",
    });
  },

  deactivate() {
    try {
      ipcMain.removeHandler(CH_OPEN);
      ipcMain.removeHandler(CH_CLOSE);
    } catch {
      /* ignore */
    }
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  },
};
