/* modules/download-manager/createFolderButton.ts
   ──────────────────────────────────────────────────────────
   Sets up the “Create folder” button – now via buttonManager. */

import {
    EXTENSION_SELECTORS, KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

import { currentConvId }       from '@/utils/location.ts';
import { registerButton }   from '@/modules/kayako/buttons/buttonManager.ts';

export function bootCreateFolderButton(): void {
    registerButton({
        id   : EXTENSION_SELECTORS.createFolderButton.replace(/^#/, ''),
        label: () => '📁 Create folder',
        routeTest: () => !!currentConvId(),

        onClick() {
            const ticketId = currentConvId();
            if (!ticketId) return;
            const requester = document
                .querySelector(KAYAKO_SELECTORS.requesterEmail)
                ?.textContent?.trim();
            chrome.runtime.sendMessage({
                action: 'createFolder',
                ticketId: `${requester} - ${ticketId}`,
                location: 'V',
            });
        },

        onContextMenu() {
            const ticketId = currentConvId();
            if (!ticketId) return;
            const requester = document
                .querySelector(KAYAKO_SELECTORS.requesterEmail)
                ?.textContent?.trim();
            chrome.runtime.sendMessage({
                action: 'createFolder',
                ticketId: `${requester} - ${ticketId}`,
                location: 'DOWNLOADS',
            });
        },

        groupId   : EXTENSION_SELECTORS.tabStripCustomButtonAreaGroup1,
        groupOrder: 1,
    });

    /* result listener unchanged */
    chrome.runtime.onMessage.addListener(msg => {
        if (msg.action !== 'createFolderResult') return;
        const { success, alreadyExisted, error, path } = msg;
        if (!success)          alert(`❌ Error creating folder: ${error}`);
        else if (alreadyExisted) alert(`⚠️ Folder already exists at:\n${path}`);
        else                    alert(`✅ Folder created at:\n${path}`);
    });
}
