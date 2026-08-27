// UPnP AVTransport / RenderingControl SOAP client.
// Works with any TV that exposes a DLNA MediaRenderer: Hisense, Samsung, LG,
// Sony, Xiaomi, Philips, Android TV boxes, etc. Pure Node http, no deps.

const http = require("node:http");
const { URL } = require("node:url");

function escapeXml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function soapRequest(controlUrl, serviceType, action, bodyXml, timeout = 12000) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(controlUrl);
    } catch {
      return resolve({ ok: false, error: "آدرس کنترل دستگاه نامعتبر است" });
    }
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
 <s:Body>
  <u:${action} xmlns:u="${serviceType}">${bodyXml}</u:${action}>
 </s:Body>
</s:Envelope>`;
    const payload = Buffer.from(envelope, "utf8");
    const req = http.request(
      target,
      {
        method: "POST",
        timeout,
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          "Content-Length": payload.length,
          SOAPACTION: `"${serviceType}#${action}"`,
          Connection: "close",
          "User-Agent": "UMS/1.0",
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          const ok = (res.statusCode || 500) < 300;
          const fault = /<errorDescription>([\s\S]*?)<\/errorDescription>/i.exec(body);
          resolve({
            ok,
            status: res.statusCode,
            body,
            error: ok ? "" : fault ? fault[1] : `SOAP ${res.statusCode}`,
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, error: "دستگاه پاسخ نداد (timeout)" });
    });
    req.on("error", (err) => resolve({ ok: false, error: String(err.message || err) }));
    req.end(payload);
  });
}

const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
const RCS = "urn:schemas-upnp-org:service:RenderingControl:1";

function metadata({ title, url, mime = "video/mp4", subtitle = "", live = false }) {
  const upnpClass = mime.startsWith("audio")
    ? "object.item.audioItem.musicTrack"
    : mime.startsWith("image")
      ? "object.item.imageItem.photo"
      : "object.item.videoItem";
  // Hisense (and every Samsung-derived DMR) picks up an external subtitle only
  // when the DIDL carries sec:CaptionInfo / sec:CaptionInfoEx and a subtitle
  // <res>. pv:subtitleFileUri covers LG / Philips renderers.
  const subExt = /\.vtt(\?|$)/i.test(subtitle) ? "vtt" : "srt";
  const subMime = subExt === "vtt" ? "text/vtt" : "application/x-subrip";
  const subXml = subtitle
    ? `
<sec:CaptionInfoEx sec:type="${subExt}">${escapeXml(subtitle)}</sec:CaptionInfoEx>
<sec:CaptionInfo sec:type="${subExt}">${escapeXml(subtitle)}</sec:CaptionInfo>
<pv:subtitleFileUri>${escapeXml(subtitle)}</pv:subtitleFileUri>
<pv:subtitleFileType>${subExt}</pv:subtitleFileType>
<res protocolInfo="http-get:*:${subMime}:*">${escapeXml(subtitle)}</res>`
    : "";
  const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/" xmlns:pv="http://www.pv.com/pvns/">
<item id="0" parentID="-1" restricted="1">
<dc:title>${escapeXml(title)}</dc:title>
<upnp:class>${upnpClass}</upnp:class>
<res protocolInfo="http-get:*:${escapeXml(mime)}:${
    live
      ? "DLNA.ORG_PN=MPEG_TS_SD_EU;DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=8d500000000000000000000000000000"
      : "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"
  }">${escapeXml(url)}</res>${subXml}
</item></DIDL-Lite>`;
  return didl;
}

const TRANSIENT = /(socket hang up|ECONNRESET|EPIPE|timeout|ECONNREFUSED|EAI_AGAIN)/i;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Hisense (and most Samsung-derived DMRs) drop the TCP connection ("socket hang
 * up") when SetAVTransportURI arrives while the transport is still busy, or when
 * the DIDL metadata carries vendor tags they don't parse. So we:
 *   1. Stop the current transport first,
 *   2. try full metadata (subtitles + DLNA flags),
 *   3. retry with plain metadata (no subtitle/vendor tags),
 *   4. finally retry with NOT_IMPLEMENTED metadata,
 * retrying transient socket errors once each time.
 */
async function setUri(controlUrl, url, meta) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await soapRequest(
      controlUrl,
      AVT,
      "SetAVTransportURI",
      `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(url)}</CurrentURI><CurrentURIMetaData>${escapeXml(
        meta,
      )}</CurrentURIMetaData>`,
    );
    if (res.ok) return res;
    if (!TRANSIENT.test(String(res.error || ""))) return res;
    await wait(800 * (attempt + 1));
  }
  return { ok: false, error: "دستگاه اتصال را قطع کرد (socket hang up)" };
}

async function play({
  controlUrl,
  url,
  title = "Universal Media Server",
  mime = "video/mp4",
  subtitle = "",
  live: liveFlag,
}) {
  if (!controlUrl) return { ok: false, error: "این دستگاه سرویس AVTransport ندارد" };

  // Free the transport before loading a new URI — prevents most hang-ups.
  await soapRequest(controlUrl, AVT, "Stop", `<InstanceID>0</InstanceID>`, 4000);
  await wait(300);

  // Live streams (IPTV / HLS / MPEG-TS) must advertise DLNA.ORG_OP=00 — a
  // seek-able (OP=01) descriptor makes most TVs drop the connection instantly.
  const live =
    liveFlag !== undefined
      ? Boolean(liveFlag)
      : /mpegurl|mp2t/i.test(String(mime)) || /\.(m3u8|ts)(\?|$)/i.test(String(url));

  const variants = [
    metadata({ title, url, mime, subtitle, live }),
    metadata({ title, url, mime, subtitle: "", live }),
    metadata({ title, url, mime: live ? "video/mp2t" : "video/mp4", subtitle: "", live }),
    "NOT_IMPLEMENTED",
  ];

  let last = { ok: false, error: "پخش شروع نشد" };
  for (const meta of variants) {
    last = await setUri(controlUrl, url, meta);
    if (last.ok) break;
  }
  if (!last.ok) return last;

  await wait(250);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await soapRequest(controlUrl, AVT, "Play", `<InstanceID>0</InstanceID><Speed>1</Speed>`);
    if (res.ok) return res;
    last = res;
    if (!TRANSIENT.test(String(res.error || ""))) return res;
    await wait(500);
  }
  return last;
}



const stop = ({ controlUrl }) => soapRequest(controlUrl, AVT, "Stop", `<InstanceID>0</InstanceID>`);
const pause = ({ controlUrl }) =>
  soapRequest(controlUrl, AVT, "Pause", `<InstanceID>0</InstanceID>`);
const resume = ({ controlUrl }) =>
  soapRequest(controlUrl, AVT, "Play", `<InstanceID>0</InstanceID><Speed>1</Speed>`);
const seek = ({ controlUrl, target }) =>
  soapRequest(
    controlUrl,
    AVT,
    "Seek",
    `<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>${escapeXml(target)}</Target>`,
  );

const setVolume = ({ controlUrl, volume }) =>
  soapRequest(
    controlUrl,
    RCS,
    "SetVolume",
    `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${Math.max(
      0,
      Math.min(100, Number(volume) || 0),
    )}</DesiredVolume>`,
  );

const setMute = ({ controlUrl, mute }) =>
  soapRequest(
    controlUrl,
    RCS,
    "SetMute",
    `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${mute ? 1 : 0}</DesiredMute>`,
  );

async function transportInfo({ controlUrl }) {
  const res = await soapRequest(controlUrl, AVT, "GetTransportInfo", `<InstanceID>0</InstanceID>`);
  if (!res.ok) return res;
  const state =
    (/<CurrentTransportState>([\s\S]*?)<\/CurrentTransportState>/i.exec(res.body) || [])[1] || "";
  return { ok: true, state: state.trim() };
}

async function positionInfo({ controlUrl }) {
  const res = await soapRequest(controlUrl, AVT, "GetPositionInfo", `<InstanceID>0</InstanceID>`);
  if (!res.ok) return res;
  const pick = (n) =>
    ((new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, "i").exec(res.body) || [])[1] || "").trim();
  return {
    ok: true,
    relTime: pick("RelTime"),
    duration: pick("TrackDuration"),
    uri: pick("TrackURI"),
  };
}

module.exports = {
  play,
  stop,
  pause,
  resume,
  seek,
  setVolume,
  setMute,
  transportInfo,
  positionInfo,
};
