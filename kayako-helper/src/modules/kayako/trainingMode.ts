/* src/modules/trainingMode.ts */

import {
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

const STORAGE_KEY = 'trainingMode';
let enabled = true;

/* ------------------------------------------------------------------ */
/* Bootstrapping                                                      */
/* ------------------------------------------------------------------ */

export function bootTrainingMode(): void {
    // Load initial setting (default: true)
    chrome.storage.sync.get({ [STORAGE_KEY]: true }, items => {
        enabled = items[STORAGE_KEY];
        setRestrictedButtonsVisibility(enabled);
    });

    // Listen for toggle changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && STORAGE_KEY in changes) {
            enabled = changes[STORAGE_KEY].newValue as boolean;
            setRestrictedButtonsVisibility(enabled);
        }
    });

    // Keep buttons hidden if Kayako re-injects them
    const mo = new MutationObserver(() => {
        if (enabled) setRestrictedButtonsVisibility(true);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Intercept send-reply clicks
    document.addEventListener('click', onReplyButtonClick, true);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Hide “Complete”+“Trash” buttons while training mode is enabled */
function setRestrictedButtonsVisibility(hide: boolean): void {
    const display = 'none';
    [
        KAYAKO_SELECTORS.completeTicketButton,
        KAYAKO_SELECTORS.trashTicketButton,
    ].forEach(sel => {
        document.querySelectorAll<HTMLElement>(sel)
            .forEach(el => (el.style.display = display));
    });
}

function onReplyButtonClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest(KAYAKO_SELECTORS.sendButtonPublicReply) as HTMLElement | null;
    if (!btn) return;

    // If it's a public reply (not an internal note)
    const isNote = btn.matches(KAYAKO_SELECTORS.sendButtonNote);
    if (enabled && !isNote) {
        const ok = confirm(
            'Training mode is ON. You are about to send a PUBLIC reply.\n' +
            'Trainees should send internal notes only. Proceed?'
        );
        if (!ok) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }
}
