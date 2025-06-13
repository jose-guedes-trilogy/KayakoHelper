/* modules/download-manager/createFolderButton.ts
   ──────────────────────────────────────────────────────────
   Sets up the “Create folder” button – now via tabButtonManager. */

import {
    EXTENSION_SELECTORS,
} from '@/generated/selectors';

import { currentConvId }       from '@/utils/location';
import { registerTabButton }   from '@/utils/tabButtonManager';

export function bootCreateFolderButton(): void {
    registerTabButton({
        id   : EXTENSION_SELECTORS.createFolderButton.replace(/^#/, ''),
        label: () => 'Create folder',
        routeTest: () => !!currentConvId(),   // only on ticket pages

        onClick(_btn) {
            const ticketId = currentConvId();
            if (!ticketId) return;
            chrome.runtime.sendMessage({ action: 'createFolder',
                ticketId, location: 'V' });
        },

        onContextMenu(_ev, _btn) {
            const ticketId = currentConvId();
            if (!ticketId) return;
            chrome.runtime.sendMessage({ action: 'createFolder',
                ticketId, location: 'DOWNLOADS' });
        },
    });

    /* Result handler – untouched */
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
}
