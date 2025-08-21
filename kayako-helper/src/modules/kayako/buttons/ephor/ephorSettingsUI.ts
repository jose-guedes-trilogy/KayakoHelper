/* Kayako Helper – ephorSettingsUI.ts (v9.4.0 – adds Cancel ref, clamps modal to viewport, log toggle ref remains) */

import { EPHOR_SETTINGS_MARKUP } from "./ephorSettingsMarkup.ts";

/* ------------------------------------------------------------------ */
/* Refs interface                                                     */
/* ------------------------------------------------------------------ */
export interface ModalRefs {
    runAutoRadio: HTMLInputElement;
    runManualRadio: HTMLInputElement;
    progressBadge: HTMLSpanElement;
    runRow: HTMLSpanElement;
    placeholderRow: HTMLDivElement;

    logPre: HTMLPreElement;
    logContainer: HTMLDivElement;
    verboseCbx: HTMLInputElement;
    logToggle: HTMLParagraphElement; /* NEW */

    modeMultiplexer: HTMLInputElement;
    modeStream: HTMLInputElement;

    tabSettingsBtn: HTMLButtonElement;
    tabOutputsBtn: HTMLButtonElement;
    paneSettings: HTMLDivElement;
    paneOutputs: HTMLDivElement;
    outputPane: HTMLDivElement;

    querySingleRadio: HTMLInputElement;
    queryWorkflowRadio: HTMLInputElement;

    stageBarDiv: HTMLDivElement;
    addStageBtn: HTMLButtonElement;

    projectSearchInp: HTMLInputElement;
    channelSearchInp: HTMLInputElement;
    projectListDiv: HTMLDivElement;
    channelListDiv: HTMLDivElement;
    chatSortSelect?: HTMLSelectElement;

    modelSearchInp: HTMLInputElement;
    aiListDiv: HTMLDivElement;

    promptInput: HTMLTextAreaElement;
    customInstrTa: HTMLTextAreaElement; /* NEW */
    instrScopeCbx: HTMLInputElement; /* NEW */
    instrScopeLabel: HTMLSpanElement; /* NEW */

    refreshBtn: HTMLButtonElement;
    newChatBtn: HTMLButtonElement;
    sendBtn: HTMLButtonElement;
    cancelBtn: HTMLButtonElement;

    closeBtn: HTMLButtonElement;

    /* NEW */
    cannedBtn: HTMLButtonElement;
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */
export function createSettingsModal() {
    const modal = Object.assign(document.createElement("div"), { id: "kh-ephor-settings-modal" });
    modal.style.cssText = `
      position:fixed;top:90px;left:50%;transform:translateX(-50%);
      min-width:980px;background:#fff;border:1px solid #ccc;border-radius:6px;padding:12px;
      z-index:10000;box-shadow:0 4px 16px rgba(0,0,0,.2);
      max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;
      font-family:system-ui;font-size:13px;display:flex;flex-direction:column;gap:12px;`;

    modal.innerHTML = EPHOR_SETTINGS_MARKUP;

    /* ---------- drag-to-move (top/bottom clamped; horizontal free) ---------- */

    // Convert from centered (translateX) to absolute px the first time we drag.
    const ensureAbsolutePosition = () => {
        if (modal.style.transform !== "none") {
            const rect = modal.getBoundingClientRect();
            modal.style.transform = "none";
            modal.style.left = `${rect.left}px`;
            modal.style.top = `${rect.top}px`;
        }
    };

    const clampY = (topPx: number, heightPx: number) => {
        const margin = 8;
        const minTop = margin;
        const maxTop = Math.max(margin, window.innerHeight - heightPx - margin);
        return Math.min(Math.max(topPx, minTop), maxTop);
    };

    const head = modal.querySelector<HTMLDivElement>(".kh-ephor-header")!;
    head.addEventListener("mousedown", ev => {
        if ((ev.target as HTMLElement).closest("button,input,label")) return;

        ev.preventDefault(); // stop text selection / focus changes
        ensureAbsolutePosition();

        const startX = ev.clientX;
        const startY = ev.clientY;
        const startLeft = modal.offsetLeft;
        const startTop = modal.offsetTop;

        // Prevent accidental text selection while dragging
        const prevSelect = document.body.style.userSelect;
        document.body.style.userSelect = "none";

        const onMove = (e: MouseEvent) => {
            // horizontal: free — no clamp
            const newLeft = startLeft + (e.clientX - startX);

            // vertical: clamp within viewport
            const h = modal.offsetHeight;
            const newTop = clampY(startTop + (e.clientY - startY), h);

            modal.style.left = `${newLeft}px`;
            modal.style.top = `${newTop}px`;
        };

        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            document.body.style.userSelect = prevSelect;
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp, { once: true });
    });

    // Keep only vertical clamping on resize; do not touch horizontal.
    window.addEventListener("resize", () => {
        const rect = modal.getBoundingClientRect();
        const newTop = clampY(rect.top, rect.height);
        modal.style.top = `${newTop}px`;
        // left stays as-is (free to cross viewport)
    });

    const $ = <T extends HTMLElement>(q: string) => modal.querySelector<T>(q)!;

    /* ---------- refs ---------- */
    const refs: ModalRefs = {
        runAutoRadio: $("#kh-run-auto") as HTMLInputElement,
        runManualRadio: $("#kh-run-manual") as HTMLInputElement,
        progressBadge: $("#kh-ephor-progress"),
        runRow: $("#kh-ephor-run-row") as HTMLSpanElement,
        placeholderRow: $("#kh-placeholder-row"),

        logPre: $("#kh-ephor-log-container pre"),
        logContainer: $("#kh-ephor-log-container"),
        verboseCbx: $("#kh-ephor-log-verbose") as HTMLInputElement,
        logToggle: $("#kh-ephor-log-toggle") as HTMLParagraphElement, /* NEW */

        modeMultiplexer: $("#kh-ephor-mode-multiplexer") as HTMLInputElement,
        modeStream: $("#kh-ephor-mode-stream") as HTMLInputElement,

        tabSettingsBtn: $("#kh-ephor-tab-settings") as HTMLButtonElement,
        tabOutputsBtn: $("#kh-ephor-tab-outputs") as HTMLButtonElement,
        paneSettings: $("#kh-ephor-pane-settings"),
        paneOutputs: $("#kh-ephor-pane-outputs"),
        outputPane: $("#kh-ephor-output-pane"),

        querySingleRadio: $("#kh-query-single") as HTMLInputElement,
        queryWorkflowRadio: $("#kh-query-workflow") as HTMLInputElement,

        stageBarDiv: $("#kh-ephor-stage-bar"),
        addStageBtn: Object.assign(
            document.createElement("button"),
            { id: "kh-ephor-add-stage", textContent: "➕", className: "kh-btn" }
        ),

        projectSearchInp: $("#kh-ephor-project-search"),
        channelSearchInp: $("#kh-ephor-channel-search"),
        projectListDiv: $("#kh-ephor-project-list"),
        channelListDiv: $("#kh-ephor-channel-list"),
        chatSortSelect: $("#kh-ephor-chat-sort") as HTMLSelectElement,

        modelSearchInp: $("#kh-ephor-model-search"),
        aiListDiv: $("#kh-ephor-ai-list"),

        promptInput: $("#kh-ephor-prompt-input") as HTMLTextAreaElement,
        customInstrTa: $("#kh-ephor-custom-instr") as HTMLTextAreaElement,
        instrScopeCbx: $("#kh-ephor-instr-scope") as HTMLInputElement,
        instrScopeLabel: $("#kh-ephor-instr-label") as HTMLSpanElement,

        refreshBtn: $("#kh-ephor-refresh-projects") as HTMLButtonElement,
        newChatBtn: $("#kh-ephor-new-chat") as HTMLButtonElement,
        sendBtn: $("#kh-ephor-send-btn") as HTMLButtonElement,
        cancelBtn: $("#kh-ephor-cancel-btn") as HTMLButtonElement,

        closeBtn: $("#kh-ephor-close") as HTMLButtonElement,

        /* NEW */
        cannedBtn: $("#kh-ephor-canned-btn") as HTMLButtonElement,
    };

    refs.stageBarDiv.appendChild(refs.addStageBtn);

    return { modal, refs };
}
