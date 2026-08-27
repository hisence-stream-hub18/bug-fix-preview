// Injects a small "UMS" bubble next to every playable video / media link.
// Clicking it sends the link to the desktop app (http://127.0.0.1:5001).

const MEDIA_RE =
  /\.(m3u8|mpd|mp4|mkv|webm|avi|mov|flv|ts|m2ts|wmv|mp3|aac|m4a)(\?|$)|youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d+|instagram\.com\/(reel|p|tv)\/|aparat\.com\/v\//i;

let PORT = 5001;
chrome.storage.local.get({ port: 5001 }, (v) => (PORT = v.port || 5001));

function send(action, url, title) {
  return fetch(`http://127.0.0.1:${PORT}/api/catch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, url, title: title || document.title }),
  })
    .then(() => toast("به برنامه فرستاده شد ✓"))
    .catch(() => toast("برنامه Universal Media Server باز نیست"));
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "ums-toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function makeBubble(url, title) {
  const box = document.createElement("div");
  box.className = "ums-bubble";
  box.innerHTML =
    '<button data-a="cast">📺 تلویزیون</button><button data-a="download">⬇ دانلود</button><button data-a="add">＋ مخزن</button>';
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    send(btn.dataset.a, url, title);
  });
  return box;
}

function currentPageUrl() {
  return location.href;
}

function decorate() {
  // 1) page-level bubble for video pages (YouTube / Instagram / any <video>)
  if (!document.querySelector(".ums-bubble.ums-fixed")) {
    const hasVideo = document.querySelector("video");
    if (hasVideo || MEDIA_RE.test(currentPageUrl())) {
      const b = makeBubble(currentPageUrl(), document.title);
      b.classList.add("ums-fixed");
      document.body.appendChild(b);
    }
  }
  // 2) inline bubbles next to direct media links
  document.querySelectorAll("a[href]").forEach((a) => {
    if (a.dataset.umsDone) return;
    if (!MEDIA_RE.test(a.href)) return;
    a.dataset.umsDone = "1";
    const b = makeBubble(a.href, a.textContent.trim());
    b.classList.add("ums-inline");
    a.insertAdjacentElement("afterend", b);
  });
}

decorate();
setInterval(decorate, 2500);
