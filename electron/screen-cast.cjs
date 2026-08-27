// Desktop screen sharing to a TV.
// Captures the whole screen with ffmpeg and pushes a live MPEG-TS stream that
// DLNA renderers (Hisense, Samsung, LG…) and Chromecast can play over plain
// HTTP: http://<ip>:<port>/desktop.ts
// ffmpeg is looked up in UMS_FFMPEG, the packaged resources folder, then PATH,
// and every candidate is verified by actually running `ffmpeg -version`.

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Small prime buffer = small delay. A big buffer is exactly what made the TV
// run ~10 s behind the desktop, because the renderer replays it before going live.
const PRIMING_BYTES = 180_000; // TS bytes replayed to a freshly attached TV (default)

// ---------------------------------------------------------------------------
// Manual tuning (settings page → "تنظیم دستی عملکرد").
//   fps        capture rate 15..60 — the single biggest cause of jerky mouse
//   kbps       video bitrate
//   gop        fixed keyframe interval in frames (8 / 15 …) = short buffer chain
//   segmentMs  output chunk length (500–1000 ms) → server-side delay
//   lightPanel drawtext is re-read once per second instead of every frame
// A zero value means "let the automatic hardware profile decide".
// ---------------------------------------------------------------------------
const tuning = { fps: 0, kbps: 0, gop: 0, segmentMs: 1000, lightPanel: false };

function setTuning(next = {}) {
  const num = (v, min, max) => {
    const n = Math.round(Number(v) || 0);
    return n ? Math.max(min, Math.min(max, n)) : 0;
  };
  if ("fps" in next) tuning.fps = num(next.fps, 15, 60);
  if ("kbps" in next) tuning.kbps = num(next.kbps, 1200, 20000);
  if ("gop" in next) tuning.gop = num(next.gop, 4, 120);
  if ("segmentMs" in next) tuning.segmentMs = num(next.segmentMs, 300, 4000) || 1000;
  if ("lightPanel" in next) tuning.lightPanel = Boolean(next.lightPanel);
  return { ...tuning };
}

function getTuning() {
  return { ...tuning };
}

/** Prime buffer scaled to the chosen segment length (short chunk = low delay). */
function primingBytes() {
  return Math.max(60_000, Math.round((PRIMING_BYTES * tuning.segmentMs) / 1000));
}

// Live control panel burned into the picture (drawtext reloads this file every
// frame, so the app can change/hide it without restarting ffmpeg).
const PANEL_FILE = path.join(os.tmpdir(), "ums-screen-panel.txt");

const state = {
  proc: null,
  clients: new Set(),
  startedAt: 0,
  lastError: "",
  rawError: "",

  ffmpeg: "",
  ffmpegChecked: false,
  audioDevice: "",
  audioNote: "",
  deviceList: null,
  options: {},
  buffer: [], // rolling MPEG-TS prime buffer
  bufferBytes: 0,
  bytesOut: 0,
  panel: { visible: false, text: "" },
  muted: false,
};

function candidates() {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const list = [];
  if (process.env.UMS_FFMPEG) list.push(process.env.UMS_FFMPEG);
  const res = process.resourcesPath || "";
  if (res) {
    list.push(path.join(res, exe));
    list.push(path.join(res, "ffmpeg", exe));
    list.push(path.join(res, "ffmpeg", "bin", exe));
    list.push(path.join(res, "app", "resources", exe));
    list.push(path.join(res, "app.asar.unpacked", "resources", exe));
  }
  list.push(path.join(__dirname, "..", "resources", exe));
  list.push(path.join(__dirname, "..", "resources", "ffmpeg", exe));
  // Installed app: <install dir>\resources\ffmpeg.exe next to the executable.
  try {
    const exeDir = path.dirname(process.execPath || "");
    if (exeDir) {
      list.push(path.join(exeDir, "resources", exe));
      list.push(path.join(exeDir, "resources", "ffmpeg", exe));
      list.push(path.join(exeDir, exe));
    }
  } catch {
    /* ignore */
  }
  // Manual repair path used by the PowerShell diagnostic scripts:
  // %APPDATA%\UniversalMediaServer\bin\ffmpeg.exe
  if (process.platform === "win32") {
    try {
      const appData = process.env.APPDATA || "";
      const localAppData = process.env.LOCALAPPDATA || "";
      if (appData) {
        list.push(path.join(appData, "UniversalMediaServer", "bin", exe));
        list.push(path.join(appData, "Universal Media Server", "bin", exe));
      }
      if (localAppData) {
        list.push(path.join(localAppData, "UniversalMediaServer", "bin", exe));
        list.push(path.join(localAppData, "Programs", "UniversalMediaServer", "resources", exe));
      }
    } catch {
      /* ignore */
    }
  }
  try {
    list.push(path.join(process.cwd(), "resources", exe));
  } catch {
    /* ignore */
  }
  list.push(exe); // PATH
  return list;
}

/** True when the binary really runs (a stale/0-byte file must not be used). */
function runs(bin) {
  try {
    const r = spawnSync(bin, ["-version"], { stdio: "ignore", timeout: 6000, windowsHide: true });
    return !r.error && (r.status === 0 || r.status === 1);
  } catch {
    return false;
  }
}

function findFfmpeg() {
  if (state.ffmpeg) return state.ffmpeg;
  if (state.ffmpegChecked) return "";
  const onPath = [];
  for (const c of candidates()) {
    const isBare = c === "ffmpeg" || c === "ffmpeg.exe";
    if (!isBare) {
      try {
        if (!fs.existsSync(c)) continue;
      } catch {
        continue;
      }
    } else {
      onPath.push(c);
      continue;
    }
    if (runs(c)) {
      state.ffmpeg = c;
      state.ffmpegChecked = true;
      return c;
    }
  }
  for (const c of onPath) {
    if (runs(c)) {
      state.ffmpeg = c;
      state.ffmpegChecked = true;
      return c;
    }
  }
  state.ffmpegChecked = true;
  return "";
}

/** Clears the cached lookup (used after the user installs ffmpeg manually). */
function resetFfmpeg() {
  state.ffmpeg = "";
  state.ffmpegChecked = false;
  state.deviceList = null;
  encoderCache = null;
  // A different ffmpeg build may well support the options the old one rejected.
  disabledOpts.clear();
  panelDisabled = false;
  return findFfmpeg();
}


// Windows loopback audio device names, in order of likelihood. Real devices are
// enumerated from ffmpeg first; these are only a fallback ordering hint.
const WIN_AUDIO_DEVICES = [
  "virtual-audio-capturer",
  "Stereo Mix (Realtek(R) Audio)",
  "Stereo Mix",
  "What U Hear",
];

/** Reads the real DirectShow audio sources of this machine from ffmpeg. */
function listWindowsAudioDevices() {
  if (process.platform !== "win32") return [];
  if (state.deviceList) return state.deviceList;
  const bin = findFfmpeg();
  if (!bin) return [];
  let out = "";
  try {
    const r = spawnSync(bin, ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", ""], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
    });
    out = `${r.stdout || ""}\n${r.stderr || ""}`;
  } catch {
    out = "";
  }
  const names = [];
  let inAudio = false;
  for (const line of out.split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) inAudio = false;
    if (/DirectShow audio devices/i.test(line)) inAudio = true;
    const m = line.match(/"([^"]+)"/);
    if (inAudio && m && !/Alternative name/i.test(line)) names.push(m[1]);
  }
  state.deviceList = names;
  return names;
}

/** Best loopback ("what you hear") sources first, then any other input. */
function preferredAudioDevices() {
  const all = listWindowsAudioDevices();
  if (!all.length) return [];
  const score = (n) => {
    const s = n.toLowerCase();
    if (s.includes("virtual-audio-capturer") || s.includes("screen capture recorder")) return 0;
    if (s.includes("stereo mix") || s.includes("what u hear") || s.includes("wave out")) return 1;
    if (s.includes("loopback") || s.includes("mix")) return 2;
    return 9; // microphones etc. — only used if nothing better exists
  };
  return all
    .map((name) => ({ name, rank: score(name) }))
    .filter((d) => d.rank < 9)
    .sort((a, b) => a.rank - b.rank)
    .map((d) => d.name);
}

/** ffmpeg chatter that is not a real failure and must not reach the UI. */
function isBenign(text, audioAttempt = true) {
  // Audio-device open failures are recovered automatically (next device, then a
  // silent video-only stream), so they must not be reported as a real error.
  // ffmpeg 7 words them differently: "[in#1 @ ...] Error opening input: I/O error"
  // followed by "Error opening input files: I/O error".
  if (
    /Error opening input file audio=|audio=virtual-audio-capturer|Could not run filter/i.test(text)
  )
    return true;
  if (
    audioAttempt &&
    /\bin#1\b|Error opening input:|Error opening input files|I\/O error/i.test(text)
  )
    return true;
  return /deprecated|Last message repeated|frame=|bitrate=|Past duration|non-monotonous|Guessed Channel|Could not find audio only device|among source devices/i.test(
    text,
  );
}

function audioInput(options = {}) {
  if (options.noAudio) return [];
  if (process.platform === "win32") {
    const device = options.audioDevice;
    if (!device) return [];
    return ["-f", "dshow", "-audio_buffer_size", "80", "-i", `audio=${device}`];
  }
  if (process.platform === "darwin") return ["-f", "avfoundation", "-i", ":0"];
  return ["-f", "pulse", "-i", "default"];
}

// ---------------------------------------------------------------------------
// Smart hardware profile: on a 2-core / 4 GB PC a software x264 encode at
// 1280p15 eats the whole CPU (that was the freeze). We detect the GPU encoder
// once and pick capture size/fps from the real machine, so quality stays as
// high as the hardware can actually sustain.
// ---------------------------------------------------------------------------

const HW_ENCODERS =
  process.platform === "win32"
    ? ["h264_nvenc", "h264_qsv", "h264_amf"]
    : process.platform === "darwin"
      ? ["h264_videotoolbox"]
      : ["h264_nvenc", "h264_vaapi"];

let encoderCache = null;

/**
 * First GPU H.264 encoder this ffmpeg build really exposes AND that the driver
 * can actually open ("" = none).
 *
 * Listing an encoder is not enough: a machine can advertise h264_nvenc while
 * the NVIDIA driver fails with "Cannot load cuMemAllocAsync / Error while
 * opening encoder". So every candidate gets a 0.2s real test encode before we
 * trust it — otherwise the whole screen share dies at runtime.
 */
function detectHwEncoder() {
  if (encoderCache !== null) return encoderCache;
  const bin = findFfmpeg();
  if (!bin) return "";
  let out = "";
  try {
    const r = spawnSync(bin, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    out = `${r.stdout || ""}${r.stderr || ""}`;
  } catch {
    out = "";
  }
  const listed = HW_ENCODERS.filter((e) => out.includes(e));
  encoderCache = "";
  for (const enc of listed) {
    try {
      const t = spawnSync(
        bin,
        [
          "-hide_banner",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=640x360:r=15",
          "-t",
          "0.2",
          "-c:v",
          enc,
          "-f",
          "null",
          "-",
        ],
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      const chatter = `${t.stdout || ""}${t.stderr || ""}`;
      if (!t.error && t.status === 0 && !/error|cannot load|failed/i.test(chatter)) {
        encoderCache = enc;
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return encoderCache;
}

/** Forces software encoding for the rest of this session (driver refused GPU). */
function disableHwEncoder() {
  encoderCache = "";
  return true;
}


/** CPU cores + RAM + GPU encoder → the capture profile for this machine. */
function machineProfile() {
  const cores = Math.max(1, os.cpus()?.length || 1);
  const ramGb = Math.round((os.totalmem() || 0) / 1024 ** 3);
  const hw = detectHwEncoder();
  // Weak = the 2-core / 4 GB class the user has, without a GPU encoder.
  const weak = !hw && (cores <= 2 || ramGb <= 4);
  const medium = !hw && !weak && cores <= 4;
  const tier = hw ? "gpu" : weak ? "weak" : medium ? "medium" : "cpu";
  const preset = hw
    ? { width: 1280, fps: 25, kbps: 5000 }
    : weak
      ? { width: 960, fps: 12, kbps: 2200 }
      : medium
        ? { width: 1152, fps: 15, kbps: 3200 }
        : { width: 1280, fps: 20, kbps: 4500 };
  return { cores, ramGb, hw, tier, weak, ...preset };
}

/** Hardware encoder when available — keeps CPU/RAM low on weak machines. */
function videoEncoder(options = {}) {
  const profile = machineProfile();
  const encoder = options.encoder || (options.forceSoftware ? "libx264" : profile.hw || "libx264");
  if (encoder === "h264_nvenc")
    return [
      "-c:v",
      "h264_nvenc",
      "-preset",
      "p1",
      "-tune",
      "ll",
      "-rc",
      "cbr",
      "-zerolatency",
      "1",
    ];
  if (encoder === "h264_qsv") return ["-c:v", "h264_qsv", "-preset", "veryfast", "-low_power", "1"];
  if (encoder === "h264_amf")
    return ["-c:v", "h264_amf", "-usage", "ultralowlatency", "-quality", "speed"];
  if (encoder === "h264_videotoolbox") return ["-c:v", "h264_videotoolbox", "-realtime", "1"];
  if (encoder === "h264_vaapi") return ["-c:v", "h264_vaapi"];
  // Software fallback: on weak CPUs ultrafast is the difference between a
  // smooth mirror and a frozen app.
  const cores = Math.max(1, os.cpus()?.length || 1);
  return [
    "-c:v",
    "libx264",
    "-preset",
    cores <= 2 ? "ultrafast" : "veryfast",
    "-tune",
    "zerolatency",
    "-threads",
    String(Math.max(1, Math.min(4, cores))),
  ];
}

/**
 * Path escaping for ffmpeg filter arguments.
 * ffmpeg is spawned without a shell, so exactly ONE backslash is needed before
 * the Windows drive colon (and before quotes/backslashes). Double-escaping made
 * ffmpeg report "No option name near ..." and screen sharing failed.
 */
function filterPath(p) {
  return String(p).replace(/\\/g, "/").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

function panelFont() {
  const list =
    process.platform === "win32"
      ? [
          "C:/Windows/Fonts/segoeui.ttf",
          "C:/Windows/Fonts/arial.ttf",
          "C:/Windows/Fonts/tahoma.ttf",
        ]
      : ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Helvetica.ttc"];
  for (const f of list) {
    try {
      if (fs.existsSync(f)) return f;
    } catch {
      /* ignore */
    }
  }
  return "";
}

// Set when ffmpeg rejects the drawtext filter (odd font/path); sharing then
// continues without the on-TV control panel instead of failing outright.
let panelDisabled = false;

// ---------------------------------------------------------------------------
// ffmpeg-version compatibility.
// Newer ffmpeg builds (8.x / 9.x) removed options that older ones accepted
// (`-async`, `-sc_threshold`, …). One unknown option makes ffmpeg exit at once,
// which is exactly the "share screen does not work" failure. So every option
// ffmpeg complains about is remembered and stripped from the next attempt.
// ---------------------------------------------------------------------------
const disabledOpts = new Set();

/** Removes every remembered-bad option (and its value) from an arg list. */
function pruneArgs(args) {
  if (!disabledOpts.size) return args;
  const out = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    const bare = typeof a === "string" && a.startsWith("-") ? a.replace(/^-+/, "") : "";
    if (bare && disabledOpts.has(bare)) {
      const next = args[i + 1];
      if (typeof next === "string" && !next.startsWith("-")) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** Option name ffmpeg rejected in this stderr text, or "" when none. */
function rejectedOption(text) {
  const m =
    /Unrecognized option '([^']+)'/i.exec(text) ||
    /Option ([\w:]+) not found/i.exec(text) ||
    /Unknown option '([^']+)'/i.exec(text) ||
    /No such option: ([\w:]+)/i.exec(text);
  return m ? String(m[1]).replace(/^-+/, "") : "";
}


/** Bottom control-panel overlay, live-reloaded only when explicitly enabled. */
function panelFilter() {
  const font = panelFont();
  writePanelFile();
  const parts = [
    `textfile=${filterPath(PANEL_FILE)}`,
    // FFmpeg's reload option is boolean (0/1), not a frame interval. Passing
    // the capture FPS here made drawtext reject the whole screen-share command.
    `reload=${tuning.lightPanel ? 0 : 1}`,
    ...(font ? [`fontfile=${filterPath(font)}`] : []),
    "fontcolor=white",
    "fontsize=26",
    "line_spacing=6",
    "box=1",
    "boxcolor=black@0.55",
    "boxborderw=16",
    "x=(w-text_w)/2",
    "y=h-text_h-34",
  ];
  return `drawtext=${parts.join(":")}`;
}

function captureArgs(options = {}) {
  const profile = machineProfile();
  const auto = options.quality !== "manual";
  // Manual fps wins over everything: this is the control that makes the mouse
  // feel like the desktop (15 → 60).
  const fps = Math.min(
    60,
    Math.max(10, Number(options.fps) || tuning.fps || (auto ? profile.fps : 15)),
  );
  const kbps = Math.min(
    20000,
    Math.max(1200, Number(options.kbps) || tuning.kbps || (auto ? profile.kbps : 4000)),
  );
  const width = Math.max(640, Math.min(1920, Number(options.width) || profile.width));
  const bitrate = `${kbps}k`;
  const encoderArgs = videoEncoder(options);
  const isX264 = encoderArgs.includes("libx264");
  const video =
    process.platform === "win32"
      ? [
          "-f",
          "gdigrab",
          "-framerate",
          String(fps),
          "-draw_mouse",
          "1",
          // A huge ring buffer adds seconds of delay; keep it just big enough.
          "-rtbufsize",
          "24M",
          "-i",
          "desktop",
        ]
      : process.platform === "darwin"
        ? ["-f", "avfoundation", "-framerate", String(fps), "-i", "1:none"]
        : ["-f", "x11grab", "-framerate", String(fps), "-i", process.env.DISPLAY || ":0.0"];

  const audio = audioInput(options);
  const hasAudio = audio.length > 0;
  // Fixed, short GOP = short buffer chain on the TV. Manual value (8 / 15…)
  // overrides the automatic half-second interval.
  // A 30-frame GOP is broadly compatible with older DLNA decoders. Manual
  // tuning may still shorten it for very low-latency local networks.
  const gop = Math.max(4, Math.round(Number(options.gop) || tuning.gop || (isX264 ? 30 : fps)));

  return pruneArgs([

    "-hide_banner",
    "-loglevel",
    "error",
    // Low-latency capture: never queue frames, never re-order.
    "-fflags",
    "+genpts+nobuffer+discardcorrupt",
    "-flags",
    "low_delay",
    "-avioflags",
    "direct",
    "-max_delay",
    "0",
    ...video,
    ...audio,
    "-vf",
    !panelDisabled && state.panel.visible && options.panel !== false
      ? `scale=${width}:-2,format=yuv420p,${panelFilter()}`
      : `scale=${width}:-2,format=yuv420p`,
    ...encoderArgs,
    "-profile:v",
    isX264 ? "baseline" : "main",
    "-level",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    bitrate,
    "-maxrate",
    bitrate,
    // Small VBV buffer → the encoder cannot hold back a second of video.
    "-bufsize",
    `${Math.max(600, Math.round(kbps / 2))}k`,
    ...(isX264
      ? ["-x264-params", "sliced-threads=1:sync-lookahead=0:rc-lookahead=0:bframes=0:scenecut=0"]
      : []),
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
    ...(hasAudio
      ? [
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-ac",
          "2",
          "-ar",
          "48000",
          // ffmpeg 8/9 removed the old `-async` flag; the aresample filter is
          // the supported way to keep TV audio locked to the picture.
          "-af",
          "aresample=async=1:first_pts=0",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
        ]
      : ["-map", "0:v:0"]),
    "-f",
    "mpegts",
    // Re-send PAT/PMT often so a late-joining TV can lock onto the stream.
    "-mpegts_flags",
    "+resend_headers",
    "-pat_period",
    "0.1",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-flush_packets",
    "1",
    "pipe:1",
  ]);

}

// ---------------------------------------------------------------------------
// On-TV control panel (a text strip drawn under the picture)
// ---------------------------------------------------------------------------

function writePanelFile() {
  const text = state.panel.visible ? String(state.panel.text || "") : "";
  try {
    fs.writeFileSync(PANEL_FILE, text, "utf8");
  } catch {
    /* ignore */
  }
}

/**
 * Shows / hides / updates the panel that is burned into the TV picture.
 * ffmpeg reloads the file every frame, so this is instant and never restarts
 * the stream (no black screen while toggling).
 */
function setPanel(payload = {}) {
  if (typeof payload.visible === "boolean") state.panel.visible = payload.visible;
  if (typeof payload.toggle === "boolean" && payload.toggle)
    state.panel.visible = !state.panel.visible;
  if (typeof payload.text === "string") state.panel.text = payload.text;
  writePanelFile();
  return { ok: true, ...state.panel };
}

// ---------------------------------------------------------------------------
// Local (desktop) speaker mute — the sound must come out of the TV only
// ---------------------------------------------------------------------------

const MUTE_PS = `
Add-Type -Language CSharp @"
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float a, System.Guid b);
  int j(); int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, System.Guid g);
  int GetMute(out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int ctx, System.IntPtr p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev); }
[ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public class Vol {
  public static void Set(bool mute) {
    IMMDeviceEnumerator e = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev; e.GetDefaultAudioEndpoint(0, 1, out dev);
    System.Guid g = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume v; dev.Activate(ref g, 23, System.IntPtr.Zero, out v);
    System.Guid empty = System.Guid.Empty;
    v.SetMute(mute, empty);
  }
}
"@
[Vol]::Set($MUTE_VALUE)
`;

/** Mutes/unmutes the PC speakers (Windows). Never throws. */
function setLocalMute(mute) {
  if (process.platform !== "win32") return false;
  try {
    const script = MUTE_PS.replace("$MUTE_VALUE", mute ? "$true" : "$false");
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { stdio: "ignore", timeout: 12000, windowsHide: true },
    );
    if (r.error || r.status !== 0) return false;
    state.muted = Boolean(mute);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the capture. Windows has no standard loopback device, so we try each
 * known device name and finally a silent (video-only) stream instead of failing.
 */
function start(options = {}) {
  if (state.proc) return { ok: true, running: true, alreadyRunning: true, ffmpeg: state.ffmpeg };
  state.options = { ...options };
  if (typeof options.panelText === "string") state.panel.text = options.panelText;
  if (typeof options.panel === "boolean") state.panel.visible = options.panel;
  writePanelFile();

  const all = process.platform === "win32" ? listWindowsAudioDevices() : [];
  const real = preferredAudioDevices();
  // Only guess device names when ffmpeg could not enumerate anything at all.
  // Otherwise a missing "virtual-audio-capturer" produces a scary I/O error.
  const guesses = all.length ? [] : WIN_AUDIO_DEVICES;
  const attempts =
    options.noAudio || process.platform !== "win32"
      ? [options]
      : [
          ...(real.length ? real : guesses).map((audioDevice) => ({
            ...options,
            audioDevice,
          })),
          { ...options, noAudio: true },
        ];
  let last = { ok: false, running: false, error: "" };
  for (const attempt of attempts) {
    state.lastError = "";
    last = launch(attempt);
    if (last.ok) {
      state.audioDevice = attempt.noAudio ? "" : attempt.audioDevice || "";
      state.lastError = "";
      state.audioNote = state.audioDevice
        ? ""
        : "دستگاه صدای loopback در ویندوز پیدا نشد؛ اشتراک صفحه فقط با تصویر انجام می‌شود. برای داشتن صدا Stereo Mix را فعال کنید یا virtual-audio-capturer را نصب کنید.";
      // Sound must come from the TV only — silence the PC speakers while sharing.
      if (options.muteLocal !== false) setLocalMute(true);
      return {
        ...last,
        audio: Boolean(state.audioDevice),
        audioDevice: state.audioDevice,
        note: state.audioNote,
        localMuted: state.muted,
        ffmpeg: state.ffmpeg,
      };
    }
  }
  return last;
}

function launch(options = {}) {
  const bin = findFfmpeg();
  if (!bin) {
    state.lastError =
      "ffmpeg پیدا نشد. فایل ffmpeg.exe را در پوشه resources برنامه قرار دهید یا در PATH نصب کنید.";
    return { ok: false, running: false, error: state.lastError };
  }
  let proc;
  try {
    proc = spawn(bin, captureArgs(options), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    state.lastError = `اجرای ffmpeg ناموفق بود: ${String(err && err.message)}`;
    return { ok: false, running: false, error: state.lastError };
  }
  state.proc = proc;
  state.startedAt = Date.now();
  state.lastError = "";
  state.buffer = [];
  state.bufferBytes = 0;
  state.bytesOut = 0;

  proc.stdout.on("data", (chunk) => {
    state.bytesOut += chunk.length;
    // Keep a small rolling buffer so a TV that connects later starts instantly.
    state.buffer.push(chunk);
    state.bufferBytes += chunk.length;
    while (state.bufferBytes > primingBytes() && state.buffer.length > 1) {
      state.bufferBytes -= state.buffer.shift().length;
    }
    for (const res of state.clients) {
      try {
        res.write(chunk);
      } catch {
        state.clients.delete(res);
      }
    }
  });
  proc.stderr.on("data", (d) => {
    // Late output from an abandoned attempt must never surface in the UI.
    if (state.proc && state.proc !== proc) return;
    const text = String(d).trim();
    if (!text) return;
    // Raw tail is kept for diagnostics/compatibility detection even when the
    // line is "benign" for the user-facing error.
    state.rawError = `${state.rawError || ""} ${text}`.slice(-1200).trim();
    const real = text
      .split(/\r?\n/)
      .filter(
        (line) => line.trim() && !isBenign(line, Boolean(!options.noAudio && options.audioDevice)),
      )
      .join(" ");
    if (real) state.lastError = real.slice(0, 300);
  });

  proc.on("error", (err) => {
    if (state.proc && state.proc !== proc) return;
    state.lastError = String(err && err.message);
    stop();
  });
  proc.on("exit", () => {
    if (state.proc === proc) state.proc = null;
    for (const res of state.clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    state.clients.clear();
  });

  // ffmpeg dies within ~1s when the audio device does not exist; the caller
  // (start) then retries with the next device / silent mode.
  if (probeFailed(proc)) {
    const chatter = `${state.lastError || ""} ${state.rawError || ""}`;
    // Newer ffmpeg builds removed some options; drop the rejected one and retry
    // instead of failing the whole share (this was the "share screen" error on
    // ffmpeg 9 builds, where `-async` / `-sc_threshold` no longer exist).
    const bad = rejectedOption(chatter);
    if (bad && !disabledOpts.has(bad) && disabledOpts.size < 12) {
      disabledOpts.add(bad);
      state.lastError = "";
      state.rawError = "";
      return launch(options);
    }
    // A drawtext/filter complaint is not a real capture failure: drop the
    // overlay and try once more so the screen still reaches the TV.
    if (!panelDisabled && /drawtext|No option|filter|AVFilter/i.test(chatter)) {
      panelDisabled = true;
      state.lastError = "";
      return launch(options);
    }
    // A GPU encoder that the driver refuses must fall back to software instead
    // of failing the whole share.
    if (
      !options.forceSoftware &&
      /nvenc|qsv|amf|videotoolbox|vaapi|Encoder|encoder|device|Cannot load/i.test(chatter)
    ) {
      state.lastError = "";
      return launch({ ...options, forceSoftware: true });
    }
    const detail = (state.lastError || state.rawError || "").slice(0, 300);
    return {
      ok: false,
      running: false,
      error: detail
        ? `ffmpeg اجرا نشد: ${detail}`
        : "ورودی صدا در دسترس نیست یا ffmpeg بلافاصله بسته شد",
      ffmpeg: bin,
    };
  }

  return { ok: true, running: true };
}

/** Blocks briefly to see whether ffmpeg exited right away (bad audio device). */
function probeFailed(proc) {
  const deadline = Date.now() + 900;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null || proc.signalCode) return true;
    try {
      require("node:child_process").execFileSync(
        process.platform === "win32" ? "cmd" : "sh",
        process.platform === "win32" ? ["/c", "ping -n 1 127.0.0.1 >nul"] : ["-c", "sleep 0.15"],
        { stdio: "ignore" },
      );
    } catch {
      break;
    }
  }
  return proc.exitCode !== null || Boolean(proc.signalCode);
}

/**
 * Resolves once real MPEG-TS bytes exist. The TV must never be pointed at a URL
 * that has no data yet — that is exactly what produces a black screen.
 */
function waitForData(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (state.bytesOut > 120_000) return resolve({ ok: true, bytes: state.bytesOut });
      if (!state.proc) return resolve({ ok: false, error: state.lastError || "ffmpeg متوقف شد" });
      if (Date.now() > deadline)
        return resolve({ ok: false, error: state.lastError || "تصویری از ffmpeg دریافت نشد" });
      setTimeout(tick, 150);
    };
    tick();
  });
}

function stop() {
  const proc = state.proc;
  state.proc = null;
  if (proc) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  for (const res of state.clients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  state.clients.clear();
  state.buffer = [];
  state.bufferBytes = 0;
  // Give the PC its sound back when the share ends.
  if (state.muted) setLocalMute(false);
  return { ok: true, running: false };
}

/** Attaches one HTTP response to the live stream (auto-starting if needed). */
function attach(req, res) {
  if (!state.proc) {
    // Some TVs open the URL a moment before/after our own start call, or
    // reconnect later. Restart the capture instead of answering 503.
    const started = start(state.options || {});
    if (!started.ok) {
      res.writeHead(503, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
      return res.end(`Desktop stream unavailable: ${started.error || ""}`);
    }
  }
  res.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Access-Control-Allow-Origin": "*",
    "transferMode.dlna.org": "Streaming",
    "contentFeatures.dlna.org":
      "DLNA.ORG_PN=MPEG_TS_SD_EU;DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=8d500000000000000000000000000000",
    Connection: "close",
    "Cache-Control": "no-cache",
  });
  if (req.method === "HEAD") return res.end();
  // Prime the renderer with recently muxed data (headers + a keyframe).
  for (const chunk of state.buffer) {
    try {
      res.write(chunk);
    } catch {
      break;
    }
  }
  state.clients.add(res);
  const drop = () => state.clients.delete(res);
  req.on("close", drop);
  res.on("close", drop);
  res.on("error", drop);
  return undefined;
}

function status() {
  return {
    running: Boolean(state.proc),
    viewers: state.clients.size,
    ffmpeg: findFfmpeg() || "",
    uptimeSec:
      state.startedAt && state.proc ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
    audioDevice: state.audioDevice || "",
    audio: Boolean(state.audioDevice),
    audioNote: state.audioNote || "",
    audioDevices: process.platform === "win32" ? listWindowsAudioDevices() : [],
    bytesOut: state.bytesOut,
    lastError: state.lastError,
    panel: { ...state.panel },
    localMuted: state.muted,
    profile: machineProfile(),
    droppedOptions: [...disabledOpts],
  };
}

/**
 * Two-second dry run of the real capture pipeline (video only, output thrown
 * away). Used by the repair button so the user learns *why* screen sharing
 * fails before pointing a TV at it.
 */
function selfTest() {
  const bin = findFfmpeg();
  if (!bin) return { ok: false, error: "ffmpeg پیدا نشد" };
  const args = pruneArgs([
    ...captureArgs({ noAudio: true, panel: false }).slice(0, -1),
    process.platform === "win32" ? "NUL" : "/dev/null",
  ]);
  try {
    const r = spawnSync(bin, ["-t", "2", ...args], {
      encoding: "utf8",
      timeout: 25000,
      windowsHide: true,
    });
    const text = `${r.stdout || ""}${r.stderr || ""}`;
    const bad = rejectedOption(text);
    if (bad && !disabledOpts.has(bad)) {
      disabledOpts.add(bad);
      return selfTest();
    }
    if (r.error) return { ok: false, error: String(r.error.message), ffmpeg: bin };
    if (r.status !== 0)
      return { ok: false, error: text.split(/\r?\n/).filter(Boolean).slice(-3).join(" "), ffmpeg: bin };
    return { ok: true, ffmpeg: bin, droppedOptions: [...disabledOpts] };
  } catch (err) {
    return { ok: false, error: String(err && err.message), ffmpeg: bin };
  }
}

module.exports = {
  selfTest,

  start,
  stop,
  attach,
  status,
  findFfmpeg,
  resetFfmpeg,
  waitForData,
  setPanel,
  setLocalMute,
  WIN_AUDIO_DEVICES,
  listWindowsAudioDevices,
  machineProfile,
  detectHwEncoder,
  disableHwEncoder,

  setTuning,
  getTuning,
};
