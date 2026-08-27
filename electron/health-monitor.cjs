// System pressure + hang watchdog.
// The app used to freeze on weak machines (2-core / 4 GB) without telling the
// user anything. This module samples real CPU/RAM load, watches a heartbeat that
// the renderer sends every 2 s, and reports "pressure" / "hang" so the UI can
// show a warning window and restart the app automatically or by hand.

const os = require("node:os");

const state = {
  timer: null,
  emit: () => {},
  app: null,
  lastCpu: null,
  cpu: 0,
  heartbeat: Date.now(),
  hangSince: 0,
  pressureSince: 0,
  autoRestart: false,
  level: "ok", // "ok" | "pressure" | "hang"
  restarts: 0,
};

const CPU_HIGH = 88; // percent, sustained
const PRESSURE_MS = 12_000; // how long the load must stay high
const HANG_MS = 15_000; // no heartbeat from the UI = frozen window
const SAMPLE_MS = 2500;

/** Total CPU usage in percent between two samples. */
function cpuPercent() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const key of Object.keys(c.times)) total += c.times[key];
    idle += c.times.idle;
  }
  const prev = state.lastCpu;
  state.lastCpu = { idle, total };
  if (!prev || total === prev.total) return state.cpu;
  const busy = 1 - (idle - prev.idle) / (total - prev.total);
  return Math.max(0, Math.min(100, Math.round(busy * 100)));
}

function snapshot() {
  const totalMb = Math.round((os.totalmem() || 0) / 1024 / 1024);
  const freeMb = Math.round((os.freemem() || 0) / 1024 / 1024);
  const rssMb = Math.round((process.memoryUsage().rss || 0) / 1024 / 1024);
  return {
    cpu: state.cpu,
    cores: (os.cpus() || []).length,
    totalMb,
    freeMb,
    usedPercent: totalMb ? Math.round(((totalMb - freeMb) / totalMb) * 100) : 0,
    appMb: rssMb,
    level: state.level,
    autoRestart: state.autoRestart,
    hangSeconds: state.hangSince ? Math.round((Date.now() - state.hangSince) / 1000) : 0,
    restarts: state.restarts,
    uptimeSec: Math.round(process.uptime()),
  };
}

/** The renderer calls this every couple of seconds while it is responsive. */
function heartbeat() {
  state.heartbeat = Date.now();
  if (state.level === "hang") {
    state.level = "ok";
    state.hangSince = 0;
    state.emit({ type: "health", ...snapshot(), recovered: true });
  }
  return { ok: true };
}

function setAutoRestart(on) {
  state.autoRestart = Boolean(on);
  return state.autoRestart;
}

/** Relaunches the whole desktop app (used by the warning window). */
function restartApp() {
  state.restarts += 1;
  if (!state.app) return { ok: false, error: "app unavailable" };
  try {
    state.app.relaunch();
    state.app.exit(0);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
}

function tick() {
  state.cpu = cpuPercent();
  const snap = snapshot();
  const silent = Date.now() - state.heartbeat;

  if (silent > HANG_MS) {
    if (!state.hangSince) state.hangSince = state.heartbeat;
    state.level = "hang";
    state.emit({ type: "health", ...snapshot(), level: "hang" });
    if (state.autoRestart) restartApp();
    return;
  }

  const heavy = snap.cpu >= CPU_HIGH || snap.freeMb < 320;
  if (heavy) {
    if (!state.pressureSince) state.pressureSince = Date.now();
    if (Date.now() - state.pressureSince >= PRESSURE_MS && state.level !== "pressure") {
      state.level = "pressure";
      state.emit({ type: "health", ...snapshot(), level: "pressure" });
      return;
    }
  } else {
    state.pressureSince = 0;
    if (state.level === "pressure") {
      state.level = "ok";
      state.emit({ type: "health", ...snapshot(), recovered: true });
      return;
    }
  }
  state.emit({ type: "health", ...snapshot() });
}

function start({ emit, app, autoRestart } = {}) {
  stop();
  if (typeof emit === "function") state.emit = emit;
  if (app) state.app = app;
  if (typeof autoRestart === "boolean") state.autoRestart = autoRestart;
  state.heartbeat = Date.now();
  cpuPercent();
  state.timer = setInterval(tick, SAMPLE_MS);
  if (state.timer.unref) state.timer.unref();
  return { ok: true };
}

function stop() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

module.exports = { start, stop, snapshot, heartbeat, setAutoRestart, restartApp };
