// Channel health checker: is a stream alive right now?
//
// The channel lists show a small green/red dot next to every channel. A full
// download would be far too heavy, so we only ask for the first bytes with a
// short timeout and cache the answer for a few minutes.

const http = require("node:http");
const https = require("node:https");

const cache = new Map(); // url -> { ok, at, status }
const TTL = 3 * 60 * 1000;
const MAX_PARALLEL = 6;
let running = 0;
const queue = [];

function head(url, timeout) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve({ ok: false, status: 0 });
    }
    if (!/^https?:$/.test(target.protocol)) return resolve({ ok: true, status: 0 });
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      target,
      {
        method: "GET",
        timeout,
        headers: {
          "User-Agent": "VLC/3.0.20 LibVLC/3.0.20",
          Accept: "*/*",
          Range: "bytes=0-1024",
        },
      },
      (up) => {
        const code = Number(up.statusCode) || 0;
        up.destroy();
        resolve({ ok: code >= 200 && code < 400, status: code });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, status: 0 });
    });
    req.on("error", () => resolve({ ok: false, status: 0 }));
    req.end();
  });
}

function schedule(task) {
  return new Promise((resolve) => {
    queue.push({ task, resolve });
    drain();
  });
}

function drain() {
  while (running < MAX_PARALLEL && queue.length) {
    const item = queue.shift();
    running += 1;
    item
      .task()
      .then(item.resolve)
      .catch(() => item.resolve({ ok: false, status: 0 }))
      .finally(() => {
        running -= 1;
        drain();
      });
  }
}

/** @param {{urls?: string[], url?: string, timeout?: number}} payload */
async function check(payload) {
  const urls = Array.isArray(payload?.urls)
    ? payload.urls
    : payload?.url
      ? [payload.url]
      : [];
  const timeout = Math.max(1500, Math.min(12000, Number(payload?.timeout) || 6000));
  const now = Date.now();
  const out = {};
  await Promise.all(
    urls.slice(0, 400).map(async (raw) => {
      const url = String(raw || "");
      if (!url) return;
      const hit = cache.get(url);
      if (hit && now - hit.at < TTL) {
        out[url] = { ok: hit.ok, status: hit.status };
        return;
      }
      const res = await schedule(() => head(url, timeout));
      cache.set(url, { ...res, at: Date.now() });
      out[url] = res;
    }),
  );
  return { ok: true, results: out };
}

module.exports = { check };
