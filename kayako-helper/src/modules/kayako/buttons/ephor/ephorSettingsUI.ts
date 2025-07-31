/* Ephor Settings – UI factory (rev-v3.3.1)
   • Header is now draggable again (cursor:move + mousedown tracking).
   • No markup omitted – this is the full file.
*/
import type { EphorStore } from "./ephorStore.ts";

export interface ModalRefs {
    /* log section */
    logPre        : HTMLPreElement;
    logContainer  : HTMLDivElement;
    verboseCbx    : HTMLInputElement;

    /* project / chat pickers */
    projectSearchInp: HTMLInputElement;
    channelSearchInp: HTMLInputElement;
    projectListDiv  : HTMLDivElement;
    channelListDiv  : HTMLDivElement;

    /* models / prompt */
    aiListDiv   : HTMLDivElement;
    promptInput : HTMLTextAreaElement;

    /* toolbar buttons */
    refreshBtn  : HTMLButtonElement;
    newChatBtn  : HTMLButtonElement;
    sendBtn     : HTMLButtonElement;

    /* close button */
    closeBtn    : HTMLButtonElement;
}

export function createSettingsModal(): { modal: HTMLDivElement; refs: ModalRefs } {
    const modal = Object.assign(document.createElement("div"), { id: "kh-ephor-settings-modal" });
    modal.style.cssText = `
        position:fixed;top:90px;left:50%;transform:translateX(-50%);
        min-width:850px;background:#fff;border:1px solid #ccc;border-radius:6px;
        padding:12px;z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,.2);
        font-family:system-ui;font-size:13px;display:flex;flex-direction:column;gap:12px;`;

    modal.innerHTML = /* HTML */`
      <style>
        #kh-ephor-ai-list label { display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;border-radius:3px; }
        #kh-ephor-ai-list label:hover { background:#f0f0f0; }
        #kh-ephor-ai-list input { margin-right:5px; }
      </style>

      <!-- Header (drag handle) -->
      <div class="kh-ephor-header" style="display:flex;align-items:center;gap:12px;cursor:move;">
        <h2 style="margin:0;font-size:16px;">Ephor – Settings & Manual Send</h2>
        <button id="kh-ephor-close"
                style="margin-left:auto;font-size:18px;border:0;background:none;cursor:pointer;">✕</button>
      </div>

      <!-- Selector grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1.2fr;gap:20px;">
        <!-- Projects -->
        <div>
          <p style="margin:0 0 4px;font-weight:600;">1. Select Project</p>
          <input id="kh-ephor-project-search" placeholder="Search projects…"
                 style="width:100%;padding:4px 6px;margin-bottom:8px;">
          <div id="kh-ephor-project-list"
               style="height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
        </div>

        <!-- Chats -->
        <div>
          <p style="margin:0 0 4px;font-weight:600;">2. Select Chat</p>
          <input id="kh-ephor-channel-search" placeholder="Search chats…"
                 style="width:100%;padding:4px 6px;margin-bottom:8px;">
          <div id="kh-ephor-channel-list"
               style="height:200px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
        </div>

        <!-- AI Models -->
        <div>
          <p style="margin:0 0 4px;font-weight:600;">3. Select AI Models</p>
          <div id="kh-ephor-ai-list"
               style="height:215px;overflow-y:auto;border:1px solid #ddd;border-radius:4px;"></div>
        </div>
      </div>

      <!-- Prompt input -->
      <div>
        <p style="margin:0 0 4px;font-weight:600;">4. Write Prompt & Send</p>
        <textarea id="kh-ephor-prompt-input" placeholder="Enter your prompt…"
                  style="width:100%;height:80px;padding:6px;border:1px solid #ddd;border-radius:4px;resize:vertical;"></textarea>
      </div>

      <!-- Toolbar -->
      <div style="display:flex;align-items:center;gap:8px;border-top:1px solid #eee;padding-top:12px;">
        <button id="kh-ephor-refresh-projects" style="padding:4px 8px;">🔄 Refresh Projects</button>
        <button id="kh-ephor-new-chat"          style="padding:4px 8px;">＋ New Chat</button>
        <button id="kh-ephor-send-btn"
                style="padding:6px 12px;font-weight:bold;margin-left:auto;background:#2e73e9;color:#fff;border:none;border-radius:4px;">
          Send Message
        </button>
      </div>

      <!-- Log area -->
      <div>
        <div style="display:flex;align-items:center;gap:12px;">
          <p style="margin:0;font-weight:600;">API Log</p>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
            <input type="checkbox" id="kh-ephor-log-verbose"> Verbose
          </label>
          <button id="kh-ephor-copy-log"  style="margin-left:auto;padding:2px 6px;">📋 Copy</button>
          <button id="kh-ephor-clear-log" style="padding:2px 6px;">🗑 Clear</button>
        </div>
        <div id="kh-ephor-log-container"
             style="background:#f0f0f0;border:1px solid #ddd;border-radius:4px;height:100px;overflow-y:scroll;padding:5px;margin-top:4px;">
          <pre style="margin:0;font-size:10px;font-family:monospace;white-space:pre-wrap;word-break:break-all;"></pre>
        </div>
      </div>
    `;

    /* ----------------- gather refs ----------------- */
    const $ = <T extends HTMLElement>(q: string) => modal.querySelector<T>(q)!;
    const refs: ModalRefs = {
        /* log */
        logPre: $("#kh-ephor-log-container pre"),
        logContainer: $("#kh-ephor-log-container"),
        verboseCbx: $("#kh-ephor-log-verbose"),

        /* project / chat pickers */
        projectSearchInp: $("#kh-ephor-project-search"),
        channelSearchInp: $("#kh-ephor-channel-search"),
        projectListDiv : $("#kh-ephor-project-list"),
        channelListDiv : $("#kh-ephor-channel-list"),

        /* models / prompt */
        aiListDiv  : $("#kh-ephor-ai-list"),
        promptInput: $("#kh-ephor-prompt-input"),

        /* toolbar buttons */
        refreshBtn : $("#kh-ephor-refresh-projects"),
        newChatBtn : $("#kh-ephor-new-chat"),
        sendBtn    : $("#kh-ephor-send-btn"),

        /* close */
        closeBtn: $("#kh-ephor-close"),
    };

    /* ----------------- drag-to-move ----------------- */
    const header = modal.querySelector<HTMLDivElement>(".kh-ephor-header")!;
    header.addEventListener("mousedown", ev => {
        // ignore when clicking on buttons / inputs in the header
        if ((ev.target as HTMLElement).closest("button,input,label")) return;

        const startX = ev.clientX;
        const startY = ev.clientY;
        const origLeft = modal.offsetLeft;
        const origTop  = modal.offsetTop;

        const move = (mv: MouseEvent) => {
            const dx = mv.clientX - startX;
            const dy = mv.clientY - startY;
            modal.style.left = origLeft + dx + "px";
            modal.style.top  = origTop  + dy + "px";
        };
        const up = () => window.removeEventListener("mousemove", move);

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up, { once: true });
    });

    return { modal, refs };
}
