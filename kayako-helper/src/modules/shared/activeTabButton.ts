/* ========================================================================
 * activeTabButton.ts – v1.2
 * Boots the “Make Active” button once per page.
 * Dynamic import keeps the parent content-script classic-safe.
 * ---------------------------------------------------------------------- */

import type { EXTENSION_SELECTORS as EXT } from '@/generated/selectors';

let SELECTORS: typeof EXT | null = null;

/** Loads selectors the first time we need them. */
async function getSelectors() {
    if (!SELECTORS) {
        const mod = await import(
            /* @vite-ignore */ chrome.runtime.getURL('dist/selectors.js')
            );
        SELECTORS = mod.EXTENSION_SELECTORS;
    }
    return SELECTORS!;
}

/**
 * Injects the button when the supplied predicate returns true.
 * Call from any content-script that wants the button.
 */
export async function initMakeTabActiveButton(
    shouldInit: () => boolean = () => true,
): Promise<void> {
    if (!shouldInit()) return;

    const selectors = await getSelectors();
    const BTN_ID = selectors.makeTabActiveButton.replace(/^#/, '');

    if (document.getElementById(BTN_ID)) return; // already on the page

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = 'Make Active';
    btn.className = 'kayako-helper__make-active-btn'; // styling is in CSS

    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage(
            { action: 'exportChat.setActiveTab' },
            () => (btn.textContent = 'Active ✔'),
        );
    });

    document.body.appendChild(btn);
}
