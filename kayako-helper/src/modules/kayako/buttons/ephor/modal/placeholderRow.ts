// Kayako Helper – placeholderRow.ts
// Centralised helpers for the placeholder-button row in the settings modal.

import { EphorStore, saveEphorStore } from "../ephorStore.ts";
import type { ModalRefs } from "../ephorSettingsUI.ts";
import { waitForRequesterId, waitForOrganization } from "@/modules/kayako/utils/caseContext.ts";
import { searchConversationIds, fetchTranscriptByCase, quoteForSearch } from "@/modules/kayako/utils/search.ts";
import { choiceDialog } from "@/utils/dialog.ts";

/* ------------------------------------------------------------------ */
/* Public API                                                         */
/* ------------------------------------------------------------------ */

/** Mount the single delegated click-handler (one-time call). */
export function attachPlaceholderRowHandler(refs: ModalRefs): void {
    refs.placeholderRow.addEventListener("click", ev => {
        const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-ph]");
        if (!el) return;
        const act = (el as HTMLElement).dataset.act || "";
        if (act === "recentTickets") {
            void insertRecentTickets(refs);
            return;
        }
        if (el.dataset.ph) insertPlaceholder(refs, el.dataset.ph);
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

/* ------------------------------------------------------------------ */
/* Async helper: fetch last 10 by requester and org, insert into TA    */
/* ------------------------------------------------------------------ */
async function insertRecentTickets(refs: ModalRefs): Promise<void> {
    const ta = refs.promptInput;
    const LIMIT = 10;
    const POSTS_PER_CASE = 100;
    let attempts = 0;

    while (true) {
        attempts++;
        try {
            try { console.debug('[KH][RecentTickets] start fetch attempt', { attempts }); } catch {}

            const requesterId = await waitForRequesterId(2000);
            const org = await waitForOrganization(2000);
            const orgName = (org?.name || '').trim();

            const results: string[] = [];
            const notes: string[] = [];

            // Requester branch
            let requesterOk = false;
            try {
                if (!requesterId) throw new Error('Requester ID not available');
                const q = `requester:${quoteForSearch(String(requesterId))}`;
                const ids = await searchConversationIds(q, LIMIT, 0);
                try { console.debug('[KH][RecentTickets] requester ids', ids); } catch {}
                if (!ids.length) throw new Error('No requester conversations found');
                const texts = await Promise.all(ids.map(async id => {
                    const raw = await fetchTranscriptByCase(id, POSTS_PER_CASE);
                    return raw.replace(/^Ticket ID:\s+Unknown ID\b/m, `Ticket ID: ${id}`);
                }));
                const section = [
                    '===== Recent Requester Tickets =====',
                    ...texts.map((t, i) => `--- [Requester ${i+1}] ---\n${t}`),
                ].join('\n\n');
                results.push(section);
                requesterOk = true;
            } catch (err: any) {
                notes.push(`Requester: ${err?.message ?? String(err)}`);
            }

            // Organization branch
            let orgOk = false;
            try {
                const q = `organization:${quoteForSearch(orgName)}`;
                const ids = await searchConversationIds(q, LIMIT, 0);
                try { console.debug('[KH][RecentTickets] org ids', ids); } catch {}
                if (!ids.length) throw new Error('No organization conversations found');
                const texts = await Promise.all(ids.map(async id => {
                    const raw = await fetchTranscriptByCase(id, POSTS_PER_CASE);
                    return raw.replace(/^Ticket ID:\s+Unknown ID\b/m, `Ticket ID: ${id}`);
                }));
                const section = [
                    '===== Recent Organization Tickets =====',
                    ...texts.map((t, i) => `--- [Org ${i+1}] ---\n${t}`),
                ].join('\n\n');
                results.push(section);
                orgOk = true;
            } catch (err: any) {
                notes.push(`Organization: ${err?.message ?? String(err)}`);
            }

            if (!requesterOk || !orgOk) {
                const msg = document.createElement('div');
                msg.style.maxWidth = '560px';
                msg.innerHTML = `
                  <p>Fetching recent tickets completed with issues:</p>
                  <ul style="margin:6px 0 0 18px;">${notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
                  <p style="margin-top:10px">What would you like to do?</p>`;
                const choice = await choiceDialog({
                    title: 'Recent Tickets – Partial Failure',
                    message: msg,
                    options: [
                        { id: 'retry', label: 'Retry' },
                        { id: 'skip', label: 'Skip stage and continue workflow' },
                        { id: 'proceed', label: 'Proceed with available data', primary: true },
                    ],
                });
                if (choice === 'retry') { try { console.debug('[KH][RecentTickets] retry chosen'); } catch {}; continue; }
                if (choice === 'skip') { try { console.warn('[KH][RecentTickets] skip chosen; nothing inserted'); } catch {}; return; }
                // proceed: fall through to insert whatever we have (may be empty)
            }

            const text = results.join('\n\n[=========== Next Conversation ===========]\n\n');
            try {
                document.dispatchEvent(new CustomEvent('ephorSetPerTicketSystemBody', { detail: { field: 'pastTickets', body: text } }));
                console.debug('[KH][RecentTickets] saved to per-ticket placeholder', { field: 'pastTickets', length: text.length });
            } catch {}
            return;
        } catch (err: any) {
            try { console.error('[KH][RecentTickets] fetch failed', err); } catch {}
            const msg = document.createElement('div');
            msg.style.maxWidth = '560px';
            msg.innerHTML = `
              <p>Fetching recent tickets failed.</p>
              <p style="white-space:pre-wrap">${escapeHtml(err?.message ?? String(err))}</p>
              <p>What would you like to do?</p>`;
            const choice = await choiceDialog({
                title: 'Recent Tickets – Error',
                message: msg,
                options: [
                    { id: 'retry', label: 'Retry' },
                    { id: 'skip', label: 'Skip stage and continue workflow' },
                    { id: 'proceed', label: 'Proceed with the workflow anyway', primary: true },
                ],
            });
            if (choice === 'retry') { continue; }
            if (choice === 'skip') { try { document.dispatchEvent(new CustomEvent('ephorSkipCurrentStage')); } catch {} return; }
            // proceed: insert nothing and continue
            return;
        }
    }
}

function insertLargeText(ta: HTMLTextAreaElement, text: string): void {
    ta.focus();
    try {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        (ta as any).setRangeText ? ta.setRangeText(text, start, end, 'end') : (ta.value = ta.value.slice(0, start) + text + ta.value.slice(end));
    } catch {
        try {
            ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
            // eslint-disable-next-line deprecation/deprecation
            document.execCommand('insertText', false, text);
        } catch {
            ta.value += (ta.value ? '\n' : '') + text;
        }
    }
    const pos = ta.value.length;
    try { ta.setSelectionRange(pos, pos); } catch {}
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function escapeHtml(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
