// Google Cast support — implemented from scratch on Node built-ins only
// (dgram for mDNS discovery, tls + a tiny protobuf codec for the castv2
// protocol). No chromecast/castv2 npm package, so the footprint stays tiny.
//
// discover(): multicast DNS query for _googlecast._tcp.local on
//   224.0.0.251:5353, then reads PTR/SRV/A/TXT records for name + ip + port.
// play()/stop()/pause()/resume()/seek()/setVolume()/status(): opens a TLS
//   connection to port 8009, launches the Default Media Receiver (CC1AD845)
//   and drives it with the urn:x-cast:com.google.cast.media namespace.

const dgram = require("node:dgram");
const tls = require("node:tls");

const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const SERVICE = "_googlecast._tcp.local";
const CAST_PORT = 8009;
const DEFAULT_RECEIVER = "CC1AD845";

// ------------------------------------------------------------------ protobuf

function varint(value) {
  const out = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Buffer.from(out);
}

function fieldVarint(field, value) {
  return Buffer.concat([varint((field << 3) | 0), varint(value)]);
}

function fieldString(field, value) {
  const body = Buffer.from(String(value ?? ""), "utf8");
  return Buffer.concat([varint((field << 3) | 2), varint(body.length), body]);
}

/** Encodes an extensions.api.cast_channel.CastMessage. */
function encodeCastMessage({ sourceId, destinationId, namespace, payload }) {
  return Buffer.concat([
    fieldVarint(1, 0), // protocol_version = CASTV2_1_0
    fieldString(2, sourceId),
    fieldString(3, destinationId),
    fieldString(4, namespace),
    fieldVarint(5, 0), // payload_type = STRING
    fieldString(6, payload),
  ]);
}

function decodeCastMessage(buf) {
  const msg = { namespace: "", payload: "", sourceId: "", destinationId: "" };
  let i = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    while (i < buf.length) {
      const byte = buf[i++];
      result += (byte & 0x7f) * Math.pow(2, shift);
      if (!(byte & 0x80)) break;
      shift += 7;
    }
    return result;
  };
  while (i < buf.length) {
    const key = readVarint();
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) {
      readVarint();
      continue;
    }
    if (wire !== 2) break;
    const len = readVarint();
    const value = buf.slice(i, i + len).toString("utf8");
    i += len;
    if (field === 2) msg.sourceId = value;
    else if (field === 3) msg.destinationId = value;
    else if (field === 4) msg.namespace = value;
    else if (field === 6) msg.payload = value;
  }
  return msg;
}

// ------------------------------------------------------------------ mDNS

function parseName(buf, offset) {
  const parts = [];
  let jumped = false;
  let next = offset;
  let guard = 0;
  let pos = offset;
  while (pos < buf.length && guard++ < 128) {
    const len = buf[pos];
    if (len === 0) {
      if (!jumped) next = pos + 1;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      const pointer = ((len & 0x3f) << 8) | buf[pos + 1];
      if (!jumped) next = pos + 2;
      jumped = true;
      pos = pointer;
      continue;
    }
    parts.push(buf.slice(pos + 1, pos + 1 + len).toString("utf8"));
    pos += len + 1;
  }
  return { name: parts.join("."), next };
}

function buildQuery(name) {
  const labels = name.split(".");
  const parts = [Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])];
  for (const label of labels) {
    const b = Buffer.from(label, "utf8");
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0, 0, 12, 0, 1])); // QTYPE=PTR QCLASS=IN
  return Buffer.concat(parts);
}

function parseResponse(buf, sink) {
  if (buf.length < 12) return;
  const counts = {
    qd: buf.readUInt16BE(4),
    an: buf.readUInt16BE(6),
    ns: buf.readUInt16BE(8),
    ar: buf.readUInt16BE(10),
  };
  let pos = 12;
  for (let q = 0; q < counts.qd; q++) {
    pos = parseName(buf, pos).next + 4;
  }
  const total = counts.an + counts.ns + counts.ar;
  for (let r = 0; r < total && pos < buf.length; r++) {
    const { name, next } = parseName(buf, pos);
    pos = next;
    if (pos + 10 > buf.length) return;
    const type = buf.readUInt16BE(pos);
    const rdLength = buf.readUInt16BE(pos + 8);
    pos += 10;
    const rdata = buf.slice(pos, pos + rdLength);
    pos += rdLength;

    if (type === 12) {
      // PTR → instance name
      sink.instances.add(parseName(buf, pos - rdLength).name);
    } else if (type === 33 && rdLength > 6) {
      // SRV → port + target host
      const port = rdata.readUInt16BE(4);
      const target = parseName(buf, pos - rdLength + 6).name;
      sink.srv.set(name, { port, target });
    } else if (type === 1 && rdLength === 4) {
      // A → IPv4
      sink.a.set(name, Array.from(rdata).join("."));
    } else if (type === 16) {
      // TXT → key=value pairs
      const txt = {};
      let t = 0;
      while (t < rdata.length) {
        const len = rdata[t++];
        const entry = rdata.slice(t, t + len).toString("utf8");
        t += len;
        const eq = entry.indexOf("=");
        if (eq > 0) txt[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
      }
      sink.txt.set(name, txt);
    }
  }
}

/** Real mDNS scan for Chromecast / Android TV / Nest devices on the LAN. */
function discover({ timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const sink = { instances: new Set(), srv: new Map(), a: new Map(), txt: new Map() };
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      const devices = [];
      const names = new Set([...sink.instances, ...sink.srv.keys()]);
      for (const instance of names) {
        if (!/_googlecast\._tcp/i.test(instance)) continue;
        const srv = sink.srv.get(instance);
        const txt = sink.txt.get(instance) || {};
        const ip = srv ? sink.a.get(srv.target) : "";
        if (!ip) continue;
        const label = instance.split("._googlecast")[0];
        devices.push({
          id: txt.id ? `cast:${txt.id}` : `cast:${ip}`,
          name: txt.fn || label || ip,
          model: txt.md || "Chromecast",
          manufacturer: "Google Cast",
          ip,
          port: srv?.port || CAST_PORT,
          protocol: "Cast",
        });
      }
      resolve(devices);
    };

    socket.on("message", (msg) => {
      try {
        parseResponse(msg, sink);
      } catch {
        /* malformed packet */
      }
    });
    socket.on("error", finish);

    socket.bind(() => {
      try {
        socket.addMembership(MDNS_ADDR);
        socket.setMulticastTTL(255);
      } catch {
        /* ignore */
      }
      const query = buildQuery(SERVICE);
      const send = () => socket.send(query, 0, query.length, MDNS_PORT, MDNS_ADDR, () => {});
      send();
      setTimeout(send, 800);
      setTimeout(finish, timeout);
    });
  });
}

// ------------------------------------------------------------------ session

let requestId = 1;
const nextId = () => requestId++;

const NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection";
const NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
const NS_RECEIVER = "urn:x-cast:com.google.cast.receiver";
const NS_MEDIA = "urn:x-cast:com.google.cast.media";

/** Opens a castv2 session, runs `run(session)`, then closes the socket. */
function withSession(ip, port, run, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let done = false;
    const settle = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(value);
    };
    const timer = setTimeout(
      () => settle({ ok: false, error: "دستگاه Cast پاسخ نداد (timeout)" }),
      timeoutMs,
    );

    const socket = tls.connect(
      { host: ip, port: port || CAST_PORT, rejectUnauthorized: false, servername: undefined },
      async () => {
        try {
          const result = await run(session);
          settle(result ?? { ok: true });
        } catch (err) {
          settle({ ok: false, error: String((err && err.message) || err) });
        }
      },
    );
    socket.setNoDelay(true);

    let buffer = Buffer.alloc(0);
    const waiters = [];

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (buffer.length < 4 + len) break;
        const frame = buffer.slice(4, 4 + len);
        buffer = buffer.slice(4 + len);
        let msg;
        try {
          msg = decodeCastMessage(frame);
        } catch {
          continue;
        }
        let payload = {};
        try {
          payload = msg.payload ? JSON.parse(msg.payload) : {};
        } catch {
          /* non-JSON payload */
        }
        if (msg.namespace === NS_HEARTBEAT && payload.type === "PING") {
          session.send(NS_HEARTBEAT, { type: "PONG" }, msg.sourceId || "receiver-0");
        }
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].match(payload, msg)) {
            const w = waiters.splice(i, 1)[0];
            w.resolve(payload);
          }
        }
      }
    });

    socket.on("error", (err) => settle({ ok: false, error: String(err.message || err) }));
    socket.on("close", () => settle({ ok: false, error: "اتصال Cast بسته شد" }));

    const session = {
      send(namespace, payload, destinationId = "receiver-0") {
        const body = encodeCastMessage({
          sourceId: "sender-0",
          destinationId,
          namespace,
          payload: JSON.stringify(payload),
        });
        const head = Buffer.alloc(4);
        head.writeUInt32BE(body.length, 0);
        socket.write(Buffer.concat([head, body]));
      },
      waitFor(match, waitMs = 8000) {
        return new Promise((res, rej) => {
          const waiter = { match, resolve: res };
          waiters.push(waiter);
          setTimeout(() => {
            const i = waiters.indexOf(waiter);
            if (i >= 0) {
              waiters.splice(i, 1);
              rej(new Error("پاسخی از دستگاه Cast دریافت نشد"));
            }
          }, waitMs);
        });
      },
      connect(destinationId = "receiver-0") {
        session.send(NS_CONNECTION, { type: "CONNECT", origin: {} }, destinationId);
      },
    };
  });
}

/** Launches the media receiver and returns { transportId, sessionId }. */
async function launchReceiver(session) {
  session.connect("receiver-0");
  session.send(NS_HEARTBEAT, { type: "PING" });
  const statusId = nextId();
  session.send(NS_RECEIVER, { type: "GET_STATUS", requestId: statusId });
  const current = await session.waitFor((p) => p.type === "RECEIVER_STATUS");
  const running = (current.status?.applications || []).find(
    (a) => a.appId === DEFAULT_RECEIVER || (a.namespaces || []).some((n) => n.name === NS_MEDIA),
  );
  if (running?.transportId) {
    session.connect(running.transportId);
    return { transportId: running.transportId, sessionId: running.sessionId };
  }
  session.send(NS_RECEIVER, { type: "LAUNCH", appId: DEFAULT_RECEIVER, requestId: nextId() });
  const launched = await session.waitFor(
    (p) =>
      p.type === "RECEIVER_STATUS" &&
      (p.status?.applications || []).some((a) => a.transportId && a.appId === DEFAULT_RECEIVER),
    10000,
  );
  const app = (launched.status?.applications || []).find((a) => a.appId === DEFAULT_RECEIVER);
  if (!app?.transportId) throw new Error("اپلیکیشن پخش روی دستگاه Cast اجرا نشد");
  session.connect(app.transportId);
  return { transportId: app.transportId, sessionId: app.sessionId };
}

/** Connects to an already-running receiver without launching a new one. */
async function attachReceiver(session) {
  session.connect("receiver-0");
  session.send(NS_HEARTBEAT, { type: "PING" });
  session.send(NS_RECEIVER, { type: "GET_STATUS", requestId: nextId() });
  const current = await session.waitFor((p) => p.type === "RECEIVER_STATUS");
  const app = (current.status?.applications || []).find(
    (a) => a.transportId && (a.namespaces || []).some((n) => n.name === NS_MEDIA),
  );
  if (!app) return null;
  session.connect(app.transportId);
  return { transportId: app.transportId, sessionId: app.sessionId };
}

async function mediaStatus(session, transportId) {
  session.send(NS_MEDIA, { type: "GET_STATUS", requestId: nextId() }, transportId);
  const res = await session.waitFor((p) => p.type === "MEDIA_STATUS");
  return (res.status || [])[0] || null;
}

/** Sends a media command (PAUSE/PLAY/STOP/SEEK) to the running receiver. */
async function command(ip, port, build) {
  return withSession(ip, port, async (session) => {
    const app = await attachReceiver(session);
    if (!app) return { ok: false, error: "چیزی روی این دستگاه پخش نمی‌شود" };
    const status = await mediaStatus(session, app.transportId);
    if (!status?.mediaSessionId) return { ok: false, error: "چیزی روی این دستگاه پخش نمی‌شود" };
    session.send(
      NS_MEDIA,
      { ...build(status), mediaSessionId: status.mediaSessionId, requestId: nextId() },
      app.transportId,
    );
    await new Promise((r) => setTimeout(r, 350));
    return { ok: true };
  });
}


function play({ ip, port, url, title = "Universal Media Server", mime = "video/mp4", subtitle }) {
  return withSession(ip, port, async (session) => {
    const { transportId } = await launchReceiver(session);
    const tracks = subtitle
      ? [
          {
            trackId: 1,
            type: "TEXT",
            trackType: "TEXT",
            trackContentId: subtitle,
            trackContentType: "text/vtt",
            subtype: "SUBTITLES",
            name: "زیرنویس",
            language: "fa",
          },
        ]
      : undefined;

    session.send(
      NS_MEDIA,
      {
        type: "LOAD",
        requestId: nextId(),
        autoplay: true,
        currentTime: 0,
        activeTrackIds: tracks ? [1] : [],
        media: {
          contentId: url,
          contentType: mime,
          streamType: "BUFFERED",
          metadata: { type: 0, metadataType: 0, title },
          ...(tracks ? { tracks, textTrackStyle: { backgroundColor: "#00000000" } } : {}),
        },
      },
      transportId,
    );

    const res = await session.waitFor(
      (p) => p.type === "MEDIA_STATUS" || p.type === "LOAD_FAILED" || p.type === "LOAD_CANCELLED",
      10000,
    );
    if (res.type !== "MEDIA_STATUS") {
      return { ok: false, error: "دستگاه Cast این فایل را نپذیرفت" };
    }
    return { ok: true, url };
  });
}

const stop = ({ ip, port }) => command(ip, port, () => ({ type: "STOP" }));
const pause = ({ ip, port }) => command(ip, port, () => ({ type: "PAUSE" }));
const resume = ({ ip, port }) => command(ip, port, () => ({ type: "PLAY" }));
const seek = ({ ip, port, seconds }) =>
  command(ip, port, () => ({ type: "SEEK", currentTime: Math.max(0, Number(seconds) || 0) }));

function setVolume({ ip, port, volume, mute }) {
  return withSession(ip, port, async (session) => {
    session.connect("receiver-0");
    const payload = { type: "SET_VOLUME", requestId: nextId(), volume: {} };
    if (typeof volume === "number") {
      payload.volume.level = Math.min(1, Math.max(0, volume / 100));
    }
    if (typeof mute === "boolean") payload.volume.muted = mute;
    session.send(NS_RECEIVER, payload);
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  });
}

/** Live playback state (used for the progress bar). */
function state({ ip, port }) {
  return withSession(
    ip,
    port,
    async (session) => {
      const app = await attachReceiver(session);
      if (!app) return { ok: true, state: "STOPPED", position: {} };
      const status = await mediaStatus(session, app.transportId);
      if (!status) return { ok: true, state: "STOPPED", position: {} };
      return {
        ok: true,
        state: status.playerState || "UNKNOWN",
        volume:
          typeof status.volume?.level === "number"
            ? Math.round(status.volume.level * 100)
            : undefined,
        muted: Boolean(status.volume?.muted),
        position: {
          relSeconds: Math.floor(status.currentTime || 0),
          durationSeconds: Math.floor(status.media?.duration || 0),
          uri: status.media?.contentId || "",
          title: status.media?.metadata?.title || "",
        },
      };
    },
    8000,
  );
}

module.exports = { discover, play, stop, pause, resume, seek, setVolume, state };

