/* ===========================================================================
 * activeTabButton.ts – v1.0
 * Single helper that boots the “Make Active” button once per page.
 * ---------------------------------------------------------------------------
 */

import {EXTENSION_SELECTORS} from "@/generated/selectors";

/**
 * Injects the “Make Active” button when the supplied predicate returns `true`.
 * Call this from any content-script that needs the button.
 */
export function initMakeTabActiveButton(
    shouldInit: () => boolean = () => true,
): void {
    if (!shouldInit()) return;

    const BTN_ID = EXTENSION_SELECTORS.makeTabActiveButton.replace(/^#/, '');
    if (document.getElementById(BTN_ID)) return;   // already added on this page

    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.textContent = 'Make Active';

    // styling lives in CSS; class is only a hook for dev-tools
    btn.classList.add('kayako-helper__make-active-btn');

    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage(
            {action: 'exportChat.setActiveTab'},
            () => (btn.textContent = 'Active ✔'),
        );
    });

    document.body.appendChild(btn);
}
