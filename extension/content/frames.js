/**
 * A panel for a form inside an iframe, drawn by the top page.
 *
 * An embedded form's frame is often taller than the screen (Greenhouse sizes
 * its iframe to the whole form), so a panel pinned inside it scrolls away with
 * the page. The frame running the form keeps the run; the top page draws its
 * panel. State goes up and your clicks come back down through the extension's
 * own messaging, which the page itself can neither read nor forge.
 */

(() => {
  if (window.__screenmateFrames) return;

  const isTop = window === window.top;

  const message = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          void chrome.runtime.lastError;
          resolve(res ?? null);
        });
      } catch {
        resolve(null);
      }
    });

  /** State as plain data: element handles stay in the frame that owns them. */
  const toPlain = (state) =>
    JSON.parse(JSON.stringify(state, (_, v) => (v instanceof Element ? undefined : v)));

  /** Extension messages carry JSON, so a chosen File travels as base64. */
  async function filePayload(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { __file: true, name: file.name, type: file.type, data: btoa(binary) };
  }
  const fileFrom = (p) =>
    new File([Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))], p.name, { type: p.type });

  /** In the frame that runs the form: your clicks, relayed from the top page. */
  let remoteHandlers = null;
  /** In the top page: the panel it draws for a form in one of its iframes. */
  let hosted = null;

  /** Stands in for the panel in the frame that runs the form. */
  class RemotePanel {
    constructor(handlers, { collapsed = false } = {}) {
      this.handlers = handlers;
      this.collapsed = collapsed;
      remoteHandlers = handlers;
      this.send({ op: "open", collapsed });
    }
    send(payload) {
      void message({ type: "screenmate:panel", to: "top", ...payload });
    }
    render(state) {
      this.send({ op: "render", state: { ...toPlain(state), remote: true } });
    }
    toggle(force) {
      // The drawn panel reports its own expanding back through onExpand.
      this.collapsed = typeof force === "boolean" ? force : !this.collapsed;
      this.send({ op: "toggle", force: this.collapsed });
    }
    remove() {
      remoteHandlers = null;
      this.send({ op: "remove" });
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== "screenmate:panel") return;

    if (msg.op === "event") {
      if (!remoteHandlers) return;
      const args = (msg.args || []).map((a) => (a && a.__file ? fileFrom(a) : a));
      remoteHandlers[msg.name]?.(...args);
      return;
    }
    if (!isTop) return;

    if (msg.op === "ping") {
      reply({ ok: true });
      return;
    }
    if (msg.op === "open") {
      hosted?.panel.remove();
      const owner = msg.frameId;
      const relay = (name) => async (...args) => {
        const out = [];
        for (const a of args) out.push(a instanceof File ? await filePayload(a) : a);
        void message({ type: "screenmate:panel", to: "owner", frameId: owner, op: "event", name, args: out });
      };
      const handlers = new Proxy(
        {},
        {
          get: (_, name) =>
            name === "onClose"
              ? () => {
                  void relay("onClose")();
                  hosted?.panel.remove();
                  hosted = null;
                }
              : relay(String(name)),
        },
      );
      hosted = { panel: new window.__screenmatePanel(handlers, { collapsed: msg.collapsed }), owner };
      return;
    }
    if (!hosted || msg.frameId !== hosted.owner) return;
    if (msg.op === "render") hosted.panel.render(msg.state);
    if (msg.op === "toggle") hosted.panel.toggle(msg.force);
    if (msg.op === "remove") {
      hosted.panel.remove();
      hosted = null;
    }
  });

  window.__screenmateFrames = {
    RemotePanel,
    /** True when this is an iframe and the top page can draw its panel. */
    async topCanHost() {
      if (isTop) return false;
      return Boolean((await message({ type: "screenmate:panel", to: "top", op: "ping" }))?.ok);
    },
  };
})();
