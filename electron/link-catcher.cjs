// Floating "link catcher" — a tiny always-on-top popup, like a download manager.
// It watches the Windows/Linux clipboard while any browser is open; as soon as a
// video/stream link is copied, a small bubble appears offering to add the link to
// the app library, download it, or cast it straight to the TV.
//
// Clipboard watching is used instead of a browser extension because it works with
// every installed browser (Chrome, Edge, Firefox…) without any install step.

const { BrowserWindow, clipboard, screen: eScreen } = require("electron");

const MEDIA_RE =
  /\.(m3u8|mpd|mp4|mkv|webm|avi|mov|flv|ts|m2ts|wmv|mp3|aac|m4a)(\?|$)|youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d+|aparat\.com\/v\//i;

const state = {
  timer: null,
  last: "",
  win: null,
  enabled: true,
  onAction: null,
};

function isMediaLink(text) {
  if (!text || text.length > 2000) return false;
  if (!/^https?:\/\//i.test(text.trim())) return false;
  return MEDIA_RE.test(text.trim());
}

function shortName(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname);
    return last.slice(0, 60) || u.hostname;
  } catch {
    return url.slice(0, 60);
  }
}

function popupHtml(url) {
  const name = shortName(url).replace(/[<>&]/g, "");
  return `<html dir="rtl"><body style="margin:0;font-family:Segoe UI,Tahoma,sans-serif;background:#0d1530;color:#e9edff;border:1px solid #f3c96955;border-radius:14px;overflow:hidden">
  <div style="padding:10px 12px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="width:8px;height:8px;border-radius:99px;background:#f3c969;display:inline-block"></span>
      <strong style="font-size:12px;color:#f3c969">لینک ویدیو شناسایی شد</strong>
      <a href="ums://close" style="margin-inline-start:auto;color:#7c88b5;text-decoration:none;font-size:14px">✕</a>
    </div>
    <div style="font-size:11px;color:#aab3d6;margin-top:6px;direction:ltr;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
    <div style="display:flex;gap:6px;margin-top:10px">
      <a href="ums://cast" style="flex:1;text-align:center;background:#f3c969;color:#0d1530;font-size:11px;font-weight:700;padding:6px 4px;border-radius:8px;text-decoration:none">پخش در تلویزیون</a>
      <a href="ums://download" style="flex:1;text-align:center;background:#1b2650;color:#e9edff;font-size:11px;padding:6px 4px;border-radius:8px;text-decoration:none">دانلود</a>
      <a href="ums://add" style="flex:1;text-align:center;background:#1b2650;color:#e9edff;font-size:11px;padding:6px 4px;border-radius:8px;text-decoration:none">افزودن به مخزن</a>
    </div>
  </div></body></html>`;
}

function closePopup() {
  if (state.win && !state.win.isDestroyed()) state.win.close();
  state.win = null;
}

function showPopup(url) {
  closePopup();
  const area = eScreen.getPrimaryDisplay().workArea;
  const width = 320;
  const height = 118;
  state.win = new BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 16,
    y: area.y + area.height - height - 16,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    focusable: true,
    backgroundColor: "#0d1530",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  state.win.setAlwaysOnTop(true, "screen-saver");
  state.win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(popupHtml(url)));

  const handle = (event, target) => {
    if (!String(target).startsWith("ums://")) return;
    event.preventDefault();
    const action = String(target).slice(6).replace(/\/$/, "");
    closePopup();
    if (action !== "close" && typeof state.onAction === "function") {
      state.onAction({ action, url, title: shortName(url) });
    }
  };
  state.win.webContents.on("will-navigate", handle);
  state.win.on("closed", () => {
    if (state.win) state.win = null;
  });
  // Auto-dismiss so the bubble never gets in the way.
  setTimeout(() => {
    if (state.win && !state.win.isDestroyed()) closePopup();
  }, 15000);
}

/** Starts watching the clipboard. onAction({action,url,title}) handles the buttons. */
function start(onAction) {
  state.onAction = onAction;
  state.last = clipboard.readText() || "";
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (!state.enabled) return;
    let text = "";
    try {
      text = clipboard.readText() || "";
    } catch {
      return;
    }
    if (text === state.last) return;
    state.last = text;
    if (isMediaLink(text)) showPopup(text.trim());
  }, 1200);
  return { ok: true };
}

function setEnabled(on) {
  state.enabled = Boolean(on);
  if (!state.enabled) closePopup();
  return { ok: true, enabled: state.enabled };
}

function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  closePopup();
}

module.exports = { start, stop, setEnabled, isMediaLink, shortName };
