// Real HTTP media server (Node, Electron main process).
// - binds 0.0.0.0:PORT so TVs on the LAN can reach it
// - HTTP Range / 206 Partial Content (mandatory for most TVs, incl. Hisense DMR)
// - /media/:id serves local files (fs) or proxies remote URLs
// - minimal UPnP MediaServer description + ContentDirectory SOAP so TVs can browse
// No third-party dependencies: keeps memory/CPU footprint tiny.

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const subs = require("./subtitles.cjs");
const screen = require("./screen-cast.cjs");
const remote = require("./remote-panel.cjs");
const resolver = require("./resolve.cjs");
const hls = require("./hls-remux.cjs");
const splashCast = require("./splash-cast.cjs");

const MIME = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ts": "video/mp2t",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m3u": "audio/x-mpegurl",
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function mimeFor(src) {
  const ext = path.extname(String(src).split("?")[0]).toLowerCase();
  return MIME[ext] || "video/mp4";
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isRemote(src) {
  return /^https?:\/\//i.test(String(src));
}

// ---------------------------------------------------------------- state

const state = {
  server: null,
  port: 0,
  host: "0.0.0.0",
  name: "Universal Media Server",
  uuid: "uuid:2f402f80-da50-11e1-9b23-0017880a1b2c",
  startedAt: 0,
  media: new Map(), // id -> { id, title, source, mime }
  lastError: "",
  brandingImage: "",
  transcodeHls: true,
  requests: 0,
  bytesSent: 0,
};

function setMedia(items) {
  state.media = new Map(
    (Array.isArray(items) ? items : [])
      .filter((i) => i && i.id && i.source)
      .map((i) => [
        String(i.id),
        {
          id: String(i.id),
          title: String(i.title || i.id),
          source: String(i.source),
          mime: i.mime || mimeFor(i.source),
          subtitle: i.subtitle ? String(i.subtitle) : "",
        },
      ]),
  );
  return state.media.size;
}

/** Attaches (or clears) an external subtitle file for one media id. */
function setSubtitle(id, file) {
  const item = state.media.get(String(id));
  if (!item) return false;
  item.subtitle = file ? String(file) : "";
  return true;
}

/** true for live IPTV/HLS sources: those need DLNA.ORG_OP=00 streaming flags. */
function isLiveSource(src) {
  return /\.(m3u8|ts)(\?|$)/i.test(String(src || "")) || /^rtsp:\/\//i.test(String(src || ""));
}

const LIVE_FEATURES =
  "DLNA.ORG_PN=MPEG_TS_SD_EU;DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=8d500000000000000000000000000000";
const FILE_FEATURES =
  "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000";

/** Enables/disables ffmpeg remuxing of HLS to MPEG-TS for old TVs. */
function setTranscodeHls(enabled) {
  state.transcodeHls = enabled !== false;
  return state.transcodeHls;
}

/**
 * Registers one item without wiping the registry and returns its id. Used to
 * push IPTV channels / ad-hoc links through the local proxy instead of handing
 * a raw HTTPS URL to the TV (TVs mostly fail on TLS, redirects and HLS).
 */
function addMedia(item) {
  if (!item || !item.source) return "";
  const id = String(item.id || `x-${Date.now().toString(36)}`);
  state.media.set(id, {
    id,
    title: String(item.title || id),
    source: String(item.source),
    mime: item.mime || mimeFor(item.source),
    subtitle: item.subtitle ? String(item.subtitle) : "",
  });
  return id;
}

function getMedia(id) {
  return state.media.get(String(id)) || null;
}

// ---------------------------------------------------------------- serving

function serveLocalFile(req, res, file, mime) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }

  const total = stat.size;
  const range = req.headers.range;
  const common = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    // DLNA hints — several TVs refuse the stream without them.
    "transferMode.dlna.org": "Streaming",
    "contentFeatures.dlna.org":
      "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
    // The in-app player fetches these URLs from the app window, so CORS must allow it.
    "Access-Control-Allow-Origin": "*",
    Connection: "keep-alive",
  };

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.writeHead(416, { "Content-Range": `bytes */${total}` });
      return res.end();
    }
    if (end >= total) end = total - 1;
    res.writeHead(206, {
      ...common,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": end - start + 1,
    });
    if (req.method === "HEAD") return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    stream.on("data", (c) => {
      state.bytesSent += c.length;
    });
    return stream.pipe(res);
  }

  res.writeHead(200, { ...common, "Content-Length": total });
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(file);
  stream.on("error", () => res.destroy());
  stream.on("data", (c) => {
    state.bytesSent += c.length;
  });
  return stream.pipe(res);
}

function proxyRemote(req, res, source, redirects = 0) {
  if (redirects > 5) {
    res.writeHead(502, { "Content-Type": "text/plain" });
    return res.end("Too many redirects");
  }
  let target;
  try {
    target = new URL(source);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("Bad source URL");
  }
  const client = target.protocol === "https:" ? https : http;
  const headers = { "User-Agent": "UMS/1.0" };
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = client.request(
    target,
    { method: req.method === "HEAD" ? "HEAD" : "GET", headers },
    (up) => {
      const loc = up.headers.location;
      if (up.statusCode && up.statusCode >= 300 && up.statusCode < 400 && loc) {
        up.resume();
        return proxyRemote(req, res, new URL(loc, target).toString(), redirects + 1);
      }
      const live =
        isLiveSource(source) || /mpegurl|mp2t/i.test(String(up.headers["content-type"] || ""));
      const out = {
        "Content-Type": up.headers["content-type"] || mimeFor(source),
        "Accept-Ranges": live ? "none" : "bytes",
        "transferMode.dlna.org": "Streaming",
        "contentFeatures.dlna.org": live ? LIVE_FEATURES : FILE_FEATURES,
        "Access-Control-Allow-Origin": "*",
      };
      if (up.headers["content-length"]) out["Content-Length"] = up.headers["content-length"];
      if (up.headers["content-range"]) out["Content-Range"] = up.headers["content-range"];
      res.writeHead(up.statusCode || 200, out);
      up.on("data", (c) => {
        state.bytesSent += c.length;
      });
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Upstream error");
  });
  upstream.end();
}

// ---------------------------------------------------------------- UPnP XML

function deviceDescription(baseUrl) {
  return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <URLBase>${escapeXml(baseUrl)}</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${escapeXml(state.name)}</friendlyName>
    <manufacturer>Universal Media Server</manufacturer>
    <modelName>UMS</modelName>
    <modelNumber>1.0</modelNumber>
    <UDN>${escapeXml(state.uuid)}</UDN>
    <dlna:X_DLNADOC xmlns:dlna="urn:schemas-dlna-org:device-1-0">DMS-1.50</dlna:X_DLNADOC>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <SCPDURL>/ContentDirectory.xml</SCPDURL>
        <controlURL>/ctl/ContentDirectory</controlURL>
        <eventSubURL>/evt/ContentDirectory</eventSubURL>
      </service>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ConnectionManager:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/ConnectionManager.xml</SCPDURL>
        <controlURL>/ctl/ConnectionManager</controlURL>
        <eventSubURL>/evt/ConnectionManager</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

const CONTENT_DIRECTORY_SCPD = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <name>Browse</name>
      <argumentList>
        <argument><name>ObjectID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_ObjectID</relatedStateVariable></argument>
        <argument><name>BrowseFlag</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_BrowseFlag</relatedStateVariable></argument>
        <argument><name>Filter</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Filter</relatedStateVariable></argument>
        <argument><name>StartingIndex</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Index</relatedStateVariable></argument>
        <argument><name>RequestedCount</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>SortCriteria</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_SortCriteria</relatedStateVariable></argument>
        <argument><name>Result</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Result</relatedStateVariable></argument>
        <argument><name>NumberReturned</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>TotalMatches</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>UpdateID</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_UpdateID</relatedStateVariable></argument>
      </argumentList>
    </action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_ObjectID</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_BrowseFlag</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Filter</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Index</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Count</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_SortCriteria</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Result</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="yes"><name>A_ARG_TYPE_UpdateID</name><dataType>ui4</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

const CONNECTION_MANAGER_SCPD = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList/>
  <serviceStateTable>
    <stateVariable sendEvents="yes"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

/** Public URL of the sidecar subtitle of one media item. */
function subtitleUrl(baseUrl, item, asVtt = false) {
  const ext = asVtt ? ".vtt" : path.extname(String(item.subtitle || "")).toLowerCase() || ".srt";
  return `${baseUrl}/subtitle/${encodeURIComponent(item.id)}${ext}${asVtt ? "?fmt=vtt" : ""}`;
}

/** Downloads a remote subtitle file as text (follows one redirect). */
function fetchRemoteText(source, done, redirects = 0) {
  let target;
  try {
    target = new URL(source);
  } catch {
    return done("");
  }
  const client = target.protocol === "https:" ? https : http;
  const req = client.get(target, { timeout: 8000 }, (up) => {
    const loc = up.headers.location;
    if (up.statusCode && up.statusCode >= 300 && up.statusCode < 400 && loc && redirects < 3) {
      up.resume();
      return fetchRemoteText(new URL(loc, target).toString(), done, redirects + 1);
    }
    let body = "";
    up.setEncoding("utf8");
    up.on("data", (c) => {
      body += c;
      if (body.length > 4_000_000) up.destroy();
    });
    up.on("end", () => done(body));
  });
  req.on("timeout", () => req.destroy());
  req.on("error", () => done(""));
}

function didlForItems(baseUrl) {
  const items = [...state.media.values()]
    .map((m) => {
      const url = `${baseUrl}/media/${encodeURIComponent(m.id)}`;
      const upnpClass = m.mime.startsWith("audio")
        ? "object.item.audioItem.musicTrack"
        : m.mime.startsWith("image")
          ? "object.item.imageItem.photo"
          : "object.item.videoItem";
      const subUrl = m.subtitle ? subtitleUrl(baseUrl, m, false) : "";
      const subXml = subUrl
        ? `\n  <sec:CaptionInfoEx sec:type="srt">${escapeXml(subUrl)}</sec:CaptionInfoEx>` +
          `\n  <sec:CaptionInfo sec:type="srt">${escapeXml(subUrl)}</sec:CaptionInfo>` +
          `\n  <res protocolInfo="http-get:*:${escapeXml(subs.subtitleMime(m.subtitle))}:*">${escapeXml(subUrl)}</res>`
        : "";
      return `<item id="${escapeXml(m.id)}" parentID="0" restricted="1">
  <dc:title>${escapeXml(m.title)}</dc:title>
  <upnp:class>${upnpClass}</upnp:class>
  <res protocolInfo="http-get:*:${escapeXml(m.mime)}:DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000">${escapeXml(url)}</res>${subXml}
</item>`;
    })
    .join("");

  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/">${items}</DIDL-Lite>`;
}

function browseResponse(baseUrl) {
  const didl = didlForItems(baseUrl);
  const count = state.media.size;
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
 <s:Body>
  <u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
   <Result>${escapeXml(didl)}</Result>
   <NumberReturned>${count}</NumberReturned>
   <TotalMatches>${count}</TotalMatches>
   <UpdateID>1</UpdateID>
  </u:BrowseResponse>
 </s:Body>
</s:Envelope>`;
}

// ---------------------------------------------------------------- router

function handle(req, res) {
  state.requests += 1;
  const host = req.headers.host || `${state.host}:${state.port}`;
  const baseUrl = `http://${host}`;
  const url = new URL(req.url || "/", baseUrl);
  const p = decodeURIComponent(url.pathname);

  res.setHeader("Server", "UMS/1.0 UPnP/1.0 DLNADOC/1.50");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Browser extension endpoint: receives a link caught on a web page.
  if (p === "/api/catch") {
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 100000) req.destroy();
    });
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      if (typeof state.onCatch === "function" && payload && payload.url) {
        try {
          state.onCatch({
            action: String(payload.action || "add"),
            url: String(payload.url),
            title: String(payload.title || payload.url),
          });
        } catch {
          /* ignore */
        }
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    });
    return undefined;
  }

  // On-TV mouse control panel (channel paging + subtitle/dub toggles).
  if (remote.handle(req, res, p, url.searchParams)) return undefined;

  if (p === "/health" || p === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(
      JSON.stringify({
        ok: true,
        name: state.name,
        port: state.port,
        items: state.media.size,
        uptimeSec: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
        requests: state.requests,
        bytesSent: state.bytesSent,
      }),
    );
  }

  if (p === "/desc.xml" || p === "/description.xml" || p === "/rootDesc.xml") {
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    return res.end(deviceDescription(baseUrl));
  }
  if (p === "/ContentDirectory.xml") {
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    return res.end(CONTENT_DIRECTORY_SCPD);
  }
  if (p === "/ConnectionManager.xml") {
    res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8" });
    return res.end(CONNECTION_MANAGER_SCPD);
  }
  if (p.startsWith("/ctl/")) {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    return req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/xml; charset=utf-8", EXT: "" });
      res.end(browseResponse(baseUrl));
    });
  }
  if (p.startsWith("/evt/")) {
    res.writeHead(200, {
      "Content-Type": "text/plain",
      SID: `uuid:${Date.now()}`,
      TIMEOUT: "Second-1800",
    });
    return res.end();
  }

  // ------------------------------------------------ external subtitle track
  // /subtitle/:id            → original format (SRT for Samsung/LG/Hisense)
  // /subtitle/:id.vtt?fmt=vtt → converted WebVTT (Chromecast only accepts VTT)
  if (p.startsWith("/subtitle/")) {
    const raw = p.split("/")[2] || "";
    const wantsVtt = url.searchParams.get("fmt") === "vtt" || /\.vtt$/i.test(raw);
    const id = raw.replace(/\.(srt|vtt|ass|ssa|sub)$/i, "");
    const item = getMedia(id);
    if (!item || !item.subtitle) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Subtitle not found");
    }
    const source = item.subtitle;
    const deliver = (text) => {
      const body = Buffer.from(wantsVtt ? subs.toVtt(text) : text, "utf8");
      res.writeHead(200, {
        "Content-Type": wantsVtt
          ? "text/vtt; charset=utf-8"
          : `${subs.subtitleMime(source)}; charset=utf-8`,
        "Content-Length": body.length,
        "Access-Control-Allow-Origin": "*",
        // Hisense / Samsung / LG look for this header on the subtitle response.
        "CaptionInfo.sec": subtitleUrl(`http://${host}`, item, wantsVtt),
      });
      if (req.method === "HEAD") return res.end();
      state.bytesSent += body.length;
      return res.end(body);
    };
    if (isRemote(source)) return fetchRemoteText(source, deliver);
    return deliver(subs.readLocal(source));
  }

  // ------------------------------------------------ live desktop mirroring
  if (p === "/desktop.ts" || p === "/desktop" || p.startsWith("/desktop/")) {
    return screen.attach(req, res);
  }

  // ------------------------------------------------ branding still image
  // Shown on the TV while the network stalls (same logo as the splash screen).
  if (p.startsWith("/branding/")) {
    const file = state.brandingImage;
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("No branding image");
    }
    return serveLocalFile(
      req,
      res,
      file,
      mimeFor(file).startsWith("image") ? mimeFor(file) : "image/png",
    );
  }

  // ------------------------------------------------ TV splash stream
  // Endless logo animation frame; shown right after a TV connects and while a
  // new channel is still buffering, so the TV never sits on a black screen.
  if (p === "/splash.ts" || p === "/splash") {
    return splashCast.attach(req, res);
  }

  // ------------------------------------------------ live HLS → MPEG-TS remux
  // /live/:id.ts — for TVs that cannot open an .m3u8 playlist at all.
  if (p.startsWith("/live/")) {
    const raw = p.split("/")[2] || "";
    const id = raw.replace(/\.(ts|m3u8)$/i, "");
    const item = getMedia(id);
    if (!item) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Media not found");
    }
    return hls.attach(req, res, id, item.resolvedSource || item.source);
  }

  if (p.startsWith("/media/") || p.startsWith("/stream/")) {
    const raw = p.split("/")[2] || "";
    const id = raw.replace(/\.(mp4|mkv|m3u8|mp3|ts|webm|avi|mov)$/i, "");
    const item = getMedia(id);
    if (!item) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Media not found");
    }
    // Hisense and other Samsung-derived DMRs read the sidecar subtitle from
    // this header on the media response itself.
    if (item.subtitle) {
      const link = subtitleUrl(`http://${host}`, item, false);
      res.setHeader("CaptionInfo.sec", link);
      res.setHeader("getCaptionInfo.sec", link);
    }
    if (isRemote(item.source)) {
      // Share pages (Aparat, YouTube…) are HTML: hand the TV the direct file.
      if (item.resolvedSource) return proxyRemote(req, res, item.resolvedSource);
      return resolver
        .resolveMedia(item.source)
        .then((r) => {
          if (r.url && r.url !== item.source) item.resolvedSource = r.url;
          if (r.mime) item.mime = r.mime;
          return proxyRemote(req, res, item.resolvedSource || item.source);
        })
        .catch(() => proxyRemote(req, res, item.source));
    }
    return serveLocalFile(req, res, item.source, item.mime);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

/** Registers the artwork used by the TV splash stream. */
function setSplashImage(background, logo) {
  return splashCast.setImages(background, logo);
}

/** Registers the still image served on /branding/logo.png. */
function setBrandingImage(file) {
  state.brandingImage = file ? String(file) : "";
  return state.brandingImage;
}

/** Resolves the real media URL of one item (page URL → direct file). */
async function resolveItem(id) {
  const item = getMedia(id);
  if (!item) return { ok: false, error: "این مورد در مخزن نیست" };
  if (!isRemote(item.source)) return { ok: true, url: item.source, mime: item.mime };
  const r = await resolver.resolveMedia(item.source);
  if (r.url && r.url !== item.source) item.resolvedSource = r.url;
  if (r.mime) item.mime = r.mime;
  return { ok: !r.error, url: item.resolvedSource || item.source, mime: item.mime, error: r.error };
}

// ---------------------------------------------------------------- lifecycle

function start({ port, host, name, uuid } = {}) {
  return new Promise((resolve) => {
    stop();
    state.port = Number(port) || 5001;
    state.host = host || "0.0.0.0";
    if (name) state.name = name;
    if (uuid) state.uuid = uuid;
    state.lastError = "";

    const server = http.createServer(handle);
    server.on("error", (err) => {
      state.lastError =
        err && err.code === "EADDRINUSE"
          ? `پورت ${state.port} در حال استفاده است`
          : String(err.message || err);
      state.server = null;
      resolve({ ok: false, error: state.lastError, port: state.port });
    });
    server.listen(state.port, state.host, () => {
      state.server = server;
      state.startedAt = Date.now();
      resolve({ ok: true, port: state.port, host: state.host });
    });
  });
}

function stop() {
  if (state.server) {
    try {
      state.server.close();
    } catch {
      /* ignore */
    }
  }
  state.server = null;
  state.startedAt = 0;
}

function status() {
  return {
    running: Boolean(state.server),
    port: state.port,
    host: state.host,
    name: state.name,
    uuid: state.uuid,
    items: state.media.size,
    uptimeSec: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
    requests: state.requests,
    bytesSent: state.bytesSent,
    lastError: state.lastError,
  };
}

function setCatchHandler(fn) {
  state.onCatch = typeof fn === "function" ? fn : null;
}

module.exports = {
  remote,
  setCatchHandler,
  isLiveSource,
  setTranscodeHls,
  addMedia,
  start,
  stop,
  status,
  setMedia,
  setSubtitle,
  getMedia,
  mimeFor,
  subtitleUrl,
  setBrandingImage,
  setSplashImage,
  resolveItem,
};
