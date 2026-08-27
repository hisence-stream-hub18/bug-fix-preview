// Packages the Electron desktop app using the @electron/packager Node API.
// Using the API avoids the CLI "Invalid processed options" error that happens
// when a single --ignore string is passed (the schema expects an array/function).
//
// Usage: node scripts/package-electron.mjs [--platform win32] [--arch x64]

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const platform = getArg("platform", process.platform === "darwin" ? "darwin" : "win32");
const arch = getArg("arch", "x64");
const appName = "UniversalMediaServer";
// Version comes from package.json (or --version) so the packaged app, the
// installer and the "about" screen never drift apart between updates.
const pkg = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8").replace(/^\uFEFF/, ""),
);
const appVersion = getArg("version", pkg.version || "1.0.0");
// Keep this explicit. Auto-detection has changed between Packager releases and
// was the source of the unhelpful "Invalid processed options" error.
const electronVersion = "37.4.0";
const out = path.join(root, "electron-release");

const serverEntries = [
  path.join(root, ".output", "server", "index.mjs"),
  path.join(root, "dist", "server", "index.mjs"),
];
if (!serverEntries.some((entry) => existsSync(entry))) {
  console.error(
    "Server bundle not found in .output/server or dist/server.\n" +
      "Run the build first with NITRO_PRESET=node-server (npm run build).",
  );
  process.exit(1);
}

// TanStack/Nitro currently emits dist/server + dist/client. Electron historically
// consumes .output/server + .output/public, so normalize the build before packing
// to keep installed upgrades compatible with either output convention.
const outputRoot = path.join(root, ".output");
const outputServer = path.join(outputRoot, "server");
const outputPublic = path.join(outputRoot, "public");
if (!existsSync(path.join(outputServer, "index.mjs"))) {
  const distServer = path.join(root, "dist", "server");
  if (existsSync(distServer)) {
    mkdirSync(outputRoot, { recursive: true });
    cpSync(distServer, outputServer, { recursive: true });
  }
}
if (!existsSync(outputPublic)) {
  const distClient = path.join(root, "dist", "client");
  if (existsSync(distClient)) {
    mkdirSync(outputRoot, { recursive: true });
    cpSync(distClient, outputPublic, { recursive: true });
  }
}

if (existsSync(out)) rmSync(out, { recursive: true, force: true });

let packager;
try {
  const module = await import("@electron/packager");
  packager = module.packager || module.default;
  if (typeof packager !== "function") throw new Error("Packager API was not found");
} catch (error) {
  console.error("@electron/packager is not installed. Run: npm install");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const options = {
  dir: root,
  name: appName,
  appVersion,
  electronVersion,
  platform,
  arch,
  out,
  overwrite: true,
  prune: false,
  asar: false,
  // Must be an array (or function) — a single string breaks option validation.
  ignore: [
    /^\/src($|\/)/,
    /^\/scripts($|\/)/,
    /^\/installer($|\/)/,
    /^\/android($|\/)/,
    /^\/electron-release($|\/)/,
    /^\/\.git($|\/)/,
    /^\/\.wrangler($|\/)/,
    /^\/node_modules($|\/)/,
  ],
};

if (platform === "win32") {
  options.win32metadata = {
    CompanyName: "UniversalMediaServer",
    ProductName: "Universal Media Server",
    FileDescription: "Universal Media Server",
    OriginalFilename: `${appName}.exe`,
  };
}

if (platform === "win32" && existsSync(path.join(root, "public", "favicon.ico"))) {
  options.icon = path.join(root, "public", "favicon.ico");
}

console.log(`Electron ${electronVersion} | ${platform}-${arch} | app ${appVersion}`);

packager(options)
  .then((paths) => {
    console.log("Packaged to:\n" + paths.join("\n"));
  })
  .catch((err) => {
    console.error("Packaging failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
