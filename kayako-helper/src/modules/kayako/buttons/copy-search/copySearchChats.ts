/* ────────────────────────────────────────────────────────────────
   modules/copy-search/copySearchChats.ts
   Adds a “Copy N chats” button on ticket-search pages
   ( …/agent/search/*  – but *not* users or org searches ).

   – Hover the right-hand chevron to pick how many tickets to copy.
   – The last choice is persisted in localStorage and restored
     across reloads.
   – Clicking the left section fetches the first N conversations
     from the current search, pulls each transcript (100 messages
     per chat), concatenates them, and copies everything to the
     clipboard.
   – UI feedback:  📄 idle · ⏳ working · ✅ success · ❌ error
   – Re-inserts itself on SPA route changes.
   – Relies on `cleanConversation` for transcript formatting.

   ───────────────────────────────────────────────────────────── */

import { cleanConversation, Post }            from '@/modules/kayako/buttons/copy-chat/cleanConversation.ts';
import { onRouteChange }                      from '@/utils/location.ts';
import {
    EXTENSION_SELECTORS,
    KAYAKO_SELECTORS,
}                                             from '@/generated/selectors';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY          = 'copySearchChats.limit';
const DEFAULT_CHAT_LIMIT   = 3;          // conversations
const POST_LIMIT_PER_CASE  = 100;        // messages per conversation
const ICON                 = { idle: '📄', work: '⏳', ok: '✅', err: '❌' } as const;
type UiState = keyof typeof ICON;

const CONTAINER_SEL        = KAYAKO_SELECTORS.searchPageContainer;   // outlet for the button
const SEARCH_INPUT         = KAYAKO_SELECTORS.searchInput;

const BTN_CONTAINER_ID     = EXTENSION_SELECTORS.searchResultsButtonContainer.replace(/^#/, '');

const DEFAULT_BTN_CLASS    = EXTENSION_SELECTORS.defaultButtonClass.replace(/^./, '');

const WRAPPER_CLASS        = EXTENSION_SELECTORS.twoPartBtnParentElement.replace(/^./, '');
const MAIN_BTN_CLASS       = EXTENSION_SELECTORS.twoPartBtnLeftHalf.replace(/^./, '');
const RIGHT_BTN_CLASS      = EXTENSION_SELECTORS.twoPartBtnRightHalf.replace(/^./, '');
const CHV_BTN_CLASS        = EXTENSION_SELECTORS.twoPartBtnChevron.replace(/^./, '');
const DD_CLASS             = EXTENSION_SELECTORS.twoPartBtnDropdown.replace(/^./, '');
const DD_OPT_CLASS         = EXTENSION_SELECTORS.twoPartBtnDropdownItem.replace(/^./, '');

/* Descriptive dropdown entries – *not* raw numbers any more */
const CUSTOM_LABEL  = 'Custom';
const DROPDOWN_OPTS = [
    'Copy 1 ticket',
    'Copy 2 tickets',
    'Copy 3 tickets',
    'Copy 5 tickets',
    'Copy 10 tickets',
    'Copy 15 tickets',
    'Copy 20 tickets',
    CUSTOM_LABEL,
] as const;

/* Pagination */
const RESULTS_PER_PAGE     = 20;         /* 🔄 NEW – matches Kayako UI */

/* Retry settings */
const MAX_RETRIES = 10;
const RETRY_DELAY = 400; // ms

/* ------------------------------------------------------------------ */
/* Boot                                                               */
/* ------------------------------------------------------------------ */

export function bootCopySearchChats(): void {
    onRouteChange(() => ensureButtonWithRetry(), { immediate: true });
}

/* ------------------------------------------------------------------ */
/* DOM helpers                                                        */
/* ------------------------------------------------------------------ */

/** Try to insert the button, retrying if the outlet hasn’t rendered yet. */
function ensureButtonWithRetry(attempt = 0): void {
    /* Guard: only run on the canonical search page of the right host */
    if (
        location.hostname !== 'central-supportdesk.kayako.com' ||
        !/^\/agent\/search\//.test(location.pathname)
    ) {
        return;
    }

    const container = document.querySelector<HTMLElement>(CONTAINER_SEL);

    if (!container) {
        if (attempt < MAX_RETRIES) {
            setTimeout(() => ensureButtonWithRetry(attempt + 1), RETRY_DELAY);
        }
        return;
    }

    /* Already present? → nothing to do */
    if (container.querySelector(`.${WRAPPER_CLASS}`)) return;

    /* Build & mount */
    buildAndInsertButton(container);
}

function buildAndInsertButton(container: HTMLElement): void {
    const ui: { state: UiState; limit: number } = {
        state: 'idle',
        limit: loadLimit(),
    };

    /* --- Wrapper ----------------------------------------------------- */
    const wrapper = document.createElement('div');
    wrapper.className = WRAPPER_CLASS; // gets styled in SCSS

    /* --- Main (left) button ------------------------------------------ */
    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.classList.add(DEFAULT_BTN_CLASS, MAIN_BTN_CLASS);
    mainBtn.textContent = label(ui);
    mainBtn.addEventListener('click', () => copyChats(ui, mainBtn));

    /* --- Chevron (right) button -------------------------------------- */
    const right = document.createElement('button');
    right.type = 'button';
    right.classList.add(DEFAULT_BTN_CLASS, RIGHT_BTN_CLASS);
    right.innerHTML = `<div class="${CHV_BTN_CLASS}">▾</div>`;

    /* --- Dropdown ---------------------------------------------------- */
    const dropdown = buildDropdown(ui, mainBtn);

    /* Show dropdown on hover, hide on leaving the right-hand area */
    right.addEventListener('mouseenter', () => {
        dropdown.style.display = 'block';
    });
    right.addEventListener('mouseleave', () => {
        dropdown.style.display = 'none';
    });

    right.append(dropdown);

    /* Assemble & attach */
    wrapper.append(mainBtn, right);

    const searchResultsButtonContainer = document.createElement('div');
    searchResultsButtonContainer.id = BTN_CONTAINER_ID;
    searchResultsButtonContainer.append(wrapper);

    container.prepend(searchResultsButtonContainer);
}

/**
 * Build the dropdown list.
 * Parses the numeric limit out of the descriptive option text,
 * or shows a prompt when “Custom” is chosen.
 */
function buildDropdown(
    ui: { state: UiState; limit: number },
    mainBtn: HTMLButtonElement
): HTMLElement {
    const list = document.createElement('div');
    list.className = DD_CLASS; // hidden by default (CSS)
    list.style.minWidth = `141.5px`;

    DROPDOWN_OPTS.forEach(optText => {
        const li = document.createElement('div');
        li.className = DD_OPT_CLASS;
        li.textContent = optText;

        li.addEventListener('click', ev => {
            ev.stopPropagation();

            /* “Custom” option – prompt for any positive integer */
            if (optText === CUSTOM_LABEL) {
                const input = prompt('Copy how many tickets?', String(ui.limit));
                if (input === null) return; // cancelled

                const num = parseInt(input.trim(), 10);
                if (!Number.isFinite(num) || num <= 0) {
                    alert('Please enter a positive integer.');
                    return;
                }

                applyLimit(num);
                return;
            }

            /* Regular predefined limits ----------------------------- */
            const numMatch = optText.match(/\d+/);
            if (!numMatch) return; // should never happen

            applyLimit(parseInt(numMatch[0], 10));
        });

        list.append(li);
    });

    return list;

    /* -------------------------------------------------------------- */
    function applyLimit(limit: number): void {
        ui.limit = limit;
        saveLimit(limit);
        ui.state = 'idle';
        mainBtn.textContent = label(ui);
        list.style.display = 'none';       // close after pick

        /* Run immediately after choosing */
        copyChats(ui, mainBtn).catch(() => {/* errors handled in copyChats */});
    }
}

/* ------------------------------------------------------------------ */
/* Business logic                                                     */
/* ------------------------------------------------------------------ */

function label(ui: { state: UiState; limit: number }): string {
    switch (ui.state) {
        case 'idle':
            return `${ICON.idle} Copy ${ui.limit} chat${ui.limit !== 1 ? 's' : ''}`;
        case 'work':
            return `${ICON.work} Copying…`;
        case 'ok':
            return `${ICON.ok} Copied!`;
        case 'err':
            return `${ICON.err} Failed`;
    }
}

/** Read search input value */
function currentSearchQuery(): string | null {
    const input = document.querySelector<HTMLInputElement>(SEARCH_INPUT);
    return input ? input.value.trim() : null;
}

/** True if current search scope is conversations/cases */
function isConversationSearch(): boolean {
    const params = new URLSearchParams(location.search);
    const group  = params.get('group')?.toUpperCase();
    return !group || group === 'CASES' || group === 'CONVERSATIONS';
}

async function copyChats(
    ui: { state: UiState; limit: number },
    btn: HTMLButtonElement
): Promise<void> {
    if (ui.state === 'work') return;                 // ignore double-clicks
    if (!isConversationSearch()) {
        return alert('This feature only works on ticket searches.');
    }

    const q = currentSearchQuery();
    if (!q) return alert('Search query not found.');

    /* 🔄 NEW – determine current page & offset */
    const searchParams = new URLSearchParams(location.search);
    const page         = parseInt(searchParams.get('page') || '1', 10);
    const offset       = (page - 1) * RESULTS_PER_PAGE;

    try {
        setUi('work');
        const ids = await firstNConversationIds(q, ui.limit, offset);  /* 🔄 NEW arg */
        if (!ids.length) throw new Error('No matching conversations.');

        /* --------------------------------------------------------------
           Fetch, patch and format each transcript
           ---------------------------------------------------------- */
        const texts = await Promise.all(
            ids.map(async id => {
                const raw = await fetchTranscriptByCase(id, POST_LIMIT_PER_CASE);

                /* 🔄 CHANGED: put the real ticket ID in place of “Unknown ID” */
                const fixed = raw.replace(
                    /^Ticket ID:\s+Unknown ID\b/m,
                    `Ticket ID: ${id}`
                );

                return fixed;
            })
        );

        const bundle =
            texts.join('\n\n[=========== Next Conversation ===========]\n\n');

        await navigator.clipboard.writeText(bundle);
        setUi('ok');
    } catch (err: any) {
        console.error('[copySearchChats]', err);
        alert(`Copy failed: ${err.message ?? err}`);
        setUi('err');
    } finally {
        setTimeout(() => setUi('idle'), 2000);
    }

    function setUi(state: UiState): void {
        ui.state = state;
        btn.textContent = label(ui);
    }
}

/* ------------------------------------------------------------------ */
/* Kayako API helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Fetch up to `limit` conversation IDs, starting at `offset`.
 */
async function firstNConversationIds(
    query: string,
    limit: number,
    offset: number          /* 🔄 NEW */
): Promise<string[]> {
    const hostname = location.hostname;
    const params   = new URLSearchParams({
        query,
        offset: String(offset),           /* 🔄 NEW – dynamic */
        limit : String(limit),
        fields:
            'data(requester(avatar%2Cfull_name)%2Clast_post_status%2Clast_replier(full_name%2Crole)%2Clast_message_preview%2Csubject%2Cpriority%2Cstate%2Cstatus%2Cassigned_agent(full_name%2Cavatar)%2Cupdated_at%2Clast_replied_at%2Chas_attachments)%2Cresource',
        include : 'case%2Ccase_status%2Ccase_priority%2Cuser%2Crole',
        resources: 'CASES',
    });

    const url = `https://${hostname}/api/v1/search?${params.toString()}`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Kayako API ${res.status}`);

    const json = await res.json();

    /* Each item can embed the ID in slightly different places */
    return (json?.data ?? [])
        .map((item: any) =>
            String(
                item?.resource?.id ??
                item?.case?.id ??
                item?.id ??
                ''
            )
        )
        .filter(Boolean)
        .slice(0, limit);
}

async function fetchTranscriptByCase(
    caseId: string,
    limit: number
): Promise<string> {
    const hostname = location.hostname;
    const url = `https://${hostname}/api/v1/cases/${caseId}/posts.json?filters=MESSAGES,NOTES&include=user&limit=${limit}`;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Case ${caseId} – API ${res.status}`);

    const json: { data: Post[] } = await res.json();
    return cleanConversation(json.data);
}

/* ------------------------------------------------------------------ */
/* Persistence helpers                                                */
/* ------------------------------------------------------------------ */

function loadLimit(): number {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? '', 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_CHAT_LIMIT;
}

function saveLimit(n: number): void {
    localStorage.setItem(STORAGE_KEY, String(n));
}
