// Dependency doctor: everything the app needs at runtime, checked and repaired
// from inside the app (the "بررسی و نصب وابستگی‌ها + ریستارت" button).
//
// Why this exists: a user installed the app on a machine where ffmpeg.exe was
// only present in some folders, an old ffmpeg rejected new options, and there
// was no loopback audio device — so the screen-share button failed with an
// unhelpful error. Now the app can diagnose and fix that itself.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const tools = require("./tools.cjs");
const screen = require("./screen-cast.cjs");

const WIN = process.platform === "win32";

// Single archive that contains a current static ffmpeg build for Windows.
const FFMPEG_ZIP = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const YTDLP_URL = WIN
  ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
  : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";

function binDir() {
  return tools.binDir();
}

function exists(p) {
  try {
    return Boolean(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

function which(cmd) {
  try {
    const r = spawnSync(WIN ? "where" : "which", [cmd], { encoding: "utf8", timeout: 4000 });
    const hit = String(r.stdout || "")
      .split(/\r?\n/)
      .find((l) => l.trim());
    return hit ? hit.trim() : "";
  } catch {
    return "";
  }
}

function ffmpegVersion(bin) {
  if (!bin) return "";
  try {
    const r = spawnSync(bin, ["-hide_banner", "-version"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    const first = String(r.stdout || r.stderr || "").split(/\r?\n/)[0] || "";
    const m = /ffmpeg version (\S+)/i.exec(first);
    return m ? m[1] : first.slice(0, 60);
  } catch {
    return "";
  }
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const req = https.get(
      url,
      { timeout: 120000, headers: { "User-Agent": "UniversalMediaServer" } },
      (up) => {
        const loc = up.headers.location;
        if (up.statusCode >= 300 && up.statusCode < 400 && loc && redirects < 6) {
          up.resume();
          return resolve(download(new URL(loc, url).toString(), dest, redirects + 1));
        }
        if (up.statusCode !== 200) {
          up.resume();
          return resolve(false);
        }
        const tmp = `${dest}.part`;
        const out = fs.createWriteStream(tmp);
        up.pipe(out);
        out.on("finish", () =>
          out.close(() => {
            try {
              fs.renameSync(tmp, dest);
              if (!WIN) fs.chmodSync(dest, 0o755);
              resolve(true);
            } catch {
              resolve(false);
            }
          }),
        );
        out.on("error", () => resolve(false));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

/** Recursively looks for a file name under a folder (shallow-ish, fast). */
function findFileUnder(root, name, depth = 4) {
  let found = "";
  const walk = (dir, level) => {
    if (found || level > depth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found) return;
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) found = full;
      else if (e.isDirectory()) walk(full, level + 1);
    }
  };
  walk(root, 0);
  return found;
}

/** Downloads + unpacks a fresh ffmpeg into userData/bin (Windows). */
async function installFfmpeg() {
  const dir = binDir();
  const target = path.join(dir, WIN ? "ffmpeg.exe" : "ffmpeg");
  if (!WIN) return { ok: false, error: "نصب خودکار ffmpeg فقط در ویندوز پشتیبانی می‌شود" };
  const zip = path.join(os.tmpdir(), "ums-ffmpeg.zip");
  const got = await download(FFMPEG_ZIP, zip);
  if (!got) return { ok: false, error: "دانلود ffmpeg ناموفق بود (اینترنت را بررسی کنید)" };
  const out = path.join(os.tmpdir(), "ums-ffmpeg-unpack");
  try {
    fs.rmSync(out, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`,
    ],
    { stdio: "ignore", timeout: 180000, windowsHide: true },
  );
  if (r.error || r.status !== 0) return { ok: false, error: "باز کردن فایل ffmpeg ناموفق بود" };
  const src = findFileUnder(out, "ffmpeg.exe");
  if (!src) return { ok: false, error: "ffmpeg.exe در بسته دانلودشده پیدا نشد" };
  try {
    fs.copyFileSync(src, target);
    const probe = findFileUnder(out, "ffprobe.exe");
    if (probe) fs.copyFileSync(probe, path.join(dir, "ffprobe.exe"));
  } catch (err) {
    return { ok: false, error: `کپی ffmpeg ناموفق بود: ${String(err && err.message)}` };
  }
  try {
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
  } catch {
    /* ignore */
  }
  screen.resetFfmpeg();
  return { ok: true, path: target };
}

async function installYtDlp() {
  const dest = path.join(binDir(), WIN ? "yt-dlp.exe" : "yt-dlp");
  const ok = await download(YTDLP_URL, dest);
  return ok ? { ok: true, path: dest } : { ok: false, error: "دانلود yt-dlp ناموفق بود" };
}

/** Full dependency report (nothing is installed here — this is read-only). */
function check() {
  const ffmpeg = screen.findFfmpeg() || tools.findTool("ffmpeg");
  const ytdlp = tools.findTool("yt-dlp");
  const loopback = WIN
    ? screen
        .listWindowsAudioDevices()
        .filter((n) => /stereo mix|what u hear|virtual-audio-capturer|loopback|mix/i.test(n))
    : [];
  const items = [
    {
      id: "ffmpeg",
      name: "ffmpeg (اشتراک صفحه و تبدیل استریم)",
      ok: Boolean(ffmpeg),
      detail: ffmpeg ? `${ffmpeg} — ${ffmpegVersion(ffmpeg)}` : "پیدا نشد",
      fixable: true,
      required: true,
    },
    {
      id: "ytdlp",
      name: "yt-dlp (دانلود از وب)",
      ok: Boolean(ytdlp),
      detail: ytdlp || "پیدا نشد",
      fixable: true,
      required: false,
    },
    {
      id: "powershell",
      name: "PowerShell (بی‌صدا کردن بلندگوی کامپیوتر)",
      ok: WIN ? Boolean(which("powershell")) : true,
      detail: WIN ? which("powershell") || "پیدا نشد" : "لازم نیست",
      fixable: false,
      required: WIN,
    },
    {
      id: "loopback",
      name: "دستگاه صدای loopback ویندوز (Stereo Mix)",
      ok: !WIN || loopback.length > 0,
      detail: loopback.length
        ? loopback.join(" · ")
        : "پیدا نشد؛ اشتراک صفحه بدون صدا انجام می‌شود. Stereo Mix را در Sound → Recording فعال کنید.",
      fixable: false,
      required: false,
    },
    {
      id: "vlc",
      name: "VLC (پخش محلی اختیاری)",
      ok: Boolean(
        which("vlc") ||
          exists("C:/Program Files/VideoLAN/VLC/vlc.exe") ||
          exists("C:/Program Files (x86)/VideoLAN/VLC/vlc.exe"),
      ),
      detail: "اختیاری",
      fixable: false,
      required: false,
    },
  ];
  return {
    ok: items.every((i) => !i.required || i.ok),
    items,
    binDir: binDir(),
    platform: process.platform,
  };
}

/**
 * Installs/updates whatever is missing, then runs a real capture dry-run so the
 * user immediately sees whether screen sharing will work.
 */
async function repair({ force = false } = {}) {
  const log = [];
  screen.resetFfmpeg();
  if (force || !screen.findFfmpeg()) {
    const res = await installFfmpeg();
    log.push(res.ok ? `ffmpeg نصب شد: ${res.path}` : `ffmpeg: ${res.error}`);
  } else {
    log.push("ffmpeg موجود است");
  }
  if (force || !tools.findTool("yt-dlp")) {
    const res = await installYtDlp();
    log.push(res.ok ? `yt-dlp نصب شد: ${res.path}` : `yt-dlp: ${res.error}`);
  } else {
    log.push("yt-dlp موجود است");
  }
  screen.resetFfmpeg();
  const test = screen.selfTest();
  log.push(test.ok ? "آزمایش ضبط صفحه موفق بود" : `آزمایش ضبط صفحه: ${test.error || "ناموفق"}`);
  const report = check();
  return { ok: report.ok && test.ok, log, test, ...report };
}

module.exports = { check, repair, installFfmpeg, installYtDlp, binDir };
