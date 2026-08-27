const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");

const dlna = require("./dlna-server.cjs");
const ssdp = require("./ssdp.cjs");
const avt = require("./avtransport.cjs");
const cast = require("./chromecast.cjs");
const subs = require("./subtitles.cjs");
const resolver = require("./resolve.cjs");
const m3u = require("./m3u.cjs");
const screen = require("./screen-cast.cjs");
const guard = require("./stall-guard.cjs");
const hlsRemux = require("./hls-remux.cjs");
const linkCatcher = require("./link-catcher.cjs");
const tools = require("./tools.cjs");
const downloader = require("./downloader.cjs");
const splashCast = require("./splash-cast.cjs");
const probe = require("./probe.cjs");
const hostKeys = require("./host-keys.cjs");
const health = require("./health-monitor.cjs");
const deps = require("./deps.cjs");
const plugins = require("./plugins.cjs");


const PORT = Number(process.env.UMS_PORT || 8080);
const EXTERNAL_URL = process.env.UMS_APP_URL || "";
const APP_URL = EXTERNAL_URL || `http://localhost:${PORT}`;
const SPLASH_MS = 5000;
const APP_VERSION = app.getVersion();
const UPDATE_URL = "https://github.com/";

let serverProcess = null;
let splashWindow = null;
let mainWindow = null;

// ---------------------------------------------------------------- media state

const mediaState = {
  settings: {
    port: 5001,
    networkIp: "",
    serverName: "Universal Media Server",
    dlnaEnabled: true,
    upnpEnabled: true,
    transcodeHls: true,
    logoOnBuffer: true,
    // Audio/video offset (ms) applied to streams remuxed for the TV.
    avOffsetMs: 0,
    // "auto" | "low" | "high" — low keeps buffers and effects small on weak PCs.
    perfMode: "auto",
    // Relaunch the app by itself when the window stops responding.
    autoRestart: false,
    // ---- manual performance tuning (settings page → "تنظیم دستی عملکرد")
    captureFps: 0, // 0 = automatic hardware profile, otherwise 15..60
    captureKbps: 0,
    gopFrames: 0, // fixed keyframe interval (8 / 15…) = short buffer chain
    segmentMs: 1000, // output chunk length in ms (500–1000 = low delay)
    lightPanel: false, // drawtext re-read once per second instead of per frame
    // The TV always lags behind; the in-app preview is delayed by the same
    // amount so both pictures are seen at the same moment.
    previewDelayMs: 0,
    // Logo splash on the TV whenever the picture is not there yet.
    tvSplash: true,
  },
  uuid: "uuid:2f402f80-da50-11e1-9b23-0017880a1b2c",
  devices: [],
  castDevices: [],
  advertising: false,
};

const settingsFile = () => path.join(app.getPath("userData"), "ums-settings.json");

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsFile(), "utf8");
    Object.assign(mediaState.settings, JSON.parse(raw));
  } catch {
    /* first run */
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(mediaState.settings, null, 2));
  } catch {
    /* ignore */
  }
}

function emit(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ums:event", payload);
}

function activeIp() {
  const chosen = mediaState.settings.networkIp || ssdp.primaryIPv4();
  // A loopback address is unreachable from the TV: fall back to any LAN NIC.
  if (!chosen || /^127\./.test(chosen)) {
    const lan = (ssdp.localIPv4List() || []).find((i) => !/^127\./.test(i.address));
    return lan ? lan.address : chosen || "127.0.0.1";
  }
  return chosen;
}

/** Pushes the manual tuning values into the capture / remux engines. */
function applyTuning() {
  const s = mediaState.settings;
  screen.setTuning({
    fps: s.captureFps,
    kbps: s.captureKbps,
    gop: s.gopFrames,
    segmentMs: s.segmentMs,
    lightPanel: s.lightPanel,
  });
  hlsRemux.setSegmentMs(s.segmentMs);
}

async function startMediaStack() {
  hlsRemux.stopAll();
  applyTuning();
  hlsRemux.setAvOffset(mediaState.settings.avOffsetMs || 0);
  dlna.setTranscodeHls(mediaState.settings.transcodeHls !== false);
  dlna.setBrandingImage(resolveAsset("app-logo.png") || "");
  dlna.setSplashImage(resolveAsset("splash-bg.jpg") || "", resolveAsset("app-logo.png") || "");
  const res = await dlna.start({
    port: Number(mediaState.settings.port) || 5001,
    host: "0.0.0.0",
    name: mediaState.settings.serverName,
    uuid: mediaState.uuid,
  });
  ssdp.stopAdvertise();
  mediaState.advertising = false;
  if (res.ok && (mediaState.settings.dlnaEnabled || mediaState.settings.upnpEnabled)) {
    const adv = await ssdp.advertise({
      ip: activeIp(),
      port: res.port,
      uuid: mediaState.uuid,
      name: mediaState.settings.serverName,
    });
    mediaState.advertising = Boolean(adv && adv.ok);
  }
  emit({ type: "server", ...serverStatus() });
  return res;
}

function serverStatus() {
  const s = dlna.status();
  return {
    ...s,
    ip: activeIp(),
    advertising: mediaState.advertising,
    baseUrl: `http://${activeIp()}:${s.port}`,
    interfaces: ssdp.localIPv4List(),
    version: APP_VERSION,
  };
}

// ---------------------------------------------------------------- IPC

// Fast, safe channel switching -------------------------------------------------
// Pressing "share" on a second channel while the first one is still playing used
// to hang the app: the old ffmpeg remux kept writing into a socket the TV had
// already dropped, and two SOAP SetAVTransportURI calls raced each other. Every
// play now bumps a sequence number, tears the previous session down first and
// abandons its own work if a newer request arrived meanwhile.
let playSeq = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function registerIpc() {
  ipcMain.handle("ums:getStatus", () => serverStatus());
  ipcMain.handle("ums:getNetwork", () => ({
    ip: ssdp.primaryIPv4(),
    interfaces: ssdp.localIPv4List(),
  }));

  ipcMain.handle("ums:applySettings", async (_e, settings) => {
    const next = settings && typeof settings === "object" ? settings : {};
    const portChanged = Number(next.port) !== Number(mediaState.settings.port);
    const ipChanged = String(next.networkIp || "") !== String(mediaState.settings.networkIp || "");
    const nameChanged = next.serverName !== mediaState.settings.serverName;
    const protoChanged =
      Boolean(next.dlnaEnabled) !== Boolean(mediaState.settings.dlnaEnabled) ||
      Boolean(next.upnpEnabled) !== Boolean(mediaState.settings.upnpEnabled);
    Object.assign(mediaState.settings, next);
    saveSettings();
    applyTuning();
    const offsetChanged = hlsRemux.getAvOffset() !== (Number(next.avOffsetMs) || 0);
    hlsRemux.setAvOffset(mediaState.settings.avOffsetMs || 0);
    // A live remux must restart to pick up the new audio delay.
    if (offsetChanged) hlsRemux.stopAll();
    if (portChanged || ipChanged || nameChanged || protoChanged || !dlna.status().running) {
      const res = await startMediaStack();
      return { ...serverStatus(), restarted: true, ok: res.ok, error: res.error || "" };
    }
    return { ...serverStatus(), restarted: false, ok: true };
  });

  ipcMain.handle("ums:restartServer", async () => {
    const res = await startMediaStack();
    return { ...serverStatus(), ok: res.ok, error: res.error || "" };
  });

  ipcMain.handle("ums:setMedia", (_e, items) => ({ count: dlna.setMedia(items) }));

  ipcMain.handle("ums:mediaUrl", (_e, id) => {
    const s = dlna.status();
    return `http://${activeIp()}:${s.port}/media/${encodeURIComponent(String(id))}`;
  });

  ipcMain.handle("ums:pickFiles", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "انتخاب فایل رسانه",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "ویدیو", extensions: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "ts"] },
        { name: "صدا", extensions: ["mp3", "aac", "flac", "wav"] },
        { name: "همه فایل‌ها", extensions: ["*"] },
      ],
    });
    if (res.canceled) return [];
    return res.filePaths.map((p) => {
      let sizeMb = 0;
      try {
        sizeMb = Math.round((fs.statSync(p).size / 1048576) * 10) / 10;
      } catch {
        /* ignore */
      }
      return { path: p, name: path.basename(p), sizeMb };
    });
  });

  // Picks subtitle files (.srt/.vtt/.ass) and, when a mediaId is given, binds
  // them to that media entry so /subtitle/:id can serve them.
  ipcMain.handle("ums:pickSubtitle", async (_e, payload) => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "انتخاب فایل زیرنویس",
      properties: ["openFile"],
      filters: [
        { name: "زیرنویس", extensions: ["srt", "vtt", "ass", "ssa", "sub"] },
        { name: "همه فایل‌ها", extensions: ["*"] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return null;
    const file = res.filePaths[0];
    const mediaId = payload?.mediaId ? String(payload.mediaId) : "";
    if (mediaId) dlna.setSubtitle(mediaId, file);
    return { path: file, name: path.basename(file) };
  });

  ipcMain.handle("ums:setSubtitle", (_e, p) => ({
    ok: dlna.setSubtitle(p?.mediaId, p?.file || ""),
  }));

  ipcMain.handle("ums:scanDevices", async (_e, options) => {
    const timeout = Math.min(10000, Math.max(1500, Number(options?.timeout) || 4000));
    const [renderers, casts] = await Promise.all([
      ssdp.discover({ timeout }),
      cast.discover({ timeout }).catch(() => []),
    ]);
    mediaState.devices = renderers;
    mediaState.castDevices = casts;
    const dlnaList = renderers.map((d) => ({
      id: d.udn || `${d.ip}:${d.port}`,
      name: d.name,
      model: d.model || "",
      manufacturer: d.manufacturer || "",
      ip: d.ip,
      protocol: d.protocol,
      avTransportUrl: d.avTransportUrl,
      renderingControlUrl: d.renderingControlUrl,
      location: d.location,
    }));
    const castList = casts.map((d) => ({
      id: d.id,
      name: d.name,
      model: d.model || "Chromecast",
      manufacturer: d.manufacturer || "Google Cast",
      ip: d.ip,
      port: d.port,
      protocol: "Cast",
      avTransportUrl: "",
      renderingControlUrl: "",
      location: "",
    }));
    return [...dlnaList, ...castList];
  });

  const isCast = (p) => String(p?.protocol || "") === "Cast" || Boolean(p?.castIp);
  const castTarget = (p) => ({ ip: p?.ip || p?.castIp, port: Number(p?.port) || 8009 });

  ipcMain.handle("ums:addMedia", (_e, item) => ({ id: dlna.addMedia(item) }));
  ipcMain.handle("ums:localBase", () => `http://127.0.0.1:${dlna.status().port}`);

  const deviceKey = (p) =>
    isCast(p)
      ? `cast:${p?.ip || p?.castIp}:${Number(p?.port) || 8009}`
      : String(p?.controlUrl || "");

  const sendToDevice = (p, url, mime, live, title, subtitle) =>
    isCast(p)
      ? cast.play({
          ...castTarget(p),
          url,
          title: title || "Universal Media Server",
          mime,
          subtitle,
        })
      : avt.play({ controlUrl: p?.controlUrl, url, title: title || "UMS", mime, subtitle, live });

  ipcMain.handle("ums:play", async (_e, payload) => {
    const { controlUrl, url, title, mime, subtitle } = payload || {};
    let mediaId = payload?.mediaId;
    const s = dlna.status();
    if (!s.running) return { ok: false, error: "سرور رسانه اجرا نیست" };
    const base = `http://${activeIp()}:${s.port}`;
    if (!mediaId && !url) return { ok: false, error: "لینک یا فایل مشخص نشده است" };

    // --- tear the previous session down before touching the TV again
    const seq = ++playSeq;
    const key = deviceKey(payload);
    guard.unwatch(payload || {});
    hlsRemux.stopAll();

    // --- startup animation while the real stream is resolving, so the TV
    //     never shows a black screen during a channel/link change.
    let splashAt = 0;
    if (
      key &&
      mediaState.settings.tvSplash !== false &&
      splashCast.available() &&
      payload?.splash !== false
    ) {
      const okSplash = await sendToDevice(
        payload,
        `${base}/splash.ts`,
        "video/mp2t",
        true,
        mediaState.settings.serverName,
        "",
      ).catch(() => ({ ok: false }));
      if (okSplash?.ok) splashAt = Date.now();
    }

    // A raw link (IPTV channel, web video…) is never handed to the TV directly:
    // TVs fail on HTTPS/TLS, redirects and cookies. We register it in the media
    // registry and let the local proxy serve plain HTTP with correct DLNA flags.
    if (!mediaId && url) {
      mediaId = dlna.addMedia({
        id: `link-${Buffer.from(String(url)).toString("base64url").slice(0, 24)}`,
        title: title || "پخش زنده",
        source: url,
        mime: mime || dlna.mimeFor(url),
        ...(subtitle ? { subtitle } : {}),
      });
      if (!mediaId) return { ok: false, error: "این لینک قابل استفاده نیست" };
    }

    if (mediaId && subtitle) dlna.setSubtitle(mediaId, subtitle);

    // Resolve share pages (Aparat, YouTube…) to a direct stream first.
    let effectiveMime = mime || "video/mp4";
    const resolved = await dlna.resolveItem(mediaId).catch(() => null);
    if (resolved && resolved.mime) effectiveMime = mime || resolved.mime;
    if (resolved && !resolved.ok && resolved.error) return { ok: false, error: resolved.error };

    const item = dlna.getMedia(mediaId);
    const sourceForType = (resolved && resolved.url) || item?.source || url || "";
    const live = dlna.isLiveSource(sourceForType) || /mpegurl|mp2t/i.test(String(effectiveMime));
    const casting = isCast(payload);

    // Old DLNA TVs cannot open an .m3u8 at all → remux to MPEG-TS with ffmpeg.
    // Chromecast plays HLS natively, so it keeps the playlist URL.
    const remux =
      live &&
      !casting &&
      (/\.(m3u8|ts)(\?|$)/i.test(String(sourceForType)) ||
        /mpegurl|mp2t/i.test(String(effectiveMime))) &&
      mediaState.settings.transcodeHls !== false &&
      hlsRemux.available();

    let target = remux
      ? `${base}/live/${encodeURIComponent(mediaId)}.ts`
      : `${base}/media/${encodeURIComponent(mediaId)}`;
    if (remux) effectiveMime = "video/mp2t";
    else if (live && !casting)
      effectiveMime = /mp2t/i.test(effectiveMime) ? "video/mp2t" : "application/vnd.apple.mpegurl";

    // Chromecast only understands WebVTT; TVs get the original SRT/ASS file.
    const subUrl = item?.subtitle ? dlna.subtitleUrl(base, item, casting) : "";
    const splashUrl = `${base}/splash.ts`;

    if (seq !== playSeq) return { ok: false, superseded: true, error: "" };
    // Let the entrance become visible, but never hold the requested picture
    // for the old fixed five-second delay once it is ready.
    if (splashAt) await sleep(Math.max(0, 900 - (Date.now() - splashAt)));
    if (seq !== playSeq) return { ok: false, superseded: true, error: "" };

    const res = casting
      ? await cast.play({
          ...castTarget(payload),
          url: target,
          title: title || "Universal Media Server",
          mime: effectiveMime,
          subtitle: subUrl,
        })
      : await avt.play({
          controlUrl,
          url: target,
          title: title || "UMS",
          mime: effectiveMime,
          subtitle: subUrl,
          live,
        });

    // The stall guard seeks back to the last position — impossible on a live
    // stream, so it only runs for on-demand files.
    if (res.ok && !live && mediaState.settings.logoOnBuffer !== false) {
      guard.watch({
        target: casting
          ? { protocol: "Cast", ...castTarget(payload) }
          : { protocol: "DLNA", controlUrl },
        mediaUrl: target,
        logoUrl: splashUrl,
        title: title || "Universal Media Server",
        mime: effectiveMime,
        subtitle: subUrl,
        emit,
      });
    }
    return { ...res, url: target, subtitle: subUrl, mime: effectiveMime, mediaId, live };
  });

  // ---- playlist (IPTV / HLS master) reader — VLC-style channel list
  ipcMain.handle("ums:loadPlaylist", async (_e, p) => {
    const source = String(p?.source || "").trim();
    return m3u.load(source);
  });

  ipcMain.handle("ums:pickPlaylistFile", async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "انتخاب فایل پلی‌لیست",
      properties: ["openFile"],
      // `properties` is the correct Electron key; `filters` narrows to playlists.
      filters: [
        { name: "پلی‌لیست", extensions: ["m3u", "m3u8"] },
        { name: "همه فایل‌ها", extensions: ["*"] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return { path: res.filePaths[0], name: path.basename(res.filePaths[0]) };
  });

  // ---- desktop screen mirroring to the TV
  ipcMain.handle("ums:screenStatus", () => screen.status());
  // On-TV control panel + local speaker mute during desktop sharing
  ipcMain.handle("ums:screenPanel", (_e, p) => screen.setPanel(p || {}));
  // Floating desktop panel: real keystrokes to whatever plays on the shared screen
  ipcMain.handle("ums:hostKey", (_e, p) => hostKeys.sendKey(p?.action, p?.repeat));
  ipcMain.handle("ums:screenMuteLocal", (_e, on) => ({
    ok: screen.setLocalMute(on !== false),
    muted: screen.status().localMuted,
  }));
  // Floating browser-link catcher (clipboard watcher)
  ipcMain.handle("ums:setLinkCatcher", (_e, on) => linkCatcher.setEnabled(on !== false));
  ipcMain.handle("ums:stopScreenShare", (_e, p) => {
    if (p && (p.controlUrl || p.ip)) {
      guard.unwatch(p);
      if (isCast(p)) void cast.stop(castTarget(p));
      else void avt.stop({ controlUrl: p.controlUrl });
    }
    return screen.stop();
  });
  ipcMain.handle("ums:shareScreen", async (_e, payload) => {
    const s = dlna.status();
    if (!s.running) return { ok: false, error: "سرور رسانه اجرا نیست" };
    if (!screen.findFfmpeg() && !screen.resetFfmpeg()) {
      return {
        ok: false,
        error:
          "ffmpeg پیدا نشد؛ بدون آن اشتراک صفحه فقط تصویر سیاه می‌دهد. فایل ffmpeg.exe را در پوشه resources برنامه قرار دهید.",
      };
    }
    const ip = activeIp();
    if (/^127\./.test(ip)) {
      return { ok: false, error: "آدرس شبکه محلی پیدا نشد؛ اتصال کابل/وای‌فای را بررسی کنید" };
    }
    // Show the logo on the TV immediately: capture + DLNA handshake take a few
    // seconds and a renderer with no bytes shows a black screen instead.
    const base = `http://${ip}:${s.port}`;
    let splashAt = 0;
    if (mediaState.settings.tvSplash !== false && splashCast.available()) {
      const okSplash = await sendToDevice(
        payload,
        `${base}/splash.ts`,
        "video/mp2t",
        true,
        mediaState.settings.serverName,
        "",
      ).catch(() => ({ ok: false }));
      if (okSplash?.ok) splashAt = Date.now();
    }
    const startOpts = {
      fps: payload?.fps,
      kbps: payload?.kbps,
      gop: payload?.gop,
      muteLocal: payload?.muteLocal,
      panel: payload?.panel,
      panelText: payload?.panelText,
    };
    let started = screen.start(startOpts);
    if (!started.ok) return started;
    // Never point the TV at a URL with no bytes yet — that is the black screen.
    let ready = await screen.waitForData(9000);
    if (!ready.ok) {
      // A GPU encoder can be listed and still be refused by the driver
      // ("Cannot load cuMemAllocAsync" / "Error while opening encoder"). ffmpeg
      // then dies a few seconds in — after the fast probe — so we retry once
      // with pure software encoding before giving up on the share.
      screen.stop();
      const chatter = String(ready.error || "");
      if (/nvenc|qsv|amf|vaapi|videotoolbox|encoder|cannot load|cuMem/i.test(chatter)) {
        screen.disableHwEncoder();
        started = screen.start({ ...startOpts, forceSoftware: true });
        ready = started.ok
          ? await screen.waitForData(12000)
          : { ok: false, error: started.error };
      }
      if (!ready.ok) {
        screen.stop();
        return { ok: false, error: ready.error || "تصویر دسکتاپ آماده نشد" };
      }
    }

    const url = `${base}/desktop.ts`;
    // Keep the logo up until the real picture is actually ready, then swap.
    if (splashAt) await sleep(Math.max(0, 1200 - (Date.now() - splashAt)));
    const res = isCast(payload)
      ? await cast.play({
          ...castTarget(payload),
          url,
          title: "صفحه دسکتاپ",
          mime: "video/mp2t",
        })
      : await avt.play({
          controlUrl: payload?.controlUrl,
          url,
          title: "صفحه دسکتاپ",
          mime: "video/mp2t",
          live: true,
        });
    if (!res.ok) screen.stop();
    const st = screen.status();
    return {
      ...res,
      url,
      live: true,
      ffmpeg: st.ffmpeg,
      audio: st.audio,
      audioDevice: st.audioDevice,
      note: st.audioNote,
    };
  });

  ipcMain.handle("ums:stop", (_e, p) => {
    guard.unwatch(p || {});
    playSeq += 1;
    hlsRemux.stopAll();
    splashCast.stop();
    return isCast(p) ? cast.stop(castTarget(p)) : avt.stop({ controlUrl: p?.controlUrl });
  });
  ipcMain.handle("ums:pause", (_e, p) =>
    isCast(p) ? cast.pause(castTarget(p)) : avt.pause({ controlUrl: p?.controlUrl }),
  );
  ipcMain.handle("ums:resume", (_e, p) =>
    isCast(p) ? cast.resume(castTarget(p)) : avt.resume({ controlUrl: p?.controlUrl }),
  );
  ipcMain.handle("ums:seek", (_e, p) => {
    const seconds = Math.max(0, Math.floor(Number(p?.seconds) || 0));
    if (isCast(p)) return cast.seek({ ...castTarget(p), seconds });
    return avt.seek({ controlUrl: p?.controlUrl, target: subs.secondsToTime(seconds) });
  });
  ipcMain.handle("ums:setVolume", (_e, p) =>
    isCast(p)
      ? cast.setVolume({ ...castTarget(p), volume: Number(p?.volume) || 0 })
      : avt.setVolume({ controlUrl: p?.controlUrl, volume: p?.volume }),
  );
  ipcMain.handle("ums:setMute", (_e, p) =>
    isCast(p)
      ? cast.setVolume({ ...castTarget(p), mute: Boolean(p?.mute) })
      : avt.setMute({ controlUrl: p?.controlUrl, mute: p?.mute }),
  );
  ipcMain.handle("ums:deviceState", async (_e, p) => {
    if (isCast(p)) return cast.state(castTarget(p));
    const [info, pos] = await Promise.all([
      avt.transportInfo({ controlUrl: p?.controlUrl }),
      avt.positionInfo({ controlUrl: p?.controlUrl }),
    ]);
    return { ...info, position: pos };
  });

  ipcMain.handle("ums:openExternal", (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });
  // ---- open a link in the VLC player installed on this machine
  ipcMain.handle("ums:openInVlc", async (_e, url) => {
    const link = String(url || "").trim();
    if (!link) return { ok: false, error: "لینک خالی است" };
    const candidates =
      process.platform === "win32"
        ? [
            path.join(
              process.env["ProgramFiles"] || "C:\\Program Files",
              "VideoLAN",
              "VLC",
              "vlc.exe",
            ),
            path.join(
              process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
              "VideoLAN",
              "VLC",
              "vlc.exe",
            ),
            "vlc.exe",
          ]
        : process.platform === "darwin"
          ? ["/Applications/VLC.app/Contents/MacOS/VLC", "vlc"]
          : ["/usr/bin/vlc", "vlc"];
    const bin = candidates.find((c) => {
      try {
        return c.includes(path.sep) ? fs.existsSync(c) : true;
      } catch {
        return false;
      }
    });
    if (!bin) return { ok: false, error: "VLC روی این سیستم پیدا نشد" };
    try {
      const child = spawn(bin, [link], { detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // ---- online translation (auto-detect -> target language, default Persian)
  ipcMain.handle("ums:translate", async (_e, payload) => {
    const text = String(payload?.text || "");
    const target = String(payload?.target || "fa");
    if (!text.trim()) return { ok: true, text: "", detected: "auto" };
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=" +
      encodeURIComponent(target) +
      "&q=" +
      encodeURIComponent(text);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      const out = (data[0] || []).map((p) => p[0]).join("");
      return { ok: true, text: out, detected: String(data[2] || "auto") };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  });

  // ---- system pressure / hang watchdog + app restart
  ipcMain.handle("ums:systemLoad", () => health.snapshot());
  ipcMain.handle("ums:heartbeat", () => health.heartbeat());
  ipcMain.handle("ums:setAutoRestart", (_e, on) => {
    mediaState.settings.autoRestart = on !== false;
    saveSettings();
    return health.setAutoRestart(on !== false);
  });
  ipcMain.handle("ums:restartApp", () => health.restartApp());
  // ---- on-TV mouse control panel (channels + subtitle/dub)
  ipcMain.handle("ums:remoteSetChannels", (_e, p) => ({
    ok: true,
    count: dlna.remote.setChannels(p?.channels || p || []),
  }));
  ipcMain.handle("ums:remoteSetFlags", (_e, p) => dlna.remote.setFlags(p || {}));
  ipcMain.handle("ums:remoteUrl", () => {
    const s = dlna.status();
    return `http://${activeIp()}:${s.port}/remote`;
  });

  ipcMain.handle("ums:appVersion", () => APP_VERSION);
  // ---- helper binaries (ffmpeg / yt-dlp) — never let a missing tool break a button
  ipcMain.handle("ums:toolStatus", () => tools.report());
  ipcMain.handle("ums:ensureTools", async () => {
    await tools.ensureTool("yt-dlp");
    screen.resetFfmpeg?.();
    return tools.report();
  });

  // ---- real downloads (YouTube / Instagram / TikTok / direct links)
  ipcMain.handle("ums:downloadStart", (_e, p) => downloader.start(p));
  ipcMain.handle("ums:downloadCancel", (_e, p) => downloader.cancel(p?.id || p));
  ipcMain.handle("ums:downloadList", () => downloader.list());
  ipcMain.handle("ums:downloadFolder", () => {
    const dir = path.join(app.getPath("videos"), "UniversalMediaServer");
    void shell.openPath(dir);
    return dir;
  });
  ipcMain.handle("ums:revealFile", (_e, file) => {
    if (file) shell.showItemInFolder(String(file));
    return { ok: Boolean(file) };
  });

  // ---- channel health (green / red dot next to every channel)
  ipcMain.handle("ums:probeStreams", (_e, p) => probe.check(p));

  ipcMain.handle("ums:checkUpdate", () => ({
    current: APP_VERSION,
    url: UPDATE_URL,
  }));

  // ---- dependency doctor: check, install/update, then restart the whole app
  ipcMain.handle("ums:depsCheck", () => deps.check());
  ipcMain.handle("ums:depsTest", () => screen.selfTest());
  ipcMain.handle("ums:depsRepair", async (_e, p) => {
    const res = await deps.repair({ force: p?.force === true });
    if (p?.restart) {
      setTimeout(() => health.restartApp(), 800);
      return { ...res, restarting: true };
    }
    return res;
  });

  // ---- plugins (افزونه‌ها): extend the app without rebuilding it
  ipcMain.handle("ums:pluginList", () => plugins.list());
  ipcMain.handle("ums:pluginFolder", () => {
    const dir = plugins.pluginsDir();
    shell.openPath(dir);
    return dir;
  });
  ipcMain.handle("ums:pluginSetEnabled", (_e, p) =>
    plugins.setEnabled(String(p?.id || ""), p?.enabled !== false),
  );
  ipcMain.handle("ums:pluginRemove", (_e, p) => plugins.remove(String(p?.id || p || "")));
  ipcMain.handle("ums:pluginReload", () => plugins.loadAll());
  ipcMain.handle("ums:pluginInstall", async (_e, p) => {
    let source = String(p?.path || "");
    if (!source) {
      const res = await dialog.showOpenDialog(mainWindow, {
        title: "انتخاب افزونه (فایل zip یا پوشه)",
        properties: ["openFile", "openDirectory"],
        filters: [
          { name: "افزونه", extensions: ["zip"] },
          { name: "همه فایل‌ها", extensions: ["*"] },
        ],
      });
      if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
      source = res.filePaths[0];
    }
    return plugins.install(source);
  });
}


// ---------------------------------------------------------------- app shell

function resolveServerEntry() {
  const roots = [
    path.join(__dirname, ".."),
    path.join(process.resourcesPath || "", "app"),
    process.resourcesPath || "",
  ];
  const candidates = [
    path.join(".output", "server", "index.mjs"),
    path.join("dist", "server", "index.mjs"),
    path.join("dist", "server", "server.js"),
  ];
  for (const root of roots) {
    for (const rel of candidates) {
      const full = path.join(root, rel);
      if (root && fs.existsSync(full)) return full;
    }
  }
  return null;
}

function resolveAsset(name) {
  const roots = [
    path.join(__dirname, "..", "public"),
    path.join(__dirname, "..", ".output", "public"),
    path.join(process.resourcesPath || "", "app", "public"),
    path.join(process.resourcesPath || "", "app", ".output", "public"),
  ];
  for (const root of roots) {
    const full = path.join(root, name);
    if (root && fs.existsSync(full)) return full;
  }
  return null;
}

function startServer() {
  if (EXTERNAL_URL) return true;
  const entry = resolveServerEntry();
  if (!entry) return false;
  serverProcess = spawn(process.execPath, [entry], {
    cwd: path.dirname(path.dirname(entry)),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(PORT),
      HOST: process.env.UMS_HOST || "127.0.0.1",
    },
    stdio: "ignore",
  });
  serverProcess.on("error", () => {
    serverProcess = null;
  });
  return true;
}

function waitForServer(tries = 60) {
  return new Promise((resolve) => {
    const attempt = (left) => {
      const req = http.get(APP_URL, () => resolve(true));
      req.on("error", () => {
        if (left <= 0) return resolve(false);
        setTimeout(() => attempt(left - 1), 500);
      });
    };
    attempt(tries);
  });
}

function toDataUrl(file) {
  if (!file) return "";
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function createSplash() {
  const logo = toDataUrl(resolveAsset("app-logo.png"));
  const bg = toDataUrl(resolveAsset("splash-bg.jpg"));

  splashWindow = new BrowserWindow({
    width: 900,
    height: 540,
    frame: false,
    resizable: false,
    center: true,
    show: true,
    backgroundColor: "#0a1024",
    title: "Universal Media Server",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const html = `<html><body style="margin:0;overflow:hidden;background:#0a1024;height:100vh;display:grid;place-items:center">
    <div style="position:absolute;inset:0;background:url('${bg}') center/cover no-repeat;opacity:.4;animation:pan 5s ease-out both"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,16,36,.6),rgba(10,16,36,.95))"></div>
    <div style="position:relative;text-align:center;font-family:Segoe UI,sans-serif">
      <img src="${logo}" style="width:320px;animation:zoom 1.6s cubic-bezier(.16,1,.3,1) both;filter:drop-shadow(0 0 60px rgba(255,190,60,.45))"/>
      <p style="color:#f3c969;font-size:22px;font-weight:700;letter-spacing:.08em;animation:rise 1.8s cubic-bezier(.16,1,.3,1) both">UNIVERSAL MEDIA SERVER</p>
      <div style="margin:0 auto;width:240px;height:6px;border-radius:99px;background:rgba(243,201,105,.2);overflow:hidden">
        <div style="height:100%;background:#f3c969;animation:fill 4.6s linear both"></div>
      </div>
    </div>
    <style>
      @keyframes zoom{0%{transform:scale(.55) rotate(-8deg);opacity:0;filter:blur(14px)}45%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}
      @keyframes rise{0%,25%{transform:translateY(24px);opacity:0;letter-spacing:.4em}100%{transform:translateY(0);opacity:1;letter-spacing:.08em}}
      @keyframes pan{0%{transform:scale(1.15)}100%{transform:scale(1.28)}}
      @keyframes fill{0%{width:0}100%{width:100%}}
    </style>
  </body></html>`;

  splashWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function buildMenu() {
  const go = (route) => () => {
    if (mainWindow && !mainWindow.isDestroyed()) emit({ type: "navigate", to: route });
  };
  const template = [
    {
      label: "برنامه",
      submenu: [
        { label: "خانه", click: go("/") },
        { label: "دستگاه‌های شبکه", click: go("/devices") },
        { label: "وضعیت سرور", click: go("/status") },
        { label: "تنظیمات", click: go("/settings") },
        { type: "separator" },
        { role: "quit", label: "خروج" },
      ],
    },
    {
      label: "سرور",
      submenu: [
        {
          label: "راه‌اندازی مجدد سرور رسانه",
          click: async () => {
            await startMediaStack();
          },
        },
        {
          label: "جست‌وجوی دستگاه‌ها",
          click: go("/devices"),
        },
      ],
    },
    {
      label: "نمایش",
      submenu: [
        { role: "reload", label: "بارگذاری مجدد" },
        { role: "toggleDevTools", label: "ابزار توسعه‌دهنده" },
        { type: "separator" },
        { role: "resetZoom", label: "بازنشانی بزرگ‌نمایی" },
        { role: "zoomIn", label: "بزرگ‌نمایی" },
        { role: "zoomOut", label: "کوچک‌نمایی" },
        { role: "togglefullscreen", label: "تمام‌صفحه" },
      ],
    },
    {
      label: "راهنما",
      submenu: [
        {
          label: `نسخه ${APP_VERSION}`,
          enabled: false,
        },
        {
          label: "بررسی به‌روزرسانی",
          click: () => shell.openExternal(UPDATE_URL),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(ok) {
  const iconPath = path.join(__dirname, "..", "public", "favicon.ico");
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#0a1024",
    autoHideMenuBar: true,
    title: "Universal Media Server",
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  mainWindow = win;

  // Small always-on-top bubble that offers to cast/download any video link the
  // user copies from any installed browser.
  const onCaught = ({ action, url, title }) => {
    emit({ type: "link-caught", action, url, title });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  // Links sent by the Chrome/Edge extension arrive over /api/catch.
  try {
    dlna.setCatchHandler(onCaught);
  } catch {
    /* server module without the hook */
  }
  linkCatcher.start(({ action, url, title }) => {
    emit({ type: "link-caught", action, url, title });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  if (ok) {
    win.loadURL(APP_URL);
  } else {
    const msg =
      "سرور برنامه اجرا نشد.<br/>مطمئن شوید برنامه با بیلد <code>NITRO_PRESET=node-server</code> ساخته شده " +
      "و پوشه <code>.output/server</code> کنار برنامه وجود دارد.<br/>آدرس: " +
      APP_URL;
    win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<html dir="rtl"><body style="background:#0a1024;color:#e6ecff;font-family:sans-serif;padding:40px;line-height:2">
           <h2>Universal Media Server</h2><p>${msg}</p></body></html>`,
        ),
    );
  }

  win.once("ready-to-show", () => {
    closeSplash();
    win.maximize();
    win.show();
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

app.whenReady().then(async () => {
  loadSettings();
  // Helper binaries + download folder must exist before any button is pressed.
  tools.setUserDataDir(app.getPath("userData"));
  downloader.setOutputDir(path.join(app.getPath("videos"), "UniversalMediaServer"));
  downloader.setNotifier(emit);
  void tools.ensureTool("yt-dlp");
  // Plugins: loaded from <userData>/plugins so new features can be added
  // without reinstalling the app.
  plugins.setPluginsDir(path.join(app.getPath("userData"), "plugins"));
  plugins.setHostApi({
    version: APP_VERSION,
    paths: { userData: app.getPath("userData"), plugins: plugins.pluginsDir() },
    ipcMain,
    emit,
    addMedia: (item) => dlna.addMedia(item),
    mediaStatus: () => dlna.status(),
    screen,
    tools,
    log: (...args) => console.log("[plugin]", ...args),
  });
  plugins.loadAll();
  registerIpc();

  // Load/hang watchdog: reports CPU/RAM pressure to the UI and can relaunch.
  health.start({
    emit,
    app,
    autoRestart: mediaState.settings.autoRestart === true,
  });
  // The TV control panel hands its clicks back to the UI.
  dlna.remote.setHandler((action) => emit({ type: "remote", ...action }));
  buildMenu();
  createSplash();
  const splashStarted = Date.now();
  const started = startServer();
  const [ok] = await Promise.all([
    started ? waitForServer() : Promise.resolve(false),
    startMediaStack(),
  ]);
  const remaining = SPLASH_MS - (Date.now() - splashStarted);
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  createWindow(ok);
  // Safety net: never leave the splash hanging if the page never becomes ready.
  setTimeout(closeSplash, 20000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(ok);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  ssdp.stopAdvertise();
  hlsRemux.stopAll();
  splashCast.stop();
  downloader.stopAll();
  screen.stop();
  linkCatcher.stop();
  dlna.stop();
  if (serverProcess) serverProcess.kill();
});
