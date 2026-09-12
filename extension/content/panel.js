/**
 * The SCREENMATE panel, injected into any page.
 *
 * Lives in a shadow root so the host page's CSS can't reach in and ours can't
 * leak out. Same visual language as the web app, rebuilt without a framework.
 */

(() => {
  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }

.root {
  position: fixed; top: 16px; right: 16px; z-index: 2147483647;
  width: 372px; max-height: calc(100vh - 32px);
  display: flex; flex-direction: column;
  background: #0e0e11; color: #d2d2da;
  border: 1px solid #23232b; border-radius: 12px;
  box-shadow: 0 18px 50px rgba(0,0,0,.55);
  font: 400 13px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Inter, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.root.collapsed { width: auto; }
.root.collapsed .body { display: none; }

.head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 12px 14px; border-bottom: 1px solid #17171c; cursor: grab;
}
.root.collapsed .head { border-bottom: none; }
.head:active { cursor: grabbing; }
.brand { display: flex; align-items: center; gap: 9px; }
.mark {
  width: 20px; height: 20px; border-radius: 5px; background: #7c6cf5;
  display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 11px;
}
.word { font-size: 12px; font-weight: 600; letter-spacing: .16em; color: #eeeef2; }
.headbtns { display: flex; gap: 4px; }
.iconbtn {
  border: 1px solid #23232b; background: #131317; color: #8a8a98;
  border-radius: 6px; width: 24px; height: 24px; cursor: pointer;
  font-size: 13px; line-height: 1; display: grid; place-items: center;
}
.iconbtn:hover { border-color: #2e2e38; color: #d2d2da; }

.body { overflow-y: auto; min-height: 0; }
.sec { padding: 14px; border-bottom: 1px solid #17171c; }
.sec:last-child { border-bottom: none; }
.sec.warn { background: rgba(46,36,21,.4); border-color: rgba(216,163,80,.2); }

.lbl {
  font-size: 10px; letter-spacing: .11em; text-transform: uppercase;
  font-weight: 600; color: #6b6b78; margin-bottom: 9px;
}
.lbl.w { color: #d8a350; }
.ttl { font-size: 13px; font-weight: 500; color: #eeeef2; }
.sub { font-size: 12px; color: #8a8a98; margin-top: 2px; }
.muted { font-size: 11.5px; color: #6b6b78; }

.bar { height: 3px; background: #17171c; border-radius: 99px; overflow: hidden; margin-top: 10px; }
.bar > i { display: block; height: 100%; background: #7c6cf5; border-radius: 99px; transition: width .6s ease; }

.status { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.dot { width: 6px; height: 6px; border-radius: 99px; background: #58b58a; flex: none; }
.dot.run { background: #8f82f7; animation: pulse 1.7s ease-in-out infinite; }
.dot.wait { background: #d8a350; }
.dot.err { background: #d4736b; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .32 } }

.btn {
  display: block; width: 100%; border: none; border-radius: 8px;
  background: #7c6cf5; color: #fff; font-size: 13px; font-weight: 500;
  padding: 9px 14px; cursor: pointer; margin-top: 12px;
  font-family: inherit; transition: background .15s;
}
.btn:hover { background: #8f82f7; }
.btn.ghost { background: #131317; border: 1px solid #23232b; color: #a8a8b5; }
.btn.ghost:hover { border-color: #2e2e38; color: #eeeef2; }
.btn:disabled { opacity: .45; cursor: default; }
.row { display: flex; gap: 8px; }
.row .btn { margin-top: 0; }

.plan { list-style: none; display: flex; flex-direction: column; gap: 7px; }
.plan li { display: flex; gap: 8px; font-size: 12.5px; align-items: flex-start; }
.plan .m { flex: none; width: 12px; text-align: center; color: #55555f; }
.plan .done .m { color: #58b58a; }
.plan .active .m { color: #8f82f7; }
.plan .done span { color: #8a8a98; }
.plan .active span { color: #ada3f9; font-weight: 500; }
.plan .pending span { color: #6b6b78; }
.plan .skipped span { color: #55555f; text-decoration: line-through; }

.feed { list-style: none; display: flex; flex-direction: column; gap: 11px; }
.feed li { display: flex; gap: 9px; }
.feed li.nested { padding-left: 18px; }
.feed .ic { flex: none; width: 13px; text-align: center; font-size: 11px; line-height: 1.4; }
.feed .msg { font-size: 12.5px; color: #d2d2da; line-height: 1.35; }
.feed li.nested .msg { font-size: 11.5px; color: #8a8a98; }
.feed .det { font-size: 11.5px; color: #6b6b78; margin-top: 3px; word-break: break-word; }
.t-good { color: #58b58a } .t-warn { color: #d8a350 } .t-acc { color: #ada3f9 }
.t-mute { color: #8a8a98 } .t-bad { color: #d4736b }

.card { border: 1px solid rgba(216,163,80,.35); background: rgba(46,36,21,.45); border-radius: 10px; padding: 14px; }
.card .q { font-size: 13.5px; font-weight: 500; color: #eeeef2; line-height: 1.35; }
.card .why { font-size: 12px; color: #8a8a98; margin-top: 7px; line-height: 1.5; }
.opts { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
.opt {
  border: 1px solid #2e2e38; background: #17171c; color: #eeeef2;
  border-radius: 7px; padding: 7px 15px; font-size: 12.5px; cursor: pointer;
  font-family: inherit;
}
.opt:hover { border-color: #7c6cf5; background: rgba(42,37,69,.8); color: #ada3f9; }
.fine { font-size: 10.5px; color: #6b6b78; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(216,163,80,.15); }

.chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.chip {
  border: 1px solid rgba(124,108,245,.25); background: rgba(42,37,69,.6);
  color: #ada3f9; border-radius: 5px; padding: 2px 7px; font-size: 11px;
}
.src { border-left: 1px solid #23232b; padding-left: 10px; margin-top: 9px;
       display: flex; flex-direction: column; gap: 10px; }
.src a { color: #d2d2da; font-size: 11.5px; text-decoration: none; line-height: 1.35; display: block; }
.src a:hover { color: #ada3f9; }
.disc { background: none; border: none; color: #8a8a98; font-size: 11.5px;
        cursor: pointer; padding: 0; font-family: inherit; margin-top: 10px; }
.disc:hover { color: #d2d2da; }

.pq { border-top: 1px solid #17171c; padding: 11px 0; }
.pq:first-of-type { border-top: none; padding-top: 0; }
.pql { font-size: 12.5px; color: #d2d2da; margin-bottom: 7px; }
.pqo { display: flex; flex-wrap: wrap; gap: 5px; }
.popt, .pask {
  border: 1px solid #23232b; background: #131317; color: #8a8a98;
  border-radius: 6px; padding: 5px 10px; font-size: 11.5px; cursor: pointer;
  font-family: inherit;
}
.popt:hover, .pask:hover { border-color: #2e2e38; color: #d2d2da; }
.popt.on { border-color: #7c6cf5; background: rgba(42,37,69,.8); color: #ada3f9; font-weight: 500; }
.pask { margin-top: 6px; font-size: 11px; }
.pask.on { border-color: #d8a350; color: #d8a350; }
.pfree {
  width: 100%; background: #131317; border: 1px solid #23232b; border-radius: 6px;
  padding: 6px 9px; color: #eeeef2; font: inherit; font-size: 12.5px; outline: none;
}
.pfree:focus, .afree:focus { border-color: #7c6cf5; }
.afree {
  flex: 1; min-width: 140px; background: #17171c; border: 1px solid #2e2e38;
  border-radius: 7px; padding: 7px 10px; color: #eeeef2; font: inherit;
  font-size: 12.5px; outline: none;
}
.arow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
.rem { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #8a8a98; cursor: pointer; }
.rem input { accent-color: #7c6cf5; }
.skip { background: none; border: none; color: #6b6b78; font-size: 11px;
        cursor: pointer; font-family: inherit; text-decoration: underline; }
.skip:hover { color: #d2d2da; }

.steps { display: flex; align-items: center; gap: 4px; margin-top: 9px; flex-wrap: wrap; }
.pip {
  width: 17px; height: 17px; border-radius: 99px; font-size: 10px; font-weight: 600;
  display: grid; place-items: center; border: 1px solid #23232b; color: #6b6b78;
}
.pip.done { background: rgba(23,42,34,.7); border-color: rgba(88,181,138,.3); color: #58b58a; }
.pip.now { background: rgba(42,37,69,.8); border-color: rgba(124,108,245,.4); color: #ada3f9; }

.diff { border: 1px solid #23232b; background: rgba(14,14,17,.6); border-radius: 8px; padding: 11px; }
.diff + .diff { margin-top: 8px; }
.diff .h { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
.diff .n { font-size: 12.5px; font-weight: 500; color: #d2d2da; }
.diff .v { font-size: 11.5px; margin-top: 6px; line-height: 1.45; }
.diff .b { color: #55555f; text-decoration: line-through; }
.diff .a { color: #d2d2da; word-break: break-word; }
.ok { border-color: rgba(88,181,138,.25); background: rgba(23,42,34,.35); }
.cacts { display:flex; gap:5px; margin-top:8px; flex-wrap:wrap; }
.mini {
  border:1px solid #23232b; background:#131317; color:#8a8a98; border-radius:5px;
  padding:4px 9px; font-size:11px; cursor:pointer; font-family:inherit;
}
.mini:hover { border-color:#7c6cf5; color:#ada3f9; }
.mini.go { background:#7c6cf5; border-color:#7c6cf5; color:#fff; }
.mini.go:hover { background:#8f82f7; color:#fff; }
.editor { margin-top:8px; }
.efield {
  width:100%; background:#17171c; border:1px solid #2e2e38; border-radius:6px;
  padding:7px 9px; color:#eeeef2; font:inherit; font-size:12px; outline:none; resize:vertical;
}
.efield:focus { border-color:#7c6cf5; }
`;

  const ICONS = {
    observe: ["◎", "t-mute"],
    research: ["⌕", "t-acc"],
    success: ["✓", "t-good"],
    think: ["✦", "t-acc"],
    action: ["⚡", "t-acc"],
    write: ["✎", "t-acc"],
    lock: ["🔒", "t-warn"],
    warn: ["▲", "t-warn"],
    verify: ["✓", "t-good"],
    context: ["↻", "t-warn"],
    nav: ["→", "t-acc"],
    prefs: ["☰", "t-acc"],
  };

  const MARKS = { done: "✓", active: "→", pending: "○", skipped: "–" };

  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  class Panel {
    constructor(handlers, options = {}) {
      this.handlers = handlers;
      this.collapsed = Boolean(options.collapsed);
      this.sourcesOpen = false;

      this.host = document.createElement("div");
      this.host.id = "screenmate-root";
      this.host.style.cssText = "all:initial;position:static;";
      this.shadow = this.host.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = CSS;
      this.shadow.append(style);

      this.root = document.createElement("div");
      this.root.className = "root";
      this.shadow.append(this.root);

      this.root.classList.toggle("collapsed", this.collapsed);
      document.documentElement.append(this.host);
      this.injectPageStyles();
      this.render({});
    }

    /** The touched-field highlight has to live in the page, not the shadow root. */
    injectPageStyles() {
      if (document.getElementById("screenmate-page-style")) return;
      const s = document.createElement("style");
      s.id = "screenmate-page-style";
      s.textContent = `
@keyframes screenmate-flash {
  0% { box-shadow: 0 0 0 3px rgba(124,108,245,.45); border-color: #7c6cf5; }
  100% { box-shadow: 0 0 0 0 rgba(124,108,245,0); }
}
.screenmate-touched { animation: screenmate-flash 1.6s ease-out; }`;
      document.head?.append(s);
    }

    remove() {
      this.host.remove();
    }

    toggle(force) {
      this.collapsed = typeof force === "boolean" ? force : !this.collapsed;
      this.root.classList.toggle("collapsed", this.collapsed);
      if (!this.collapsed) this.handlers.onExpand?.();
      this.render(this.state || {});
    }

    /**
     * Captures the bits of live UI state that a full innerHTML swap destroys:
     * scroll position, focus, caret, and any text typed but not yet saved.
     */
    captureUi() {
      const body = this.root.querySelector(".body");
      const active = this.shadow.activeElement;
      const drafts = {};
      this.root.querySelectorAll(".pfree").forEach((i) => {
        drafts[i.dataset.topic] = i.value;
      });
      const editors = {};
      this.root.querySelectorAll(".editor").forEach((e) => {
        if (!e.hidden) editors[e.dataset.editor] = e.querySelector(".efield")?.value;
      });
      return {
        scrollTop: body ? body.scrollTop : 0,
        nearBottom: body
          ? body.scrollHeight - body.scrollTop - body.clientHeight < 90
          : true,
        focusKey: active?.classList?.contains("pfree")
          ? `pfree:${active.dataset.topic}`
          : active?.classList?.contains("afree")
            ? "afree"
            : null,
        caret: typeof active?.selectionStart === "number" ? active.selectionStart : null,
        drafts,
        editors,
        answerDraft: this.root.querySelector(".afree")?.value || "",
      };
    }

    restoreUi(ui, autoscroll) {
      // Unsaved typing survives the re-render.
      this.root.querySelectorAll(".pfree").forEach((i) => {
        const draft = ui.drafts[i.dataset.topic];
        if (draft) i.value = draft;
      });
      const answer = this.root.querySelector(".afree");
      if (answer && ui.answerDraft) answer.value = ui.answerDraft;

      // An editor the user had open, and whatever they had typed in it, stays.
      for (const [fieldId, value] of Object.entries(ui.editors || {})) {
        const box = this.editorFor(fieldId);
        if (!box) continue;
        box.hidden = false;
        const area = box.querySelector(".efield");
        if (area && value !== undefined) area.value = value;
      }

      const body = this.root.querySelector(".body");
      if (body) {
        // Only jump to the newest activity if the reader was already down there.
        body.scrollTop =
          autoscroll && ui.nearBottom ? body.scrollHeight : ui.scrollTop;
      }

      if (ui.focusKey) {
        const el =
          ui.focusKey === "afree"
            ? this.root.querySelector(".afree")
            : this.root.querySelector(
                `.pfree[data-topic="${ui.focusKey.slice(6)}"]`,
              );
        if (el) {
          el.focus({ preventScroll: true });
          if (ui.caret !== null) {
            try {
              el.setSelectionRange(ui.caret, ui.caret);
            } catch {
              /* not all inputs support selection */
            }
          }
        }
      }
    }

    render(s) {
      const ui = this.captureUi();
      this.state = s;
      const {
        context = {},
        status = "idle",
        goal,
        steps = [],
        activity = [],
        research,
        approval,
        changes = [],
        report,
        stats,
        banner,
        counts,
        step = 1,
        pages = [],
        submitHandoff,
        needsPrefs,
        prefs = {},
        prefQuestions = [],
      } = s;

      const tone =
        status === "error"
          ? "err"
          : status === "waiting" || status === "reviewing"
            ? "wait"
            : [
                  "observing",
                  "researching",
                  "planning",
                  "acting",
                  "verifying",
                  "advancing",
                ].includes(status)
              ? "run"
              : "";

      const STATUS_TEXT = {
        idle: "Standing by",
        observing: "Observing",
        researching: "Researching",
        planning: "Planning",
        acting: "Acting",
        verifying: "Verifying",
        advancing: "Advancing to next step",
        waiting: "Waiting for user",
        reviewing: "Awaiting your review",
        complete: "Complete",
        error: "Backend unavailable",
      };

      const pct = counts?.total
        ? Math.round((counts.filled / counts.total) * 100)
        : 0;

      this.root.innerHTML = `
<div class="head">
  <div class="brand"><div class="mark">S</div><div class="word">SCREENMATE</div>${
    this.collapsed && counts
      ? `<span class="muted" style="font-size:11px">${counts.total - counts.filled} open</span>`
      : ""
  }</div>
  <div class="headbtns">
    <button class="iconbtn" data-act="collapse" title="Collapse">${this.collapsed ? "+" : "−"}</button>
    <button class="iconbtn" data-act="close" title="Close">×</button>
  </div>
</div>
<div class="body">
  <div class="sec">
    <div class="lbl">Current context</div>
    <div class="ttl">${esc(context.jobTitle || "Scanning…")}</div>
    <div class="sub">${esc(context.company || "")}</div>
    ${
      step > 1 || pages.length
        ? `<div class="steps">${
            pages
              .map(
                (p) =>
                  `<span class="pip done" title="${esc(p.label)}: ${p.filled} filled">${p.step}</span>`,
              )
              .join("") +
            (pages.some((p) => p.step === step)
              ? ""
              : `<span class="pip now" title="current">${step}</span>`)
          }<span class="muted" style="margin-left:6px">Step ${step}${
            context.stepLabel ? ` · ${esc(context.stepLabel)}` : ""
          }</span></div>`
        : context.stepLabel
          ? `<div class="muted" style="margin-top:6px">${esc(context.stepLabel)}</div>`
          : ""
    }
    ${
      counts
        ? `<div class="muted" style="margin-top:10px">${counts.filled}/${counts.total} fields
             · ${counts.sensitive} sensitive · ${counts.review} needs review</div>
           <div class="bar"><i style="width:${pct}%"></i></div>`
        : ""
    }
  </div>

  ${
    goal
      ? `<div class="sec"><div class="lbl">Current goal</div>
         <div class="muted" style="color:#d2d2da;font-size:12.5px">${esc(goal)}</div></div>`
      : ""
  }

  ${
    steps.length
      ? `<div class="sec"><div class="lbl">Agent plan</div>
         <ul class="plan">${steps
           .map(
             (st) =>
               `<li class="${st.status}"><span class="m">${MARKS[st.status]}</span><span>${esc(st.label)}</span></li>`,
           )
           .join("")}</ul></div>`
      : ""
  }

  ${
    needsPrefs
      ? `<div class="sec">
           <div class="lbl">Your standing answers</div>
           <div class="muted" style="line-height:1.55;margin-bottom:12px">
             Answer these once. SCREENMATE applies them on every application
             instead of stopping to ask each time. Anything you leave as
             <em>Ask each time</em> still pauses the run.
           </div>
           ${prefQuestions
             .map((q) => {
               const cur = prefs[q.topic] || "";
               return `<div class="pq">
                 <div class="pql">${esc(q.label)}${q.protectedTopic ? ' <span class="muted">· optional</span>' : ""}</div>
                 ${
                   q.free
                     ? `<input class="pfree" data-topic="${esc(q.topic)}"
                          placeholder="${esc(q.placeholder || "")}"
                          value="${esc(cur === "__ask__" ? "" : cur)}">`
                     : `<div class="pqo">${q.options
                         .map(
                           (o) =>
                             `<button class="popt${cur === o ? " on" : ""}"
                                data-act="pref" data-topic="${esc(q.topic)}"
                                data-val="${esc(o)}">${esc(o)}</button>`,
                         )
                         .join("")}</div>`
                 }
                 <button class="pask${cur === "__ask__" ? " on" : ""}"
                   data-act="pref" data-topic="${esc(q.topic)}" data-val="__ask__">
                   Ask each time</button>
               </div>`;
             })
             .join("")}
           <button class="btn" data-act="prefsDone">Save and run</button>
         </div>`
      : ""
  }

  <div class="sec">
    <div class="lbl">Live status</div>
    <div class="status"><span class="dot ${tone}"></span>${esc(STATUS_TEXT[status] || status)}</div>
    ${banner ? `<div class="muted t-warn" style="margin-top:9px;line-height:1.5">${esc(banner)}</div>` : ""}
    ${
      status === "idle"
        ? `<button class="btn" data-act="run">Run SCREENMATE</button>
           <button class="btn ghost" data-act="rescan">Rescan page</button>`
        : ""
    }
    ${status === "error" ? `<button class="btn ghost" data-act="run">Retry</button>` : ""}
    ${
      status === "complete"
        ? `<button class="btn ghost" data-act="rescan">Rescan page</button>`
        : ""
    }
  </div>

  ${
    approval
      ? `<div class="sec warn">
           <div class="lbl w">User decision required</div>
           <div class="card">
             <div class="q">${esc(approval.label)}</div>
             <div class="why">SCREENMATE paused here. ${esc(approval.reason)}</div>
             ${
               approval.free
                 ? `<div class="opts"><input class="afree" placeholder="Type your answer">
                      <button class="opt" data-act="answerFree">Save</button></div>`
                 : `<div class="opts">${(approval.options?.length
                     ? approval.options
                     : ["Yes", "No"])
                     .slice(0, 8)
                     .map(
                       (o) =>
                         `<button class="opt" data-act="answer" data-val="${esc(o)}">${esc(o)}</button>`,
                     )
                     .join("")}</div>`
             }
             <div class="arow">
               ${
                 approval.topic
                   ? `<label class="rem"><input type="checkbox" class="remember" checked>
                        Remember this answer</label>`
                   : "<span></span>"
               }
               <button class="skip" data-act="skip">Skip this one</button>
             </div>
             <div class="fine">SCREENMATE does not make sensitive decisions without you.</div>
           </div>
         </div>`
      : ""
  }

  ${
    changes.length
      ? `<div class="sec">
           <div class="lbl">${status === "reviewing" ? "Review changes" : "Changes on this step"}</div>
           <div class="muted" style="margin-bottom:10px">
             ${changes.length} field${changes.length === 1 ? "" : "s"} written. Edit anything that is wrong — nothing is submitted.
           </div>
           ${changes
             .map(
               (c, i) => `<div class="diff${c.verified ? " ok" : ""}" data-i="${i}">
               <div class="h">
                 <div class="n">${esc(c.label)}</div>
                 <div class="muted ${c.verified ? "t-good" : "t-warn"}">${
                   c.fromPreference ? "your answer" : c.verified ? "verified" : "unverified"
                 }</div>
               </div>
               <div class="v b">${esc(c.before || "Empty")}</div>
               <div class="v a">${esc(c.after)}</div>
               <div class="cacts">
                 <button class="mini" data-act="editChange" data-field="${esc(c.fieldId)}">Edit</button>
                 ${
                   c.regenerable !== false && c.level === "review"
                     ? `<button class="mini" data-act="regen" data-field="${esc(c.fieldId)}">Regenerate</button>`
                     : ""
                 }
                 <button class="mini" data-act="revertOne" data-field="${esc(c.fieldId)}">Revert</button>
               </div>
               <div class="editor" data-editor="${esc(c.fieldId)}" hidden>
                 <textarea class="efield" rows="4">${esc(c.after)}</textarea>
                 <div class="cacts">
                   <button class="mini go" data-act="saveEdit" data-field="${esc(c.fieldId)}">Save to page</button>
                   <button class="mini" data-act="cancelEdit" data-field="${esc(c.fieldId)}">Cancel</button>
                 </div>
               </div>
             </div>`,
             )
             .join("")}
           ${
             status === "reviewing"
               ? `<div class="row" style="margin-top:12px">
                    <button class="btn" data-act="acceptAll">Looks right</button>
                    <button class="btn ghost" data-act="revertAll">Revert all</button>
                  </div>`
               : ""
           }
         </div>`
      : ""
  }

  ${
    status === "complete" && report
      ? `<div class="sec">
           <div class="lbl">Application check</div>
           ${report.checks
             .map(
               (c) =>
                 `<div style="display:flex;gap:7px;font-size:12px;margin-bottom:5px">
                    <span class="${c.ok ? "t-good" : "t-warn"}">${c.ok ? "✓" : "✗"}</span>
                    <span class="${c.ok ? "t-mute" : "t-warn"}">${esc(c.label)}${c.detail ? ` · ${esc(c.detail)}` : ""}</span>
                  </div>`,
             )
             .join("")}
           <div class="muted" style="margin-top:10px;line-height:1.6">
             ${stats ? `${stats.safeFields} safe fields · ${stats.verifiedActions} verified · ${stats.userDecisions} user decisions${stats.sourcesUsed ? ` · ${stats.sourcesUsed} sources` : ""}<br>` : ""}
             SCREENMATE completed what it could safely automate and left final control with you.
           </div>
         </div>`
      : ""
  }

  ${
    submitHandoff
      ? `<div class="sec warn">
           <div class="lbl w">Submission is yours</div>
           <div class="muted" style="color:#d2d2da;line-height:1.55">
             SCREENMATE filled and verified what it safely could, across
             ${pages.length || 1} step${(pages.length || 1) === 1 ? "" : "s"}.
             It stops at <strong style="color:#eeeef2">"${esc(submitHandoff.text)}"</strong> —
             that is the one button it will never press.
           </div>
         </div>`
      : ""
  }

  ${
    research
      ? `<div class="sec">
           <div class="lbl">Research</div>
           <div class="muted" style="color:#a8a8b5;line-height:1.55">${esc(research.companySummary)}</div>
           ${
             research.technicalFocus?.length
               ? `<div class="chips">${research.technicalFocus.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>`
               : ""
           }
           ${
             research.sources?.length
               ? `<button class="disc" data-act="sources">${this.sourcesOpen ? "▾" : "▸"} ${research.sources.length} source${research.sources.length === 1 ? "" : "s"} used</button>
                  ${
                    this.sourcesOpen
                      ? `<div class="src">${research.sources
                          .map(
                            (src) =>
                              `<div><a href="${esc(src.url)}" target="_blank" rel="noreferrer">${esc(src.title)}</a>
                               <div class="lbl" style="margin:4px 0 0">${esc(src.relevance)}</div></div>`,
                          )
                          .join("")}</div>`
                      : ""
                  }`
               : ""
           }
         </div>`
      : ""
  }

  <div class="sec">
    <div class="lbl">Recent activity</div>
    ${
      activity.length
        ? `<ul class="feed">${activity
            .map((e) => {
              const [ic, tone2] = ICONS[e.kind] || ICONS.observe;
              return `<li class="${e.nested ? "nested" : ""}">
                <span class="ic ${tone2}">${ic}</span>
                <div><div class="msg">${esc(e.message)}</div>
                ${e.detail ? `<div class="det">${esc(e.detail)}</div>` : ""}</div></li>`;
            })
            .join("")}</ul>`
        : `<div class="muted" style="line-height:1.55">Nothing yet. Every observation, decision, action and verification will appear here.</div>`
    }
  </div>
</div>`;

      this.bind();
      this.restoreUi(ui, Boolean(s.autoscroll));
    }

    /** Attribute selectors need escaping; matching on dataset does not. */
    editorFor(fieldId) {
      return [...this.root.querySelectorAll(".editor")].find(
        (e) => e.dataset.editor === fieldId,
      );
    }

    bind() {
      this.root.querySelectorAll("[data-act]").forEach((el) => {
        el.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const act = el.dataset.act;
          if (act === "collapse") return this.toggle();
          if (act === "close") return this.handlers.onClose?.();
          if (act === "sources") {
            this.sourcesOpen = !this.sourcesOpen;
            return this.render(this.state);
          }
          const remember = () =>
            this.root.querySelector(".remember")?.checked !== false;
          if (act === "answer") {
            return this.handlers.onAnswer?.(el.dataset.val, remember());
          }
          if (act === "answerFree") {
            const input = this.root.querySelector(".afree");
            const v = input?.value.trim();
            if (v) this.handlers.onAnswer?.(v, remember());
            return;
          }
          if (act === "skip") return this.handlers.onSkip?.();
          if (act === "editChange" || act === "cancelEdit") {
            const box = this.editorFor(el.dataset.field);
            if (box) box.hidden = act === "cancelEdit" ? true : !box.hidden;
            if (box && !box.hidden) box.querySelector(".efield")?.focus();
            return;
          }
          if (act === "saveEdit") {
            const box = this.editorFor(el.dataset.field);
            const v = box?.querySelector(".efield")?.value ?? "";
            return this.handlers.onEditChange?.(el.dataset.field, v);
          }
          if (act === "regen") return this.handlers.onRegenerate?.(el.dataset.field);
          if (act === "revertOne") return this.handlers.onRevertOne?.(el.dataset.field);
          if (act === "pref") {
            return this.handlers.onSetPref?.(el.dataset.topic, el.dataset.val);
          }
          if (act === "prefsDone") {
            // Hand the free-text answers over together, so the run cannot start
            // before they have been written to storage.
            const free = {};
            this.root.querySelectorAll(".pfree").forEach((inp) => {
              const v = inp.value.trim();
              if (v) free[inp.dataset.topic] = v;
            });
            return this.handlers.onPrefsDone?.(free);
          }
          this.handlers[
            { run: "onRun", rescan: "onRescan", acceptAll: "onAcceptAll", revertAll: "onRevertAll" }[act]
          ]?.();
        });
      });
      const head = this.root.querySelector(".head");
      if (this.collapsed) {
        head.style.cursor = "pointer";
        head.title = "Open SCREENMATE";
        head.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          this.toggle(false);
        });
      }
      this.makeDraggable(head);
    }

    makeDraggable(handle) {
      if (!handle) return;
      handle.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) return;
        const rect = this.root.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        const move = (ev) => {
          this.root.style.left = `${Math.max(0, ev.clientX - dx)}px`;
          this.root.style.top = `${Math.max(0, ev.clientY - dy)}px`;
          this.root.style.right = "auto";
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
    }
  }

  window.__screenmatePanel = Panel;
})();
