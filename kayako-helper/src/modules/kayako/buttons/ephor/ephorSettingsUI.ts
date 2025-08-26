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

    /* NEW ▸ AI selections toolbar */
    aiSelRow: HTMLDivElement;
    aiSelGearBtn: HTMLButtonElement;

    /* NEW ▸ workflows row */
    wfSelect: HTMLSelectElement;
    wfNameInp: HTMLInputElement;
    wfNameClearBtn: HTMLButtonElement;
    wfSaveBtn: HTMLButtonElement;
    wfLoadBtn: HTMLButtonElement;
    wfDeleteBtn: HTMLButtonElement;

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

    /* NEW ▸ Saved instructions toolbar */
    instrRow: HTMLDivElement;
    instrGearBtn: HTMLButtonElement;
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */
export function createSettingsModal() {
    const modal = Object.assign(document.createElement("div"), { id: "kh-ephor-settings-modal" });

    modal.innerHTML = EPHOR_SETTINGS_MARKUP;

    /* ---------- drag-to-move (top/bottom clamped; horizontal free) ---------- */

    // Convert from centered (translateX) to absolute px the first time we drag.
    const ensureAbsolutePosition = () => {
        const computed = window.getComputedStyle(modal).transform;
        if (computed && computed !== "none") {
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
        // Convert to absolute px before clamping so translateY(-50%) doesn't skew math
        ensureAbsolutePosition();
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

        /* NEW ▸ AI selections toolbar */
        aiSelRow: $("#kh-ai-sel-row"),
        aiSelGearBtn: $("#kh-ai-sel-gear") as HTMLButtonElement,

        /* NEW ▸ workflows row */
        wfSelect: $("#kh-workflow-select") as HTMLSelectElement,
        wfNameInp: $("#kh-workflow-name") as HTMLInputElement,
        wfNameClearBtn: $("#kh-workflow-name-clear") as HTMLButtonElement,
        wfSaveBtn: $("#kh-workflow-save") as HTMLButtonElement,
        wfLoadBtn: $("#kh-workflow-load") as HTMLButtonElement,
        wfDeleteBtn: $("#kh-workflow-delete") as HTMLButtonElement,

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

        /* NEW ▸ Saved instructions toolbar */
        instrRow: $("#kh-saved-instr"),
        instrGearBtn: $("#kh-instr-gear") as HTMLButtonElement,
    };

    // Append Add Stage button inside the stage bar; avoid extra wrapper that adds whitespace
    try { refs.stageBarDiv.appendChild(refs.addStageBtn); } catch {}

    return { modal, refs };
}
