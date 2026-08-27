// Real downloader for YouTube / Instagram / TikTok / direct links.
//
// yt-dlp does the heavy lifting (it knows every social site); plain HTTP links
// are streamed straight to disk so a download still works when yt-dlp is
// unavailable. Progress is parsed from yt-dlp's stdout and pushed to the UI.

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { spawn } = require("node:child_process");

const tools = require("./tools.cjs");

/** id -> job */
const jobs = new Map();
let outputDir = "";
let notify = () => {};

function setOutputDir(dir) {
  outputDir = String(dir || "");
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch {
    /* ignore */
  }
  return outputDir;
}

function setNotifier(fn) {
  notify = typeof fn === "function" ? fn : () => {};
}

function publish(job) {
  notify({
    type: "download",
    job: {
      id: job.id,
      title: job.title,
      url: job.url,
      progress: job.progress,
      status: job.status,
      error: job.error || "",
      file: job.file || "",
      sizeMb: job.sizeMb || 0,
      speed: job.speed || "",
      createdAt: job.createdAt,
    },
  });
}

function safeName(name) {
  return String(name || "video")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 90)
    .trim();
}

function finish(job, patch) {
  Object.assign(job, patch);
  if (job.status === "done" && job.file) {
    try {
      job.sizeMb = Math.round((fs.statSync(job.file).size / 1048576) * 10) / 10;
    } catch {
      /* ignore */
    }
  }
  publish(job);
}

// --------------------------------------------------------------- yt-dlp path

const PCT = /\[download\]\s+(\d{1,3}(?:\.\d)?)%/;
const DEST = /\[(?:download|Merger|ExtractAudio)\]\s+(?:Destination:|Merging formats into\s+")([^"\n\r]+)/;
const SPEED = /at\s+([\d.]+\s*[KMG]iB\/s)/;

function runYtDlp(job, bin) {
  const out = path.join(outputDir, `${safeName(job.title)}-${job.id}.%(ext)s`);
  const args = [
    "--no-playlist",
    "--newline",
    "--no-part",
    "--restrict-filenames",
    "--no-warnings",
    "-f",
    job.audioOnly ? "bestaudio/best" : "bv*+ba/b",
    "--merge-output-format",
    job.audioOnly ? "m4a" : "mp4",
    "-o",
    out,
    job.url,
  ];
  const ff = tools.findTool("ffmpeg");
  if (ff) args.unshift("--ffmpeg-location", path.dirname(ff));

  const proc = spawn(bin, args, { windowsHide: true });
  job.proc = proc;
  finish(job, { status: "downloading", progress: 0 });

  const read = (chunk) => {
    const text = String(chunk);
    const pct = PCT.exec(text);
    if (pct) {
      const value = Math.max(0, Math.min(99, Math.round(Number(pct[1]))));
      if (value !== job.progress) finish(job, { progress: value });
    }
    const speed = SPEED.exec(text);
    if (speed) job.speed = speed[1];
    const dest = DEST.exec(text);
    if (dest) job.file = dest[1].trim();
    if (/ERROR/i.test(text) && !job.error) job.error = text.split(/\r?\n/)[0].slice(0, 200);
  };
  proc.stdout.on("data", read);
  proc.stderr.on("data", read);

  proc.on("error", (err) => finish(job, { status: "error", error: String(err.message || err) }));
  proc.on("exit", (code) => {
    job.proc = null;
    if (job.status === "canceled") return;
    if (code === 0) {
      if (!job.file || !fs.existsSync(job.file)) job.file = newestMatch(job.id) || job.file;
      finish(job, { status: "done", progress: 100 });
    } else {
      finish(job, {
        status: "error",
        error: job.error || "دانلود ناموفق بود؛ لینک یا اتصال اینترنت را بررسی کنید.",
      });
    }
  });
}

function newestMatch(id) {
  try {
    const hits = fs
      .readdirSync(outputDir)
      .filter((f) => f.includes(id))
      .map((f) => path.join(outputDir, f));
    return hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || "";
  } catch {
    return "";
  }
}

// ------------------------------------------------------------- direct HTTP

function runDirect(job, redirects = 0) {
  let target;
  try {
    target = new URL(job.url);
  } catch {
    return finish(job, { status: "error", error: "آدرس نامعتبر است" });
  }
  const client = target.protocol === "https:" ? https : http;
  const ext = (path.extname(target.pathname) || ".mp4").split("?")[0];
  const file = path.join(outputDir, `${safeName(job.title)}-${job.id}${ext}`);

  finish(job, { status: "downloading", progress: 0 });
  const req = client.get(
    target,
    { timeout: 20000, headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" } },
    (up) => {
      const loc = up.headers.location;
      if (up.statusCode >= 300 && up.statusCode < 400 && loc && redirects < 5) {
        up.resume();
        job.url = new URL(loc, target).toString();
        return runDirect(job, redirects + 1);
      }
      if (up.statusCode !== 200) {
        up.resume();
        return finish(job, { status: "error", error: `پاسخ سرور: ${up.statusCode}` });
      }
      const total = Number(up.headers["content-length"] || 0);
      let got = 0;
      const out = fs.createWriteStream(file);
      job.stream = up;
      up.on("data", (c) => {
        got += c.length;
        if (total) {
          const value = Math.min(99, Math.round((got / total) * 100));
          if (value !== job.progress) finish(job, { progress: value });
        }
      });
      up.pipe(out);
      out.on("finish", () => {
        if (job.status === "canceled") return;
        job.file = file;
        finish(job, { status: "done", progress: 100 });
      });
      out.on("error", (e) => finish(job, { status: "error", error: String(e.message || e) }));
    },
  );
  req.on("timeout", () => {
    req.destroy();
    finish(job, { status: "error", error: "زمان اتصال تمام شد" });
  });
  req.on("error", (e) => finish(job, { status: "error", error: String(e.message || e) }));
}

const DIRECT = /\.(mp4|m4v|mkv|webm|mov|mp3|m4a|aac)(\?|$)/i;

async function start(payload) {
  const url = String(payload?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: "لینک معتبر وارد کنید" };
  if (!outputDir) return { ok: false, error: "پوشه دانلود مشخص نیست" };

  const id = `d-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const job = {
    id,
    url,
    title: String(payload?.title || "").trim() || "ویدیو",
    genre: String(payload?.genre || "other"),
    audioOnly: Boolean(payload?.audioOnly),
    progress: 0,
    status: "queued",
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  publish(job);

  const bin = DIRECT.test(url) ? "" : await tools.ensureTool("yt-dlp");
  if (bin) runYtDlp(job, bin);
  else if (DIRECT.test(url)) runDirect(job);
  else {
    finish(job, {
      status: "error",
      error: "ابزار yt-dlp در دسترس نیست؛ اتصال اینترنت را بررسی کنید تا به‌صورت خودکار دریافت شود.",
    });
  }
  return { ok: true, id, job: list().find((j) => j.id === id) };
}

function cancel(id) {
  const job = jobs.get(String(id));
  if (!job) return { ok: false };
  job.status = "canceled";
  try {
    job.proc?.kill("SIGKILL");
    job.stream?.destroy();
  } catch {
    /* ignore */
  }
  jobs.delete(job.id);
  publish({ ...job, status: "canceled" });
  return { ok: true };
}

function list() {
  return [...jobs.values()]
    .map((j) => ({
      id: j.id,
      title: j.title,
      url: j.url,
      genre: j.genre,
      progress: j.progress,
      status: j.status,
      error: j.error || "",
      file: j.file || "",
      sizeMb: j.sizeMb || 0,
      speed: j.speed || "",
      createdAt: j.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function stopAll() {
  for (const id of [...jobs.keys()]) cancel(id);
}

module.exports = { setOutputDir, setNotifier, start, cancel, list, stopAll };
