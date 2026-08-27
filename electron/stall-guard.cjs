// Buffering watchdog.
// While a session is playing we poll the renderer's position. If the position
// freezes (weak internet → picture breaks up), we push the complete animated
// startup splash stream to the TV — never a cropped still logo — and then
// automatically restore the video from the last known position once the stream
// recovers.

const avt = require("./avtransport.cjs");
const cast = require("./chromecast.cjs");

const FROZEN_MS = 8000; // how long the position must stay put
const RECOVER_MS = 6000; // how long the logo stays before we retry the video

const sessions = new Map(); // key -> session

const keyOf = (t) => `${t.protocol || "DLNA"}|${t.controlUrl || ""}|${t.ip || ""}:${t.port || ""}`;

const isCast = (t) => String(t.protocol || "") === "Cast";

async function readState(target) {
  if (isCast(target)) return cast.state({ ip: target.ip, port: target.port || 8009 });
  const [info, pos] = await Promise.all([
    avt.transportInfo({ controlUrl: target.controlUrl }),
    avt.positionInfo({ controlUrl: target.controlUrl }),
  ]);
  return { ...info, position: pos };
}

function parseSeconds(value) {
  if (typeof value === "number") return value;
  const parts = String(value || "")
    .split(":")
    .map((n) => Number(n) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function positionSeconds(state) {
  const p = state?.position || {};
  return Number(p.relSeconds) || parseSeconds(p.relTime) || 0;
}

async function showLogo(session) {
  const { target, logoUrl } = session;
  if (!logoUrl) return;
  if (isCast(target)) {
    await cast.play({
      ip: target.ip,
      port: target.port || 8009,
      url: logoUrl,
      title: session.title || "Universal Media Server",
      mime: "video/mp2t",
    });
  } else {
    await avt.play({
      controlUrl: target.controlUrl,
      url: logoUrl,
      title: session.title || "Universal Media Server",
      mime: "video/mp2t",
    });
  }
  session.showingLogo = true;
  session.emit({
    type: "buffering",
    key: session.key,
    showingLogo: true,
    at: session.lastPosition,
  });
}

async function restoreVideo(session) {
  const { target } = session;
  if (isCast(target)) {
    await cast.play({
      ip: target.ip,
      port: target.port || 8009,
      url: session.mediaUrl,
      title: session.title,
      mime: session.mime || "video/mp4",
      subtitle: session.subtitle || "",
    });
    if (session.lastPosition > 2)
      await cast.seek({ ip: target.ip, port: target.port || 8009, seconds: session.lastPosition });
  } else {
    await avt.play({
      controlUrl: target.controlUrl,
      url: session.mediaUrl,
      title: session.title,
      mime: session.mime || "video/mp4",
      subtitle: session.subtitle || "",
    });
    if (session.lastPosition > 2) {
      const s = Math.floor(session.lastPosition);
      const hh = String(Math.floor(s / 3600)).padStart(2, "0");
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      await avt.seek({ controlUrl: target.controlUrl, target: `${hh}:${mm}:${ss}` });
    }
  }
  session.showingLogo = false;
  session.frozenSince = 0;
  session.emit({
    type: "buffering",
    key: session.key,
    showingLogo: false,
    at: session.lastPosition,
  });
}

async function tick(session) {
  if (session.busy) return;
  session.busy = true;
  try {
    if (session.showingLogo) {
      if (Date.now() - session.logoAt >= RECOVER_MS) {
        session.logoAt = Date.now();
        await restoreVideo(session);
      }
      return;
    }
    const state = await readState(session.target);
    const pos = positionSeconds(state);
    const playing = /PLAY|TRANSITION|BUFFER/i.test(String(state?.state || ""));
    if (!playing) {
      session.frozenSince = 0;
      return;
    }
    if (pos > session.lastPosition + 0.4) {
      session.lastPosition = pos;
      session.frozenSince = 0;
      return;
    }
    if (!session.frozenSince) session.frozenSince = Date.now();
    if (Date.now() - session.frozenSince >= FROZEN_MS) {
      session.logoAt = Date.now();
      await showLogo(session);
    }
  } catch {
    /* keep watching */
  } finally {
    session.busy = false;
  }
}

/** Starts (or replaces) the watchdog for one renderer. */
function watch({ target, mediaUrl, logoUrl, title, mime, subtitle, emit }) {
  const key = keyOf(target || {});
  unwatch(target);
  const session = {
    key,
    target,
    mediaUrl,
    logoUrl,
    title,
    mime,
    subtitle,
    emit: typeof emit === "function" ? emit : () => {},
    lastPosition: 0,
    frozenSince: 0,
    showingLogo: false,
    logoAt: 0,
    busy: false,
  };
  session.timer = setInterval(() => void tick(session), 2500);
  sessions.set(key, session);
  return { ok: true, key };
}

function unwatch(target) {
  const key = keyOf(target || {});
  const session = sessions.get(key);
  if (session) {
    clearInterval(session.timer);
    sessions.delete(key);
  }
  return { ok: true };
}

function unwatchAll() {
  for (const s of sessions.values()) clearInterval(s.timer);
  sessions.clear();
}

module.exports = { watch, unwatch, unwatchAll };
