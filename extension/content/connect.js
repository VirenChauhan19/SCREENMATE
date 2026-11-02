(() => {
  if (window !== window.top || window.__screenmateConnectLoaded) return;
  window.__screenmateConnectLoaded = true;
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.source !== "screenmate:website") return;
    if (!["ping", "saveProfile"].includes(message.action) || typeof message.id !== "string" || message.id.length > 80) return;
    chrome.runtime.sendMessage({ type: "screenmate:website", action: message.action, profile: message.profile }, (response) => {
      const error = chrome.runtime.lastError;
      window.postMessage({ source: "screenmate:extension", id: message.id, ok: !error && response?.ok === true, error: error?.message || response?.error }, location.origin);
    });
  });
})();
