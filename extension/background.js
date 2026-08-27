chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ port: 5001 }, (v) =>
    chrome.storage.local.set({ port: v.port || 5001 }),
  );
});
