import {
    KAYAKO_SELECTORS,
} from '@/generated/selectors';

const STORAGE_KEY = 'trainingMode';
let enabled = true;

export function bootTrainingMode(): void {
    // Load initial setting (default: true)
    chrome.storage.sync.get({ [STORAGE_KEY]: true }, items => {
        enabled = items[STORAGE_KEY];
    });

    // Listen for toggle changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && STORAGE_KEY in changes) {
            enabled = changes[STORAGE_KEY].newValue as boolean;
        }
    });

    // Intercept send-reply clicks
    document.addEventListener('click', onReplyButtonClick, true);
}

function onReplyButtonClick(e: MouseEvent): void {
    const btn = (e.target as Element).closest(KAYAKO_SELECTORS.sendReplyButtonBaseSelector) as HTMLElement | null;
    if (!btn) return;

    // If it's a public reply (not an internal note)
    const isNote = btn.matches(KAYAKO_SELECTORS.sendReplyButtonAsNote);
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