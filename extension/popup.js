const portEl = document.getElementById("port");
const msg = document.getElementById("msg");

chrome.storage.local.get({ port: 5001 }, (v) => (portEl.value = v.port || 5001));

document.getElementById("save").onclick = () => {
  chrome.storage.local.set({ port: Number(portEl.value) || 5001 }, () => {
    msg.textContent = "ذخیره شد.";
  });
};

document.getElementById("send").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await fetch(`http://127.0.0.1:${Number(portEl.value) || 5001}/api/catch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", url: tab.url, title: tab.title }),
    });
    msg.textContent = "به برنامه فرستاده شد ✓";
  } catch {
    msg.textContent = "برنامه باز نیست.";
  }
};
