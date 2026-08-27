// Helper-binary manager (Windows first, harmless elsewhere).
//
// Screen sharing needs ffmpeg.exe and real downloads need yt-dlp.exe. The
// Windows build script bundles both, but if a user installs a build where the
// download failed, the "share screen" button would break at runtime. So the app
// looks the binaries up in every plausible place and, as a last resort,
// downloads them into userData/bin once — the feature then never fails for a
// missing tool.

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");

const WIN = process.platform === "win32";

const SOURCES = {
  "yt-dlp": {
    file: WIN ? "yt-dlp.exe" : "yt-dlp",
    url: WIN
      ? "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
      : "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
  },
  ffmpeg: {
    file: WIN ? "ffmpeg.exe" : "ffmpeg",
    // Single-file static build (no archive) so no unzip step is needed.
    url: WIN
      ? "https://github.com/GyanD/codexffmpeg/releases/download/7.1/ffmpeg-7.1-essentials_build.zip"
      : "",
  },
};

let userDir = "";
/** Called once from main.cjs with app.getPath("userData"). */
function setUserDataDir(dir) {
  userDir = String(dir || "");
  return userDir;
}

function binDir() {
  const dir = path.join(userDir || process.cwd(), "bin");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function candidates(file) {
  const list = [];
  const res = process.resourcesPath || "";
  if (res) {
    list.push(
      path.join(res, file),
      path.join(res, "resources", file),
      path.join(res, "app", "resources", file),
      path.join(res, "app.asar.unpacked", "resources", file),
    );
  }
  try {
    const exeDir = path.dirname(process.execPath || "");
    if (exeDir) {
      list.push(path.join(exeDir, "resources", file), path.join(exeDir, file));
    }
  } catch {
    /* ignore */
  }
  list.push(
    path.join(process.cwd(), "resources", file),
    path.join(__dirname, "..", "resources", file),
    path.join(binDir(), file),
  );
  return list;
}

function usableFile(name, file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) return false;
  } catch {
    return false;
  }
  if (name !== "ffmpeg") return true;
  try {
    const r = spawnSync(file, ["-version"], { stdio: "ignore", timeout: 6000, windowsHide: true });
    return !r.error && (r.status === 0 || r.status === 1);
  } catch {
    return false;
  }
}

/** Absolute path of a tool, or "" when it is nowhere to be found. */
function findTool(name) {
  const spec = SOURCES[name];
  if (!spec) return "";
  for (const p of candidates(spec.file)) {
    try {
      if (usableFile(name, p)) return p;
    } catch {
      /* ignore */
    }
  }
  // On PATH?
  try {
    const probe = spawnSync(WIN ? "where" : "which", [spec.file.replace(/\.exe$/i, "")], {
      encoding: "utf8",
      timeout: 4000,
    });
    const hit = String(probe.stdout || "").split(/\r?\n/).find((l) => l.trim());
    if (hit && usableFile(name, hit.trim())) return hit.trim();
  } catch {
    /* ignore */
  }
  return "";
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const req = https.get(
      url,
      { timeout: 60000, headers: { "User-Agent": "UniversalMediaServer" } },
      (up) => {
        const loc = up.headers.location;
        if (up.statusCode && up.statusCode >= 300 && up.statusCode < 400 && loc && redirects < 6) {
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
        out.on("finish", () => {
          out.close(() => {
            try {
              fs.renameSync(tmp, dest);
              if (!WIN) fs.chmodSync(dest, 0o755);
              resolve(true);
            } catch {
              resolve(false);
            }
          });
        });
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

const pending = new Map();

/**
 * Returns the tool path, downloading it once if needed.
 * Only single-file downloads are attempted (yt-dlp); ffmpeg ships with the
 * installer because it comes as an archive.
 */
async function ensureTool(name) {
  const found = findTool(name);
  if (found) return found;
  const spec = SOURCES[name];
  if (!spec || !spec.url || /\.zip$/i.test(spec.url)) return "";
  if (pending.has(name)) return pending.get(name);
  const dest = path.join(binDir(), spec.file);
  const task = download(spec.url, dest).then((ok) => {
    pending.delete(name);
    return ok ? dest : "";
  });
  pending.set(name, task);
  return task;
}

function report() {
  return {
    ffmpeg: findTool("ffmpeg"),
    ytdlp: findTool("yt-dlp"),
    binDir: binDir(),
  };
}

module.exports = { setUserDataDir, findTool, ensureTool, report, binDir };
