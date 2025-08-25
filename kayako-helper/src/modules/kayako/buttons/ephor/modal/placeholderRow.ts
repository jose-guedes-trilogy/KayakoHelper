// Kayako Helper – placeholderRow.ts
// Centralised helpers for the placeholder-button row in the settings modal.

import { EphorStore, saveEphorStore } from "../ephorStore.ts";
import type { ModalRefs } from "../ephorSettingsUI.ts";

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/** Mount the single delegated click-handler (one-time call). */
export function attachPlaceholderRowHandler(refs: ModalRefs): void {
    refs.placeholderRow.addEventListener("click", ev => {
        const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-ph]");
        if (!el?.dataset.ph) return;
        insertPlaceholder(refs, el.dataset.ph);
    });
}

/**
 * Rebuild the entire placeholder row.
 * Call whenever:
 *   • stage changes
 *   • query-mode switches (single vs workflow)
 */
export function rebuildPlaceholderRow(
    store          : EphorStore,
    refs           : ModalRefs,
    useWorkflow    : boolean,
    currentStageId : string,
    rebuildCanned  : () => void,
): void {

    const row = refs.placeholderRow;
    row.textContent = "";                                    // wipe
    row.style.scrollBehavior = "smooth";

    // Label rendered in left split column in markup; no inline label here

    /* --- Transcript button (always visible) --- */
    createPlainBtn("Transcript", "@#TRANSCRIPT#@", row);

    /* Single-stage mode still shows system placeholders and user canned */
    if (!useWorkflow) {
        appendSystemPlaceholders(row, store);
        rebuildCanned();
        return;
    }

    /* Determine completed round count (0-based → 1-based display) */
    const stageIdx = store.workflowStages.findIndex(s => s.id === currentStageId);

    for (let r = 1; r <= stageIdx; r++) {
        const stg = store.workflowStages[r - 1];

        /* wrapper */
        const wrap = document.createElement("div");
        wrap.className = "kh-split-btn-wrapper";
        row.appendChild(wrap);

        /* main – combined */
        wrap.appendChild(
            createSplitBtnPart(
                `Round ${r} Combined`,
                `@#RD_${r}_COMBINED#@`,
                "kh-split-main",
            ),
        );

        /* dropdown toggle */
        const drop = createSplitBtnPart("▾", "", "kh-split-drop");
        wrap.appendChild(drop);

        /* dropdown menu */
        const menu = document.createElement("div");
        menu.className = "kh-ph-menu";
        wrap.appendChild(menu);

        stg.selectedModels.forEach(ai => {
            const item = document.createElement("div");
            item.textContent = ai;
            item.dataset.ph  = `@#RD_${r}_AI_${ai}#@`;
            menu.appendChild(item);
        });

        /* toggle */
        drop.addEventListener("click", e => {
            e.stopPropagation();
            menu.style.display = menu.style.display === "block" ? "none" : "block";
        });
        document.addEventListener("click", () => { menu.style.display = "none"; });
    }

    appendSystemPlaceholders(row, store);
    rebuildCanned();   // append user canned-prompt buttons

    // Make canned placeholder buttons draggable to reorder within the row
    try {
        const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>(".kh-ph-btn[data-canned]"));
        buttons.forEach((btn, index) => {
            btn.draggable = true;
            btn.addEventListener("dragstart", (e) => {
                btn.dataset.dragIndex = String(index);
                e.dataTransfer?.setData("text/plain", String(index));
            });
            btn.addEventListener("dragover", (e) => { e.preventDefault(); });
            btn.addEventListener("drop", async (e) => {
                e.preventDefault();
                const fromIdx = Number(e.dataTransfer?.getData("text/plain") ?? btn.dataset.dragIndex ?? -1);
                const toIdx = buttons.indexOf(btn);
                if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
                const arr = store.cannedPrompts ?? [];
                if (!arr.length) return;
                const [moved] = arr.splice(fromIdx, 1);
                arr.splice(toIdx, 0, moved);
                await saveEphorStore(store);
                // Rebuild the row to reflect new order
                rebuildPlaceholderRow(store, refs, useWorkflow, currentStageId, rebuildCanned);
                // Keep plus button visible by scrolling to end
                row.scrollLeft = row.scrollWidth;
            });
        });
    } catch {}
}

/* ------------------------------------------------------------------ */
/* Internals                                                          */
/* ------------------------------------------------------------------ */

function insertPlaceholder(refs: ModalRefs, token: string): void {
    if (!token) return;
    const ta = refs.promptInput;
    const posStart = ta.selectionStart;
    const posEnd   = ta.selectionEnd;
    ta.value = ta.value.slice(0, posStart) + token + ta.value.slice(posEnd);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = posStart + token.length;

    /* persist (same mechanism as manual typing) */
    ta.dispatchEvent(new Event("input", { bubbles: true }));
}

function createPlainBtn(label: string, token: string, parent: HTMLElement): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className  = "kh-ph-btn";
    btn.textContent = label;
    btn.dataset.ph  = token;
    parent.appendChild(btn);
    return btn;
}

function createSplitBtnPart(
    label: string,
    token: string,
    extraClass: string,
): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = `kh-ph-btn ${extraClass}`;
    btn.textContent = label;
    if (token) btn.dataset.ph = token;
    return btn;
}

function appendSystemPlaceholders(parent: HTMLElement, store: EphorStore): void {
    // System placeholders: File Analysis, Past Tickets, Style Guide (Transcript already included above)
    try {
        createPlainBtn("File Analysis", "@#FILE_ANALYSIS#@", parent);
        createPlainBtn("Past Tickets", "@#PAST_TICKETS#@", parent);
        createPlainBtn("Style Guide", "@#STYLE_GUIDE#@", parent);
    } catch {}
}
