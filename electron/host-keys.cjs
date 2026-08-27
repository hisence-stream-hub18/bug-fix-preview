// Sends real keystrokes / media keys to the focused desktop window.
//
// While the desktop screen is mirrored to the TV, the floating panel in the app
// must be able to control whatever is playing on that desktop (video, music,
// browser player): play/pause, seek back/forward, previous/next item and the
// system volume. There is no "media session" to talk to, so we emulate the same
// keys the user would press on a keyboard.
//
// Windows only (keybd_event through PowerShell); other platforms return false.

const { spawn } = require("child_process");

// Virtual key codes (Windows)
const KEYS = {
  playpause: 0xb3,
  next: 0xb0,
  prev: 0xb1,
  stop: 0xb2,
  volup: 0xaf,
  voldown: 0xae,
  mute: 0xad,
  right: 0x27,
  left: 0x25,
  up: 0x26,
  down: 0x28,
  space: 0x20,
  escape: 0x1b,
  fullscreen: 0x46, // "F" — the fullscreen shortcut of most players
};

const PS_HEAD = `
Add-Type -Language CSharp @"
using System.Runtime.InteropServices;
public class UmsKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, System.IntPtr e);
  public static void Tap(byte k) {
    keybd_event(k, 0, 1, System.IntPtr.Zero);      // extended key down
    keybd_event(k, 0, 1 | 2, System.IntPtr.Zero);  // key up
  }
}
"@
`;

/** Taps a key (optionally several times, e.g. seek 10× right). Never throws. */
function sendKey(action, repeat = 1) {
  const code = KEYS[String(action || "").toLowerCase()];
  if (!code) return { ok: false, error: "کلید ناشناخته" };
  if (process.platform !== "win32") return { ok: false, error: "فقط در ویندوز" };
  const times = Math.max(1, Math.min(30, Number(repeat) || 1));
  const taps = Array.from({ length: times }, () => `[UmsKeys]::Tap(${code}); Start-Sleep -m 25`).join(
    "; ",
  );
  try {
    const p = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS_HEAD + taps], {
      stdio: "ignore",
      windowsHide: true,
      detached: false,
    });
    p.on("error", () => {});
    p.unref?.();
    return { ok: true };
  } catch {
    return { ok: false, error: "ارسال کلید ناموفق بود" };
  }
}

module.exports = { sendKey, KEYS };
