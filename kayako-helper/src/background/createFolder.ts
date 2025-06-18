/* background/createFolder.ts */

import type { ToBackground, FromBackground } from '@/messageTypes';

chrome.runtime.onMessage.addListener((msg: ToBackground, _sender, sendResponse) => {
    switch (msg.action) {
        case 'createFolder':
            chrome.runtime.sendNativeMessage(
                'com.kayako_helper',
                { ticketId: msg.ticketId, location: msg.location },
                resp => {
                    if (chrome.runtime.lastError) {
                        sendResponse(<FromBackground>{
                            action: 'createFolderResult',
                            success: false,
                            error: chrome.runtime.lastError.message
                        });
                    } else {
                        sendResponse(<FromBackground>{
                            action: 'createFolderResult',
                            success: resp.success,
                            alreadyExisted: resp.alreadyExisted,
                            path: resp.path,
                            error: resp.error
                        });
                    }
                }
            );
            return true;
    }
});