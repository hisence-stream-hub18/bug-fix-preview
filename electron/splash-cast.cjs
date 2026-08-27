// Splash stream for the TV.
//
// A DLNA renderer shows a black screen while it waits for the first bytes of a
// new stream, which looks like a crash to the user. So the very first thing we
// hand a freshly connected TV is this endless MPEG-TS stream of the app logo
// (the same artwork as the desktop splash screen). It is also reused while the
// network stalls, and is replaced the moment the real picture is ready.

const { spawn } = require("node:child_process");
const tools = require("./tools.cjs");

let background = "";
let logo = "";
let session = null; // { proc, clients:Set }

function setImages(backgroundFile, logoFile) {
  background = String(backgroundFile || "");
  logo = String(logoFile || "");
  return background;
}

function available() {
  return Boolean(tools.findTool("ffmpeg") && background && logo);
}

function args() {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-re",
    "-i",
    background,
    "-loop",
    "1",
    "-i",
    logo,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-filter_complex",
    [
      "[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720",
      "zoompan=z='min(zoom+0.00045,1.08)':d=125:s=1280x720:fps=25",
      "format=rgba,colorchannelmixer=aa=0.42[bg]",
      ";[1:v]scale=420:420:force_original_aspect_ratio=decrease",
      "format=rgba,fade=t=in:st=0:d=0.7:alpha=1[mark]",
      ";[bg][mark]overlay=(W-w)/2:(H-h)/2-24:format=auto",
      "drawtext=text='UNIVERSAL MEDIA SERVER':fontcolor=0xf3c969:fontsize=34:font='Arial':x=(w-text_w)/2:y=h-112:enable='gte(t,0.45)'",
      "drawbox=x=(iw-360)/2:y=646:w=360:h=7:color=0xf3c969@0.22:t=fill",
      "drawbox=x=(iw-360)/2:y=646:w='min(360,t*78)':h=7:color=0xf3c969:t=fill",
      "format=yuv420p[v]",
    ].join(","),
    "-map",
    "[v]",
    "-map",
    "2:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-tune",
    "stillimage",
    "-g",
    "25",
    "-r",
    "25",
    "-b:v",
    "1200k",
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-f",
    "mpegts",
    "-mpegts_flags",
    "+resend_headers",
    "-pat_period",
    "0.1",
    "-muxdelay",
    "0",
    "pipe:1",
  ];
}

/** Serves the splash as MPEG-TS on /splash.ts */
function attach(req, res) {
  const bin = tools.findTool("ffmpeg");
  if (!bin || !background || !logo) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("splash unavailable");
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

  if (!session) {
    let proc;
    try {
      proc = spawn(bin, args(), { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch {
      return res.end();
    }
    session = { proc, clients: new Set() };
    proc.stdout.on("data", (chunk) => {
      if (!session) return;
      for (const client of session.clients) {
        try {
          client.write(chunk);
        } catch {
          session.clients.delete(client);
        }
      }
      if (!session.clients.size) stop();
    });
    proc.stderr.resume();
    proc.on("exit", () => {
      if (!session) return;
      for (const client of session.clients) {
        try {
          client.end();
        } catch {
          /* ignore */
        }
      }
      session = null;
    });
  }

  session.clients.add(res);
  const drop = () => {
    if (!session) return;
    session.clients.delete(res);
    if (!session.clients.size) stop();
  };
  req.on("close", drop);
  res.on("close", drop);
  res.on("error", drop);
  return undefined;
}

function stop() {
  const current = session;
  session = null;
  if (!current) return;
  try {
    current.proc.kill("SIGKILL");
  } catch {
    /* ignore */
  }
}

module.exports = { setImages, attach, stop, available };
