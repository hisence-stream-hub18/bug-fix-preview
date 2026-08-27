// Secure bridge: exposes window.ums to the renderer (contextIsolation stays on).
const { contextBridge, ipcRenderer } = require("electron");

// Electron's structured clone throws "Invalid Args" for undefined payloads and
// for objects holding undefined values / functions / React state proxies.
// So every payload is normalised to a plain, fully serialisable object first.
function clean(payload) {
  if (payload === undefined || payload === null) return {};
  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "boolean") {
    return payload;
  }
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return {};
  }
}

const invoke = (channel, payload) => ipcRenderer.invoke(channel, clean(payload));

contextBridge.exposeInMainWorld("ums", {
  isDesktop: true,
  platform: process.platform,

  getStatus: () => invoke("ums:getStatus"),
  getNetwork: () => invoke("ums:getNetwork"),
  applySettings: (settings) => invoke("ums:applySettings", settings),
  restartServer: () => invoke("ums:restartServer"),

  setMedia: (items) => invoke("ums:setMedia", items),
  addMedia: (item) => invoke("ums:addMedia", item),
  mediaUrl: (id) => invoke("ums:mediaUrl", id),
  localBase: () => invoke("ums:localBase"),
  pickFiles: () => invoke("ums:pickFiles"),

  // Subtitles (SRT/VTT/ASS → served on /subtitle/:id, VTT for Chromecast)
  pickSubtitle: (payload) => invoke("ums:pickSubtitle", payload),
  setSubtitle: (payload) => invoke("ums:setSubtitle", payload),

  // Discovery covers both DLNA/UPnP renderers (SSDP) and Google Cast (mDNS)
  scanDevices: (options) => invoke("ums:scanDevices", options),
  play: (payload) => invoke("ums:play", payload),
  stop: (payload) => invoke("ums:stop", payload),
  pause: (payload) => invoke("ums:pause", payload),
  resume: (payload) => invoke("ums:resume", payload),
  seek: (payload) => invoke("ums:seek", payload),
  setVolume: (payload) => invoke("ums:setVolume", payload),
  setMute: (payload) => invoke("ums:setMute", payload),
  deviceState: (payload) => invoke("ums:deviceState", payload),

  // Playlists (IPTV M3U / HLS master) — VLC-style channel list
  loadPlaylist: (payload) => invoke("ums:loadPlaylist", payload),
  pickPlaylistFile: () => invoke("ums:pickPlaylistFile"),

  // Desktop screen mirroring (live MPEG-TS on /desktop.ts)
  shareScreen: (payload) => invoke("ums:shareScreen", payload),
  stopScreenShare: (payload) => invoke("ums:stopScreenShare", payload),
  screenStatus: () => invoke("ums:screenStatus"),
  screenPanel: (payload) => invoke("ums:screenPanel", payload),
  screenMuteLocal: (on) => invoke("ums:screenMuteLocal", on),
  hostKey: (payload) => invoke("ums:hostKey", payload),
  setLinkCatcher: (on) => invoke("ums:setLinkCatcher", on),

  // Helper binaries (ffmpeg / yt-dlp) — auto-repaired after install
  toolStatus: () => invoke("ums:toolStatus"),
  ensureTools: () => invoke("ums:ensureTools"),

  // Dependency doctor + one-click repair & restart
  depsCheck: () => invoke("ums:depsCheck"),
  depsTest: () => invoke("ums:depsTest"),
  depsRepair: (payload) => invoke("ums:depsRepair", payload),

  // Plugins (افزونه‌ها)
  pluginList: () => invoke("ums:pluginList"),
  pluginInstall: (payload) => invoke("ums:pluginInstall", payload),
  pluginSetEnabled: (payload) => invoke("ums:pluginSetEnabled", payload),
  pluginRemove: (payload) => invoke("ums:pluginRemove", payload),
  pluginReload: () => invoke("ums:pluginReload"),
  pluginFolder: () => invoke("ums:pluginFolder"),


  // Real downloads (YouTube / Instagram / TikTok / direct links)
  downloadStart: (payload) => invoke("ums:downloadStart", payload),
  downloadCancel: (payload) => invoke("ums:downloadCancel", payload),
  downloadList: () => invoke("ums:downloadList"),
  downloadFolder: () => invoke("ums:downloadFolder"),
  revealFile: (file) => invoke("ums:revealFile", file),

  // Channel health dots
  probeStreams: (payload) => invoke("ums:probeStreams", payload),

  // System pressure / hang watchdog + restart (manual & automatic)
  systemLoad: () => invoke("ums:systemLoad"),
  heartbeat: () => invoke("ums:heartbeat"),
  setAutoRestart: (on) => invoke("ums:setAutoRestart", on),
  restartApp: () => invoke("ums:restartApp"),

  // On-TV mouse control panel (/remote): channel pages + subtitle/dub toggles
  remoteSetChannels: (payload) => invoke("ums:remoteSetChannels", payload),
  remoteSetFlags: (payload) => invoke("ums:remoteSetFlags", payload),
  remoteUrl: () => invoke("ums:remoteUrl"),

  openExternal: (url) => invoke("ums:openExternal", url),
  // Hands a saved / direct link to the VLC player installed on this machine.
  openInVlc: (url) => invoke("ums:openInVlc", url),
  // Online subtitle translation (auto-detect -> Persian), proxied by the main
  // process so the renderer is not blocked by CORS.
  translate: (payload) => invoke("ums:translate", payload),
  checkUpdate: () => invoke("ums:checkUpdate"),
  appVersion: () => invoke("ums:appVersion"),

  onEvent: (handler) => {
    const listener = (_e, data) => handler(data);
    ipcRenderer.on("ums:event", listener);
    return () => ipcRenderer.removeListener("ums:event", listener);
  },
});
