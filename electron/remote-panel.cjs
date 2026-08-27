// On-screen control panel for the TV.
// The TV supports a mouse/keyboard, so instead of only burning a text strip
// into the shared picture we also serve a real, very light HTML remote at
// http://<ip>:<port>/remote — big buttons, no framework, no images. From the TV
// the user can page through channels, switch a channel, and turn subtitles /
// the audio-dub translator on or off.
//
// Everything it does is handed back to the app through one handler, so the
// desktop app performs the real work (DLNA play, subtitle engine…).

const state = {
  channels: [], // [{ id, title, group }]
  handler: null,
  flags: { subtitle: false, dub: false },
  current: "",
};

const PAGE_SIZE = 24; // small pages keep a weak TV browser fast

function setChannels(list) {
  state.channels = (Array.isArray(list) ? list : []).map((c, i) => ({
    id: String(c.id ?? c.key ?? i),
    title: String(c.title || `کانال ${i + 1}`),
    group: String(c.group || ""),
  }));
  return state.channels.length;
}

function setFlags(flags = {}) {
  if (typeof flags.subtitle === "boolean") state.flags.subtitle = flags.subtitle;
  if (typeof flags.dub === "boolean") state.flags.dub = flags.dub;
  if (typeof flags.current === "string") state.current = flags.current;
  return { ...state.flags, current: state.current };
}

function setHandler(fn) {
  state.handler = typeof fn === "function" ? fn : null;
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(query) {
  const total = state.channels.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(pages, Math.max(1, Number(query.get("p")) || 1));
  const slice = state.channels.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  const rows = slice
    .map(
      (c) =>
        `<button class="ch${c.id === state.current ? " on" : ""}" onclick="act('channel','${esc(
          c.id,
        )}')">${esc(c.title)}${c.group ? `<small>${esc(c.group)}</small>` : ""}</button>`,
    )
    .join("");
  return `<!doctype html>
<html lang="fa" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>کنترل روی تلویزیون</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#07090f;color:#f4f6fb;font:20px/1.5 system-ui,sans-serif}
header{display:flex;gap:12px;align-items:center;padding:16px 20px;background:#101728;position:sticky;top:0}
h1{font-size:22px;margin:0;flex:1}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;padding:16px 20px}
button{cursor:pointer;border-radius:14px}
.ch{background:#141c2f;border:1px solid #26314c;color:#f4f6fb;padding:16px;text-align:right;border-radius:14px;font-size:20px}
.ch.on{border-color:#5b8cff;background:#1b2848}
.ch small{display:block;color:#8fa0c0;font-size:14px}
.tog{background:#1b2848;border:1px solid #37507f;color:#dbe6ff;padding:14px 18px;border-radius:14px;font-size:18px}
.tog.on{background:#3f6dff;border-color:#3f6dff;color:#fff}
nav{display:flex;gap:12px;justify-content:center;padding:8px 20px 28px}
nav button{background:#141c2f;border:1px solid #26314c;color:#f4f6fb;padding:14px 26px;font-size:20px}
</style></head><body>
<header>
  <h1>کنترل پخش — صفحه ${p} از ${pages}</h1>
  <button class="tog${state.flags.subtitle ? " on" : ""}" onclick="act('subtitle')">زیرنویس</button>
  <button class="tog${state.flags.dub ? " on" : ""}" onclick="act('dub')">دوبله صدا</button>
  <button class="tog" onclick="act('stop')">توقف</button>
</header>
<div class="grid">${rows || "<p>کانالی ثبت نشده است.</p>"}</div>
<nav>
  <button onclick="go(${Math.max(1, p - 1)})" ${p === 1 ? "disabled" : ""}>صفحه قبل</button>
  <button onclick="location.reload()">به‌روزرسانی</button>
  <button onclick="go(${Math.min(pages, p + 1)})" ${p === pages ? "disabled" : ""}>صفحه بعد</button>
</nav>
<script>
function go(n){location.search='?p='+n}
function act(action,id){
  fetch('/api/remote/action',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:action,id:id||''})}).then(function(){setTimeout(function(){location.reload()},600)});
}
</script>
</body></html>`;
}

/** Routes /remote and /api/remote/* — returns true when it handled the request. */
function handle(req, res, pathname, query) {
  if (pathname === "/remote" || pathname === "/remote/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(page(query));
    return true;
  }
  if (pathname === "/api/remote/state") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, ...state.flags, current: state.current, channels: state.channels.length }));
    return true;
  }
  if (pathname === "/api/remote/action") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 20000) req.destroy();
    });
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body || "{}");
      } catch {
        payload = {};
      }
      if (payload.action === "subtitle") state.flags.subtitle = !state.flags.subtitle;
      if (payload.action === "dub") state.flags.dub = !state.flags.dub;
      if (payload.action === "channel") state.current = String(payload.id || "");
      try {
        state.handler?.({
          action: String(payload.action || ""),
          id: String(payload.id || ""),
          flags: { ...state.flags },
        });
      } catch {
        /* ignore */
      }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ...state.flags, current: state.current }));
    });
    return true;
  }
  return false;
}

module.exports = { handle, setChannels, setFlags, setHandler, PAGE_SIZE };
