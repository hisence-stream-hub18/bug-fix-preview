// Plugin (افزونه) host.
//
// Goal: add new capabilities without shipping a whole new build of the app.
// A plugin is a folder inside <userData>/plugins/<id> containing:
//
//   plugin.json  { "id", "name", "version", "main": "index.cjs", "description" }
//   index.cjs    module.exports = { activate(api) {}, deactivate() {} }
//
// Plugins run inside the main process and get a small, explicit API — they can
// register IPC channels, add media, react to app events and read app paths.
// Failures are contained: a broken plugin is reported and disabled, never
// allowed to take the app down.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const state = {
  dir: "",
  api: null,
  loaded: new Map(), // id -> { manifest, mod, error }
};

function pluginsDir() {
  const dir = state.dir || path.join(process.cwd(), "plugins");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

function setPluginsDir(dir) {
  state.dir = String(dir || "");
  return pluginsDir();
}

/** Host API handed to every plugin (kept deliberately small and stable). */
function setHostApi(api) {
  state.api = api;
  return true;
}

function readManifest(folder) {
  try {
    const raw = fs.readFileSync(path.join(folder, "plugin.json"), "utf8");
    const m = JSON.parse(raw);
    const id = String(m.id || path.basename(folder)).trim();
    if (!id) return null;
    return {
      id,
      name: String(m.name || id),
      version: String(m.version || "1.0.0"),
      description: String(m.description || ""),
      main: String(m.main || "index.cjs"),
      folder,
    };
  } catch {
    return null;
  }
}

function disabledFile(folder) {
  return path.join(folder, ".disabled");
}

function isEnabled(folder) {
  try {
    return !fs.existsSync(disabledFile(folder));
  } catch {
    return true;
  }
}

/** Every installed plugin with its manifest + live state. */
function list() {
  const dir = pluginsDir();
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    entries = [];
  }
  return entries
    .map((e) => {
      const folder = path.join(dir, e.name);
      const manifest = readManifest(folder);
      if (!manifest) {
        return {
          id: e.name,
          name: e.name,
          version: "",
          description: "فایل plugin.json معتبر نیست",
          enabled: false,
          loaded: false,
          error: "plugin.json خوانده نشد",
          folder,
        };
      }
      const live = state.loaded.get(manifest.id);
      return {
        ...manifest,
        enabled: isEnabled(folder),
        loaded: Boolean(live && !live.error),
        error: live?.error || "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function activateOne(manifest) {
  const entry = path.join(manifest.folder, manifest.main);
  try {
    delete require.cache[require.resolve(entry)];
  } catch {
    /* not cached yet */
  }
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(entry);
    if (typeof mod?.activate === "function") mod.activate(state.api || {});
    state.loaded.set(manifest.id, { manifest, mod, error: "" });
    return { ok: true };
  } catch (err) {
    const error = String(err && err.message).slice(0, 300);
    state.loaded.set(manifest.id, { manifest, mod: null, error });
    return { ok: false, error };
  }
}

function deactivateOne(id) {
  const live = state.loaded.get(id);
  if (live?.mod && typeof live.mod.deactivate === "function") {
    try {
      live.mod.deactivate();
    } catch {
      /* ignore */
    }
  }
  state.loaded.delete(id);
  return { ok: true };
}

/** Loads all enabled plugins. Called once at startup and after every change. */
function loadAll() {
  for (const id of [...state.loaded.keys()]) deactivateOne(id);
  const results = [];
  for (const p of list()) {
    if (!p.enabled || p.error === "plugin.json خوانده نشد") continue;
    const manifest = readManifest(p.folder);
    if (!manifest) continue;
    results.push({ id: manifest.id, ...activateOne(manifest) });
  }
  return { ok: true, count: results.filter((r) => r.ok).length, results };
}

function setEnabled(id, on) {
  const target = list().find((p) => p.id === id);
  if (!target) return { ok: false, error: "افزونه پیدا نشد" };
  try {
    if (on) fs.rmSync(disabledFile(target.folder), { force: true });
    else fs.writeFileSync(disabledFile(target.folder), "disabled", "utf8");
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
  loadAll();
  return { ok: true, enabled: Boolean(on) };
}

function remove(id) {
  const target = list().find((p) => p.id === id);
  if (!target) return { ok: false, error: "افزونه پیدا نشد" };
  deactivateOne(id);
  try {
    fs.rmSync(target.folder, { recursive: true, force: true });
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  }
  loadAll();
  return { ok: true };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    const to = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function findManifestFolder(root, depth = 3) {
  if (fs.existsSync(path.join(root, "plugin.json"))) return root;
  if (depth <= 0) return "";
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return "";
  }
  for (const e of entries) {
    const hit = findManifestFolder(path.join(root, e.name), depth - 1);
    if (hit) return hit;
  }
  return "";
}

/**
 * Installs a plugin from a .zip file or from a folder on disk.
 * The archive may wrap the plugin in a subfolder — the real plugin.json is
 * located automatically.
 */
function install(source) {
  const src = String(source || "");
  if (!src || !fs.existsSync(src)) return { ok: false, error: "فایل یا پوشه افزونه پیدا نشد" };
  let root = src;
  let tmp = "";
  if (/\.zip$/i.test(src)) {
    tmp = path.join(pluginsDir(), `.unpack-${Date.now()}`);
    if (process.platform !== "win32")
      return { ok: false, error: "نصب از فایل zip فقط در ویندوز پشتیبانی می‌شود" };
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Expand-Archive -LiteralPath '${src}' -DestinationPath '${tmp}' -Force`,
      ],
      { stdio: "ignore", timeout: 120000, windowsHide: true },
    );
    if (r.error || r.status !== 0) return { ok: false, error: "باز کردن فایل zip ناموفق بود" };
    root = tmp;
  }
  const folder = findManifestFolder(root);
  if (!folder) {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, error: "فایل plugin.json در بسته پیدا نشد" };
  }
  const manifest = readManifest(folder);
  if (!manifest) {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, error: "plugin.json معتبر نیست" };
  }
  const dest = path.join(pluginsDir(), manifest.id);
  try {
    deactivateOne(manifest.id);
    fs.rmSync(dest, { recursive: true, force: true });
    copyDir(folder, dest);
  } catch (err) {
    return { ok: false, error: String(err && err.message) };
  } finally {
    if (tmp) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
  loadAll();
  const live = state.loaded.get(manifest.id);
  return {
    ok: !live?.error,
    error: live?.error || "",
    plugin: { ...manifest, folder: dest, enabled: true },
  };
}

module.exports = {
  setPluginsDir,
  setHostApi,
  pluginsDir,
  list,
  loadAll,
  setEnabled,
  remove,
  install,
};
