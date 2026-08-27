// Real SSDP / UPnP discovery + advertisement over UDP multicast (Node only).
// - discover(): M-SEARCH to 239.255.255.250:1900, collects MediaRenderer /
//   AVTransport devices, then fetches each LOCATION XML for the friendly name,
//   manufacturer, model and the AVTransport controlURL.
// - advertise(): periodic NOTIFY ssdp:alive + answers M-SEARCH so the app is
//   visible on the TV as a Media Server.

const dgram = require("node:dgram");
const http = require("node:http");
const os = require("node:os");
const { URL } = require("node:url");

const MCAST_ADDR = "239.255.255.250";
const MCAST_PORT = 1900;

const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:MediaRenderer:1",
  "urn:schemas-upnp-org:service:AVTransport:1",
  "upnp:rootdevice",
];

function localIPv4List() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === "IPv4" && !info.internal) out.push({ name, address: info.address });
    }
  }
  return out;
}

function primaryIPv4() {
  const list = localIPv4List();
  const preferred = list.find((i) => /^192\.168\./.test(i.address) || /^10\./.test(i.address));
  return (preferred || list[0] || { address: "127.0.0.1" }).address;
}

function fetchText(url, timeout = 3000) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve("");
    }
    if (target.protocol !== "http:") return resolve("");
    const req = http.get(target, { timeout }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        body += c;
        if (body.length > 200_000) req.destroy();
      });
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(""));
  });
}

const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? m[1].trim() : "";
};

function findAvTransportControlUrl(xml) {
  const services = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (const svc of services) {
    if (/AVTransport/i.test(tag(svc, "serviceType"))) return tag(svc, "controlURL");
  }
  return "";
}
function findRenderingControlUrl(xml) {
  const services = xml.match(/<service>[\s\S]*?<\/service>/gi) || [];
  for (const svc of services) {
    if (/RenderingControl/i.test(tag(svc, "serviceType"))) return tag(svc, "controlURL");
  }
  return "";
}

async function describe(location) {
  const xml = await fetchText(location);
  if (!xml) return null;
  const base = new URL(location);
  const urlBase = tag(xml, "URLBase");
  const root = urlBase || `${base.protocol}//${base.host}`;
  const abs = (u) => (u ? new URL(u, root.endsWith("/") ? root : root + "/").toString() : "");
  const av = findAvTransportControlUrl(xml);
  const rc = findRenderingControlUrl(xml);
  return {
    ip: base.hostname,
    port: Number(base.port || 80),
    location,
    name: tag(xml, "friendlyName") || base.hostname,
    manufacturer: tag(xml, "manufacturer"),
    model: tag(xml, "modelName") || tag(xml, "modelNumber"),
    deviceType: tag(xml, "deviceType"),
    udn: tag(xml, "UDN"),
    avTransportUrl: abs(av),
    renderingControlUrl: abs(rc),
  };
}

/** Sends M-SEARCH on every local interface and resolves discovered devices. */
function discover({ timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const found = new Map(); // location -> headers
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

    socket.on("message", (msg) => {
      const text = msg.toString("utf8");
      if (!/^HTTP\/1\.1 200/i.test(text)) return;
      const headers = {};
      for (const line of text.split(/\r?\n/).slice(1)) {
        const i = line.indexOf(":");
        if (i > 0) headers[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim();
      }
      const location = headers.LOCATION;
      if (location && !found.has(location)) found.set(location, headers);
    });

    socket.on("error", () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve([]);
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(4);
      } catch {
        /* ignore */
      }
      const send = (st) => {
        const payload = Buffer.from(
          [
            "M-SEARCH * HTTP/1.1",
            `HOST: ${MCAST_ADDR}:${MCAST_PORT}`,
            'MAN: "ssdp:discover"',
            "MX: 2",
            `ST: ${st}`,
            "",
            "",
          ].join("\r\n"),
        );
        socket.send(payload, 0, payload.length, MCAST_PORT, MCAST_ADDR, () => {});
      };
      SEARCH_TARGETS.forEach(send);
      setTimeout(() => SEARCH_TARGETS.forEach(send), 900);

      setTimeout(async () => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        const devices = [];
        for (const [location, headers] of found) {
          const info = await describe(location);
          if (!info) continue;
          const isRenderer = /MediaRenderer/i.test(info.deviceType) || Boolean(info.avTransportUrl);
          if (!isRenderer) continue;
          const friendly =
            info.name ||
            (/X-FRIENDLY-NAME:\s*(.+)/i.exec(headers["X-FRIENDLY-NAME"] || "") || [])[1] ||
            headers["X-FRIENDLY-NAME"] ||
            info.model ||
            info.ip;
          devices.push({
            ...info,
            name: String(friendly).trim() || info.ip,
            server: headers.SERVER || "",
            protocol: /DLNADOC/i.test(headers.SERVER || "") ? "DLNA" : "UPnP",
          });

        }
        resolve(devices);
      }, timeout);
    });
  });
}

// ---------------------------------------------------------------- advertise

let advertiseSocket = null;
let advertiseTimer = null;

function stopAdvertise() {
  if (advertiseTimer) clearInterval(advertiseTimer);
  advertiseTimer = null;
  if (advertiseSocket) {
    try {
      advertiseSocket.close();
    } catch {
      /* ignore */
    }
  }
  advertiseSocket = null;
}

function advertise({ ip, port, uuid, name = "Universal Media Server" }) {
  stopAdvertise();
  const host = ip || primaryIPv4();
  const location = `http://${host}:${port}/desc.xml`;
  const usnBase = uuid.startsWith("uuid:") ? uuid : `uuid:${uuid}`;
  const targets = [
    "upnp:rootdevice",
    "urn:schemas-upnp-org:device:MediaServer:1",
    "urn:schemas-upnp-org:service:ContentDirectory:1",
    usnBase,
  ];

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  advertiseSocket = socket;

  const notify = (nts) => {
    for (const st of targets) {
      const usn = st === usnBase ? usnBase : `${usnBase}::${st}`;
      const lines = [
        "NOTIFY * HTTP/1.1",
        `HOST: ${MCAST_ADDR}:${MCAST_PORT}`,
        `NT: ${st}`,
        `NTS: ${nts}`,
        `USN: ${usn}`,
      ];
      if (nts === "ssdp:alive") {
        lines.push(
          `LOCATION: ${location}`,
          "CACHE-CONTROL: max-age=1800",
          "SERVER: UMS/1.0 UPnP/1.0 DLNADOC/1.50",
        );
      }
      lines.push("", "");
      const buf = Buffer.from(lines.join("\r\n"));
      socket.send(buf, 0, buf.length, MCAST_PORT, MCAST_ADDR, () => {});
    }
  };

  socket.on("error", () => stopAdvertise());
  socket.on("message", (msg, rinfo) => {
    const text = msg.toString("utf8");
    if (!/^M-SEARCH/i.test(text)) return;
    const st = (/ST:\s*(.+)/i.exec(text) || [])[1]?.trim() || "";
    if (st && !targets.includes(st) && st !== "ssdp:all") return;
    const reply = Buffer.from(
      [
        "HTTP/1.1 200 OK",
        "CACHE-CONTROL: max-age=1800",
        `LOCATION: ${location}`,
        "SERVER: UMS/1.0 UPnP/1.0 DLNADOC/1.50",
        `ST: ${st || "upnp:rootdevice"}`,
        `USN: ${usnBase}::${st || "upnp:rootdevice"}`,
        "EXT:",
        `X-FRIENDLY-NAME: ${name}`,
        "",
        "",
      ].join("\r\n"),
    );
    socket.send(reply, 0, reply.length, rinfo.port, rinfo.address, () => {});
  });

  return new Promise((resolve) => {
    socket.bind(MCAST_PORT, () => {
      try {
        socket.addMembership(MCAST_ADDR);
        socket.setMulticastTTL(4);
      } catch {
        /* ignore */
      }
      notify("ssdp:alive");
      advertiseTimer = setInterval(() => notify("ssdp:alive"), 30_000);
      resolve({ ok: true, location });
    });
    socket.on("error", () => resolve({ ok: false, location }));
  });
}

module.exports = {
  discover,
  advertise,
  stopAdvertise,
  primaryIPv4,
  localIPv4List,
  isAdvertising: () => Boolean(advertiseSocket),
};
