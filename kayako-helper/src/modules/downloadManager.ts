/* modules/downloadManager.ts
   ──────────────────────────────────────────────────────────
   Injects the “Create folder” button when viewing a ticket. */

import { EXTENSION_SELECTORS, KAYAKO_SELECTORS } from '@/selectors';
import { currentConvId } from '@/utils/location';

export function injectCreateFolderButton(): void {
    const ticketId = currentConvId();

    /* 1) Not on a ticket? Clean up stray buttons & bail */
    if (!ticketId) {
        document
            .querySelectorAll(EXTENSION_SELECTORS.createFolderButton)
            .forEach(btn => btn.remove());
        return;
    }

    /* 2) Need the custom area first; if it isn’t there yet just exit—
          our MutationObserver will retry when the DOM changes.        */
    const container = document.querySelector<HTMLElement>(
        EXTENSION_SELECTORS.tabStripCustomButtonArea
    );
    if (!container) return;

    /* 3) Already injected? Nothing to do. */
    if (container.querySelector(EXTENSION_SELECTORS.createFolderButton)) return;

    /* 4) Build the button */
    const btn = document.createElement('button');
    btn.id = EXTENSION_SELECTORS.createFolderButton.replace(/^#/, '');
    btn.textContent = 'Create folder';
    btn.className = EXTENSION_SELECTORS.tabStripButtonClass.replace(/^./, '');

    /* 5) Inject */
    container.appendChild(btn);

    /* 6) Wire events */
    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
            action: 'createFolder',
            ticketId,
            location: 'V',
        });
    });

    btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        chrome.runtime.sendMessage({
            action: 'createFolder',
            ticketId,
            location: 'DOWNLOADS',
        });
    });
}

/* Observe DOM mutations and run the injector */
export function bootDownloadManager(): void {
    const obs = new MutationObserver(injectCreateFolderButton);
    obs.observe(document.body, { childList: true, subtree: true });
    injectCreateFolderButton(); // initial run
}

/* Result handler */
chrome.runtime.onMessage.addListener(msg => {
    if (msg.action !== 'createFolderResult') return;

    if (!msg.success) {
        alert(`❌ Error creating folder: ${msg.error}`);
    } else if (msg.alreadyExisted) {
        alert(`⚠️ Folder already exists at:\n${msg.path}`);
    } else {
        alert(`✅ Folder created at:\n${msg.path}`);
    }
});
