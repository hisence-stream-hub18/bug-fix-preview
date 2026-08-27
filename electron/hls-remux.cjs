// Live HLS → MPEG-TS remuxer.
// Most DLNA TVs (Hisense included) cannot open an .m3u8 playlist at all: they
// only accept a continuous byte stream. ffmpeg reads the HLS/IPTV stream and
// copies it into MPEG-TS on the fly (no re-encode → almost no CPU cost).

const { spawn } = require("node:child_process");
const { findFfmpeg } = require("./screen-cast.cjs");

const sessions = new Map(); // key -> { proc, clients:Set }

// Output-chain tuning shared with the manual performance settings:
// a short segment (0.5–1 s) keeps the TV from building a multi-second buffer.
let segmentMs = 1000;

function setSegmentMs(ms) {
  const v = Number(ms) || 1000;
  segmentMs = Math.max(300, Math.min(4000, Math.round(v)));
  return segmentMs;
}

// Audio/video offset in milliseconds, set from the app settings.
//  > 0 : the sound arrives too early  -> the audio track is delayed
//  < 0 : the picture arrives too early -> the video track is delayed
let avOffsetMs = 0;

function setAvOffset(ms) {
  const v = Number(ms) || 0;
  avOffsetMs = Math.max(-5000, Math.min(5000, Math.round(v)));
  return avOffsetMs;
}

function getAvOffset() {
  return avOffsetMs;
}

/** Builds the input part: one input normally, two when an offset is applied. */
function inputArgs(url) {
  const offset = (Math.abs(avOffsetMs) / 1000).toFixed(3);
  if (!avOffsetMs) return ["-i", url, "-map", "0:v:0?", "-map", "0:a:0?"];
  // The stream is opened twice and one of the two copies is time-shifted, so
  // the TV receives an already-synchronised MPEG-TS (weak TVs cannot re-sync).
  return avOffsetMs > 0
    ? ["-i", url, "-itsoffset", offset, "-i", url, "-map", "0:v:0?", "-map", "1:a:0?"]
    : ["-itsoffset", offset, "-i", url, "-i", url, "-map", "0:v:0?", "-map", "1:a:0?"];
}

function args(url) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-fflags",
    "+genpts+discardcorrupt",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-user_agent",
    "VLC/3.0.20 LibVLC/3.0.20",
    ...inputArgs(url),
    // Video is copied (cheap); audio is normalised to AAC because many TVs
    // refuse MP2/AC3 inside MPEG-TS and then show a black screen.
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    // Keeps the audio clock locked to the video clock on long sessions; without
    // it cheap TV decoders drift a few hundred ms after ~20 minutes.
    "-af",
    "aresample=async=1:min_hard_comp=0.100:first_pts=0",
    "-max_delay",
    String(Math.round(segmentMs * 500)),
    "-avoid_negative_ts",
    "make_zero",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-f",
    "mpegts",
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
  ];
}

function available() {
  return Boolean(findFfmpeg());
}

/** Streams `url` to one HTTP response as MPEG-TS. */
function attach(req, res, key, url) {
  const bin = findFfmpeg();
  if (!bin) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("ffmpeg not available");
  }

  res.writeHead(200, {
    "Content-Type": "video/mp2t",
    "transferMode.dlna.org": "Streaming",
    "contentFeatures.dlna.org":
      "DLNA.ORG_PN=MPEG_TS_SD_EU;DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=8d500000000000000000000000000000",
    "Cache-Control": "no-cache",
    "Access-Control-Allow-Origin": "*",
    Connection: "close",
  });
  if (req.method === "HEAD") return res.end();

  let session = sessions.get(key);
  if (!session || !session.proc) {
    let proc;
    try {
      proc = spawn(bin, args(url), { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      res.end();
      return undefined;
    }
    session = { proc, clients: new Set(), lastError: "" };
    sessions.set(key, session);
    proc.stdout.on("data", (chunk) => {
      for (const client of session.clients) {
        try {
          client.write(chunk);
        } catch {
          session.clients.delete(client);
        }
      }
      if (!session.clients.size) stop(key);
    });
    proc.stderr.on("data", (d) => {
      session.lastError = String(d).slice(0, 300);
    });
    proc.on("exit", () => {
      for (const client of session.clients) {
        try {
          client.end();
        } catch {
          /* ignore */
        }
      }
      sessions.delete(key);
    });
  }

  session.clients.add(res);
  const drop = () => {
    session.clients.delete(res);
    if (!session.clients.size) stop(key);
  };
  req.on("close", drop);
  res.on("close", drop);
  res.on("error", drop);
  return undefined;
}

function stop(key) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  try {
    session.proc.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

function stopAll() {
  for (const key of [...sessions.keys()]) stop(key);
}

module.exports = {
  attach,
  stop,
  stopAll,
  available,
  setAvOffset,
  getAvOffset,
  setSegmentMs,
};

