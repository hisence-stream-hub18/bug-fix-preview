// Copies the native SSDP/AVTransport plugin into the generated Capacitor
// Android project, registers it in MainActivity and makes sure the manifest has
// the network/multicast permissions the discovery needs.
// Run after `npx cap add android` and before `gradlew assembleDebug`.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const root = process.cwd();
const androidRoot = join(root, "android");
if (!existsSync(androidRoot)) {
  console.error("پوشه android پیدا نشد. ابتدا دستور «npx cap add android» را اجرا کنید.");
  process.exit(1);
}

const pkg = "app.lovable.universalmediaserver";
const javaRoot = join(androidRoot, "app", "src", "main", "java", ...pkg.split("."));
mkdirSync(javaRoot, { recursive: true });

const source = readFileSync(join(root, "native", "android", "UmsNativePlugin.java"), "utf8");
writeFileSync(join(javaRoot, "UmsNativePlugin.java"), source, "utf8");
console.log("پلاگین بومی کپی شد:", join(javaRoot, "UmsNativePlugin.java"));

// ---- register the plugin in MainActivity ---------------------------------
function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry === name) {
      return full;
    }
  }
  return null;
}

const activity = findFile(join(androidRoot, "app", "src", "main", "java"), "MainActivity.java");
if (activity) {
  let code = readFileSync(activity, "utf8");
  if (!code.includes("UmsNativePlugin.class")) {
    if (!code.includes("import android.os.Bundle;")) {
      code = code.replace(
        /(package [^;]+;\s*)/,
        `$1\nimport android.os.Bundle;\n`,
      );
    }
    if (/onCreate\s*\(\s*Bundle/.test(code)) {
      code = code.replace(
        /(super\.onCreate\([^)]*\);)/,
        `registerPlugin(UmsNativePlugin.class);\n        $1`,
      );
    } else {
      code = code.replace(
        /(public class MainActivity extends BridgeActivity \{)/,
        `$1
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UmsNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
`,
      );
    }
    writeFileSync(activity, code, "utf8");
    console.log("MainActivity به‌روزرسانی شد:", activity);
  } else {
    console.log("MainActivity از قبل پلاگین را ثبت کرده است.");
  }
} else {
  console.warn("MainActivity.java پیدا نشد؛ ثبت پلاگین را دستی انجام دهید.");
}

// ---- permissions ---------------------------------------------------------
const manifestPath = join(androidRoot, "app", "src", "main", "AndroidManifest.xml");
if (existsSync(manifestPath)) {
  let manifest = readFileSync(manifestPath, "utf8");
  const perms = [
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.ACCESS_WIFI_STATE",
    "android.permission.CHANGE_WIFI_MULTICAST_STATE",
  ];
  const missing = perms.filter((p) => !manifest.includes(p));
  if (missing.length) {
    manifest = manifest.replace(
      /<\/manifest>/,
      `${missing.map((p) => `    <uses-permission android:name="${p}" />`).join("\n")}\n</manifest>`,
    );
    writeFileSync(manifestPath, manifest, "utf8");
    console.log("مجوزهای شبکه اضافه شد:", missing.join(", "));
  } else {
    console.log("مجوزهای شبکه از قبل موجود است.");
  }

  // Android 11+ package visibility: without this the "play in VLC" intent is
  // invisible and silently fails.
  if (!manifest.includes("org.videolan.vlc")) {
    manifest = manifest.replace(
      /<\/manifest>/,
      `    <queries>
        <package android:name="org.videolan.vlc" />
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:mimeType="video/*" />
        </intent>
    </queries>
</manifest>`,
    );
    writeFileSync(manifestPath, manifest, "utf8");
    console.log("دسترسی به VLC در manifest اضافه شد.");
  }
}

// ---- cleartext HTTP (TVs serve plain http) --------------------------------
const netConfigDir = join(androidRoot, "app", "src", "main", "res", "xml");
mkdirSync(netConfigDir, { recursive: true });
const netConfig = join(netConfigDir, "network_security_config.xml");
if (!existsSync(netConfig)) {
  writeFileSync(
    netConfig,
    `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`,
    "utf8",
  );
  console.log("فایل network_security_config.xml ساخته شد:", dirname(netConfig));
}

console.log("نصب پلاگین بومی کامل شد.");
