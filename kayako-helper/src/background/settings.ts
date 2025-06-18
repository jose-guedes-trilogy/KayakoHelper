/* background/settings.ts */

import type { ToBackground, FromBackground } from '@/messageTypes';

chrome.runtime.onMessage.addListener((msg: ToBackground, _sender, sendResponse) => {
    switch (msg.action) {
        case 'setTrainingMode':
            chrome.storage.sync.set({ trainingMode: msg.enabled }, () => {
                chrome.runtime.sendMessage(<FromBackground>{
                    action: 'trainingMode',
                    enabled: msg.enabled
                });
            });
            break;

        case 'getTrainingMode':
            chrome.storage.sync.get({ trainingMode: true }, items => {
                sendResponse(<FromBackground>{
                    action: 'trainingMode',
                    enabled: items.trainingMode as boolean
                });
            });
            return true;
    }
});